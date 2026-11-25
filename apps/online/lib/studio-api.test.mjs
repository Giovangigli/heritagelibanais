import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readdirSync,readFileSync} from 'node:fs';
import {handleStudioRequest,encryptToken,decryptToken} from './studio-api.mjs';
import {buildCompositionInput} from '../public/private-studio/composition-v2.mjs';
import {emptyState,saveDossier,createProposal,markReady} from '../public/private-studio/studio-model.mjs';
const origin='https://studio.example';
const user={userId:'owner',email:'owner@example.org'};
const editor={userId:'editor',email:'editor@example.org'};
const token='test-studio-token-123456789';
function configureWorkspace(env){
  Object.assign(env,{
    STUDIO_OWNER_EMAIL:'owner@example.org',STUDIO_OWNER_USER_ID:'owner',
    STUDIO_EDITOR_EMAILS:' Editor@Example.org ',
  });
}
function setup(){
  const sql=new DatabaseSync(':memory:');
  for(const name of readdirSync(new URL('../drizzle/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort())sql.exec(readFileSync(new URL(`../drizzle/${name}`,import.meta.url),'utf8'));
  const objects=new Map();
  const env={
    STUDIO_CONNECTION_KEY:Buffer.alloc(32,7).toString('base64'),
    DB:{prepare(query){return {bind(...args){return {
      first:async()=>sql.prepare(query).get(...args)||null,
      all:async()=>({results:sql.prepare(query).all(...args)}),
      run:async()=>({meta:{changes:Number(sql.prepare(query).run(...args).changes)}}),
    };}};}},
    BUCKET:{
      put:async(key,bytes,options)=>objects.set(key,{bytes,options}),
      get:async key=>{const item=objects.get(key);return item?{body:item.bytes,httpMetadata:item.options.httpMetadata,arrayBuffer:async()=>new Response(item.bytes).arrayBuffer()}:null;},
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
  const status=await(await handleStudioRequest(request('/api/status'),env,user,{fetchImpl:missingJob})).json();assert.equal(status.connected,true);assert.equal(status.status,'ready');assert(!JSON.stringify(status).includes(token));
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
test('managed access scopes drafts and media to the workspace and credential setup to its owner',async()=>{
  const {env}=setup();configureWorkspace(env);
  const state={schema:1,dossier:{sourceText:'Dossier commun.'},proposals:[],history:[]};
  assert.equal((await handleStudioRequest(request('/api/session','PUT',{state,revision:0}),env,user)).status,200);
  const shared=await(await handleStudioRequest(request('/api/session'),env,editor)).json();
  assert.deepEqual(shared.state,state);
  const image=new Uint8Array([137,80,78,71]);
  const put=new Request(origin+'/api/media/photo-1',{method:'PUT',headers:{origin,'Content-Type':'image/png'},body:image});
  assert.equal((await handleStudioRequest(put,env,editor)).status,200);
  const restored=await handleStudioRequest(request('/api/media/photo-1'),env,user);
  assert.deepEqual(new Uint8Array(await restored.arrayBuffer()),image);
  assert.equal((await handleStudioRequest(request('/api/session'),env,{userId:'outsider',email:'outsider@example.org'})).status,403);
  assert.equal((await handleStudioRequest(request('/api/session'),env,{...user,userId:'different-owner'})).status,403);
  assert.equal((await handleStudioRequest(request('/api/setup','POST',{token}),env,editor)).status,403);
  const ownerAccess=await(await handleStudioRequest(request('/api/access'),env,user)).json();
  const editorAccess=await(await handleStudioRequest(request('/api/access'),env,editor)).json();
  assert.equal(ownerAccess.role,'owner');
  assert.equal(editorAccess.role,'editor');
  assert.equal(editorAccess.canManageConnections,false);
  assert.equal(editorAccess.canScheduleMailing,false);
  assert.notEqual(ownerAccess.storageScope,editorAccess.storageScope);
  assert(!JSON.stringify(editorAccess).includes(editor.email));
  env.STUDIO_MAILING_EDITOR_EMAILS=editor.email;
  const publisher=await(await handleStudioRequest(request('/api/access'),env,editor)).json();
  assert.equal(publisher.canScheduleMailing,true);
});
test('shared n8n access is gated by managed mode and verifies the actual production workflow',async()=>{
  const {env,sql}=setup();env.N8N_STUDIO_WEBHOOK_TOKEN=token;
  let calls=0;
  const options={fetchImpl:async(_url,init)=>{
    calls++;
    assert.equal(init.headers['X-Heritage-Studio-Token'],token);
    assert.equal(JSON.parse(init.body).transport.action,'poll');
    return Response.json({code:'job_not_found'},{status:404});
  }};
  const personal=await(await handleStudioRequest(request('/api/status'),env,user,options)).json();
  assert.equal(personal.status,'setup');assert.equal(calls,0);
  configureWorkspace(env);
  const ownerToken=await encryptToken('old-owner-token',env);
  sql.prepare('INSERT INTO studio_connections VALUES (?,?,?)').run(user.userId,ownerToken,'now');
  const shared=await(await handleStudioRequest(request('/api/status'),env,editor,options)).json();
  assert.equal(shared.status,'ready');assert.equal(calls,1);
  const rejected=await(await handleStudioRequest(request('/api/status'),env,editor,{fetchImpl:async()=>new Response('',{status:403})})).json();
  assert.equal(rejected.status,'unavailable');assert.equal(rejected.reason,'rejected');
  delete env.N8N_STUDIO_WEBHOOK_TOKEN;
  const fallback=await(await handleStudioRequest(request('/api/status'),env,editor,{fetchImpl:async(_url,init)=>{
    assert.equal(init.headers['X-Heritage-Studio-Token'],'old-owner-token');return missingJob();
  }})).json();
  assert.equal(fallback.status,'ready');
});
test('the real asynchronous acknowledgment passes unchanged without revealing the token',async()=>{
  const {env}=setup();configureWorkspace(env);env.N8N_STUDIO_WEBHOOK_TOKEN=token;
  const job={contrat:'hl.studio.job.1',ticket:'job-ticket',statut:'en_cours',requete_id:'r1',base_version:'v1'};
  const ack={ok:true,output:{title:'Composition en cours',summary:'Reçue.',cards:'En cours.',caption:'',compositionResponse:job}};
  const payload={schema:1,dossier:{sourceText:'Titre : Les temples\n\nTexte à composer.'},photos:[],transport:{action:'start',ticket:'job-ticket'}};
  const result=await handleStudioRequest(request('/api/intake','POST',payload),env,user,{fetchImpl:async(url,options)=>{assert.equal(url,'https://giovangigli.app.n8n.cloud/webhook/heritage-studio-draft');assert.equal(options.headers['X-Heritage-Studio-Token'],token);return Response.json(ack,{status:202});}});
  const body=await result.json();assert.equal(result.status,200);assert.deepEqual(body.output.compositionResponse,job);assert(!JSON.stringify(body).includes(token));
});
test('bad input is rejected before any generation and n8n errors preserve their job code',async()=>{
  const {env}=setup();configureWorkspace(env);env.N8N_STUDIO_WEBHOOK_TOKEN=token;let calls=0;
  const options={fetchImpl:async()=>{calls++;return Response.json({ok:false,code:'job_expired',error:'Suivi expiré.'});}};
  assert.equal((await handleStudioRequest(request('/api/intake','POST',{schema:2,photos:[]}),env,user,options)).status,400);assert.equal(calls,0);
  const result=await handleStudioRequest(request('/api/intake','POST',{schema:1,dossier:{sourceText:'Suivi'},photos:[],transport:{action:'poll',ticket:'job-ticket'}}),env,user,options);
  assert.equal((await result.json()).code,'job_expired');assert.equal(calls,1);
});
test('a story with no recognized title gets an actionable message without a model call', async () => {
  const {env}=setup();
  configureWorkspace(env);
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
test('validation publishes once and Studio can move only its tracked post to WordPress Trash',async()=>{
  const {env,sql}=setup();env.WORDPRESS_ACCESS_TOKEN='server-secret';
  const dossier={...emptyState().dossier,title:'Le cèdre',sourceText:'Le cèdre est un symbole du Liban.'};
  const state=markReady(createProposal(saveDossier(emptyState(),dossier)));
  sql.prepare('INSERT INTO studio_sessions VALUES (?,?,?,?)').run(user.userId,JSON.stringify(state),1,'now');
  const calls=[];
  const fetchImpl=async(url,init)=>{
    calls.push({url,init});assert.equal(init.headers.Authorization,'Bearer server-secret');
    if(init.method==='GET')return Response.json([]);
    if(init.method==='POST')return Response.json({id:151,status:'publish',link:'https://heritage-libanais.fr/le-cedre/'});
    if(init.method==='DELETE')return Response.json({id:151,status:'trash'});
    throw new Error('Unexpected WordPress method');
  };
  const published=await handleStudioRequest(request('/api/publication/publish','POST',{reviewer:'Joseph',revision:1}),env,user,{fetchImpl});
  assert.equal(published.status,200);
  const result=await published.json();assert.equal(result.state.status,'Publié');assert.equal(result.state.draft.wordpressPostId,151);
  assert.equal(calls.filter(call=>call.init.method==='POST').length,1);
  assert.equal((await handleStudioRequest(request('/api/publication/publish','POST',{reviewer:'Joseph',revision:1}),env,user,{fetchImpl})).status,409);
  const list=await(await handleStudioRequest(request('/api/publication/list'),env,user)).json();
  assert.equal(list.posts[0].title,'Le cèdre');
  const trashed=await handleStudioRequest(request('/api/publication/trash','POST',{revision:2,postId:151}),env,user,{fetchImpl});
  assert.equal(trashed.status,200);assert.equal((await trashed.json()).state.status,'Retiré du site');
  assert.match(calls.at(-1).url,/\/posts\/151\?force=false$/);
  assert.equal(sql.prepare('SELECT status FROM studio_wordpress_publications').get().status,'trash');
  assert.equal((await handleStudioRequest(request('/api/publication/trash','POST',{revision:3,postId:151}),env,user,{fetchImpl})).status,403);
});
test('a story or event with a photo can publish without credit or rights',async(t)=>{
  for(const type of ['recit','evenement'])await t.test(type,async()=>{
    const {env}=setup();
    env.WORDPRESS_ACCESS_TOKEN='fixture';
    await env.BUCKET.put(user.userId+'/media/visuel',new Uint8Array([137,80,78,71]),{httpMetadata:{contentType:'image/png'}});
    const start=emptyState(type);
    const event={...start.dossier.event,startDate:'2026-12-10',startTime:'18:00',venue:'Salle fictive'};
    const dossier={...start.dossier,title:'Publication de recette',sourceText:'Un texte relu.',event,
      mediaMode:'photos',media:[{id:'visuel',name:'visuel.png',alt:'Visuel fictif',credit:'  '}],
      ...(type==='evenement'?{eventImageId:'visuel'}:{})};
    const saved=saveDossier(start,dossier);
    const preview=type==='evenement'
      ?createProposal(saved,{title:dossier.title,summary:dossier.sourceText,contentType:type,siteEvent:true,event})
      :createProposal(saved);
    let uploaded=false;
    let published=false;
    const fetchImpl=async(url,init)=>{
      if(init.method==='GET')return Response.json([]);
      if(url.endsWith('/media')){
        assert.equal(init.body.has('caption'),false);
        assert.equal(init.body.get('alt_text'),'Visuel fictif');
        uploaded=true;
        return Response.json({id:27,source_url:'https://heritage-libanais.fr/visuel.png'},{status:201});
      }
      const post=JSON.parse(init.body);
      assert.equal(post.featured_media,27);
      assert.match(post.content,/alt="Visuel fictif"/);
      assert.doesNotMatch(post.content,/<figcaption>/);
      published=true;
      return Response.json({id:30,status:'publish',link:'https://heritage-libanais.fr/recette/'},{status:201});
    };
    const result=await handleStudioRequest(request('/api/publication/publish','POST',{revision:0,preview}),env,user,{fetchImpl});
    assert.equal(result.status,200,await result.text());
    assert.equal(uploaded,true);
    assert.equal(published,true);
  });
});

test('owner configures WordPress once and an editor can use the shared encrypted connection',async()=>{
  const {env,sql}=setup();configureWorkspace(env);
  const secret='wordpress-test-token-long-enough';
  const fetchImpl=async(_url,options)=>{
    assert.equal(options.headers.Authorization,'Bearer '+secret);
    return Response.json([]);
  };
  assert.equal((await handleStudioRequest(request('/api/publication/setup','POST',{token:secret}),env,editor,{fetchImpl})).status,403);
  assert.equal((await handleStudioRequest(request('/api/publication/setup','POST',{token:secret}),env,user,{fetchImpl})).status,200);
  const stored=sql.prepare('SELECT encrypted_token FROM studio_connections WHERE user_id = ?').get('wordpress:owner').encrypted_token;
  assert(!stored.includes(secret));
  const status=await(await handleStudioRequest(request('/api/publication/status'),env,editor,{fetchImpl})).json();
  assert.equal(status.connected,true);
  assert(!JSON.stringify(status).includes(secret));
});
test('owner stores a site application password encrypted and status never exposes it',async()=>{
  const {env,sql}=setup();configureWorkspace(env);
  const password='abcd efgh ijkl mnop qrst uvwx';
  const fetchImpl=async(url,options)=>{
    assert.match(url,/^https:\/\/heritage-libanais\.fr\/wp-json\/wp\/v2\//);
    assert.equal(options.headers.Authorization,`Basic ${btoa(`studio.owner:${password}`)}`);
    return url.includes('/users/me')?Response.json({id:3}):Response.json([]);
  };
  const connected=await handleStudioRequest(request('/api/publication/setup','POST',{username:'studio.owner',password}),env,user,{fetchImpl});
  assert.equal(connected.status,200);
  const stored=sql.prepare('SELECT encrypted_token FROM studio_connections WHERE user_id = ?').get('wordpress:owner').encrypted_token;
  assert(!stored.includes(password));
  const status=await(await handleStudioRequest(request('/api/publication/status'),env,editor,{fetchImpl})).json();
  assert.equal(status.connected,true);
  assert(!JSON.stringify(status).includes(password));
});
test('the setup action cannot publish a fictitious post to public WordPress',async()=>{
  const {env,sql}=setup();
  configureWorkspace(env);
  env.WORDPRESS_ACCESS_TOKEN='server-test-token';
  let upstream=0;
  const result=await handleStudioRequest(request('/api/publication/test','POST',{type:'recit'}),env,user,{
    fetchImpl:async()=>{upstream++;return Response.json({});},
  });
  assert.equal(result.status,404);
  assert.equal(upstream,0);
  assert.equal(sql.prepare('SELECT COUNT(*) AS total FROM studio_wordpress_publications').get().total,0);
});
test('an older Studio publication remains removable after a new dossier replaces the current session',async()=>{
  const {env,sql}=setup();env.WORDPRESS_ACCESS_TOKEN='server-secret';
  sql.prepare('INSERT INTO studio_wordpress_publications (slug,user_id,post_id,title,type,url,status,created_at) VALUES (?,?,?,?,?,?,?,?)').run('studio-0123456789abcdef01234567',user.userId,222,'Ancien récit','recit','https://heritage-libanais.fr/ancien/','publish','now');
  const response=await handleStudioRequest(request('/api/publication/trash','POST',{revision:0,postId:222}),env,user,{fetchImpl:async(_url,init)=>{assert.equal(init.method,'DELETE');return Response.json({id:222,status:'trash'});}});
  assert.equal(response.status,200);assert.equal((await response.json()).state,null);
  const list=await(await handleStudioRequest(request('/api/publication/list'),env,user)).json();
  assert.equal(list.posts[0].status,'trash');
  assert.equal((await handleStudioRequest(request('/api/publication/trash','POST',{revision:0,postId:222}),env,{userId:'other'})).status,403);
});


test('publication rejects racing calls and updates the same WordPress post from a reopened dossier',async()=>{
  const {env,sql}=setup();
  configureWorkspace(env);
  env.WORDPRESS_ACCESS_TOKEN='server-test-token';
  const dossier={...emptyState().dossier,title:'Recette récit',sourceText:'Premier texte.'};
  const draft=createProposal(saveDossier(emptyState(),dossier));
  assert.equal((await handleStudioRequest(request('/api/session','PUT',{state:draft,revision:0}),env,user)).status,200);
  const {promise:entered,resolve:notify}=Promise.withResolvers();
  const {promise:finish,resolve:release}=Promise.withResolvers();
  const calls=[];
  const post={id:201,status:'publish',link:'https://heritage-libanais.fr/recette/'};
  const fetchImpl=async(url,init)=>{
    calls.push({url,method:init.method,body:init.body&&JSON.parse(init.body)});
    if(init.method==='GET')return Response.json(url.includes('/posts/201?')?post:[]);
    if(url.endsWith('/posts')){notify();await finish;}
    return Response.json(post);
  };
  const submit=(revision,preview,actor)=>handleStudioRequest(
    request('/api/publication/publish','POST',{revision,preview}),env,actor,{fetchImpl},
  );
  const first=submit(1,draft,user);
  await entered;
  const racing=await submit(1,draft,editor);
  assert.equal(racing.status,409);
  assert.match((await racing.json()).error,/en cours/);
  release();
  const created=await (await first).json();
  assert.equal(created.post.id,201);
  assert.equal((await submit(1,draft,editor)).status,409);
  const reopened=await (await handleStudioRequest(request('/api/publication/dossier/201'),env,editor)).json();
  assert.equal(reopened.state.draft.wordpressPostId,201);
  const changed=createProposal(saveDossier(reopened.state,{...dossier,title:'Recette corrigée',sourceText:'Texte corrigé.'}));
  const saved=await submit(created.revision,changed,editor);
  assert.equal(saved.status,200);
  const updated=await saved.json();
  assert.equal(updated.post.id,201);
  assert.equal(updated.post.url,created.post.url);
  assert.equal(calls.filter(call=>call.method==='POST'&&call.url.endsWith('/posts')).length,1);
  assert.equal(calls.at(-1).url.endsWith('/posts/201'),true);
  assert.equal(calls.at(-1).body.title,'Recette corrigée');
  assert.equal(Object.hasOwn(calls.at(-1).body,'slug'),false);
  assert.equal(sql.prepare('SELECT title FROM studio_wordpress_publications').get().title,'Recette corrigée');
});
