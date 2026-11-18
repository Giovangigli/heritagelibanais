import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handleMailingRequest} from './mailing-api.mjs';

const owner={userId:'owner'};
const editor={userId:'editor'};
const ownerAccess={role:'owner',workspaceUserId:owner.userId,canManageConnections:true,canScheduleMailing:true};
const editorAccess={role:'editor',workspaceUserId:owner.userId,canManageConnections:false,canScheduleMailing:true};
const personalAccess={role:'personal',workspaceUserId:editor.userId,canManageConnections:true,canScheduleMailing:true};
const account={organization_id:'6ae79b0ecddd8ac19c05da12',plan:[{type:'free',creditsType:'sendLimit',credits:296}]};
const published=[{
  id:12,
  link:'https://heritage-libanais.fr/le-cedre/',
  title:{rendered:'Le cèdre'},
  content:{rendered:'<section class="editorial-carousel"></section>'},
}];
const fail=()=>{throw new Error('Appel inattendu');};
const blockedDb={prepare:fail};

function request(route,{method='GET',body}={}){
  return new Request('https://studio.example/api/mailing/'+route,{
    method,
    ...(body===undefined?{}:{body:JSON.stringify(body),headers:{'Content-Type':'application/json'}}),
  });
}
function call(route,{actor=editor,access=editorAccess,env={},db=blockedDb,fetchImpl=fail,decryptToken=fail,encryptToken=fail,method,body}={}){
  const input=request(route,{method,body});
  return handleMailingRequest(new URL(input.url).pathname,input,env,actor,{
    access,db,fetchImpl,decryptToken,encryptToken,bodyJson:r=>r.json(),
  });
}
function database(){
  const sql=new DatabaseSync(':memory:');
  for(const file of ['0000_productive_mister_fear.sql','0001_past_gressill.sql']){
    sql.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
  }
  const db={prepare(query){
    return {bind(...args){
      const statement=sql.prepare(query);
      return {
        first:async()=>statement.get(...args)||null,
        all:async()=>({results:statement.all(...args)}),
        run:async()=>statement.run(...args),
      };
    }};
  }};
  return {db,sql};
}
function provider({override=()=>null,contacts=[],key='shared-service-key'}={}){
  return async (url,options)=>{
    assert.equal(options.method,'GET');
    assert.equal(options.headers['api-key'],key);
    const path=new URL(url).pathname;
    const response=override(path);
    if(response)return response;
    if(path==='/v3/account')return Response.json(account);
    if(path==='/v3/contacts/lists/3')return Response.json({id:3});
    if(path==='/v3/contacts/lists/3/contacts')return Response.json({contacts,count:contacts.length});
    if(path==='/v3/senders/domains/heritage-libanais.fr')return Response.json({verified:true,authenticated:true});
    if(path==='/v3/senders')return Response.json({senders:[{active:true,id:3,email:'lettre@heritage-libanais.fr'}]});
    throw new Error('Appel Brevo inattendu: '+path);
  };
}

test('the invited editor checks the managed connection read-only, even with fewer than 300 credits',async()=>{
  const result=await (await call('status',{
    env:{BREVO_API_KEY:'shared-service-key'},fetchImpl:provider(),
  })).json();
  assert.equal(result.status,'ready');
  assert.equal(result.reason,null);
  assert.equal(result.connected,true);
  assert.equal(result.readyToSend,true);
  assert.equal(result.connectionManaged,true);
  assert.equal(result.canManageConnections,false);
  assert.equal(result.eligible,0);
  assert.ok(Number.isFinite(Date.parse(result.lastCheckedAt)));
  assert.equal(JSON.stringify(result).includes('shared-service-key'),false);
});

