import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handleInstagramRequest,jpegDimensions} from './instagram-api.mjs';
import {encryptToken,decryptToken} from './studio-api.mjs';

function setup(){
  const sql=new DatabaseSync(':memory:');
  for(const name of ['0000_productive_mister_fear','0001_past_gressill','0002_empty_victor_mancha','0004_glossy_crystal'])sql.exec(readFileSync(new URL(`../drizzle/${name}.sql`,import.meta.url),'utf8'));
  const db={prepare(query){return {bind(...args){return {
    first:async()=>sql.prepare(query).get(...args)||null,
    all:async()=>({results:sql.prepare(query).all(...args)}),
    run:async()=>({meta:{changes:Number(sql.prepare(query).run(...args).changes)}}),
  };}};}};
  const env={STUDIO_CONNECTION_KEY:Buffer.alloc(32,7).toString('base64')};
  const access={role:'owner',workspaceUserId:'owner',canManageConnections:true};
  const bodyJson=async request=>request.json();
  const boundedBody=async request=>new Uint8Array(await request.arrayBuffer());
  return {sql,db,env,access,bodyJson,boundedBody,encryptToken,decryptToken,wordpressConnection:async()=>({type:'application-password',username:'owner',password:'a'.repeat(20)})};
}
function jpeg(){
  const bytes=new Uint8Array(110);
  bytes.set([0xff,0xd8,0xff,0xc0,0,17,8,0x05,0x46,0x04,0x38],0);
  bytes.set([0xff,0xd9],21);
  return bytes;
}
const origin='https://studio.example';
function request(path,method='GET',body,headers={}){
  return new Request(origin+path,{method,headers,body:body===undefined?undefined:body instanceof Uint8Array?body:JSON.stringify(body)});
}
const published=[{id:23,link:'https://heritage-libanais.fr/recit/',title:{rendered:'Récit test'},date:'2026-11-19',content:{rendered:'<article class="editorial-carousel"><div class="new-slide-copy"><p>Texte.</p></div></article>'}}];

test('JPEG dimensions are read from the file, including rejection of bad markers',()=>{
  assert.deepEqual(jpegDimensions(jpeg()),{width:1080,height:1350});
  assert.equal(jpegDimensions(new Uint8Array([0xff,0xd8,0xff])),null);
});

test('Instagram setup checks the exact account and never exposes the token',async()=>{
  const ctx=setup();const token='IGQV'+('x'.repeat(80));
  const fetchImpl=async url=>{
    if(String(url).includes('/me?'))return Response.json({id:'12345',username:'heritagelibanais',account_type:'BUSINESS'});
    throw new Error('Unexpected network call');
  };
  await assert.rejects(()=>handleInstagramRequest('/api/instagram/setup',request('/api/instagram/setup','POST',{token,username:'other'}),ctx.env,{...ctx,fetchImpl}),/pas à @other/);
  assert.equal(ctx.sql.prepare('SELECT COUNT(*) AS count FROM studio_connections').get().count,0);
  const saved=await handleInstagramRequest('/api/instagram/setup',request('/api/instagram/setup','POST',{token,username:'@heritagelibanais'}),ctx.env,{...ctx,fetchImpl});
  assert.equal(saved.status,200);
  const row=ctx.sql.prepare('SELECT encrypted_token FROM studio_connections').get();
  assert(!row.encrypted_token.includes(token));
  const status=await(await handleInstagramRequest('/api/instagram/status',request('/api/instagram/status'),ctx.env,{...ctx,fetchImpl})).json();
  assert.equal(status.connected,true);assert.equal(status.username,'heritagelibanais');assert(!JSON.stringify(status).includes(token));
});

test('carousel uploads verified JPEGs, publishes children then parent once, and records the result',async()=>{
  const ctx=setup();const token='IGQV'+('x'.repeat(80));
  const encrypted=await encryptToken(JSON.stringify({token,expectedUsername:'heritagelibanais',id:'12345'}),ctx.env);
  ctx.sql.prepare('INSERT INTO studio_connections VALUES (?,?,?)').run('instagram:owner',encrypted,'now');
  const calls=[];let uploaded=0,created=0;
  const fetchImpl=async(url,options={})=>{
    const parsed=new URL(String(url));calls.push(`${options.method||'GET'} ${parsed.pathname}`);
    if(parsed.hostname==='heritage-libanais.fr')return Response.json(published);
    if(parsed.pathname.endsWith('/me'))return Response.json({id:'12345',username:'heritagelibanais',account_type:'BUSINESS'});
    if(parsed.hostname==='heritage-libanais.fr'&&parsed.pathname.endsWith('/media'))return Response.json({id:++uploaded,source_url:`https://heritage-libanais.fr/wp-content/uploads/card-${uploaded}.jpg`});
    if(parsed.hostname==='graph.instagram.com'){
      if(parsed.pathname.endsWith('/media_publish'))return Response.json({id:'900'});
      if(parsed.pathname.endsWith('/media'))return Response.json({id:String(++created)});
      if(parsed.pathname.endsWith('/900'))return Response.json({permalink:'https://www.instagram.com/p/test/'});
      return Response.json({status_code:'FINISHED'});
    }
    if(parsed.hostname==='heritage-libanais.fr'&&parsed.pathname.endsWith('/media'))return Response.json({id:++uploaded,source_url:`https://heritage-libanais.fr/wp-content/uploads/card-${uploaded}.jpg`});
    throw new Error(`Unexpected URL ${url}`);
  };
  // WordPress application passwords use the site REST endpoint.
  const originalFetch=fetchImpl;
  const wrappedFetch=async(url,options)=>{
    if(String(url).includes('/wp-json/wp/v2/media'))return Response.json({id:++uploaded,source_url:`https://heritage-libanais.fr/wp-content/uploads/card-${uploaded}.jpg`});
    return originalFetch(url,options);
  };
  const ids=[];
  for(let position=1;position<=2;position++){
    const staged=await handleInstagramRequest('/api/instagram/asset',request(`/api/instagram/asset?postId=23&position=${position}`,'POST',jpeg(),{'Content-Type':'image/jpeg'}),ctx.env,{...ctx,fetchImpl:wrappedFetch});
    assert.equal(staged.status,200);ids.push((await staged.json()).asset.id);
  }
  const requestId=crypto.randomUUID();
  const body={postId:23,assetIds:ids,caption:'Récit test à lire.',confirmed:true,requestId};
  const result=await handleInstagramRequest('/api/instagram/publish',request('/api/instagram/publish','POST',body),ctx.env,{...ctx,fetchImpl:wrappedFetch});
  const job=(await result.json()).job;
  assert.equal(job.status,'published');assert.equal(job.mediaId,'900');assert.equal(job.permalink,'https://www.instagram.com/p/test/');
  assert.equal(calls.filter(call=>call==='POST /v27.0/12345/media').length,3);
  assert.equal(calls.filter(call=>call==='POST /v27.0/12345/media_publish').length,1);
  const repeated=await handleInstagramRequest('/api/instagram/publish',request('/api/instagram/publish','POST',body),ctx.env,{...ctx,fetchImpl:wrappedFetch});
  assert.equal((await repeated.json()).job.mediaId,'900');
  assert.equal(calls.filter(call=>call==='POST /v27.0/12345/media_publish').length,1);
  await assert.rejects(()=>handleInstagramRequest('/api/instagram/publish',request('/api/instagram/publish','POST',{...body,requestId:crypto.randomUUID()}),ctx.env,{...ctx,fetchImpl:wrappedFetch}),/existe déjà/);
  assert.equal(calls.filter(call=>call==='POST /v27.0/12345/media_publish').length,1);
});
