import {registerForPublishedEvent} from './event-registration-api.mjs';
import {validPayload,findDraft} from './bridge-contract.mjs';
import {renderStoryEmail,renderEventEmail} from './brevo-email.mjs';
import {storyCreationIssue} from '../public/private-studio/composition-v2.mjs';
import {handleMailingRequest} from './mailing-api.mjs';
import {handleInstagramRequest} from './instagram-api.mjs';
import {resolveStudioAccess,studioStorageScope} from './studio-access.mjs';
import {contentType,publicationMedia,validate} from '../public/private-studio/studio-model.mjs';
import {publishWordPressPost,trashWordPressPost,restoreWordPressPost,verifyWordPressToken,verifyWordPressEventPlugin,wordpressEventRegistrations} from './wordpress-publication.mjs';
const WEBHOOK='https://giovangigli.app.n8n.cloud/webhook/heritage-studio-draft';
const MAX_BODY=12*1024*1024;
const encoder=new TextEncoder();
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
const error=(message,status=400)=>Object.assign(new Error(message),{status});
function database(env){if(!env.DB)throw error('La sauvegarde privée est indisponible.',503);return env.DB;}
async function boundedBody(request,limit=MAX_BODY){
  if(Number(request.headers.get('content-length')||0)>limit)throw error('Le dossier est trop volumineux.',413);
  const reader=request.body?.getReader();if(!reader)return new Uint8Array();
  const chunks=[];let size=0;
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw error('Le dossier est trop volumineux.',413);}chunks.push(value);}
  const data=new Uint8Array(size);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.byteLength;}return data;
}
async function bodyJson(request,limit=MAX_BODY){
  if(request.headers.get('content-type')?.split(';')[0]!=='application/json')throw error('Format de demande invalide.',415);
  try{return JSON.parse(new TextDecoder().decode(await boundedBody(request,limit)));}catch(e){if(e.status)throw e;throw error('Le dossier est illisible.');}
}
function cryptoKey(env){
  if(!env.STUDIO_CONNECTION_KEY)throw error('La connexion hébergée doit être configurée.',503);
  return crypto.subtle.importKey('raw',Uint8Array.from(atob(env.STUDIO_CONNECTION_KEY),c=>c.charCodeAt(0)),{name:'AES-GCM'},false,['encrypt','decrypt']);
}
export async function encryptToken(token,env){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ciphertext=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},await cryptoKey(env),encoder.encode(token)));
  return JSON.stringify({iv:btoa(String.fromCharCode(...iv)),ciphertext:btoa(String.fromCharCode(...ciphertext))});
}
export async function decryptToken(value,env){
  const {iv,ciphertext}=JSON.parse(value);
  return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:Uint8Array.from(atob(iv),c=>c.charCodeAt(0))},await cryptoKey(env),Uint8Array.from(atob(ciphertext),c=>c.charCodeAt(0))));
}
async function connection(env,access){
  if(access.role!=='personal'&&env.N8N_STUDIO_WEBHOOK_TOKEN)return env.N8N_STUDIO_WEBHOOK_TOKEN;
  const row=await database(env).prepare('SELECT encrypted_token FROM studio_connections WHERE user_id = ?').bind(access.workspaceUserId).first();
  return row?decryptToken(row.encrypted_token,env):null;
}
async function wordpressConnection(env,access){
  if(env.WORDPRESS_ACCESS_TOKEN)return env.WORDPRESS_ACCESS_TOKEN;
  const row=await database(env).prepare('SELECT encrypted_token FROM studio_connections WHERE user_id = ?').bind('wordpress:'+access.workspaceUserId).first();
  if(!row)return null;
  const saved=await decryptToken(row.encrypted_token,env);
  if(saved.startsWith('{')){
    const value=JSON.parse(saved);
    if(value?.type==='application-password')return value;
  }
  return saved;
}
async function upstream(payload,token,fetchImpl,timeout=25000){
  const response=await fetchImpl(WEBHOOK,{method:'POST',headers:{'Content-Type':'application/json','X-Heritage-Studio-Token':token},body:JSON.stringify(payload),signal:AbortSignal.timeout(timeout)});
  const text=await response.text();let body=null;try{body=JSON.parse(text);}catch{}
  return {response,body};
}
async function probeN8n(token,fetchImpl,timeout){
  const payload={
    schema:1,dossier:{sourceText:'Suivi de composition'},photos:[],
    transport:{contrat:'hl.studio.job.1',action:'poll',ticket:crypto.randomUUID()},
  };
  const {response,body}=await upstream(payload,token,fetchImpl,timeout);
  if([401,403].includes(response.status))return 'rejected';
  const job=body?.output?.compositionResponse||body;
  const missing=job?.code==='job_not_found'||body?.code==='job_not_found';
  if(missing&&(response.ok||response.status===404))return null;
  if(response.ok&&['hl.studio.job.1','hl.composition.2'].includes(job?.contrat))return null;
  return 'upstream';
}
async function n8nStatus(env,access,fetchImpl){
  const result=(status,reason)=>json({
    connected:status==='ready',status,reason,checkedAt:new Date().toISOString(),protocol:4,webhookMode:'production',hosted:true,
  });
  let token;
  try{token=await connection(env,access);}
  catch{return result('unavailable','credentials');}
  if(!token)return result('setup','missing');
  try{
    const reason=await probeN8n(token,fetchImpl,3500);
    return reason?result('unavailable',reason):result('ready',null);
  }catch(e){return result('unavailable',e.name==='TimeoutError'?'timeout':'upstream');}
}
async function publicationHash(parts) {
  const digest=await crypto.subtle.digest('SHA-256',encoder.encode(JSON.stringify(parts)));
  return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}

