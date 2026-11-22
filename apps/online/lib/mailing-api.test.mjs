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
function call(route,{actor=editor,access=editorAccess,env={},db=blockedDb,fetchImpl=fail,decryptToken=fail,encryptToken=fail,listWordPressRegistrations,method,body}={}){
  const input=request(route,{method,body});
  return handleMailingRequest(new URL(input.url).pathname,input,env,actor,{
    access,db,fetchImpl,decryptToken,encryptToken,listWordPressRegistrations,bodyJson:r=>r.json(),
  });
}
function database(){
  const sql=new DatabaseSync(':memory:');
  for(const file of ['0000_productive_mister_fear.sql','0001_past_gressill.sql','0003_event_registrations.sql']){
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
  const fetchImpl=async()=>Response.json([...published,{id:13,link:'https://heritage-libanais.fr/evenement/',title:{rendered:'Rencontre'},content:{rendered:`<article class="event-hero studio-native-registration"><time datetime="${eventDate}">Bientôt</time></article>`}}]);
  const input={postId:13,intro:'Nous vous attendons pour cette rencontre.',purpose:'reminder'};
  const {db,sql}=database();
  sql.prepare('INSERT INTO studio_event_registrations (id, workspace_id, event_post_id, email, name, created_at) VALUES (?,?,?,?,?,?)').run('a','owner',13,'a@example.org','A',eventDate);
  sql.prepare('INSERT INTO studio_event_registrations (id, workspace_id, event_post_id, email, name, created_at) VALUES (?,?,?,?,?,?)').run('b','owner',14,'b@example.org','B',eventDate);
  const preview=await (await call('preview',{db,fetchImpl,method:'POST',body:input})).json();
  assert.equal(preview.audience.registeredCount,1);
  assert.match(preview.email.subject,/^Rappel/);
  assert.match(preview.email.html,/Rappel de l’événement/);
  await assert.rejects(call('preview',{fetchImpl,method:'POST',body:{...input,postId:12}}),/réservé aux événements/);
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
    if(path.endsWith('/contacts/add')){
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
  const env={BREVO_API_KEY:'shared-service-key'};
  const preview=await (await call('preview',{method:'POST',body:draft,db,env,fetchImpl})).json();
  const body={...draft,confirmed:true,contentHash:preview.contentHash,requestId:crypto.randomUUID()};
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

test('a follow-up excludes event registrants from the newsletter while confirmations and thanks target only registrants', async () => {
  const {db,sql}=database();
  const eventDate=new Date(Date.now()+7*86400000).toISOString();
  const event={id:13,link:'https://heritage-libanais.fr/evenement/',title:{rendered:'Rencontre'},content:{rendered:`<article class="event-hero studio-native-registration"><time datetime="${eventDate}">Bientôt</time></article>`}};
  const register=sql.prepare('INSERT INTO studio_event_registrations VALUES (?,?,?,?,?,?)');
  register.run('a','owner',13,'both@example.test','A',eventDate);
  register.run('b','owner',13,'registered@example.test','B',eventDate);
  register.run('c','owner',14,'newsletter@example.test','C',eventDate);
  const contacts=['BOTH@example.test','newsletter@example.test'].map((email,index)=>({
    id:index+1,email,attributes:{HL_SIGNUP_SOURCE:'heritage-libanais.fr/la-lettre',HL_CONSENT_VERSION:'v1'},
  }));
  const readProvider=provider({contacts});
  const delivery=[];
  const fetchImpl=async (url,options)=>{
    const {hostname,pathname}=new URL(url);
    if(hostname==='heritage-libanais.fr')return Response.json([event]);
    if(pathname.startsWith('/v3/emailCampaigns/') && options.method==='GET')return Response.json({status:'queued'});
    if(options.method==='GET')return readProvider(url,options);
    const body=JSON.parse(options.body);
    delivery.push({pathname,body});
    if(pathname==='/v3/smtp/email')return Response.json({messageIds:body.messageVersions.map((_,i)=>'message-'+i)});
    return Response.json({id:20});
  };
  const env={BREVO_API_KEY:'shared-service-key'};
  for(const [purpose,kind,count,subject] of [
    ['follow_up','newsletter_unregistered',1,/Relance/],
    ['confirmation','event_registrants',2,/Inscription confirmée/],
    ['thanks','event_registrants',2,/Merci/],
  ]){
    const draft={postId:13,purpose};
    const preview=await (await call('preview',{method:'POST',body:draft,db,env,fetchImpl})).json();
    assert.equal(preview.audience.kind,kind);
    assert.equal(preview.audience.count,count);
    assert.match(preview.email.subject,subject);
    const result=await (await call('send',{method:'POST',body:{...draft,confirmed:true,contentHash:preview.contentHash,requestId:crypto.randomUUID()},db,env,fetchImpl})).json();
    assert.equal(result.job.status,'scheduled');
  }
  const draft={postId:13,purpose:'follow_up'};
  const preview=await (await call('preview',{method:'POST',body:draft,db,env,fetchImpl})).json();
  register.run('d','owner',13,'newsletter@example.test','D',eventDate);
  await assert.rejects(call('send',{
    method:'POST',body:{...draft,confirmed:true,contentHash:preview.contentHash,requestId:crypto.randomUUID()},db,env,fetchImpl,
  }),{status:409});
  assert.deepEqual(delivery.find(({pathname})=>pathname.endsWith('/contacts/add')).body.ids,[2]);
  for(const {body} of delivery.filter(({pathname})=>pathname==='/v3/smtp/email')){
    assert.deepEqual(body.messageVersions.map(version=>version.to.map(x=>x.email)),[['both@example.test'],['registered@example.test']]);
  }
});

test('an externally managed event requires the complete list, and past events can be thanked',async()=>{
  const eventDate=new Date(Date.now()-7*86400000).toISOString();
  const event={id:15,link:'https://heritage-libanais.fr/rencontre/',title:{rendered:'Rencontre'},content:{rendered:`<article class="event-hero"><time datetime="${eventDate}">Date</time></article>`}};
  const fetchImpl=async()=>Response.json([event]);
  const catalogue=await (await call('content?includePastEvents=1',{fetchImpl})).json();
  assert.equal(catalogue.posts.find(post=>post.id===15)?.past,true);
  const draft={postId:15,purpose:'thanks'};
  const missing=await (await call('preview',{method:'POST',body:draft,fetchImpl})).json();
  assert.equal(missing.audience.count,null);
  assert.match(missing.audience.problem,/liste complète/);
  const preview=await (await call('preview',{method:'POST',body:{...draft,externalRegistrations:['A@example.test','a@example.test']},fetchImpl})).json();
  assert.equal(preview.audience.count,1);
  assert.equal(preview.audience.problem,null);
  assert.doesNotMatch(JSON.stringify(preview),/a@example\.test/i);
  await assert.rejects(call('preview',{method:'POST',body:{...draft,purpose:'invitation'},fetchImpl}),{status:400});
});

test('WordPress event registrants drive the recipient count, and their CSV stays owner-only',async()=>{
  const date=new Date(Date.now()+7*86400000).toISOString();
  const event={id:16,link:'https://heritage-libanais.fr/rencontre/',title:{rendered:'Une rencontre'},content:{rendered:`<article class="studio-event-page studio-wordpress-registration"><header class="event-hero"><time datetime="${date}">Bientôt</time></header></article>`}};
  const fetchImpl=async()=>Response.json([event]);
  const listWordPressRegistrations=async(id,after)=>{
    assert.equal(id,16);
    assert.equal(after,'');
    return [{email:'attendee@example.test',name:'=Nom',created_at:'2026-11-22 10:00:00'}];
  };
  const preview=await (await call('preview',{method:'POST',body:{postId:16,purpose:'confirmation'},fetchImpl,listWordPressRegistrations})).json();
  assert.equal(preview.audience.count,1);
  assert.doesNotMatch(JSON.stringify(preview),/attendee@example/);
  assert.equal(preview.post.registrationUrl,'https://heritage-libanais.fr/rencontre/#inscription');
  await assert.rejects(call('registrations.csv?postId=16'),{status:403});
  const csv=await call('registrations.csv?postId=16',{actor:owner,access:ownerAccess,fetchImpl,listWordPressRegistrations});
  assert.match(await csv.text(),/"'=Nom","attendee@example.test"/);
});
