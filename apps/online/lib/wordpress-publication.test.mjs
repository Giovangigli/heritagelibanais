import test from 'node:test';
import assert from 'node:assert/strict';
import {eventDateTime,wordpressPostFromProposal,publishWordPressPost,trashWordPressPost,restoreWordPressPost,verifyWordPressToken} from './wordpress-publication.mjs';

const slug='studio-0123456789abcdef01234567';
const story={basis:{sourceText:'Un texte <à relire>.\n\nSecond paragraphe.',sources:'Archive & livre',contentType:'recit'},output:{title:'Un récit',summary:'Résumé du récit.',contentType:'recit'}};

test('WordPress article keeps source paragraphs, escapes HTML and identifies the Récit for mailing',()=>{
  const post=wordpressPostFromProposal(story,slug);
  assert.equal(post.status,'publish');
  assert.match(post.content,/class="editorial-carousel/);
  assert.match(post.content,/&lt;à relire&gt;/);
  assert.match(post.content,/Archive &amp; livre/);
  assert(!post.content.includes('<à relire>'));
  const edited=wordpressPostFromProposal({...story,output:{...story.output,slides:[{title:'Un récit',body:''},{title:'La suite',body:'Texte validé par Joseph.'}]}},slug);
  assert.match(edited.content,/Texte validé par Joseph/);
  assert(!edited.content.includes('Un texte &lt;à relire&gt;'));
});

test('French event date becomes a dated WordPress event that mailing can identify',()=>{
  const event={startDate:'22 novembre 2026',startTime:'18 h 30',venue:'Paris'};
  assert.equal(eventDateTime(event),'2026-11-22T18:30:00+01:00');
  const post=wordpressPostFromProposal({basis:{...story.basis,contentType:'evenement',event},output:{...story.output,contentType:'evenement',event}},slug);
  assert.match(post.content,/class="event-hero/);
  assert.match(post.content,/datetime="2026-11-22T18:30:00\+01:00"/);
  assert.throws(()=>eventDateTime({...event,startDate:'31 février 2026'}),/invalide/);
});

test('publication checks for an existing slug before creating a post and Trash is recoverable',async()=>{
  const calls=[];
  const fetchImpl=async(url,options)=>{calls.push({url,options});
    if(options.method==='GET')return Response.json([]);
    if(options.method==='POST')return Response.json({id:35,status:'publish',link:'https://heritage-libanais.fr/un-recit/'});
    return Response.json({id:35,status:'trash'});
  };
  const post=await publishWordPressPost('token',story,slug,fetchImpl);
  assert.equal(post.id,35);
  assert.equal(JSON.parse(calls[1].options.body).slug,slug);
  assert.equal((await trashWordPressPost('token',35,fetchImpl)).status,'trash');
  assert.match(calls.at(-1).url,/force=false$/);
});
test('approved image is uploaded before the article and becomes its featured image',async()=>{
  const calls=[];
  const fetchImpl=async(url,options)=>{calls.push({url,options});
    if(options.method==='GET')return Response.json([]);
    if(url.endsWith('/media'))return Response.json({id:72,source_url:'https://heritage-libanais.fr/wp-content/uploads/cedre.jpg'});
    return Response.json({id:36,status:'publish',link:'https://heritage-libanais.fr/cedre/'});
  };
  await publishWordPressPost('token',story,slug,fetchImpl,[{bytes:new Uint8Array([1,2,3]),contentType:'image/jpeg',name:'cedre.jpg',alt:'Un cèdre',credit:'Photo autorisée'}]);
  const post=JSON.parse(calls.at(-1).options.body);
  assert.equal(post.featured_media,72);
  assert.match(post.content,/Photo autorisée/);
  assert.match(post.content,/cedre.jpg/);
});
test('site application password verifies the user and posts, then publishes and trashes through the site API',async()=>{
  const connection={type:'application-password',username:'studio.owner',password:'abcd efgh ijkl mnop qrst uvwx'};
  const calls=[];
  const fetchImpl=async(url,options)=>{
    calls.push({url,options});
    assert.equal(options.headers.Authorization,`Basic ${btoa(`${connection.username}:${connection.password}`)}`);
    assert.match(url,/^https:\/\/heritage-libanais\.fr\/wp-json\/wp\/v2\//);
    if(url.includes('/users/me'))return Response.json({id:3});
    if(options.method==='GET')return Response.json([]);
    if(options.method==='POST')return Response.json({id:44,status:'publish',link:'https://heritage-libanais.fr/test-studio/'});
    return Response.json({id:44,status:'trash'});
  };
  assert.equal(await verifyWordPressToken(connection,fetchImpl),true);
  assert.equal((await publishWordPressPost(connection,story,slug,fetchImpl)).id,44);
  assert.equal((await trashWordPressPost(connection,44,fetchImpl)).status,'trash');
  assert.equal((await restoreWordPressPost(connection,44,fetchImpl)).status,'publish');
  assert.equal(JSON.parse(calls.at(-1).options.body).status,'publish');
  assert.equal(calls.length,6);
});
