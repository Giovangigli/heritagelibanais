import {eventDateTime, renderEventPage} from '../public/private-studio/studio-event-page.mjs';
export {eventDateTime};

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
  if (!proposal?.output?.title?.trim() || (!proposal.output.siteEvent&&!proposal?.basis?.sourceText?.trim()&&!proposal?.output?.slides?.length)) throw failure('Le titre et le texte validé sont nécessaires avant publication.', 400);
  if (!/^studio-[a-f0-9]{24}$/.test(slug)) throw failure('Référence de publication invalide.', 400);
  return {
    title: proposal.output.title.trim(),
    excerpt: String(proposal.output.summary || '').trim(),
    content: proposal.output.siteEvent ? renderEventPage(proposal, uploadedMedia[0]) : renderedContent(proposal, uploadedMedia),
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

async function eventPluginRequest(connection, route, fetchImpl) {
  if (connection?.type !== 'application-password') {
    throw failure('Connectez WordPress avec un mot de passe d’application pour utiliser le module Événements.',409);
  }
  try {
    return await requestWordPress(connection,`https://${SITE}/wp-json/heritage-events/v1/${route}`,{method:'GET'},fetchImpl);
  } catch {
    throw failure('Le module Événements de WordPress ne répond pas. Vérifiez son activation et la connexion WordPress.',409);
  }
}

export async function verifyWordPressEventPlugin(connection, fetchImpl) {
  const status=await eventPluginRequest(connection,'status',fetchImpl);
  if(status?.ready!==true)throw failure('Activez le module Événements dans WordPress avant de publier.',409);
}

export async function wordpressEventRegistrations(connection, postId, afterEmail, fetchImpl) {
  if(!Number.isSafeInteger(postId)||postId<1)throw failure('Référence d’événement invalide.',400);
  const result=await eventPluginRequest(connection,`registrations/${postId}?after=${encodeURIComponent(afterEmail)}`,fetchImpl);
  if(!Array.isArray(result?.registrations)||result.registrations.length>500||
      result.registrations.some(row=>typeof row?.email!=='string'||!row.email||row.email===afterEmail)){
    throw failure('La liste d’inscrits WordPress ne peut pas être vérifiée.',502);
  }
  return result.registrations;
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
  const images = proposal.output.contentType === 'evenement' || proposal.basis.contentType === 'evenement' ? media.slice(0,1) : media;
  for(const image of images) uploaded.push(await uploadMedia(connection,image,fetchImpl));
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
