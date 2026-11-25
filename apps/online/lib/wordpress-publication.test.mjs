import test from 'node:test';
import assert from 'node:assert/strict';
import {renderStoryPreview} from '../public/private-studio/studio-publication-page.mjs';
import {eventDateTime,wordpressPostFromProposal,publishWordPressPost,trashWordPressPost,restoreWordPressPost,verifyWordPressToken} from './wordpress-publication.mjs';

const slug='studio-0123456789abcdef01234567';
const story={basis:{sourceText:'Un texte <à relire>.\n\nSecond paragraphe.',sources:'Archive & livre',contentType:'recit'},output:{title:'Un récit',summary:'Résumé du récit.',contentType:'recit'}};

test('WordPress article keeps source paragraphs, escapes HTML and identifies the Récit for mailing',()=>{
  const post=wordpressPostFromProposal(story,slug);
  assert.equal(post.status,'publish');
  assert.match(post.content,/class="container editorial-carousel/);
  assert.match(post.content,/&lt;à relire&gt;/);
  assert.match(post.content,/Archive &amp; livre/);
  assert(!post.content.includes('<à relire>'));
  const edited=wordpressPostFromProposal({...story,output:{...story.output,slides:[{title:'Un récit',body:''},{title:'La suite',body:'Texte validé par Joseph.'}]}},slug);
  assert.match(edited.content,/Texte validé par Joseph/);
  assert(!edited.content.includes('Un texte &lt;à relire&gt;'));
});

test('approved story composition is published as cards with their assigned images',async()=>{
  const composition={
    contrat:'hl.composition.2',type:'recit',pratique:[],alertes:[],
    textes:[{id:'title',role:'titre',texte:'Couverture validée',separateur:''},
      {id:'body',role:'corps',texte:'Texte de la deuxième carte.',separateur:''}],
    cartes:[
      {id:'cover',gabarit:'couverture',fond:'sand',blocs:['title'],medias:[],champs:[]},
      {id:'second',gabarit:'colonnes',fond:'sage',relief:'filet',blocs:['body'],
        medias:[{media_id:'assigned',alt:'Légende alternative',fit:'cover'}],champs:[]},
    ],
  };
  const proposal={...story,output:{...story.output,composition,
    slides:[{title:'Ancienne copie du titre'},{body:'Ancienne copie du texte'}]}};
  let content;
  const fetchImpl=async(url,options)=>{
    if(options.method==='GET')return Response.json([]);
    if(url.endsWith('/media')){
      const name=options.body.get('file').name;
      return Response.json({id:name==='assigned.jpg'?72:73,source_url:'https://heritage-libanais.fr/'+name});
    }
    ({content}=JSON.parse(options.body));
    return Response.json({id:36,status:'publish',link:'https://heritage-libanais.fr/test/'});
  };
  const image={bytes:new Uint8Array([1]),contentType:'image/jpeg',alt:'Image',credit:''};
  await publishWordPressPost('token',proposal,slug,fetchImpl,[
    {...image,mediaId:'unused',name:'unused.jpg'},
    {...image,mediaId:'assigned',name:'assigned.jpg',credit:'Crédit facultatif'},
  ]);
  assert.match(content,/class="editorial-track" data-carousel-track/);
  const cards=content.match(/<article[^>]+data-slide[^>]*>.*?<\/article>/gs);
  assert.equal(cards.length,2);
  assert.match(cards[0],/studio-card-sand[^>]*>.*Couverture validée/s);
  assert.doesNotMatch(cards[0],/assigned\.jpg/);
  assert.match(cards[1],/studio-card-colonnes .*studio-card-filet/);
  assert.match(cards[1],/Texte de la deuxième carte/);
  assert.match(cards[1],/class="[^"]*studio-image-cover"[^>]*>.*assigned\.jpg" alt="Légende alternative"/s);
  assert.match(cards[1],/<figcaption>Crédit facultatif<\/figcaption>/);
  assert.doesNotMatch(content,/Ancienne copie|unused\.jpg/);
});

