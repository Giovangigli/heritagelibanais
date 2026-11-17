import {validPayload,findDraft} from './bridge-contract.mjs';
import {renderStoryEmail,renderEventEmail} from './brevo-email.mjs';
import {storyCreationIssue} from '../public/private-studio/composition-v2.mjs';
import {handleMailingRequest} from './mailing-api.mjs';
import {resolveStudioAccess,studioStorageScope} from './studio-access.mjs';
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
async function bodyJson(request){
  if(request.headers.get('content-type')?.split(';')[0]!=='application/json')throw error('Format de demande invalide.',415);
  try{return JSON.parse(new TextDecoder().decode(await boundedBody(request)));}catch(e){if(e.status)throw e;throw error('Le dossier est illisible.');}
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
export async function handleStudioRequest(request,env,user,{fetchImpl=fetch}={}){
  try{
    if(!user?.userId)return json({error:'Reconnectez-vous au Studio.',signInUrl:'/signin-with-chatgpt?return_to=%2F'},401);
    const access=resolveStudioAccess(env,user);
    if(!access)throw error('Ce compte n’a pas accès au Studio privé.',403);
    const path=new URL(request.url).pathname;
    if(request.method!=='GET'&&request.headers.get('origin')!==new URL(request.url).origin)throw error('Cette demande ne vient pas du Studio.',403);
    if(path==='/api/access'&&request.method==='GET'){
      const {role,canManageConnections,canScheduleMailing}=access;
      return json({role,canManageConnections,canScheduleMailing,storageScope:await studioStorageScope(user,access)});
    }
    if(path.startsWith('/api/mailing/')){
      const result=await handleMailingRequest(path,request,env,user,{db:database(env),bodyJson,encryptToken,decryptToken,fetchImpl,access});
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
