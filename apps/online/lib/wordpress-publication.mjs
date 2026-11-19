const SITE = 'heritage-libanais.fr';
const OAUTH_API = `https://public-api.wordpress.com/wp/v2/sites/${SITE}`;
const APP_API = `https://${SITE}/wp-json/wp/v2`;
function wordpressAccess(connection) {
  if (typeof connection === 'string' && connection) return {api:OAUTH_API,authorization:`Bearer ${connection}`};
  if (connection?.type === 'application-password' && /^[A-Za-z0-9_.@+\-]{1,200}$/.test(connection.username) && typeof connection.password === 'string' && connection.password.length >= 16) {
    return {api:APP_API,authorization:`Basic ${btoa(`${connection.username}:${connection.password}`)}`};
  }
  throw failure('La connexion WordPress doit être configurée par l’administrateur.',503);
}

const failure = (message, status = 502) => Object.assign(new Error(message), { status });
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const paragraph = value => String(value ?? '').split(/\n\s*\n/).map(part => part.trim()).filter(Boolean).map(part => `<p>${escapeHtml(part).replace(/\n/g, '<br>')}</p>`).join('\n');
function approvedBody(proposal) {
  const slides=proposal.output.slides;
  if(!Array.isArray(slides)||!slides.length)return paragraph(proposal.basis.sourceText);
  return slides.map((slide,index)=>{
    const title=String(slide.title||'').trim();
    const heading=title&&title!==proposal.output.title?`<h2>${escapeHtml(title)}</h2>`:'';
    const text=paragraph(slide.body);
    return heading||text?`<section class="studio-card-copy" data-card="${index+1}">${heading}${text}</section>`:'';
  }).join('\n');
}
const MONTHS=['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];

export function eventDateTime(event) {
  const date=String(event?.startDate||'').trim().toLowerCase();
  let year,month,day;
  const iso=date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const french=date.match(/^(\d{1,2})\s+([a-zéûôî]+)\s+(\d{4})$/);
  const numeric=date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if(iso)[year,month,day]=[Number(iso[1]),Number(iso[2]),Number(iso[3])];
  else if(french)[year,month,day]=[Number(french[3]),MONTHS.indexOf(french[2])+1,Number(french[1])];
  else if(numeric)[year,month,day]=[Number(numeric[3]),Number(numeric[2]),Number(numeric[1])];
  else throw failure('Indiquez une date d’événement complète, par exemple « 22 novembre 2026 ».',400);
  const check=new Date(Date.UTC(year,month-1,day));
  if(check.getUTCFullYear()!==year||check.getUTCMonth()!==month-1||check.getUTCDate()!==day)throw failure('La date de l’événement est invalide.',400);
  const time=String(event?.startTime||'').trim().match(/^(\d{1,2})\s*(?:h|:)\s*(\d{0,2})$/i);
  if(!time)throw failure('Indiquez une heure complète, par exemple « 18 h 30 ».',400);
  const hour=Number(time[1]),minute=Number(time[2]||0);
  if(hour>23||minute>59)throw failure('L’heure de l’événement est invalide.',400);
  const offset=new Intl.DateTimeFormat('en-US',{timeZone:'Europe/Paris',timeZoneName:'shortOffset'}).formatToParts(new Date(Date.UTC(year,month-1,day,12))).find(part=>part.type==='timeZoneName')?.value==='GMT+2'?'+02:00':'+01:00';
  return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}T${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}:00${offset}`;
}

function renderedContent(proposal, uploadedMedia = []) {
  const { basis, output } = proposal;
  const event = output.contentType === 'evenement' || basis.contentType === 'evenement';
  const details = output.event || basis.event || {};
  const body = approvedBody(proposal);
  const figures = uploadedMedia.map(item => `<figure class="studio-image"><img src="${escapeHtml(item.url)}" alt="${escapeHtml(item.alt)}"><figcaption>${escapeHtml(item.credit)}</figcaption></figure>`).join('\n');
  const sources = basis.sources?.trim() ? `<section class="studio-sources"><h2>Sources</h2>${paragraph(basis.sources)}</section>` : '';
  if (!event) return `<article class="editorial-carousel studio-publication"><div class="new-slide-copy">${body}</div>${figures}${sources}</article>`;
  const eventDate = `${details.startDate || ''} ${details.startTime || ''}`.trim();
  const time = `<time datetime="${eventDateTime(details)}">${escapeHtml(eventDate)}</time>`;
  const practical = [details.venue, details.address, details.city, details.registrationUrl].filter(Boolean).map(value => `<p>${escapeHtml(value)}</p>`).join('');
  const registrationClass = details.registrationUrl?.trim() ? '' : ' studio-native-registration';
  return `<article class="event-hero studio-publication${registrationClass}">${time}<div class="event-story-copy">${body}</div>${figures}<section class="event-practical"><h2>Informations pratiques</h2>${practical}</section>${sources}</article>`;
}

export function wordpressPostFromProposal(proposal, slug, uploadedMedia = []) {
  if (!proposal?.output?.title?.trim() || (!proposal?.basis?.sourceText?.trim()&&!proposal?.output?.slides?.length)) throw failure('Le titre et le texte validé sont nécessaires avant publication.', 400);
  if (!/^studio-[a-f0-9]{24}$/.test(slug)) throw failure('Référence de publication invalide.', 400);
  return {
    title: proposal.output.title.trim(),
    excerpt: String(proposal.output.summary || '').trim(),
    content: renderedContent(proposal, uploadedMedia),
    ...(uploadedMedia[0] ? {featured_media:uploadedMedia[0].id} : {}),
    slug,
    status: 'publish',
  };
}

async function requestWordPress(connection, url, options, fetchImpl) {
  const {authorization}=wordpressAccess(connection);
  const response = await fetchImpl(url, {
    ...options,
    headers: { Authorization: authorization, Accept: 'application/json', ...(options?.body ? {'Content-Type':'application/json'} : {}) },
    signal: AbortSignal.timeout(15000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw failure(response.status === 401 || response.status === 403 ? 'La connexion WordPress a été refusée.' : `WordPress a refusé l’opération (${response.status}).`, response.status === 401 || response.status === 403 ? 503 : 502);
  return payload;
}

export async function verifyWordPressToken(connection,fetchImpl=fetch){
  const {api}=wordpressAccess(connection);
  if (typeof connection !== 'string') {
    const user=await requestWordPress(connection,`${api}/users/me?context=edit`,{method:'GET'},fetchImpl);
    if(!Number.isSafeInteger(user?.id))throw failure('Le compte WordPress ne répond pas comme prévu.');
  }
  const url=new URL(`${api}/posts`);
  url.searchParams.set('per_page','1');url.searchParams.set('context','edit');
  const posts=await requestWordPress(connection,url.href,{method:'GET'},fetchImpl);
  if(!Array.isArray(posts))throw failure('La connexion WordPress ne répond pas comme prévu.');
  return true;
}

async function uploadMedia(connection, image, fetchImpl) {
  const {api,authorization}=wordpressAccess(connection);
  const url=`${api}/media`;
  const form=new FormData();
  form.append('file',new Blob([image.bytes],{type:image.contentType}),image.name);
  form.append('alt_text',image.alt);
  form.append('caption',image.credit);
  const response=await fetchImpl(url,{method:'POST',headers:{Authorization:authorization,Accept:'application/json'},body:form,signal:AbortSignal.timeout(30000)});
  const payload=await response.json().catch(()=>null);
  if(!response.ok||!Number.isSafeInteger(payload?.id)||!payload?.source_url?.startsWith('https://'))throw failure('WordPress n’a pas accepté une image. La publication a été arrêtée.');
  return {id:payload.id,url:payload.source_url,alt:image.alt,credit:image.credit};
}

export async function uploadWordPressMedia(connection,image,fetchImpl=fetch){
  return uploadMedia(connection,image,fetchImpl);
}

export async function publishWordPressPost(connection, proposal, slug, fetchImpl = fetch, media = []) {
  const {api}=wordpressAccess(connection);
  const search = new URL(`${api}/posts`);
  search.searchParams.set('slug', slug);
  search.searchParams.set('context', 'edit');
  const existing = await requestWordPress(connection, search.href, {method:'GET'}, fetchImpl);
  if (Array.isArray(existing) && existing.length) {
    const post = existing[0];
    if (post.status !== 'publish') throw failure('Une publication WordPress existe déjà avec cette référence, mais son état doit être vérifié.', 409);
    return {id:post.id,url:post.link,status:post.status};
  }
  const uploaded=[];
  for(const image of media) uploaded.push(await uploadMedia(connection,image,fetchImpl));
  const post = await requestWordPress(connection, `${api}/posts`, {method:'POST',body:JSON.stringify(wordpressPostFromProposal(proposal, slug, uploaded))}, fetchImpl);
  if (!Number.isSafeInteger(post?.id) || post.status !== 'publish' || !post.link?.startsWith(`https://${SITE}/`)) throw failure('WordPress a répondu sans publication vérifiable. Vérifiez le site avant de recommencer.');
  return {id:post.id,url:post.link,status:post.status};
}

export async function trashWordPressPost(connection, postId, fetchImpl = fetch) {
  if (!Number.isSafeInteger(postId) || postId < 1) throw failure('Référence WordPress invalide.', 400);
  const {api}=wordpressAccess(connection);
  const post = await requestWordPress(connection, `${api}/posts/${postId}?force=false`, {method:'DELETE'}, fetchImpl);
  if (post?.status !== 'trash') throw failure('WordPress n’a pas confirmé la mise à la corbeille.');
  return {id:postId,status:'trash'};
}

export async function restoreWordPressPost(connection, postId, fetchImpl = fetch) {
  if (!Number.isSafeInteger(postId) || postId < 1) throw failure('Référence WordPress invalide.', 400);
  const {api}=wordpressAccess(connection);
  const post=await requestWordPress(connection,`${api}/posts/${postId}`,{method:'POST',body:JSON.stringify({status:'publish'})},fetchImpl);
  if(post?.status!=='publish'||!post?.link?.startsWith(`https://${SITE}/`))throw failure('WordPress n’a pas confirmé la restauration.');
  return {id:postId,status:'publish',url:post.link};
}
