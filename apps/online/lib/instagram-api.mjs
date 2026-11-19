import {fetchPublishedContent} from './mailing-content.mjs';
import {uploadWordPressMedia} from './wordpress-publication.mjs';

const GRAPH='https://graph.instagram.com/v27.0';
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
const now=()=>new Date().toISOString();
const validId=value=>typeof value==='string'&&/^[0-9]+$/.test(value);

async function graph(path,token,{method='GET',params={},fetchImpl=fetch}={}){
  const url=new URL(GRAPH+path);
  if(method==='GET')for(const [key,value] of Object.entries({...params,access_token:token}))url.searchParams.set(key,String(value));
  const response=await fetchImpl(url.href,{method,headers:{Accept:'application/json',...(method==='POST'?{'Content-Type':'application/x-www-form-urlencoded'}:{})},...(method==='POST'?{body:new URLSearchParams({...params,access_token:token})}:{}),signal:AbortSignal.timeout(20000)});
  const payload=await response.json().catch(()=>null);
  if(!response.ok||payload?.error)throw fail([190,10,200].includes(payload?.error?.code)||[401,403].includes(response.status)?'Meta a refusé le jeton ou le droit de publication Instagram.':'Meta a refusé cette opération. Vérifiez le compte et réessayez.',[190,10,200].includes(payload?.error?.code)?401:502);
  return payload;
}

async function profile(token,fetchImpl){
  const result=await graph('/me',token,{params:{fields:'id,username,account_type'},fetchImpl});
  if(!validId(result?.id)||typeof result.username!=='string'||!result.username)throw fail('Meta ne renvoie pas un compte Instagram vérifiable.',502);
  if(result.account_type&&result.account_type!=='BUSINESS'&&result.account_type!=='MEDIA_CREATOR')throw fail('Le compte Instagram doit être professionnel.',409);
  return {id:result.id,username:result.username,accountType:result.account_type||null};
}

async function connection(env,db,userId,decryptToken){
  if(env.INSTAGRAM_ACCESS_TOKEN){
    return {token:env.INSTAGRAM_ACCESS_TOKEN,expectedUsername:env.INSTAGRAM_EXPECTED_USERNAME||'',managed:true};
  }
  const row=await db.prepare('SELECT encrypted_token FROM studio_connections WHERE user_id = ?').bind('instagram:'+userId).first();
  return row?{...JSON.parse(await decryptToken(row.encrypted_token,env)),managed:false}:null;
}

// JPEG markers contain the actual dimensions; do not trust dimensions sent by the browser.
export function jpegDimensions(bytes){
  if(bytes.length<100||bytes[0]!==0xff||bytes[1]!==0xd8)return null;
  let offset=2;
  while(offset+9<bytes.length){
    if(bytes[offset]!==0xff)return null;
    const marker=bytes[offset+1];offset+=2;
    if(marker===0xd9||marker===0xda)break;
    if(marker===0x01||marker>=0xd0&&marker<=0xd7)continue;
    const length=bytes[offset]*256+bytes[offset+1];
    if(length<2||offset+length>bytes.length)return null;
    if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)){
      return {width:bytes[offset+5]*256+bytes[offset+6],height:bytes[offset+3]*256+bytes[offset+4]};
    }
    offset+=length;
  }
  return null;
}

async function story(postId,fetchImpl){
  if(!Number.isSafeInteger(postId)||postId<1)throw fail('Choisissez un récit publié.');
  const post=(await fetchPublishedContent(fetchImpl)).find(item=>item.id===postId&&item.type==='recit');
  if(!post)throw fail('Ce récit n’est plus publié sur le site.',409);
  return post;
}

async function saveJob(db,job){
  await db.prepare('UPDATE studio_instagram_jobs SET status = ?, state_json = ?, updated_at = ? WHERE id = ?')
    .bind(job.status,JSON.stringify(job),now(),job.id).run();
}

