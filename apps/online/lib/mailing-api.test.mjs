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
  for(const file of ['0000_productive_mister_fear.sql','0001_past_gressill.sql','0003_event_registrations.sql','0005_brevo_event_lists.sql','0006_brevo_event_registrants.sql']){
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

function eventProvider(contacts,{onDraft=()=>{}}={}){
  const readProvider=provider({contacts});
  const lists=new Map(),campaigns=[],sent=[],transactional=[],imports=[];
  const directory=new Map(contacts.map(contact=>[contact.email.toLowerCase(),contact]));
  const fetchImpl=async (url,options)=>{
    const path=new URL(url).pathname;
    const listMatch=/^\/v3\/contacts\/lists\/(\d+)(?:\/contacts(?:\/(add|remove))?)?$/.exec(path);
    const list=listMatch&&lists.get(Number(listMatch[1]));
    if(options.method==='GET'){
      const processId=Number(/^\/v3\/processes\/(\d+)$/.exec(path)?.[1]);
      if(processId){
        const pending=imports[processId-1];
        if(pending.status==='completed'&&!pending.applied){
          for(const {email} of pending.body.jsonBody){
            if(directory.has(email))continue;
            const contact={id:100+directory.size,email};
            directory.set(email,contact);
            lists.get(pending.body.listIds[0]).ids.add(contact.id);
          }
          pending.applied=true;
        }
        return Response.json({id:processId,status:pending.status});
      }
      if(path==='/v3/contacts/folders/1/lists'){
        return Response.json({lists:[...lists.values()].map(({id,name})=>({id,name})),count:lists.size});
      }
      if(list){
        if(!path.endsWith('/contacts'))return Response.json({id:list.id,name:list.name});
        const members=[...directory.values()].filter(person=>list.ids.has(person.id));
        return Response.json({contacts:members,count:members.length});
      }
      return readProvider(url,options);
    }
    assert.equal(options.headers['api-key'],'shared-service-key');
    const body=options.body&&JSON.parse(options.body);
    if(list&&options.method==='PUT'){
      list.name=body.name;
      return new Response(null,{status:204});
    }
    assert.equal(options.method,'POST');
    if(path==='/v3/contacts/import'){
      assert.deepEqual(Object.keys(body).sort(),['disableNotification','jsonBody','listIds','updateExistingContacts']);
      assert.equal(body.updateExistingContacts,false);
      assert.equal(body.disableNotification,true);
      assert.ok(body.jsonBody.every(entry=>Object.keys(entry).join()==='email'));
      imports.push({body,status:'queued'});
      return Response.json({processId:imports.length});
    }
    if(path==='/v3/contacts/lists'){
      const id=10+lists.size;
      lists.set(id,{id,name:body.name,ids:new Set()});
      return Response.json({id});
    }
    if(list&&listMatch[2]){
      const ids=body.ids??body.emails.map(email=>directory.get(email)?.id);
      if(ids.includes(undefined))return Response.json({contacts:{failure:['unknown']}});
      for(const id of ids)list.ids[listMatch[2]==='add'?'add':'delete'](id);
      return Response.json({contacts:{success:ids,failure:[]}});
    }
    if(path==='/v3/emailCampaigns'){
      assert.equal(body.scheduledAt,undefined);
      campaigns.push(body);
      onDraft();
      return Response.json({id:campaigns.length});
    }
    if(path==='/v3/smtp/email'){
      transactional.push(body.messageVersions);
      return Response.json({messageIds:body.messageVersions.map((_,i)=>'message-'+i)});
    }
    const id=Number(/^\/v3\/emailCampaigns\/(\d+)\/sendNow$/.exec(path)?.[1]);
    assert.ok(campaigns[id-1],path);
    sent.push(id);
    return new Response(null,{status:204});
  };
  return {fetchImpl,lists,campaigns,sent,transactional,imports,directory};
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
  const brevo=eventProvider(contacts);
  const fetchImpl=(url,options)=>new URL(url).hostname==='heritage-libanais.fr'?Response.json([event]):brevo.fetchImpl(url,options);
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
    assert.equal(result.job.status,purpose==='follow_up'?'submitted':'scheduled');
  }
  const draft={postId:13,purpose:'follow_up'};
  const preview=await (await call('preview',{method:'POST',body:draft,db,env,fetchImpl})).json();
  register.run('d','owner',13,'newsletter@example.test','D',eventDate);
  await assert.rejects(call('send',{
    method:'POST',body:{...draft,confirmed:true,contentHash:preview.contentHash,requestId:crypto.randomUUID()},db,env,fetchImpl,
  }),{status:409});
  assert.deepEqual(brevo.campaigns[0].recipients,{listIds:[10]});
  assert.deepEqual([...brevo.lists.get(10).ids],[2]);
  assert.deepEqual(brevo.sent,[1]);
  for(const versions of brevo.transactional){
    assert.deepEqual(versions.map(version=>version.to.map(x=>x.email)),[['both@example.test'],['registered@example.test']]);
  }
});

