const POSTS_URL='https://heritage-libanais.fr/wp-json/wp/v2/posts?per_page=100&_fields=id,date,link,title,content';
const decode=value=>String(value||'').replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos|nbsp|hellip);/gi,(_,entity)=>{
  const named={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',hellip:'…'};
  if(entity[0]==='#')return String.fromCodePoint(parseInt(entity[1].toLowerCase()==='x'?entity.slice(2):entity.slice(1),entity[1].toLowerCase()==='x'?16:10));
  return named[entity.toLowerCase()]||_;
});
const plain=value=>decode(String(value||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ')).trim();
const publishedUrl=value=>{try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='heritage-libanais.fr'?u.href:'';}catch{return '';}};

function publicationImage(html) {
  for (const [tag] of html.matchAll(/<img\b[^>]*>/gi)) {
    const attrs = new Map(Array.from(tag.matchAll(/\s([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g), ([, name, doubleQuoted, singleQuoted]) => [name.toLowerCase(), decode(doubleQuoted ?? singleQuoted)]));
    const attr = name => attrs.get(name) || '';
    if (/\b(?:logo|new-cover-mark)\b/i.test(attr('class')) || attr('aria-hidden') === 'true') continue;
    try {
      const url = new URL(attr('src'));
      if (url.protocol !== 'https:' || !/\.(?:png|jpe?g|gif|webp)$/i.test(url.pathname)) continue;
      return {imageUrl: url.href, imageAlt: attr('alt').trim()};
    } catch { /* Ignore relative or invalid image URLs. */ }
  }
  return {};
}

export function parsePublishedPosts(posts,now=Date.now(),{includePastEvents=false}={}){
  if(!Array.isArray(posts))throw new TypeError('Réponse WordPress invalide.');
  return posts.flatMap(post=>{
    const html=String(post?.content?.rendered||'');
    const type=html.includes('editorial-carousel')?'recit':html.includes('event-hero')?'evenement':null;
    const url=publishedUrl(post?.link),title=plain(post?.title?.rendered);
    if(!type||!url||!title||!Number.isSafeInteger(post?.id))return [];
    let eventDate='',date='';
    let registrationSource,registrationUrl,past;
    if(type==='evenement'){
      const match=html.match(/<time\b[^>]*datetime=["']([^"']+)["']/i);
      eventDate=match?.[1]||'';
      const timestamp=Date.parse(eventDate);
      if(!Number.isFinite(timestamp))return [];
      past = timestamp <= now;
      if (past && !includePastEvents) return [];
      registrationSource = html.includes('studio-native-registration') ? 'studio' : 'external';
      if (registrationSource === 'external') {
        const link = html.match(/class=["'][^"']*event-practical[^"']*["'][^>]*>[\s\S]*?(https:\/\/[^<"'\s]+)/i);
        registrationUrl = link?.[1] ? decode(link[1]) : undefined;
      }
      date=new Intl.DateTimeFormat('fr-FR',{dateStyle:'long',timeStyle:'short',timeZone:'Europe/Paris'}).format(timestamp);
    }
    const introMatch=html.match(/class=["'][^"']*(?:new-slide-copy|event-story-copy)[^"']*["'][^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i);
    const intro=plain(introMatch?.[1]||'').slice(0,600);
    return [{id:post.id,type,title,url,publishedAt:post.date||'',intro,eventDate,date,...(type === 'evenement' ? {past,registrationSource,registrationUrl} : {}),...publicationImage(html)}];
  }).sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt));
}
export async function fetchPublishedContent(fetchImpl=fetch,{includePastEvents=false}={}){
  const response=await fetchImpl(POSTS_URL,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error('Le catalogue du site est momentanément indisponible.');
  const now = Date.now();
  const posts = parsePublishedPosts(await response.json(), now, {includePastEvents});
  // This event is rendered by a WordPress page template, outside the posts feed.
  const eventDate = '2026-11-28T16:00:00+01:00';
  const url = 'https://heritage-libanais.fr/lidentite-libanaise-en-danger-2e-session/';
  const past = Date.parse(eventDate) <= now;
  if ((!past || includePastEvents) && !posts.some(post => post.url === url)) {
    posts.unshift({
      id: -20261128,
      type: 'evenement',
      title: 'L’identité libanaise en danger — deuxième session',
      url,
      eventDate,
      past,
      registrationSource: 'external',
      date: '28 novembre 2026 à 16 h',
      intro: 'Le CCJFL et Héritage Libanais vous invitent à une deuxième session de cette conférence autour de l’histoire, de l’identité et de l’avenir du Liban.',
      venue: 'Mairie du XVe · Salle des mariages · 31, rue Péclet, 75015 Paris',
      registrationUrl: 'https://www.helloasso.com/associations/club-culturel-de-la-jeunesse-franco-libanaise/evenements/l-identite-libanaise-en-danger',
    });
  }
  return posts;
}