test('an editor may use the encrypted owner connection and personal mode stays actor scoped',async()=>{
  const {db,sql}=database();
  sql.prepare('INSERT INTO studio_connections VALUES (?,?,?)').run('brevo:owner','encrypted','now');
  const decryptToken=async value=>{assert.equal(value,'encrypted');return 'owner-key';};
  const status=await (await call('status',{db,decryptToken,fetchImpl:provider({key:'owner-key'})})).json();
  assert.equal(status.status,'ready');
  assert.equal(status.connectionManaged,false);
  const isolated=await (await call('status',{db,access:personalAccess,env:{BREVO_API_KEY:'managed-key'}})).json();
  assert.equal(isolated.reason,'credentials_missing');
  assert.equal(isolated.connectionManaged,false);
});

test('setup and scheduling enforce separate permissions before looking up keys or calling services',async()=>{
  await assert.rejects(call('setup',{method:'POST'}),{status:403});
  await assert.rejects(call('send',{method:'POST',access:{...editorAccess,canScheduleMailing:false}}),{status:403});
  await assert.rejects(call('setup',{
    method:'POST',actor:owner,access:ownerAccess,env:{BREVO_API_KEY:'shared-service-key'},
  }),{status:409});
});

test('Brevo status distinguishes credential, sender, quota and provider failures',async()=>{
  const cases=[
    {path:'/v3/account',response:()=>new Response(null,{status:401}),status:'needs_configuration',reason:'credentials_rejected'},
    {path:'/v3/account',response:()=>Response.json({...account,organization_id:'another'}),status:'needs_configuration',reason:'account_mismatch'},
    {path:'/v3/contacts/lists/3',response:()=>new Response(null,{status:404}),status:'needs_configuration',reason:'list_missing'},
    {path:'/v3/senders/domains/heritage-libanais.fr',response:()=>Response.json({verified:false,authenticated:false}),status:'needs_configuration',reason:'sender_not_ready'},
    {path:'/v3/account',response:()=>Response.json({...account,plan:[{...account.plan[0],credits:0}]}),status:'unavailable',reason:'quota_exhausted'},
    {path:'/v3/senders/domains/heritage-libanais.fr',response:()=>new Response(null,{status:503}),status:'unavailable',reason:'provider_unavailable'},
  ];
  for(const {path,response,status,reason} of cases){
    const result=await (await call('status',{
      env:{BREVO_API_KEY:'shared-service-key'},
      fetchImpl:provider({override:url=>url===path?response():null}),
    })).json();
    assert.equal(result.status,status);
    assert.equal(result.reason,reason);
    assert.equal(result.readyToSend,false);
  }
});

test('a verified Brevo key is saved once even while the newsletter list needs setup',async()=>{
  const {db,sql}=database();
  const fetchImpl=provider({key:'valid-brevo-key',override:path=>path==='/v3/contacts/lists/3'?new Response(null,{status:404}):null});
  const result=await call('setup',{actor:owner,access:ownerAccess,method:'POST',body:{apiKey:'valid-brevo-key'.padEnd(32,'x')},db,
    fetchImpl:provider({key:'valid-brevo-key'.padEnd(32,'x'),override:path=>path==='/v3/contacts/lists/3'?new Response(null,{status:404}):null}),encryptToken:async()=> 'encrypted'});
  assert.equal((await result.json()).ok,true);
  assert.equal(sql.prepare('SELECT encrypted_token FROM studio_connections WHERE user_id = ?').get('brevo:owner').encrypted_token,'encrypted');
  const status=await (await call('status',{actor:owner,access:ownerAccess,db,fetchImpl,decryptToken:async()=> 'valid-brevo-key'})).json();
  assert.equal(status.reason,'list_missing');
  assert.equal(status.connected,true);
});

test('publication and preview survive missing Brevo credentials',async()=>{
  const fetchImpl=async url=>{
    assert.equal(new URL(url).hostname,'heritage-libanais.fr');
    return Response.json(published);
  };
  const catalogue=await (await call('content',{fetchImpl})).json();
  assert.equal(catalogue.posts.find(post => post.id === 12)?.id,12);
  const preview=await (await call('preview',{
    fetchImpl,method:'POST',body:{postId:12,intro:'Un nouveau récit à découvrir cette semaine.'},
  })).json();
  assert.ok(preview.contentHash);
  assert.match(preview.email.subject,/cèdre/);
  const edited=await (await call('preview',{
    fetchImpl,method:'POST',body:{postId:12,intro:'Un nouveau récit à découvrir cette semaine.',subject:'Un cèdre à découvrir',previewText:'Notre nouveau récit est en ligne.'},
  })).json();
  assert.equal(edited.email.subject,'Un cèdre à découvrir');
  assert.equal(edited.email.previewText,'Notre nouveau récit est en ligne.');
  assert.notEqual(edited.contentHash,preview.contentHash);
});