export async function handleInstagramRequest(path,request,env,{db,access,bodyJson,boundedBody,encryptToken,decryptToken,wordpressConnection,fetchImpl=fetch}){
  const userId=access.workspaceUserId;
  if(path==='/api/instagram/status'&&request.method==='GET'){
    try{
      const saved=await connection(env,db,userId,decryptToken);
      if(!saved)return json({connected:false,status:'setup',reason:'missing',managed:false});
      const account=await profile(saved.token,fetchImpl);
      if(saved.expectedUsername&&account.username.toLowerCase()!==saved.expectedUsername.toLowerCase())return json({connected:false,status:'unavailable',reason:'account_mismatch',managed:saved.managed});
      return json({connected:true,status:'ready',username:account.username,accountType:account.accountType,managed:saved.managed,checkedAt:now()});
    }catch{return json({connected:false,status:'unavailable',reason:'rejected',managed:Boolean(env.INSTAGRAM_ACCESS_TOKEN)});}
  }
  if(path==='/api/instagram/setup'&&request.method==='POST'){
    if(!access.canManageConnections)throw fail('La connexion Instagram est réservée à l’administration.',403);
    if(env.INSTAGRAM_ACCESS_TOKEN)throw fail('La connexion Instagram est gérée dans l’hébergement.',409);
    const {token,username}=await bodyJson(request,2048);
    if(typeof token!=='string'||token.trim().length<30||token.length>1024||/[\r\n]/.test(token)||typeof username!=='string'||!/^@?[a-zA-Z0-9._]{1,30}$/.test(username.trim()))throw fail('Saisissez le jeton Meta et le nom du compte Instagram attendus.');
    const expectedUsername=username.trim().replace(/^@/,'');
    const account=await profile(token.trim(),fetchImpl);
    if(account.username.toLowerCase()!==expectedUsername.toLowerCase())throw fail(`Ce jeton donne accès à @${account.username}, pas à @${expectedUsername}.`,409);
    const encrypted=await encryptToken(JSON.stringify({token:token.trim(),expectedUsername,id:account.id}),env);
    await db.prepare('INSERT INTO studio_connections (user_id,encrypted_token,updated_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET encrypted_token=excluded.encrypted_token,updated_at=excluded.updated_at').bind('instagram:'+userId,encrypted,now()).run();
    return json({ok:true,username:account.username});
  }
  if(path==='/api/instagram/jobs'&&request.method==='GET'){
    const rows=await db.prepare('SELECT state_json FROM studio_instagram_jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT 20').bind(userId).all();
    return json({jobs:(rows.results||[]).map(row=>JSON.parse(row.state_json))});
  }
  if(path==='/api/instagram/asset'&&request.method==='POST'){
    if(access.role!=='owner'&&access.role!=='personal')throw fail('La publication Instagram est réservée à l’administrateur.',403);
    const postId=Number(new URL(request.url).searchParams.get('postId'));
    const position=Number(new URL(request.url).searchParams.get('position'));
    const post=await story(postId,fetchImpl);
    if(!Number.isSafeInteger(position)||position<1||position>10)throw fail('Numéro de carte invalide.');
    if(request.headers.get('content-type')?.split(';')[0]!=='image/jpeg')throw fail('Les cartes doivent être au format JPEG.',415);
    const bytes=await boundedBody(request,8_000_000);
    const dimensions=jpegDimensions(bytes);
    if(dimensions?.width!==1080||dimensions?.height!==1350)throw fail('La carte doit mesurer 1080 × 1350 pixels.');
    const uploaded=await uploadWordPressMedia(await wordpressConnection(env,access),{bytes,contentType:'image/jpeg',name:`instagram-${postId}-${crypto.randomUUID()}.jpg`,alt:`${post.title} — carte ${position}`,credit:'Héritage Libanais'},fetchImpl);
    const id=crypto.randomUUID();
    await db.prepare('INSERT INTO studio_instagram_assets (id,user_id,post_id,media_id,url,created_at) VALUES (?,?,?,?,?,?)').bind(id,userId,postId,uploaded.id,uploaded.url,now()).run();
    return json({asset:{id,url:uploaded.url,position}});
  }
  if(path==='/api/instagram/publish'&&request.method==='POST'){
    if(access.role!=='owner'&&access.role!=='personal')throw fail('La publication Instagram est réservée à l’administrateur.',403);
    const input=await bodyJson(request,8192);
    if(input?.confirmed!==true||!Number.isSafeInteger(input.postId)||!Array.isArray(input.assetIds)||input.assetIds.length<2||input.assetIds.length>10||new Set(input.assetIds).size!==input.assetIds.length||input.assetIds.some(id=>typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id))||typeof input.caption!=='string'||!input.caption.trim()||input.caption.length>2200||typeof input.requestId!=='string'||!/^[0-9a-f-]{36}$/i.test(input.requestId))throw fail('Relisez les cartes et la légende, puis confirmez la publication.');
    const prior=await db.prepare('SELECT state_json FROM studio_instagram_jobs WHERE request_id = ? AND user_id = ?').bind(input.requestId,userId).first();
    if(prior)return json({job:JSON.parse(prior.state_json)});
    const existing=await db.prepare('SELECT id,status FROM studio_instagram_jobs WHERE user_id = ? AND post_id = ?').bind(userId,input.postId).first();
    if(existing&&existing.status!=='failed')throw fail('Un envoi de ce récit existe déjà. Vérifiez son état avant de recommencer.',409);
    const post=await story(input.postId,fetchImpl);
    const assets=[];
    for(const id of input.assetIds){
      const asset=await db.prepare('SELECT id,url FROM studio_instagram_assets WHERE id = ? AND user_id = ? AND post_id = ?').bind(id,userId,input.postId).first();
      if(!asset)throw fail('Une carte n’a pas été préparée pour ce récit.',409);
      assets.push(asset);
    }
    const saved=await connection(env,db,userId,decryptToken);
    if(!saved)throw fail('Connectez Instagram avant de publier.',409);
    const account=await profile(saved.token,fetchImpl);
    if((saved.id&&saved.id!==account.id)||(saved.expectedUsername&&saved.expectedUsername.toLowerCase()!==account.username.toLowerCase()))throw fail('Le compte Instagram connecté a changé. Vérifiez la connexion.',409);
    const job={id:existing?.id||crypto.randomUUID(),requestId:input.requestId,postId:post.id,title:post.title,username:account.username,caption:input.caption.trim(),assetIds:input.assetIds,status:'preparing',createdAt:now(),childIds:[],containerId:null,mediaId:null,permalink:null};
    if(existing){
      const updated=await db.prepare("UPDATE studio_instagram_jobs SET request_id = ?,status = ?,state_json = ?,created_at = ?,updated_at = ? WHERE id = ? AND status = 'failed'").bind(job.requestId,job.status,JSON.stringify(job),job.createdAt,job.createdAt,job.id).run();
      if(!updated.meta.changes)throw fail('Un autre envoi de ce récit est déjà en cours.',409);
    }else{
      try{await db.prepare('INSERT INTO studio_instagram_jobs (id,user_id,request_id,post_id,status,state_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').bind(job.id,userId,job.requestId,post.id,job.status,JSON.stringify(job),job.createdAt,job.createdAt).run();}
      catch{throw fail('Un autre envoi de ce récit est déjà en cours.',409);}
    }
    try{
      for(const asset of assets){
        const child=await graph(`/${account.id}/media`,saved.token,{method:'POST',params:{image_url:asset.url,is_carousel_item:'true'},fetchImpl});
        if(!validId(child?.id))throw fail('Meta n’a pas confirmé une carte.',502);
        job.childIds.push(child.id);await saveJob(db,job);
      }
      const parent=await graph(`/${account.id}/media`,saved.token,{method:'POST',params:{media_type:'CAROUSEL',children:job.childIds.join(','),caption:job.caption},fetchImpl});
      if(!validId(parent?.id))throw fail('Meta n’a pas confirmé le carrousel.',502);
      job.containerId=parent.id;await saveJob(db,job);
      for(let attempt=0;attempt<6;attempt++){
        const state=await graph(`/${parent.id}`,saved.token,{params:{fields:'status_code'},fetchImpl});
        if(state.status_code==='FINISHED')break;
        if(state.status_code==='ERROR'||state.status_code==='EXPIRED')throw fail('Meta a refusé la préparation du carrousel.',502);
        if(attempt===5)throw fail('Le carrousel est encore en préparation chez Meta. Vérifiez son état avant de réessayer.',502);
        await new Promise(resolve=>setTimeout(resolve,2000));
      }
      job.status='needs_review';await saveJob(db,job);
      const published=await graph(`/${account.id}/media_publish`,saved.token,{method:'POST',params:{creation_id:parent.id},fetchImpl});
      if(!validId(published?.id))throw fail('Meta n’a pas confirmé la publication. Vérifiez le compte Instagram.',502);
      job.mediaId=published.id;
      try{const detail=await graph(`/${published.id}`,saved.token,{params:{fields:'permalink'},fetchImpl});job.permalink=detail.permalink||null;}catch{}
      job.status='published';await saveJob(db,job);
      return json({job});
    }catch(error){
      if(job.status!=='needs_review')job.status='failed';
      job.error=error.message;
      await saveJob(db,job);
      throw error;
    }
  }
  return null;
}
