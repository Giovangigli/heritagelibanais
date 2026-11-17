import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handleStudioRequest,encryptToken,decryptToken} from './studio-api.mjs';
import {buildCompositionInput} from '../public/private-studio/composition-v2.mjs';
const origin='https://studio.example';
const user={userId:'owner'};
const token='test-studio-token-123456789';
function setup(){
  const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../drizzle/0000_productive_mister_fear.sql',import.meta.url),'utf8'));
  const objects=new Map();
  const env={
    STUDIO_CONNECTION_KEY:Buffer.alloc(32,7).toString('base64'),
    DB:{prepare(query){return {bind(...args){return {
      first:async()=>sql.prepare(query).get(...args)||null,
      run:async()=>({meta:{changes:Number(sql.prepare(query).run(...args).changes)}}),
    };}};}},
    BUCKET:{
      put:async(key,bytes,options)=>objects.set(key,{bytes,options}),
      get:async key=>{const item=objects.get(key);return item?{body:item.bytes,httpMetadata:item.options.httpMetadata}:null;},
    },
  };
  return {env,sql,objects};
}
function request(path,method='GET',body,headers={}){return new Request(origin+path,{method,headers:{...(method==='GET'?{}:{origin,'Content-Type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});}
const missingJob=()=>Response.json({ok:false,code:'job_not_found',error:'Introuvable.'});
test('requests require identity and same-origin writes before accessing storage or n8n',async()=>{
  const fail=()=>{throw new Error('Unexpected access');};const env={DB:{prepare:fail}};
  assert.equal((await handleStudioRequest(request('/api/status'),env,null,{fetchImpl:fail})).status,401);
  assert.equal((await handleStudioRequest(request('/api/setup','POST',{token},{origin:'https://other.example'}),env,user,{fetchImpl:fail})).status,403);
});
test('a connection checks only a poll, encrypts its token and never exposes it in status',async()=>{
  const {env,sql}=setup();const calls=[];
  const response=await handleStudioRequest(request('/api/setup','POST',{token}),env,user,{fetchImpl:async(url,options)=>{calls.push({url,options});return missingJob();}});
  assert.equal(response.status,200);assert.equal(JSON.parse(calls[0].options.body).transport.action,'poll');
  assert.equal(calls[0].options.headers['X-Heritage-Studio-Token'],token);
  const stored=sql.prepare('SELECT encrypted_token FROM studio_connections').get().encrypted_token;
  assert(!stored.includes(token));assert.equal(await decryptToken(stored,env),token);
  const status=await(await handleStudioRequest(request('/api/status'),env,user)).json();assert.equal(status.connected,true);assert(!JSON.stringify(status).includes(token));
  const other=await(await handleStudioRequest(request('/api/status'),env,{userId:'other'})).json();assert.equal(other.connected,false);
});
test('rejected credentials do not replace a working connection',async()=>{
  const {env,sql}=setup();const stored=await encryptToken(token,env);sql.prepare('INSERT INTO studio_connections VALUES (?,?,?)').run(user.userId,stored,'now');
  const result=await handleStudioRequest(request('/api/setup','POST',{token:'wrong-credential-12345'}),env,user,{fetchImpl:async()=>new Response('',{status:403})});
  assert.equal(result.status,401);assert.equal(sql.prepare('SELECT encrypted_token FROM studio_connections').get().encrypted_token,stored);
});
test('concurrent session saves cannot overwrite a newer version and users remain isolated',async()=>{
  const {env}=setup();const state={schema:1,dossier:{sourceText:'Texte manuel.'},proposals:[],history:[]};
  let result=await handleStudioRequest(request('/api/session','PUT',{state,revision:0}),env,user);assert.equal(result.status,200);
  assert.equal((await handleStudioRequest(request('/api/session','PUT',{state,revision:0}),env,user)).status,409);
  const saved=await(await handleStudioRequest(request('/api/session'),env,user)).json();assert.deepEqual(saved.state,state);assert.equal(saved.revision,1);
  assert.equal((await(await handleStudioRequest(request('/api/session'),env,{userId:'other'})).json()).state,null);
});
test('images persist separately and another visitor cannot retrieve them',async()=>{
  const {env}=setup();const image=new Uint8Array([137,80,78,71]);
  const put=new Request(origin+'/api/media/photo-1',{method:'PUT',headers:{origin,'Content-Type':'image/png'},body:image});
  assert.equal((await handleStudioRequest(put,env,user)).status,200);
  const restored=await handleStudioRequest(request('/api/media/photo-1'),env,user);assert.deepEqual(new Uint8Array(await restored.arrayBuffer()),image);
  assert.equal((await handleStudioRequest(request('/api/media/photo-1'),env,{userId:'other'})).status,404);
});
test('the real asynchronous acknowledgment passes unchanged without revealing the token',async()=>{
  const {env}=setup();env.N8N_STUDIO_WEBHOOK_TOKEN=token;
  const job={contrat:'hl.studio.job.1',ticket:'job-ticket',statut:'en_cours',requete_id:'r1',base_version:'v1'};
  const ack={ok:true,output:{title:'Composition en cours',summary:'Reçue.',cards:'En cours.',caption:'',compositionResponse:job}};
  const payload={schema:1,dossier:{sourceText:'Titre : Les temples\n\nTexte à composer.'},photos:[],transport:{action:'start',ticket:'job-ticket'}};
  const result=await handleStudioRequest(request('/api/intake','POST',payload),env,user,{fetchImpl:async(url,options)=>{assert.equal(url,'https://giovangigli.app.n8n.cloud/webhook/heritage-studio-draft');assert.equal(options.headers['X-Heritage-Studio-Token'],token);return Response.json(ack,{status:202});}});
  const body=await result.json();assert.equal(result.status,200);assert.deepEqual(body.output.compositionResponse,job);assert(!JSON.stringify(body).includes(token));
});
test('bad input is rejected before any generation and n8n errors preserve their job code',async()=>{
  const {env}=setup();env.N8N_STUDIO_WEBHOOK_TOKEN=token;let calls=0;
  const options={fetchImpl:async()=>{calls++;return Response.json({ok:false,code:'job_expired',error:'Suivi expiré.'});}};
  assert.equal((await handleStudioRequest(request('/api/intake','POST',{schema:2,photos:[]}),env,user,options)).status,400);assert.equal(calls,0);
  const result=await handleStudioRequest(request('/api/intake','POST',{schema:1,dossier:{sourceText:'Suivi'},photos:[],transport:{action:'poll',ticket:'job-ticket'}}),env,user,options);
  assert.equal((await result.json()).code,'job_expired');assert.equal(calls,1);
});
test('a story with no recognized title gets an actionable message without a model call', async () => {
  const {env}=setup();
  env.N8N_STUDIO_WEBHOOK_TOKEN=token;
  const dossier={sourceText:'Un paragraphe sans titre.'};
  const entreeComposition=buildCompositionInput({dossier});
  let calls=0;
  const result=await handleStudioRequest(request('/api/intake','POST',{schema:2,dossier,entreeComposition,photos:[]}),env,user,{
    fetchImpl:async()=>{calls++;return missingJob();},
  });
  assert.equal(result.status,400);
  assert.match((await result.json()).error,/Titre du récit/);
  assert.equal(calls,0);
});
