import {listEventRegistrations} from './event-registrations.mjs';
import {fetchPublishedContent} from './mailing-content.mjs';
import {renderStoryEmail,renderEventEmail,renderAutomationPreview,EVENT_MAILS} from './brevo-email.mjs';

const BREVO='https://api.brevo.com/v3';
const ORGANIZATION='6ae79b0ecddd8ac19c05da12';
const NEWSLETTER_LIST=3;
const MAILING_FOLDER=1;
const DAY_CAP=250; // Leave at least 50 of the Free plan's 300 sends for signups and welcome emails.
const MAX_AUDIENCE=400;
const MAX_EXTERNAL_REGISTRATIONS=2000;
const emailKey=email=>email.trim().toLowerCase();
const failure=(message,status=400,details={})=>Object.assign(new Error(message),{status,...details});
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});

async function brevo(key,path,{method='GET',body,fetchImpl=fetch}={}){
  const response=await fetchImpl(BREVO+path,{method,cache:'no-store',headers:{'api-key':key,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(16000)});
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
async function listContacts(key,listId,fetchImpl){
  const contacts=[];
  for(let offset=0;offset<=2000;offset+=500){
    const page=await brevo(key,`/contacts/lists/${listId}/contacts?limit=500&offset=${offset}`,{fetchImpl});
    if(!Array.isArray(page?.contacts))throw failure('La liste Brevo ne peut pas être vérifiée.',502);
    contacts.push(...page.contacts);
    if(contacts.length>=page.count||page.contacts.length<500)break;
  }
  if(contacts.length>2000)throw failure('La liste dépasse la capacité de vérification du Studio.',409);
  return contacts;
}
async function audience(key,fetchImpl){
  const contacts=await listContacts(key,NEWSLETTER_LIST,fetchImpl);
  const unique=new Map();
  for(const contact of contacts){
    if(!Number.isSafeInteger(contact.id)||!contact.email||contact.emailBlacklisted||contact.listUnsubscribed?.includes(NEWSLETTER_LIST))continue;
    if(contact.attributes?.HL_SIGNUP_SOURCE!=='heritage-libanais.fr/la-lettre'||!contact.attributes?.HL_CONSENT_VERSION)continue;
    unique.set(contact.id,contact);
  }
  return [...unique.values()].sort((a,b)=>a.id-b.id);
}

async function setListMembers(key,listId,action,ids,fetchImpl){
  for(let offset=0;offset<ids.length;offset+=150){
    const changed=await brevo(key,`/contacts/lists/${listId}/contacts/${action}`,{
      method:'POST',body:{ids:ids.slice(offset,offset+150)},fetchImpl,
    });
    if(changed?.contacts?.failure?.length||changed?.failure?.length)throw failure('Brevo a refusé certains contacts.',502);
  }
}

async function verifyListMembers(key,listId,wanted,fetchImpl){
  const members=await listContacts(key,listId,fetchImpl);
  const actual=new Set(members.map(person=>person.id));
  if(actual.size!==wanted.size||[...actual].some(id=>!wanted.has(id))){
    throw failure('La liste Brevo diffère de l’audience vérifiée.',409);
  }
}

async function findEventList(key,name,fetchImpl){
  let listId;
  for(let offset=0;;offset+=50){
    const page=await brevo(key,`/contacts/folders/${MAILING_FOLDER}/lists?limit=50&offset=${offset}`,{fetchImpl});
    if(!Array.isArray(page?.lists))throw failure('Les listes Brevo sont indisponibles.',502);
    for(const list of page.lists.filter(list=>list.name===name)){
      if(listId||!Number.isSafeInteger(list.id)||list.id<=0||list.id===NEWSLETTER_LIST){
        throw failure('La liste d’exclusion de cet événement est ambiguë dans Brevo.',409);
      }
      listId=list.id;
    }
    if(offset+page.lists.length>=page.count||page.lists.length<50)return listId;
  }
}

async function syncEventList(key,postId,excluded,{db,workspaceUserId,fetchImpl}){
  const now=Date.now(),lockedUntil=now+900000;
  const row=await db.prepare(`
    INSERT INTO studio_brevo_event_lists (workspace_id,event_post_id,locked_until) VALUES (?,?,?)
    ON CONFLICT (workspace_id,event_post_id) DO UPDATE SET locked_until=excluded.locked_until
    WHERE studio_brevo_event_lists.locked_until <= ?
    RETURNING list_id
  `).bind(workspaceUserId,postId,lockedUntil,now).first();
  if(!row)throw failure('La liste Brevo de cet événement est déjà en cours de mise à jour.',409);
  try{
    const name=`Exclusion Newsletter · Événement ${postId} · ${(await hash(workspaceUserId)).slice(0,16)}`;
    let listId=row.list_id;
    if(listId){
      try{
        const list=await brevo(key,`/contacts/lists/${listId}`,{fetchImpl});
        if(list?.id!==listId||list.name!==name)throw failure('La liste d’exclusion Brevo de cet événement a changé.',409);
      }catch(error){
        if(error.providerStatus!==404)throw error;
        listId=null;
      }
    }
    if(!listId){
      listId=await findEventList(key,name,fetchImpl);
      if(!listId){
        const list=await brevo(key,'/contacts/lists',{method:'POST',body:{name,folderId:MAILING_FOLDER},fetchImpl});
        listId=list?.id;
        if(!Number.isSafeInteger(listId)||listId<=0||listId===NEWSLETTER_LIST)throw failure('La liste d’exclusion Brevo n’a pas été créée.',502);
      }
      await db.prepare('UPDATE studio_brevo_event_lists SET list_id = ? WHERE workspace_id = ? AND event_post_id = ? AND locked_until = ?')
        .bind(listId,workspaceUserId,postId,lockedUntil).run();
    }
    const wanted=new Set(excluded.map(person=>person.id));
    const current=new Set((await listContacts(key,listId,fetchImpl)).map(person=>person.id));
    const remove=[...current].filter(id=>!wanted.has(id));
    const add=[...wanted].filter(id=>!current.has(id));
    await setListMembers(key,listId,'remove',remove,fetchImpl);
    await setListMembers(key,listId,'add',add,fetchImpl);
    if(remove.length||add.length)await verifyListMembers(key,listId,wanted,fetchImpl);
    return listId;
  }finally{
    await db.prepare('UPDATE studio_brevo_event_lists SET locked_until = 0 WHERE workspace_id = ? AND event_post_id = ? AND locked_until = ?')
      .bind(workspaceUserId,postId,lockedUntil).run();
  }
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
  if(!Number.isSafeInteger(input?.postId))throw failure('Choisissez une publication.');
  if(input.intro!==undefined&&(typeof input.intro!=='string'||input.intro.trim().length<20||input.intro.length>1200))throw failure('L’introduction doit contenir de 20 à 1 200 caractères.');
  if(input.subject!==undefined&&(typeof input.subject!=='string'||input.subject.trim().length<5||input.subject.length>160))throw failure('L’objet doit contenir de 5 à 160 caractères.');
  if(input.previewText!==undefined&&(typeof input.previewText!=='string'||input.previewText.trim().length<5||input.previewText.length>220))throw failure('Le texte d’aperçu doit contenir de 5 à 220 caractères.');
  const post=(await fetchPublishedContent(fetchImpl,{includePastEvents:true})).find(item=>item.id===input.postId);
  if(!post)throw failure('Cette publication n’est pas disponible pour un envoi.');
  const purpose=input.purpose||'announcement';
  const isEvent=post.type==='evenement';
  if(typeof purpose!=='string'||!Object.hasOwn(EVENT_MAILS,purpose)||(!isEvent&&purpose!=='announcement'))throw failure('Ce modèle est réservé aux événements.');
  if(post.past&&purpose!=='thanks')throw failure('Seul le remerciement est disponible pour un événement passé.');
  const model=EVENT_MAILS[purpose];
  const kind=input.audience??(isEvent?model.audience:'newsletter');
  const canNarrow=isEvent&&post.registrationSource!=='none'&&model.audience==='newsletter';
  if(kind!==(isEvent?model.audience:'newsletter')&&!(canNarrow&&kind==='newsletter_unregistered')){
    throw failure('Ces destinataires sont incompatibles avec le modèle choisi.');
  }
  if(kind!=='newsletter'&&post.registrationSource==='none')throw failure('Cet événement ne propose pas d’inscription.');
  const defaultIntro=(isEvent && purpose==='invitation' ? post.intro : '') || (isEvent ? model.intro : post.intro || 'Découvrez notre nouveau récit sur le site d’Héritage Libanais.');
  const intro=input.intro?.trim()||defaultIntro;
  const common={title:post.title,intro,url:post.url,imageUrl:post.imageUrl,imageAlt:post.imageAlt,subject:input.subject?.trim(),previewText:input.previewText?.trim()};
  const email=isEvent?renderEventEmail({...common,date:post.date,past:post.past,venue:post.venue,registrationUrl:post.registrationUrl,purpose}):renderStoryEmail(common);
  return {post,email,purpose,intro,kind};
}

async function registrationPage(post,afterEmail,{db,workspaceUserId,listWordPressRegistrations}){
  if(post.registrationSource==='wordpress'){
    if(!listWordPressRegistrations)throw failure('La liste des inscrits WordPress est indisponible.',503);
    return listWordPressRegistrations(post.id,afterEmail);
  }
  return listEventRegistrations(db,{workspaceId:workspaceUserId,eventPostId:post.id,afterEmail,limit:500});
}

async function eventEmails(post,input,options){
  if(post.registrationSource==='external'){
    const rows=input.externalRegistrations;
    if(rows===undefined)return null;
    if(!Array.isArray(rows)||rows.length>MAX_EXTERNAL_REGISTRATIONS||
        rows.some(email=>typeof email!=='string'||email.length>254||!/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/u.test(email.trim()))){
      throw failure('Collez jusqu’à 2 000 adresses e-mail valides, une par ligne.');
    }
    return [...new Set(rows.map(emailKey))].sort();
  }
  if(post.registrationSource==='none')throw failure('Cet événement ne propose pas d’inscription.');
  const emails=[];
  let afterEmail='';
  for(;;){
    const rows=await registrationPage(post,afterEmail,options);
    emails.push(...rows.map(row=>emailKey(row.email)));
    if(rows.length<500)return [...new Set(emails)].sort();
    afterEmail=rows.at(-1).email;
  }
}

async function mailingAudience({post,kind},input,{db,workspaceUserId,connectionKey,fetchImpl,listWordPressRegistrations}){
  let registrations=null;
  if(kind!=='newsletter'){
    registrations=await eventEmails(post,input,{db,workspaceUserId,listWordPressRegistrations});
    if(registrations===null)return {people:null,registeredCount:null,problem:'Renseignez la liste complète des inscrits pour vérifier cet envoi.'};
  }
  const registeredCount=registrations?.length??null;
  if(kind==='event_registrants')return {people:registrations.map(email=>({email})),registeredCount};
  const key=await connectionKey();
  if(!key)return {people:null,registeredCount,problem:'Connectez Brevo pour vérifier les destinataires.'};
  await expectedAccount(key,fetchImpl);
  await verifyNewsletterList(key,fetchImpl);
  const subscribers=await audience(key,fetchImpl);
  const registered=new Set(registrations);
  const excluded=subscribers.filter(person=>registered.has(emailKey(person.email)));
  return {people:subscribers.filter(person=>!registered.has(emailKey(person.email))),excluded,registeredCount};
}

function audienceProblem({post,purpose,kind},{people,problem}){
  if(problem)return problem;
  if(!people.length)return kind==='event_registrants'?'Aucune inscription pour cet événement.':'Aucun abonné éligible pour cet envoi.';
  if(kind==='newsletter_unregistered'){
    if(people.length>DAY_CAP)return `Une relance immédiate est limitée à ${DAY_CAP} destinataires.`;
    return Date.parse(post.eventDate)>Date.now()?null:'Cet événement a déjà commencé.';
  }
  if(people.length>MAX_AUDIENCE)return `Cet envoi dépasse la limite de ${MAX_AUDIENCE} destinataires.`;
  if(post.type==='evenement'&&purpose!=='thanks'&&Date.parse(post.eventDate)<=Date.parse(nextParisMorning(Math.ceil(people.length/DAY_CAP)))){
    return 'L’envoi ne peut pas atteindre tous les destinataires avant l’événement.';
  }
  return null;
}

function mailingHash({post,email,purpose,kind},people){
  return hash({postId:post.id,registrationSource:post.registrationSource,email,purpose,kind,recipients:people?.map(person=>kind==='event_registrants'?person.email:[person.id,emailKey(person.email)])??null});
}

async function hash(value){const bytes=new TextEncoder().encode(JSON.stringify(value));return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');}
async function saveJob(db,job){await db.prepare('UPDATE studio_mailing_jobs SET state_json = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(job),new Date().toISOString(),job.id).run();}

export async function handleMailingRequest(path,request,env,user,{db,bodyJson,encryptToken,decryptToken,fetchImpl=fetch,listWordPressRegistrations,access={
  role:'personal',workspaceUserId:user.userId,canManageConnections:true,canScheduleMailing:true,
}}={}){
  const {role,workspaceUserId,canManageConnections,canScheduleMailing}=access;
  const serverKey=role==='owner'||role==='editor'?env.BREVO_API_KEY?.trim():null;
  const connectionManaged=Boolean(serverKey);
  const connectionKey=()=>serverKey||storedKey(db,env,workspaceUserId,decryptToken);
  if(path==='/api/mailing/content'&&request.method==='GET'){
    const includePastEvents=new URL(request.url).searchParams.get('includePastEvents')==='1';
    return json({posts:await fetchPublishedContent(fetchImpl,{includePastEvents})});
  }
  if(path==='/api/mailing/automation-preview'&&request.method==='GET'){
    const kind=new URL(request.url).searchParams.get('kind');
    if(!['welcome','registration','unsubscribe'].includes(kind))throw failure('Modèle inconnu.');
    return json(renderAutomationPreview(kind));
  }
  if(path==='/api/mailing/registrations.csv'&&request.method==='GET'){
    if(role!=='owner')throw failure('L’export est réservé au propriétaire du Studio.',403);
    const eventPostId=Number(new URL(request.url).searchParams.get('postId'));
    if(!Number.isSafeInteger(eventPostId)||eventPostId<=0)throw failure('Choisissez un événement WordPress.');
    const post=(await fetchPublishedContent(fetchImpl,{includePastEvents:true})).find(event=>event.id===eventPostId);
    if(!post||!['studio','wordpress'].includes(post.registrationSource))throw failure('Aucune liste d’inscrits accessible pour cet événement.',404);
    const lines=['Nom,Email,Inscription UTC'];
    const cell=value=>{
      const text=String(value??'');
      return '"'+(/^[\s]*[=+@-]/u.test(text)?"'":"")+text.replaceAll('"','""')+'"';
    };
    let afterEmail='';
    for(;;){
      const page=await registrationPage(post,afterEmail,{db,workspaceUserId,listWordPressRegistrations});
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
  if(path==='/api/mailing/event-list'&&request.method==='POST'){
    if(!canScheduleMailing)throw failure('Votre compte ne peut pas modifier une liste Brevo.',403);
    const input=await bodyJson(request,600000);
    const post=(await fetchPublishedContent(fetchImpl,{includePastEvents:true})).find(item=>item.id===input?.postId&&item.type==='evenement');
    if(!post||post.registrationSource==='none')throw failure('Choisissez un événement avec inscription.');
    const key=await connectionKey();
    const recipients=await mailingAudience({post,kind:'newsletter_unregistered'},input,{db,workspaceUserId,connectionKey:()=>key,fetchImpl,listWordPressRegistrations});
    if(recipients.problem)throw failure(recipients.problem,409);
    const listId=await syncEventList(key,post.id,recipients.excluded,{db,workspaceUserId,fetchImpl});
    return json({listId,count:recipients.excluded.length});
  }
  if(path==='/api/mailing/preview'&&request.method==='POST'){
    const input=await bodyJson(request,600000);
    const draft=await resolvedEmail(input,fetchImpl);
    let recipients;
    try{
      recipients=await mailingAudience(draft,input,{db,workspaceUserId,connectionKey,fetchImpl,listWordPressRegistrations});
    }catch(error){
      recipients={people:null,registeredCount:null,problem:error.status===400?error.message:'Le Studio n’a pas pu vérifier les destinataires.'};
    }
    const {post,email,intro,kind}=draft;
    return json({
      post,email,intro,
      audience:{kind,count:recipients.people?.length??null,registeredCount:recipients.registeredCount,
        excludedCount:recipients.excluded?.length??null,problem:audienceProblem(draft,recipients)},
      contentHash:await mailingHash(draft,recipients.people),
    });
  }
  if(path==='/api/mailing/jobs'&&request.method==='GET'){
    const rows=await db.prepare('SELECT state_json FROM studio_mailing_jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT 20').bind(workspaceUserId).all();
    return json({jobs:(rows.results||[]).map(row=>JSON.parse(row.state_json))});
  }
  if(path==='/api/mailing/send'&&request.method==='POST'){
    if(!canScheduleMailing)throw failure('Votre compte ne peut pas programmer de newsletter.',403);
    const input=await bodyJson(request,600000);
    if(input?.confirmed!==true||typeof input?.requestId!=='string'||!/^[0-9a-f-]{36}$/i.test(input.requestId)||typeof input.contentHash!=='string')throw failure('Relisez l’aperçu et confirmez cet envoi.');
    const prior=await db.prepare('SELECT state_json FROM studio_mailing_jobs WHERE request_id = ? AND user_id = ?').bind(input.requestId,workspaceUserId).first();
    if(prior)return json({job:JSON.parse(prior.state_json)});
    const key=await connectionKey();
    if(!key)throw failure('La connexion Brevo doit être configurée avant de programmer cet envoi.',503);
    const draft=await resolvedEmail(input,fetchImpl);
    const {post,email,purpose,kind}=draft;
    const eventNotice=kind==='event_registrants';
    const immediate=kind==='newsletter_unregistered';

    const account=await expectedAccount(key,fetchImpl);
    const plan=freeCampaignPlan(account);
    if(!plan)throw failure('Le forfait Free Brevo a changé. Vérifiez-le avant l’envoi.',409);
    if(quotaExhausted(plan))throw failure('Le quota quotidien Brevo est atteint. Réessayez après son renouvellement.',409);
    const recipients=await mailingAudience(draft,input,{db,workspaceUserId,connectionKey:()=>key,fetchImpl,listWordPressRegistrations});
    const contentHash=await mailingHash(draft,recipients.people);
    if(recipients.people&&contentHash!==input.contentHash)throw failure('La publication, l’e-mail ou les destinataires ont changé. Recommencez la prévisualisation.',409);
    const problem=audienceProblem(draft,recipients);
    if(problem)throw failure(problem,409);
    const {people}=recipients;
    const credits=Number(plan.credits);
    if(immediate&&(!Number.isFinite(credits)||credits-50<people.length)){
      throw failure('Le quota Brevo restant ne couvre pas cet envoi après la réserve de 50 e-mails.',409);
    }
    const sender=await publicSender(key,fetchImpl,env.BREVO_SENDER_EMAIL);
    if(!sender)throw failure('Authentifiez heritage-libanais.fr et activez une adresse expéditrice sur ce domaine avant un envoi public.',409);
    const replyTo=typeof env.BREVO_REPLY_TO==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.BREVO_REPLY_TO)?env.BREVO_REPLY_TO:sender.email;
    const batches=[];for(let i=0;i<people.length;i+=DAY_CAP)batches.push(people.slice(i,i+DAY_CAP));
    const now=new Date().toISOString(),job={id:crypto.randomUUID(),postId:post.id,title:post.title,type:post.type,purpose,audience:kind,contentHash,actorUserId:user.userId,createdAt:now,status:'preparing',batches:[],error:null};
    await db.prepare('INSERT OR IGNORE INTO studio_mailing_jobs (id,user_id,request_id,content_hash,state_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').bind(job.id,workspaceUserId,input.requestId,contentHash,JSON.stringify(job),now,now).run();
    const existing=await db.prepare('SELECT state_json FROM studio_mailing_jobs WHERE request_id = ? AND user_id = ?').bind(input.requestId,workspaceUserId).first();
    if(!existing)throw failure('Une demande d’envoi existe déjà avec cette référence.',409);
    if(JSON.parse(existing.state_json).id!==job.id)return json({job:JSON.parse(existing.state_json)});
    try{
      const exclusionListId=immediate?await syncEventList(key,post.id,recipients.excluded,{db,workspaceUserId,fetchImpl}):null;
      for(let i=0;i<batches.length;i++){
        const scheduledAt=immediate?null:nextParisMorning(i+1,new Date(now));
        const recipients=batches[i];
        if(eventNotice){
          const part={count:recipients.length,scheduledAt,status:'preparing',batchId:crypto.randomUUID()};
          job.batches.push(part);
          await saveJob(db,job);
          const result=await brevo(key,'/smtp/email',{method:'POST',body:{
            sender:{email:sender.email,name:'Héritage Libanais'},replyTo:{email:replyTo},subject:email.subject,htmlContent:email.html,
            scheduledAt,batchId:part.batchId,messageVersions:recipients.map(({email})=>({to:[{email}]})),
          },fetchImpl});
          if(result?.messageIds?.length!==recipients.length)throw failure('Brevo n’a pas confirmé la programmation de tous les e-mails.',502);
          part.status='scheduled';
          await saveJob(db,job);
          continue;
        }
        const list=await brevo(key,'/contacts/lists',{method:'POST',body:{name:`Mailing Héritage Libanais · ${job.id.slice(0,8)} · ${i+1}/${batches.length}`,folderId:MAILING_FOLDER},fetchImpl});
        if(!Number.isSafeInteger(list?.id)||list.id<=0||list.id===NEWSLETTER_LIST||list.id===exclusionListId)throw failure('La liste de diffusion n’a pas été créée.',502);
        const part={listId:list.id,count:recipients.length,scheduledAt,campaignId:null,status:'list_created'};job.batches.push(part);await saveJob(db,job);
        await setListMembers(key,list.id,'add',recipients.map(person=>person.id),fetchImpl);
        part.status='list_ready';await saveJob(db,job);
        const campaign=await brevo(key,'/emailCampaigns',{method:'POST',body:{name:`${post.type==='evenement'?EVENT_MAILS[purpose].label:'La Newsletter'} · ${post.title} · ${job.id.slice(0,8)} · ${i+1}/${batches.length}`,sender:{email:sender.email,name:'Héritage Libanais'},replyTo,subject:email.subject,previewText:email.previewText,htmlContent:email.html,
          recipients:{listIds:[list.id],...(immediate?{exclusionListIds:[exclusionListId]}:{})},...(scheduledAt?{scheduledAt}:{})},fetchImpl});
        if(!Number.isSafeInteger(campaign?.id))throw failure('La campagne Brevo n’a pas été créée.',502);
        part.campaignId=campaign.id;part.status='campaign_created';await saveJob(db,job);
        if(immediate){
          await verifyListMembers(key,list.id,new Set(people.map(person=>person.id)),fetchImpl);
          const latestDraft=await resolvedEmail(input,fetchImpl);
          const latest=await mailingAudience(latestDraft,input,{db,workspaceUserId,connectionKey:()=>key,fetchImpl,listWordPressRegistrations});
          if(audienceProblem(latestDraft,latest)||await mailingHash(latestDraft,latest.people)!==contentHash){
            throw failure('La publication, l’e-mail ou les destinataires ont changé. Recommencez la prévisualisation.',409);
          }
          await brevo(key,`/emailCampaigns/${campaign.id}/sendNow`,{method:'POST',fetchImpl});
          part.status='submitted';await saveJob(db,job);
          continue;
        }
        let detail=await brevo(key,`/emailCampaigns/${campaign.id}?excludeHtmlContent=true`,{fetchImpl});
        if(detail?.status==='draft'){
          await brevo(key,`/emailCampaigns/${campaign.id}`,{method:'PUT',body:{scheduledAt},fetchImpl});
          detail=await brevo(key,`/emailCampaigns/${campaign.id}?excludeHtmlContent=true`,{fetchImpl});
        }
        if(!['queued','inProcess','sent'].includes(detail?.status))throw failure('Brevo a conservé la campagne en brouillon. Aucun envoi automatique confirmé.',502);
        part.status=detail.status;await saveJob(db,job);
      }
      job.status=immediate?'submitted':'scheduled';await saveJob(db,job);return json({job});
    }catch(e){job.status='needs_review';job.error=e.message;await saveJob(db,job);return json({job},e.status===409?409:502);}
  }
  return null;
}