test('an event reminder has distinct preview content and a story cannot be reminded',async()=>{
  const eventDate=new Date(Date.now()+7*86400000).toISOString();
  const fetchImpl=async()=>Response.json([...published,{id:13,link:'https://heritage-libanais.fr/evenement/',title:{rendered:'Rencontre'},content:{rendered:`<article class="event-hero"><time datetime="${eventDate}">Bientôt</time></article>`}}]);
  const input={postId:13,intro:'Nous vous attendons pour cette rencontre.',purpose:'reminder'};
  const preview=await (await call('preview',{fetchImpl,method:'POST',body:input})).json();
  assert.match(preview.email.subject,/^Rappel/);
  assert.match(preview.email.html,/Rappel de l’événement/);
  await assert.rejects(call('preview',{fetchImpl,method:'POST',body:{...input,postId:12}}),/invitations et rappels concernent uniquement/);
});

test('an editor schedules 400 approved contacts across two days, with shared history and an individual audit',async()=>{
  const {db}=database();
  const contacts=Array.from({length:400},(_,index)=>({
    id:index+1,email:`contact${index}@example.test`,
    attributes:{HL_SIGNUP_SOURCE:'heritage-libanais.fr/la-lettre',HL_CONSENT_VERSION:'v1'},
  }));
  const readProvider=provider({contacts});
  const lists=new Map();
  const campaigns=new Map();
  const fetchImpl=async (url,options)=>{
    if(new URL(url).hostname==='heritage-libanais.fr')return Response.json(published);
    const path=new URL(url).pathname;
    if(options.method==='GET'){
      if(path.startsWith('/v3/emailCampaigns/'))return Response.json({status:'queued'});
      return readProvider(url,options);
    }
    assert.equal(options.method,'POST');
    const body=JSON.parse(options.body);
    if(path==='/v3/contacts/lists'){
      const id=10+lists.size;
      lists.set(id,[]);
      return Response.json({id});
    }
    if(path.endsWith('/contacts')){
      const id=Number(path.split('/')[4]);
      lists.get(id).push(...body.ids);
      return Response.json({contacts:{failure:[]}});
    }
    assert.equal(path,'/v3/emailCampaigns');
    const id=20+campaigns.size;
    campaigns.set(id,body);
    return Response.json({id});
  };
  const draft={postId:12,intro:'Un nouveau récit à découvrir cette semaine.'};
  const preview=await (await call('preview',{method:'POST',body:draft,fetchImpl})).json();
  const body={...draft,confirmed:true,contentHash:preview.contentHash,requestId:crypto.randomUUID()};
  const env={BREVO_API_KEY:'shared-service-key'};
  const result=await (await call('send',{method:'POST',body,db,env,fetchImpl})).json();
  assert.equal(result.job.status,'scheduled');
  assert.equal(result.job.actorUserId,editor.userId);
  assert.deepEqual(result.job.batches.map(batch=>batch.count),[250,150]);
  assert.notEqual(result.job.batches[0].scheduledAt,result.job.batches[1].scheduledAt);
  assert.equal(new Set([...lists.values()].flat()).size,400);
  const ownerHistory=await (await call('jobs',{db,actor:owner,access:ownerAccess})).json();
  assert.deepEqual(ownerHistory.jobs,[result.job]);
  const personalHistory=await (await call('jobs',{db,access:personalAccess})).json();
  assert.deepEqual(personalHistory.jobs,[]);
  const retry=await (await call('send',{method:'POST',body,db,actor:owner,access:ownerAccess})).json();
  assert.deepEqual(retry,result);
});