async function trackedPublication(db,workspaceId,type,state,slug) {
  const find=key=>db.prepare(
    'SELECT slug,post_id,url,status,version_hash FROM studio_wordpress_publications WHERE slug = ? AND user_id = ? AND type = ?'
  ).bind(key,workspaceId,type).first();
  const previous=await find(state.draft?.wordpressSlug || slug);
  if(previous)return previous;
  // Earlier releases keyed each published revision separately.
  for(const entry of [...state.proposals].reverse()){
    const hash=await publicationHash([workspaceId,entry.at,entry.number,entry.output]);
    const legacy=await find('studio-'+hash.slice(0,24));
    if(legacy)return legacy;
  }
  return null;
}

async function publishStudioDossier({env,access,revision,reviewer,preview,fetchImpl}) {
  const db=database(env);
  const workspaceId=access.workspaceUserId;
  const token=crypto.randomUUID();
  const now=Date.now();
  const lock=await db.prepare(
    'INSERT INTO studio_wordpress_publication_locks (user_id,token,expires_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE expires_at <= ?'
  ).bind(workspaceId,token,now+15*60*1000,now).run();
  if(!lock.meta.changes)throw error('Une publication est en cours. Attendez sa confirmation puis actualisez le dossier.',409);

  try{
    const row=await db.prepare('SELECT state_json,revision FROM studio_sessions WHERE user_id = ?').bind(workspaceId).first();
    if((row?.revision ?? 0)!==revision||(!row&&preview===undefined))throw error('Le dossier a changé. Rechargez-le avant de publier.',409);
    const state=preview===undefined?JSON.parse(row.state_json):preview;
    if(state?.schema!==1||!state.dossier||!Array.isArray(state.proposals)||!state.proposals.length||!Array.isArray(state.history))throw error('L’aperçu du dossier est invalide.',400);
    let next;
    try{next=validate(state,reviewer);}catch(e){throw error(e.message,409);}
    const proposal=state.proposals.at(-1);
    const type=contentType(proposal.basis);
    const first=state.proposals[0];
    const dossierHash=await publicationHash([workspaceId,type,first.at,first.number]);
    const versionHash=await publicationHash([proposal.at,proposal.number,proposal.basis,proposal.output]);
    const stableSlug='studio-'+dossierHash.slice(0,24);
    const prior=await trackedPublication(db,workspaceId,type,state,stableSlug);
    const slug=prior?.slug || stableSlug;
    if(prior?.status==='trash')throw error('Cette publication a été retirée du site. Restaurez-la avant de la modifier.',409);

    let post;
    if(prior?.version_hash===versionHash){
      post={id:prior.post_id,url:prior.url,status:'publish'};
    }else{
      const credential=await wordpressConnection(env,access);
      if(proposal.output.siteEvent&&(proposal.output.event || proposal.basis.event)?.registrationMode==='site'){
        await verifyWordPressEventPlugin(credential,fetchImpl);
      }
      const images=[];
      for(const item of publicationMedia(proposal.basis)){
        if(!item.id||!item.credit?.trim()||!item.rights?.trim())throw error('Complétez le crédit et les droits de chaque image avant publication.',409);
        const object=await env.BUCKET?.get(workspaceId+'/media/'+item.id);
        if(!object)throw error('Une image du dossier est introuvable dans le stockage privé.',409);
        const contentType=object.httpMetadata?.contentType;
        if(!['image/png','image/jpeg','image/webp'].includes(contentType))throw error('WordPress accepte ici les images PNG, JPEG et WebP. Convertissez les autres formats avant publication.',409);
        const bytes=await object.arrayBuffer();
        if(bytes.byteLength>10*1024*1024)throw error('Une image dépasse 10 Mo. Réduisez-la avant publication.',413);
        images.push({bytes,contentType,name:item.name||'image',alt:item.alt||proposal.output.title,credit:item.credit});
      }
      post=await publishWordPressPost(credential,proposal,slug,fetchImpl,images,prior?.post_id ?? null);
    }

    next.draft={...next.draft,localSimulation:false,wordpressStatus:'publish',wordpressPostId:post.id,wordpressUrl:post.url,wordpressSlug:slug};
    next.status='Publié';
    next.history.push({status:'Publié',at:new Date().toISOString(),note:`Publication WordPress n°${post.id}`});
    const publishedDossier={...next,otherDossier:undefined};
    await db.prepare(
      'INSERT INTO studio_wordpress_publications (slug,user_id,post_id,title,type,url,status,created_at,state_json,version_hash) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(slug) DO UPDATE SET title=excluded.title,url=excluded.url,status=excluded.status,state_json=excluded.state_json,version_hash=excluded.version_hash'
    ).bind(slug,workspaceId,post.id,proposal.output.title,type,post.url,'publish',new Date().toISOString(),JSON.stringify(publishedDossier),versionHash).run();
    const saved=revision===0
      ?await db.prepare('INSERT INTO studio_sessions (user_id,state_json,revision,updated_at) VALUES (?,?,1,?) ON CONFLICT(user_id) DO NOTHING').bind(workspaceId,JSON.stringify(next),new Date().toISOString()).run()
      :await db.prepare('UPDATE studio_sessions SET state_json = ?, revision = revision + 1, updated_at = ? WHERE user_id = ? AND revision = ?').bind(JSON.stringify(next),new Date().toISOString(),workspaceId,revision).run();
    return json({state:next,revision:saved.meta.changes?revision+1:null,post});
  }finally{
    await db.prepare('DELETE FROM studio_wordpress_publication_locks WHERE user_id = ? AND token = ?').bind(workspaceId,token).run();
  }
}