test('WordPress events synchronize all registrants into separate Brevo lists and recheck the exact relay audience',async()=>{
  const {db}=database();
  const date=new Date(Date.now()+7*86400000).toISOString();
  const events=[16,17].map(id=>({
    id,link:`https://heritage-libanais.fr/rencontre-${id}/`,title:{rendered:`Rencontre ${id}`},
    content:{rendered:`<article class="studio-event-page studio-wordpress-registration"><header class="event-hero"><time datetime="${date}">Bientôt</time></header></article>`},
  }));
  const registrations=new Map([[16,['FIRST@example.test','event-only@example.test']],[17,['second@example.test']]]);
  const contacts=['first','second','third','blocked','opted-out','unconfirmed'].map((name,index)=>({
    id:index+1,email:name+'@example.test',emailBlacklisted:name==='blocked',listUnsubscribed:name==='opted-out'?[3]:[],
    attributes:{HL_SIGNUP_SOURCE:'heritage-libanais.fr/la-lettre',HL_CONSENT_VERSION:name==='unconfirmed'?null:'v1'},
  }));
  let changeOnDraft=false;
  const brevo=eventProvider(contacts,{onDraft(){
    if(changeOnDraft)registrations.set(16,['third@example.test','event-only@example.test']);
  }});
  const options={
    db,env:{BREVO_API_KEY:'shared-service-key'},method:'POST',
    fetchImpl:(url,options)=>new URL(url).hostname==='heritage-libanais.fr'?Response.json(events):brevo.fetchImpl(url,options),
    listWordPressRegistrations:async(id,after)=>{
      assert.equal(after,'');
      return registrations.get(id).map(email=>({email}));
    },
  };
  await assert.rejects(call('event-list',{...options,access:{...editorAccess,canScheduleMailing:false}}),{status:403});
  const sync=async postId=>(await call('event-list',{...options,body:{postId}})).json();
  const pendingFirst=await sync(16);
  assert.equal(pendingFirst.pending,true);
  assert.deepEqual(await sync(16),pendingFirst);
  assert.equal(brevo.imports.length,1);
  brevo.imports[0].status='completed';
  const first=await sync(16);
  assert.equal(first.pending,false);
  assert.equal(first.count,2);
  const pendingSecond=await sync(17);
  brevo.imports[1].status='failed';
  await assert.rejects(sync(17),/import Brevo a échoué/);
  assert.equal((await sync(17)).listId,pendingSecond.listId);
  brevo.imports[2].status='completed';
  const second=await sync(17);
  const newcomer=brevo.directory.get('event-only@example.test');
  assert.notEqual(first.listId,second.listId);
  assert.deepEqual([...brevo.lists.get(first.listId).ids].sort((a,b)=>a-b),[1,newcomer.id]);
  assert.deepEqual([...brevo.lists.get(second.listId).ids],[2]);
  assert.deepEqual(brevo.directory.get('first@example.test'),contacts[0]);
  assert.equal(newcomer.attributes,undefined);
  assert.deepEqual(await sync(16),first);
  assert.equal(brevo.imports.length,3);
  const draft={postId:16,purpose:'invitation',audience:'newsletter_unregistered'};
  const preview=async body=>(await call('preview',{...options,body})).json();
  const approved=await preview(draft);
  assert.deepEqual(approved.audience,{kind:'newsletter_unregistered',name:'La Newsletter · hors inscrits à « Rencontre 16 »',count:2,registeredCount:2,excludedCount:1,problem:null});
  const attendeePreview=await preview({postId:16,purpose:'confirmation',audience:'event_registrants'});
  assert.equal(attendeePreview.audience.name,'Inscrits · Rencontre 16');
  assert.equal(attendeePreview.audience.count,2);
  assert.equal((await preview({...draft,audience:'newsletter'})).audience.count,3);
  await assert.rejects(preview({...draft,purpose:'follow_up',audience:'newsletter'}),{status:400});
  const approve=preview=>({...draft,confirmed:true,contentHash:preview.contentHash,requestId:crypto.randomUUID()});
  changeOnDraft=true;
  const blocked=await call('send',{...options,body:approve(approved)});
  assert.equal(blocked.status,409);
  assert.match((await blocked.json()).job.error,/destinataires ont changé/);
  assert.deepEqual(brevo.sent,[]);
  assert.equal((await preview(draft)).audience.count,approved.audience.count);
  assert.equal((await sync(16)).pending,true);
  brevo.imports[3].status='completed';
  assert.deepEqual(await sync(16),first);
  assert.deepEqual([...brevo.lists.get(first.listId).ids].sort((a,b)=>a-b),[3,newcomer.id]);
  assert.deepEqual([...brevo.lists.get(second.listId).ids],[2]);
  const body=approve(await preview(draft));
  const result=await (await call('send',{...options,body})).json();
  assert.equal(result.job.status,'submitted');
  assert.deepEqual([...brevo.lists.get(brevo.campaigns[1].recipients.listIds[0]).ids],[1,2]);
  assert.deepEqual((await (await call('send',{...options,body})).json()),result);
  assert.deepEqual(brevo.sent,[2]);
});

test('an externally managed event requires the complete list, and past events can be thanked',async()=>{
  const eventDate=new Date(Date.now()-7*86400000).toISOString();
  const event={id:15,link:'https://heritage-libanais.fr/rencontre/',title:{rendered:'Rencontre'},content:{rendered:`<article class="event-hero"><time datetime="${eventDate}">Date</time></article>`}};
  const fetchImpl=async()=>Response.json([event]);
  const catalogue=await (await call('content?includePastEvents=1',{fetchImpl})).json();
  assert.equal(catalogue.posts.find(post=>post.id===15)?.past,true);
  const draft={postId:15,purpose:'thanks'};
  const missing=await (await call('preview',{method:'POST',body:draft,fetchImpl})).json();
  await assert.rejects(call('event-list',{method:'POST',body:{postId:15},fetchImpl}),{status:409,message:/liste complète/});
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
