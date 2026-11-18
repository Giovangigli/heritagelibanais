import {listEventRegistrations} from './event-registrations.mjs';
import {fetchPublishedContent} from './mailing-content.mjs';
import {renderStoryEmail,renderEventEmail,renderAutomationPreview} from './brevo-email.mjs';

const BREVO='https://api.brevo.com/v3';
const ORGANIZATION='6ae79b0ecddd8ac19c05da12';
const NEWSLETTER_LIST=3;
const DAY_CAP=250; // Leave at least 50 of the Free plan's 300 sends for signups and welcome emails.
const MAX_AUDIENCE=400;
const failure=(message,status=400,details={})=>Object.assign(new Error(message),{status,...details});
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});

async function brevo(key,path,{method='GET',body,fetchImpl=fetch}={}){
  const response=await fetchImpl(BREVO+path,{method,headers:{'api-key':key,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(16000)});
  const text=await response.text();let value=null;try{value=JSON.parse(text);}catch{}
  if(!response.ok)throw failure(response.status===401||response.status===403?'La connexion Brevo ne permet pas cette action.':response.status===402?'Le quota d’envoi Brevo est insuffisant.':`Brevo a refusé l’opération (${response.status}).`,response.status===401||response.status===403?403:502,{providerStatus:response.status});
  return value;
}

async function storedKey(db,env,userId,decryptToken){
  const row=await db.prepare('SELECT encrypted_token FROM studio_connections WHERE user_id = ?').bind('brevo:'+userId).first();
  return row?decryptToken(row.encrypted_token,env):null;
}
async function expectedAccount(key,fetchImpl){
  const account=await brevo(key,'/account',{fetchImpl});
  if(typeof account?.organization_id!=='string')throw failure('Le compte Brevo ne peut pas être vérifié.',502);
  if(account.organization_id!==ORGANIZATION)throw failure('Cette clé appartient à un autre compte Brevo.',403,{reason:'account_mismatch'});
  return account;
}
async function verifyNewsletterList(key,fetchImpl){
  const missing=()=>failure('La liste newsletter est introuvable pour cette clé.',403,{reason:'list_missing'});
  try{
    const list=await brevo(key,`/contacts/lists/${NEWSLETTER_LIST}`,{fetchImpl});
    if(!Number.isSafeInteger(list?.id))throw failure('La liste Brevo ne peut pas être vérifiée.',502);
    if(list.id!==NEWSLETTER_LIST)throw missing();
  }catch(error){
    if(error.providerStatus===404)throw missing();
    throw error;
  }
}
function freeCampaignPlan(account){
  return Array.isArray(account.plan)?account.plan.find(item=>item.type==='free'&&item.creditsType==='sendLimit'):null;
}
function quotaExhausted(plan){
  return plan.credits===0||plan.credits==='0';
}
async function audience(key,fetchImpl){
  const contacts=[];
  for(let offset=0;offset<=2000;offset+=500){
    const page=await brevo(key,`/contacts/lists/${NEWSLETTER_LIST}/contacts?limit=500&offset=${offset}`,{fetchImpl});
    if(!Array.isArray(page?.contacts))throw failure('La liste Brevo ne peut pas être vérifiée.',502);
    contacts.push(...page.contacts);
    if(contacts.length>=page.count||page.contacts.length<500)break;
  }
  if(contacts.length>2000)throw failure('La liste dépasse la capacité de vérification du Studio.',409);
  const unique=new Map();
  for(const contact of contacts){
    if(!Number.isSafeInteger(contact.id)||!contact.email||contact.emailBlacklisted||contact.listUnsubscribed?.includes(NEWSLETTER_LIST))continue;
    if(contact.attributes?.HL_SIGNUP_SOURCE!=='heritage-libanais.fr/la-lettre'||!contact.attributes?.HL_CONSENT_VERSION)continue;
    unique.set(contact.id,contact);
  }
  return [...unique.values()].sort((a,b)=>a.id-b.id);
}
async function publicSender(key,fetchImpl,configuredEmail){
  let domain;
  try{domain=await brevo(key,'/senders/domains/heritage-libanais.fr',{fetchImpl});}
  catch(error){if(error.providerStatus===404)return null;throw error;}
  if(typeof domain?.verified!=='boolean'||typeof domain?.authenticated!=='boolean')throw failure('Le domaine d’expédition Brevo ne peut pas être vérifié.',502);
  if(domain?.verified!==true||domain?.authenticated!==true)return null;
  const senders=await brevo(key,'/senders',{fetchImpl});
  if(!Array.isArray(senders?.senders))throw failure('Les expéditeurs Brevo ne peuvent pas être vérifiés.',502);
  return senders.senders.find(sender=>sender.active===true&&Number.isSafeInteger(sender.id)&&(
    configuredEmail?String(sender.email||'').toLowerCase()===configuredEmail.toLowerCase():String(sender.email||'').toLowerCase().endsWith('@heritage-libanais.fr')
  ))||null;
}
function offsetForParis(utcDate){
  const tz=new Intl.DateTimeFormat('en-US',{timeZone:'Europe/Paris',timeZoneName:'shortOffset'}).formatToParts(utcDate).find(x=>x.type==='timeZoneName')?.value||'GMT+1';
  const m=tz.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  return m?(m[1]==='-'?-1:1)*(Number(m[2])*60+Number(m[3]||0)):60;
}
export function nextParisMorning(daysFromToday,now=new Date()){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const get=type=>Number(parts.find(p=>p.type===type)?.value);
  const rough=new Date(Date.UTC(get('year'),get('month')-1,get('day')+daysFromToday,10));
  return new Date(rough.getTime()-offsetForParis(rough)*60000).toISOString();
}
async function resolvedEmail(input,fetchImpl){
  if(!Number.isSafeInteger(input?.postId)||typeof input.intro!=='string'||input.intro.trim().length<20||input.intro.length>1200)throw failure('Choisissez une publication et écrivez une introduction de 20 à 1 200 caractères.');
  if(input.subject!==undefined&&(typeof input.subject!=='string'||input.subject.trim().length<5||input.subject.length>160))throw failure('L’objet doit contenir de 5 à 160 caractères.');
  if(input.previewText!==undefined&&(typeof input.previewText!=='string'||input.previewText.trim().length<5||input.previewText.length>220))throw failure('Le texte d’aperçu doit contenir de 5 à 220 caractères.');
  const post=(await fetchPublishedContent(fetchImpl)).find(item=>item.id===input.postId);
  if(!post)throw failure('Cette publication n’est pas disponible pour un envoi.');
  const purpose=input.purpose||'announcement';
  if(!['announcement','reminder','invitation'].includes(purpose)||(purpose!=='announcement'&&post.type!=='evenement'))throw failure('Les invitations et rappels concernent uniquement les événements à venir.');
  const common={title:post.title,intro:input.intro.trim(),url:post.url,imageUrl:post.imageUrl,imageAlt:post.imageAlt,subject:input.subject?.trim(),previewText:input.previewText?.trim()};
  const email=post.type==='evenement'?renderEventEmail({...common,date:post.date,venue:post.venue,registrationUrl:post.registrationUrl,purpose}):renderStoryEmail(common);
  return {post,email,purpose};
}
async function hash(value){const bytes=new TextEncoder().encode(JSON.stringify(value));return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');}
async function saveJob(db,job){await db.prepare('UPDATE studio_mailing_jobs SET state_json = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(job),new Date().toISOString(),job.id).run();}

export async function handleMailingRequest(path,request,env,user,{db,bodyJson,encryptToken,decryptToken,fetchImpl=fetch,access={
  role:'personal',workspaceUserId:user.userId,canManageConnections:true,canScheduleMailing:true,
}}={}){
  const {role,workspaceUserId,canManageConnections,canScheduleMailing}=access;
  const serverKey=role==='owner'||role==='editor'?env.BREVO_API_KEY?.trim():null;
  const connectionManaged=Boolean(serverKey);
  const connectionKey=()=>serverKey||storedKey(db,env,workspaceUserId,decryptToken);
  if(path==='/api/mailing/content'&&request.method==='GET')return json({posts:await fetchPublishedContent(fetchImpl)});
  if(path==='/api/mailing/automation-preview'&&request.method==='GET'){
    const kind=new URL(request.url).searchParams.get('kind');
    if(!['welcome','registration','unsubscribe'].includes(kind))throw failure('Modèle inconnu.');
    return json(renderAutomationPreview(kind));
  }
  if(path==='/api/mailing/registrations.csv'&&request.method==='GET'){
    if(role!=='owner')throw failure('L’export est réservé au propriétaire du Studio.',403);
    const eventPostId=Number(new URL(request.url).searchParams.get('postId'));
    if(!Number.isSafeInteger(eventPostId)||eventPostId<=0)throw failure('Choisissez un événement WordPress.');
    const lines=['Nom,Email,Inscription UTC'];
    const cell=value=>{
      const text=String(value??'');
      return '"'+(/^[\s]*[=+@-]/u.test(text)?"'":"")+text.replaceAll('"','""')+'"';
    };
    let afterEmail='';
    for(;;){
      const page=await listEventRegistrations(db,{workspaceId:workspaceUserId,eventPostId,afterEmail,limit:500});
      for(const row of page)lines.push([row.name,row.email,row.created_at].map(cell).join(','));
      if(page.length<500)break;
      afterEmail=page.at(-1).email;
    }
    return new Response('\uFEFF'+lines.join('\r\n'),{headers:{
      'Content-Type':'text/csv; charset=utf-8','Cache-Control':'private, no-store',
      'Content-Disposition':`attachment; filename="inscriptions-${eventPostId}.csv"`,
      'X-Content-Type-Options':'nosniff',
    }});
  }
  if(path==='/api/mailing/status'&&request.method==='GET'){
    let connected=false;
    const checked=(status,reason,fields={})=>json({
      status,reason,connected,lastCheckedAt:new Date().toISOString(),connectionManaged,
      canManageConnections,canScheduleMailing,eligible:null,senderEmail:null,readyToSend:false,
      dayCap:DAY_CAP,maxAudience:MAX_AUDIENCE,...fields,
    });
    try{
      const key=await connectionKey();
      if(!key)return checked('needs_configuration','credentials_missing');
      const account=await expectedAccount(key,fetchImpl);
      connected=true;
      await verifyNewsletterList(key,fetchImpl);
      const plan=freeCampaignPlan(account);
      if(!plan)return checked('needs_configuration','plan_mismatch');
      const [people,sender]=await Promise.all([audience(key,fetchImpl),publicSender(key,fetchImpl,env.BREVO_SENDER_EMAIL)]);
      if(!sender)return checked('needs_configuration','sender_not_ready',{eligible:people.length});
      if(quotaExhausted(plan))return checked('unavailable','quota_exhausted',{eligible:people.length,senderEmail:sender.email});
      return checked('ready',null,{eligible:people.length,senderEmail:sender.email,readyToSend:canScheduleMailing});
    }catch(error){
      if([401,403].includes(error.providerStatus))return checked('needs_configuration','credentials_rejected',{connected:false});
      if(error.reason)return checked('needs_configuration',error.reason,{connected});
      return checked('unavailable','provider_unavailable');
    }
  }
  if(path==='/api/mailing/setup'&&request.method==='POST'){
    if(!canManageConnections)throw failure('Seul l’administrateur peut modifier la connexion Brevo.',403);
    if(connectionManaged)throw failure('La connexion Brevo est gérée par le serveur.',409);
    const {apiKey}=await bodyJson(request);
    if(typeof apiKey!=='string'||apiKey.trim().length<30||apiKey.length>256||/[\r\n]/.test(apiKey))throw failure('Saisissez une clé API v3 Brevo complète.');
    const clean=apiKey.trim();
    await expectedAccount(clean,fetchImpl);
    const encrypted=await encryptToken(clean,env),now=new Date().toISOString();
    await db.prepare('INSERT INTO studio_connections (user_id, encrypted_token, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET encrypted_token=excluded.encrypted_token,updated_at=excluded.updated_at').bind('brevo:'+workspaceUserId,encrypted,now).run();
    return json({ok:true});
  }
  if(path==='/api/mailing/preview'&&request.method==='POST'){
    const input=await bodyJson(request);const {post,email}=await resolvedEmail(input,fetchImpl);
    const registrations=post.id>0 && input.purpose==='reminder'
      ?await listEventRegistrations(db,{workspaceId:workspaceUserId,eventPostId:post.id,limit:MAX_AUDIENCE+1})
      :null;
    return json({post,email,registeredCount:input.purpose==='reminder'?(registrations?.length??0):null,contentHash:await hash({postId:post.id,email})});
  }
  if(path==='/api/mailing/jobs'&&request.method==='GET'){
    const rows=await db.prepare('SELECT state_json FROM studio_mailing_jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT 20').bind(workspaceUserId).all();
    return json({jobs:(rows.results||[]).map(row=>JSON.parse(row.state_json))});
  }
  if(path==='/api/mailing/send'&&request.method==='POST'){
    if(!canScheduleMailing)throw failure('Votre compte ne peut pas programmer de newsletter.',403);
    const input=await bodyJson(request);
    if(input?.confirmed!==true||typeof input?.requestId!=='string'||!/^[0-9a-f-]{36}$/i.test(input.requestId)||typeof input.contentHash!=='string')throw failure('Relisez l’aperçu et confirmez cet envoi.');
    const prior=await db.prepare('SELECT state_json FROM studio_mailing_jobs WHERE request_id = ? AND user_id = ?').bind(input.requestId,workspaceUserId).first();
    if(prior)return json({job:JSON.parse(prior.state_json)});
    const key=await connectionKey();
    if(!key)throw failure('La connexion Brevo doit être configurée avant de programmer cet envoi.',503);
    const {post,email,purpose}=await resolvedEmail(input,fetchImpl);

    const contentHash=await hash({postId:post.id,email});
    if(contentHash!==input.contentHash)throw failure('La publication ou l’e-mail a changé. Recommencez la prévisualisation.',409);
    const account=await expectedAccount(key,fetchImpl);
    const plan=freeCampaignPlan(account);
    if(!plan)throw failure('Le forfait Free Brevo a changé. Vérifiez-le avant l’envoi.',409);
    if(quotaExhausted(plan))throw failure('Le quota quotidien Brevo est atteint. Réessayez après son renouvellement.',409);
    let people;
    if(purpose==='reminder'){
      if(post.id<=0)throw failure('Les inscriptions à cet événement sont gérées en dehors du Studio.',409);
      const registrations=await listEventRegistrations(db,{workspaceId:workspaceUserId,eventPostId:post.id,limit:MAX_AUDIENCE+1});
      if(!registrations.length)throw failure('Aucune inscription enregistrée pour cet événement.',409);
      if(registrations.length>MAX_AUDIENCE)throw failure('Cet événement dépasse la limite de 400 inscrits par envoi.',409);
      if(Date.parse(post.eventDate)<=Date.parse(nextParisMorning(Math.ceil(registrations.length/DAY_CAP))))throw failure('Le rappel ne peut pas être envoyé à tous les inscrits avant l’événement.',409);
      people=registrations.map(({email})=>({email}));
    }else{
      await verifyNewsletterList(key,fetchImpl);
      people=await audience(key,fetchImpl);
      if(!people.length)throw failure('Aucun abonné confirmé et éligible dans la liste newsletter.',409);
      if(people.length>MAX_AUDIENCE)throw failure(`La liste compte ${people.length} abonnés. Ce parcours est limité à ${MAX_AUDIENCE}.`,409);
    }
    const sender=await publicSender(key,fetchImpl,env.BREVO_SENDER_EMAIL);
    if(!sender)throw failure('Authentifiez heritage-libanais.fr et activez une adresse expéditrice sur ce domaine avant un envoi public.',409);
    const replyTo=typeof env.BREVO_REPLY_TO==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.BREVO_REPLY_TO)?env.BREVO_REPLY_TO:sender.email;
    const batches=[];for(let i=0;i<people.length;i+=DAY_CAP)batches.push(people.slice(i,i+DAY_CAP));
    const now=new Date().toISOString(),job={id:crypto.randomUUID(),postId:post.id,title:post.title,type:post.type,purpose,contentHash,actorUserId:user.userId,createdAt:now,status:'preparing',batches:[],error:null};
    await db.prepare('INSERT OR IGNORE INTO studio_mailing_jobs (id,user_id,request_id,content_hash,state_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').bind(job.id,workspaceUserId,input.requestId,contentHash,JSON.stringify(job),now,now).run();
    const existing=await db.prepare('SELECT state_json FROM studio_mailing_jobs WHERE request_id = ? AND user_id = ?').bind(input.requestId,workspaceUserId).first();
    if(!existing)throw failure('Une demande d’envoi existe déjà avec cette référence.',409);
    if(JSON.parse(existing.state_json).id!==job.id)return json({job:JSON.parse(existing.state_json)});
    try{
      for(let i=0;i<batches.length;i++){
        const recipients=batches[i].map(person=>purpose==='reminder'?person.email:person.id),scheduledAt=nextParisMorning(i+1);
        const list=await brevo(key,'/contacts/lists',{method:'POST',body:{name:`Mailing Héritage Libanais · ${job.id.slice(0,8)} · ${i+1}/${batches.length}`,folderId:1},fetchImpl});
        if(!Number.isSafeInteger(list?.id))throw failure('La liste de diffusion n’a pas été créée.',502);
        const part={listId:list.id,count:recipients.length,scheduledAt,campaignId:null,status:'list_created'};job.batches.push(part);await saveJob(db,job);
        for(let n=0;n<recipients.length;n+=150){
          const added=await brevo(key,`/contacts/lists/${list.id}/contacts${purpose==='reminder'?'/add':''}`,{method:'POST',body:{[purpose==='reminder'?'emails':'ids']:recipients.slice(n,n+150)},fetchImpl});
          if(added?.contacts?.failure?.length||added?.failure?.length)throw failure('Brevo a refusé certains destinataires.',502);
        }
        part.status='list_ready';await saveJob(db,job);
        const campaign=await brevo(key,'/emailCampaigns',{method:'POST',body:{name:`${purpose==='reminder'?'Rappel':purpose==='invitation'?'Invitation':'La Newsletter'} · ${post.title} · ${job.id.slice(0,8)} · ${i+1}/${batches.length}`,sender:{email:sender.email,name:'Héritage Libanais'},replyTo,subject:email.subject,previewText:email.previewText,htmlContent:email.html,recipients:{listIds:[list.id]},scheduledAt},fetchImpl});
        if(!Number.isSafeInteger(campaign?.id))throw failure('La campagne Brevo n’a pas été créée.',502);
        part.campaignId=campaign.id;part.status='campaign_created';await saveJob(db,job);
        let detail=await brevo(key,`/emailCampaigns/${campaign.id}?excludeHtmlContent=true`,{fetchImpl});
        if(detail?.status==='draft'){
          await brevo(key,`/emailCampaigns/${campaign.id}`,{method:'PUT',body:{scheduledAt},fetchImpl});
          detail=await brevo(key,`/emailCampaigns/${campaign.id}?excludeHtmlContent=true`,{fetchImpl});
        }
        if(!['queued','inProcess','sent'].includes(detail?.status))throw failure('Brevo a conservé la campagne en brouillon. Aucun envoi automatique confirmé.',502);
        part.status=detail.status;await saveJob(db,job);
      }
      job.status='scheduled';await saveJob(db,job);return json({job});
    }catch(e){job.status='needs_review';job.error=e.message;await saveJob(db,job);return json({job},502);}
  }
  return null;
}