export async function handleStudioRequest(request,env,user,{fetchImpl=fetch}={}){
  try{
    if(request.method==='POST'&&new URL(request.url).pathname==='/api/events/register')return await registerForPublishedEvent(request,env,r=>bodyJson(r,4096),fetchImpl);
    if(!user?.userId)return json({error:'Reconnectez-vous au Studio.',signInUrl:'/signin-with-chatgpt?return_to=%2F'},401);
    const access=resolveStudioAccess(env,user);
    if(!access)throw error('Ce compte n’a pas accès au Studio privé.',403);
    const path=new URL(request.url).pathname;
    if(request.method!=='GET'&&request.headers.get('origin')!==new URL(request.url).origin)throw error('Cette demande ne vient pas du Studio.',403);
    if(path==='/api/access'&&request.method==='GET'){
      const {role,canManageConnections,canScheduleMailing}=access;
      return json({role,canManageConnections,canScheduleMailing,storageScope:await studioStorageScope(user,access)});
    }
    if(path==='/api/publication/status'&&request.method==='GET'){
      try{
        const token=await wordpressConnection(env,access);
        if(!token)return json({connected:false,reason:'missing',managed:Boolean(env.WORDPRESS_ACCESS_TOKEN)});
        await verifyWordPressToken(token,fetchImpl);
        return json({connected:true,reason:null,managed:Boolean(env.WORDPRESS_ACCESS_TOKEN)});
      }catch{return json({connected:false,reason:'unavailable',managed:Boolean(env.WORDPRESS_ACCESS_TOKEN)});}
    }
    if(path==='/api/publication/setup'&&request.method==='POST'){
      if(!access.canManageConnections)throw error('La connexion WordPress est réservée à l’administration du Studio.',403);
      if(env.WORDPRESS_ACCESS_TOKEN)throw error('La connexion WordPress est gérée dans les réglages de l’hébergement.',409);
      const {token,username,password}=await bodyJson(request);
      let credential;
      if(typeof username==='string'||typeof password==='string'){
        if(typeof username!=='string'||!/^[A-Za-z0-9_.@+\-]{1,200}$/.test(username.trim())||typeof password!=='string'||password.length<16||password.length>200||/[\r\n]/.test(password))throw error('Saisissez l’identifiant WordPress et le mot de passe d’application complet.',400);
        credential={type:'application-password',username:username.trim(),password};
      }else{
        if(typeof token!=='string'||token.trim().length<20||token.length>500||/[\r\n]/.test(token))throw error('Saisissez un jeton WordPress complet.',400);
        credential=token.trim();
      }
      await verifyWordPressToken(credential,fetchImpl);
      const encrypted=await encryptToken(typeof credential==='string'?credential:JSON.stringify(credential),env);
      await database(env).prepare('INSERT INTO studio_connections (user_id,encrypted_token,updated_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET encrypted_token=excluded.encrypted_token,updated_at=excluded.updated_at').bind('wordpress:'+access.workspaceUserId,encrypted,new Date().toISOString()).run();
      return json({ok:true});
    }
    if(path==='/api/publication/list'&&request.method==='GET'){
      const rows=await database(env).prepare('SELECT post_id,title,type,url,status,created_at,state_json IS NOT NULL AS editable FROM studio_wordpress_publications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100').bind(access.workspaceUserId).all();
      return json({posts:rows.results||[]});
    }
    if(path.startsWith('/api/publication/dossier/')&&request.method==='GET'){
      const postId=Number(path.slice('/api/publication/dossier/'.length));
      if(!Number.isSafeInteger(postId)||postId<1)throw error('Référence de publication invalide.');
      const publication=await database(env).prepare(
        "SELECT state_json,url FROM studio_wordpress_publications WHERE user_id = ? AND post_id = ? AND status = 'publish'"
      ).bind(access.workspaceUserId,postId).first();
      if(!publication?.state_json)throw error('Le dossier source de cette publication n’est pas disponible dans le Studio.',404);
      const state=JSON.parse(publication.state_json);
      state.draft.wordpressUrl=publication.url;
      return json({state});
    }
    if(path==='/api/publication/publish'&&request.method==='POST'){
      const {reviewer:requestedReviewer,revision,preview}=await bodyJson(request);
      const reviewer=preview===undefined?requestedReviewer:(user.fullName || user.displayName || user.email || 'Équipe Studio').trim().slice(0,120);
      if(typeof reviewer!=='string'||reviewer.trim().length<2||reviewer.length>120||!Number.isSafeInteger(revision)||revision<0)throw error('Indiquez la personne qui valide et rechargez le dossier.',400);
      return await publishStudioDossier({env,access,revision,reviewer,preview,fetchImpl});
    }
    if(path==='/api/publication/trash'&&request.method==='POST'){
      const {revision,postId}=await bodyJson(request);
      if(!Number.isSafeInteger(postId)||postId<1)throw error('Référence de publication invalide.',400);
      const db=database(env);
      const tracked=await db.prepare('SELECT post_id,status FROM studio_wordpress_publications WHERE post_id = ? AND user_id = ?').bind(postId,access.workspaceUserId).first();
      if(!tracked||tracked.status!=='publish')throw error('Cette publication n’est pas active dans le Studio.',403);
      await trashWordPressPost(await wordpressConnection(env,access),postId,fetchImpl);
      await db.prepare('UPDATE studio_wordpress_publications SET status = ? WHERE post_id = ? AND user_id = ?').bind('trash',postId,access.workspaceUserId).run();
      const row=await db.prepare('SELECT state_json,revision FROM studio_sessions WHERE user_id = ?').bind(access.workspaceUserId).first();
      if(row&&row.revision===revision){
        const state=JSON.parse(row.state_json);
        if(state.draft?.wordpressPostId===postId){
          state.draft.wordpressStatus='trash';state.status='Retiré du site';
          state.history.push({status:'Retiré du site',at:new Date().toISOString(),note:`Publication WordPress n°${postId} placée dans la corbeille`});
          const saved=await db.prepare('UPDATE studio_sessions SET state_json = ?, revision = revision + 1, updated_at = ? WHERE user_id = ? AND revision = ?').bind(JSON.stringify(state),new Date().toISOString(),access.workspaceUserId,revision).run();
          if(saved.meta.changes)return json({state,revision:revision+1});
        }
      }
      return json({state:null,revision:null});
    }
    if(path==='/api/publication/restore'&&request.method==='POST'){
      const {postId,revision}=await bodyJson(request);
      if(!Number.isSafeInteger(postId)||postId<1)throw error('Référence de publication invalide.',400);
      const db=database(env);
      const tracked=await db.prepare('SELECT post_id,status FROM studio_wordpress_publications WHERE post_id = ? AND user_id = ?').bind(postId,access.workspaceUserId).first();
      if(!tracked||tracked.status!=='trash')throw error('Cette publication n’est pas dans la corbeille du Studio.',403);
      const post=await restoreWordPressPost(await wordpressConnection(env,access),postId,fetchImpl);
      await db.prepare('UPDATE studio_wordpress_publications SET status = ?, url = ? WHERE post_id = ? AND user_id = ?').bind('publish',post.url,postId,access.workspaceUserId).run();
      const row=await db.prepare('SELECT state_json,revision FROM studio_sessions WHERE user_id = ?').bind(access.workspaceUserId).first();
      if(row&&row.revision===revision){
        const state=JSON.parse(row.state_json);
        if(state.draft?.wordpressPostId===postId){
          state.draft.wordpressStatus='publish';state.draft.wordpressUrl=post.url;state.status='Publié';
          state.history.push({status:'Publié',at:new Date().toISOString(),note:`Publication WordPress n°${postId} restaurée`});
          const saved=await db.prepare('UPDATE studio_sessions SET state_json = ?, revision = revision + 1, updated_at = ? WHERE user_id = ? AND revision = ?').bind(JSON.stringify(state),new Date().toISOString(),access.workspaceUserId,revision).run();
          if(saved.meta.changes)return json({post,state,revision:revision+1});
        }
      }
      return json({post,state:null,revision:null});
    }
    if(path.startsWith('/api/mailing/')){
      const listWordPressRegistrations=async (eventId,afterEmail)=>wordpressEventRegistrations(
        await wordpressConnection(env,access),eventId,afterEmail,fetchImpl,
      );
      const result=await handleMailingRequest(path,request,env,user,{db:database(env),bodyJson,encryptToken,decryptToken,fetchImpl,access,listWordPressRegistrations});
      if(result)return result;
    }
    if(path.startsWith('/api/instagram/')){
      const result=await handleInstagramRequest(path,request,env,{db:database(env),access,bodyJson,boundedBody,encryptToken,decryptToken,wordpressConnection,fetchImpl});
      if(result)return result;
    }
    if(path==='/api/status'&&request.method==='GET')return n8nStatus(env,access,fetchImpl);
    if(path==='/api/setup'&&request.method==='POST'){
      if(!access.canManageConnections)throw error('La connexion n8n est réservée à l’administration du Studio.',403);
      if(access.role==='owner'&&env.N8N_STUDIO_WEBHOOK_TOKEN)throw error('La connexion n8n est gérée dans les réglages de l’hébergement.',409);
      const {token}=await bodyJson(request);
      if(typeof token!=='string'||token.trim().length<16||token.trim().length>256||/[\r\n]/.test(token))throw error('Saisissez le jeton complet du Studio.');
      const clean=token.trim();
      const reason=await probeN8n(clean,fetchImpl,10000);
      if(reason==='rejected')throw error('Ce jeton a été refusé par n8n. Vérifiez-le puis réessayez.',401);
      if(reason)throw error('La connexion à n8n n’a pas pu être vérifiée. Réessayez.',502);
      const encrypted=await encryptToken(clean,env);
      await database(env).prepare('INSERT INTO studio_connections (user_id, encrypted_token, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET encrypted_token=excluded.encrypted_token, updated_at=excluded.updated_at').bind(access.workspaceUserId,encrypted,new Date().toISOString()).run();
      return json({ok:true});
    }
    if(path==='/api/session'&&request.method==='GET'){
      const row=await database(env).prepare('SELECT state_json, revision FROM studio_sessions WHERE user_id = ?').bind(access.workspaceUserId).first();
      return json(row?{state:JSON.parse(row.state_json),revision:row.revision}:{state:null,revision:0});
    }
    if(path==='/api/session'&&request.method==='PUT'){
      const {state,revision}=await bodyJson(request);
      if(state?.schema!==1||!state.dossier||!Array.isArray(state.proposals)||!Array.isArray(state.history)||!Number.isSafeInteger(revision)||revision<0)throw error('La sauvegarde du dossier est invalide.');
      const saved=JSON.stringify(state),now=new Date().toISOString();let result;
      if(revision===0)result=await database(env).prepare('INSERT INTO studio_sessions (user_id, state_json, revision, updated_at) VALUES (?, ?, 1, ?) ON CONFLICT(user_id) DO NOTHING').bind(access.workspaceUserId,saved,now).run();
      else result=await database(env).prepare('UPDATE studio_sessions SET state_json = ?, revision = revision + 1, updated_at = ? WHERE user_id = ? AND revision = ?').bind(saved,now,access.workspaceUserId,revision).run();
      if(!result.meta.changes)throw error('Une autre fenêtre a enregistré une version plus récente. Vos saisies restent dans ce navigateur. Rechargez pour retrouver la version en ligne.',409);
      return json({ok:true,revision:revision+1});
    }
    if(path==='/api/email/preview'&&request.method==='POST'){
      const {type,input}=await bodyJson(request);
      if(!['recit','evenement'].includes(type)||!input||typeof input!=='object'||Array.isArray(input)||JSON.stringify(input).length>20000)throw error('Données de l’e-mail invalides.');
      let email;
      try { email=type==='evenement'?renderEventEmail(input):renderStoryEmail(input); }
      catch { throw error('Complétez le titre, le texte, la date si nécessaire et un lien HTTPS valide.'); }
      return json(email);
    }
    if(path.startsWith('/api/media/')){
      const id=path.slice('/api/media/'.length);
      if(!/^[a-zA-Z0-9_-]{1,200}$/.test(id))throw error('Référence d’image invalide.');
      if(!env.BUCKET)throw error('La sauvegarde des images est indisponible.',503);
      const key=access.workspaceUserId+'/media/'+id;
      if(request.method==='GET'){
        const object=await env.BUCKET.get(key);if(!object)return json({error:'Image à rattacher.'},404);
        return new Response(object.body,{headers:{'Content-Type':object.httpMetadata?.contentType||'application/octet-stream','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'; style-src 'unsafe-inline'"}});
      }
      if(request.method==='PUT'){
        const type=request.headers.get('content-type')?.split(';')[0];if(!['image/png','image/jpeg','image/webp','image/svg+xml'].includes(type))throw error('Ce format d’image n’est pas accepté.',415);
        const bytes=await boundedBody(request,20*1024*1024);if(!bytes.byteLength)throw error('Le fichier image est vide.');
        await env.BUCKET.put(key,bytes,{httpMetadata:{contentType:type}});return json({ok:true});
      }
    }
    if(path==='/api/intake'&&request.method==='POST'){
      const payload=await bodyJson(request);if(!validPayload(payload))throw error('Texte ou photos invalides pour n8n.');
      if(payload.schema===2&&payload.transport?.action!=='poll'){
        const issue=storyCreationIssue(payload.entreeComposition);
        if(issue)throw error(issue);
      }
      const personal=access.role==='personal';
      const token=await connection(env,access);
      if(!token)throw error(personal?'Connectez n8n dans « Connexion n8n » pour envoyer votre demande au modèle.':'La connexion au modèle doit être configurée par l’administration du Studio.',503);
      const {response,body}=await upstream(payload,token,fetchImpl);
      if([401,403].includes(response.status)){
        return json({error:personal?'La connexion n8n a été refusée. Ouvrez « Connexion n8n » pour la rétablir.':'La connexion au modèle doit être vérifiée par l’administration du Studio.'},personal?401:502);
      }
      if(!response.ok)return json({error:body?.error||`Le flux n8n a répondu avec une erreur (${response.status}).`,...(body?.code?{code:body.code}:{})},502);
      const output=findDraft(body);if(!output)return json({error:body?.error||'n8n n’a pas renvoyé de composition vérifiable.',...(body?.code?{code:body.code}:{})},502);
      return json({ok:true,receivedPhotos:payload.photos.length,output});
    }
    return json({error:'Adresse introuvable.'},404);
  }catch(e){return json({error:e.status?e.message:e.name==='TimeoutError'?'La connexion à n8n prend trop de temps. Le suivi reprendra sans renvoyer le dossier.':'Une erreur empêche cette action. Vos saisies sont conservées.'},e.status||502);}
}