test('the active Studio preview matches the published card and the cover follows its assigned image',()=>{
  const basis={...story.basis,mediaMode:'photos',media:[{id:'inside',name:'Archive'},{id:'cover',name:'Couverture'}]};
  const output={...story.output,slides:[
    {title:'Couverture',layout:'cover',mediaIds:['cover']},
    {title:'Archive',body:'Récit relu',layout:'split',mediaIds:['inside']},
  ]};
  const media=[
    {id:17,mediaId:'inside',url:'https://example.test/archive.jpg'},
    {id:18,mediaId:'cover',url:'https://example.test/cover.jpg'},
  ];
  const proposal={basis,output};
  const post=wordpressPostFromProposal(proposal,slug,media);
  assert.equal(post.featured_media,18);
  const matchCards=html=>html.match(/<article[^>]+data-slide[^>]*>.*?<\/article>/gs);
  const cards=matchCards(post.content);
  assert.deepEqual(matchCards(renderStoryPreview(proposal,media)),cards);
  const withoutCover={basis,output:{...output,slides:[{...output.slides[0],mediaIds:[]},output.slides[1]]}};
  assert.equal(wordpressPostFromProposal(withoutCover,slug,media).featured_media,undefined);
});

test('portrait cards keep text before the image when the two columns stack',()=>{
  const proposal={basis:{...story.basis,mediaMode:'photos',media:[{id:'portrait',name:'Portrait'}]},output:{...story.output,slides:[
    {title:'Couverture',layout:'cover'},
    {body:'Texte avant le portrait',layout:'image-top',mediaIds:['portrait']},
  ]}};
  const media=[{mediaId:'portrait',url:'https://example.test/portrait.jpg'}];
  const portraitCard=/<article[^>]+studio-card-image_haut[^>]*>.*<div class="new-slide-copy">.*Texte avant le portrait.*<div class="new-slide-media-group">.*portrait\.jpg/s;
  assert.match(renderStoryPreview(proposal,media),portraitCard);
  assert.match(wordpressPostFromProposal(proposal,slug,media).content,portraitCard);
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

test('the site event page uses one image and the editor’s explicit registration choice',async()=>{
  const {renderEventPage}=await import('../public/private-studio/studio-event-page.mjs');
  const event={startDate:'2026-11-28',startTime:'16:00',venue:'Paris',registrationMode:'site'};
  const proposal={basis:{contentType:'evenement',sourceText:'Programme & description',event},output:{contentType:'evenement',siteEvent:true,title:'Rencontre',event}};
  const images=[{id:1,url:'https://heritage-libanais.fr/affiche.png'},{id:2,url:'https://heritage-libanais.fr/vieux.jpg'}];
  const post=wordpressPostFromProposal(proposal,'studio-123456789012345678901234',images);
  assert.match(post.content,/<h1>Rencontre<\/h1>/);
  assert.match(post.content,/Programme &amp; description/);
  assert.match(post.content,/\[hl_event_registration\]/);
  assert.doesNotMatch(post.content,/vieux\.jpg/);
  const preview=renderEventPage(proposal,images[0],{preview:true});
  assert.match(preview,/Confirmer mon inscription/);
  assert.doesNotMatch(preview,/\[hl_event_registration\]/);
  const withIcon={...proposal,basis:{...proposal.basis,eventIcon:'cedar'}};
  const iconPost=wordpressPostFromProposal(withIcon,'studio-123456789012345678901234',images);
  assert.match(iconPost.content,/studio-event-icon-cedar/);
  assert.match(iconPost.content,/\[hl_studio_event_icon name="cedar"\]/);
  assert.equal(iconPost.featured_media,undefined);
  assert.doesNotMatch(iconPost.content,/affiche\.png/);
  const iconPreview=renderEventPage(withIcon,images[0],{preview:true});
  assert.match(iconPreview,/pictogram-cedar\.svg/);
  assert.equal((iconPreview.match(/<img /g)||[]).length,1);
  for(const mode of ['none','external']){
    event.registrationMode=mode;
    event.registrationUrl='https://example.org/places';
    const content=wordpressPostFromProposal(proposal,'studio-123456789012345678901234').content;
    assert.doesNotMatch(content,/\[hl_event_registration\]/);
    assert.equal(content.includes('href="https://example.org/places"'),mode==='external');
  }
});
