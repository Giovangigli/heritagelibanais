import {eventDateTime, renderEventPage} from '../public/private-studio/studio-event-page.mjs';
import {renderPublicationContent} from '../public/private-studio/studio-publication-page.mjs';
import {eventIcon} from '../public/private-studio/studio-model.mjs';
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
export function wordpressPostFromProposal(proposal, slug, uploadedMedia = []) {
  if (!proposal?.output?.title?.trim() || (!proposal.output.siteEvent&&!proposal?.basis?.sourceText?.trim()&&!proposal?.output?.slides?.length)) throw failure('Le titre et le texte validé sont nécessaires avant publication.', 400);
  if (!/^studio-[a-f0-9]{24}$/.test(slug)) throw failure('Référence de publication invalide.', 400);
  return {
    title: proposal.output.title.trim(),
    excerpt: String(proposal.output.summary || '').trim(),
    content: proposal.output.siteEvent ? renderEventPage(proposal, uploadedMedia[0]) : renderPublicationContent(proposal, uploadedMedia),
    ...(uploadedMedia[0] && !(proposal.output.siteEvent && eventIcon(proposal.basis)) ? {featured_media:uploadedMedia[0].id} : {}),
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
  }).catch(()=>{throw failure('WordPress ne répond pas. Vérifiez la publication avant de réessayer.');});
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
  const response=await fetchImpl(url,{method:'POST',headers:{Authorization:authorization,Accept:'application/json'},body:form,signal:AbortSignal.timeout(30000)}).catch(()=>{
    throw failure('Le transfert de l’image vers WordPress a échoué. Réessayez après avoir vérifié la connexion.');
  });
  const payload=await response.json().catch(()=>null);
  if(!response.ok||!Number.isSafeInteger(payload?.id)||!payload?.source_url?.startsWith('https://'))throw failure('WordPress n’a pas accepté une image. La publication a été arrêtée.');
  return {id:payload.id,url:payload.source_url,alt:image.alt,credit:image.credit};
}

export async function uploadWordPressMedia(connection,image,fetchImpl=fetch){
  return uploadMedia(connection,image,fetchImpl);
}

export async function publishWordPressPost(connection, proposal, slug, fetchImpl = fetch, media = [], postId = null) {
  const {api}=wordpressAccess(connection);
  if (postId === null) {
    const search = new URL(`${api}/posts`);
    search.searchParams.set('slug', slug);
    search.searchParams.set('context', 'edit');
    search.searchParams.set('status', 'publish,draft,pending,future,private,trash');
    const existing = await requestWordPress(connection, search.href, {method:'GET'}, fetchImpl);
    if (!Array.isArray(existing)) throw failure('WordPress n’a pas confirmé la disponibilité de cette référence.');
    if (existing.length) {
      const post = existing[0];
      if (post.status !== 'publish' || !Number.isSafeInteger(post.id) || !post.link?.startsWith(`https://${SITE}/`)) {
        throw failure('Une publication WordPress existe déjà avec cette référence, mais son état doit être vérifié.', 409);
      }
      postId=post.id;
    }
  } else {
    const current = await requestWordPress(connection, `${api}/posts/${postId}?context=edit`, {method:'GET'}, fetchImpl);
    if (current?.status !== 'publish' || current.id !== postId) {
      throw failure('La publication WordPress a changé d’état. Vérifiez-la avant de la modifier.', 409);
    }
  }
  const uploaded = [];
  const images = proposal.output.contentType === 'evenement' || proposal.basis.contentType === 'evenement' ? media.slice(0,1) : media;
  for (const image of images) uploaded.push(await uploadMedia(connection,image,fetchImpl));
  const payload = wordpressPostFromProposal(proposal, slug, uploaded);
  if (postId !== null) {
    // Keep the existing permalink even if an editor changed the WordPress slug.
    delete payload.slug;
    delete payload.status;
    payload.featured_media ??= 0;
  }
  const endpoint = postId === null ? `${api}/posts` : `${api}/posts/${postId}`;
  const post = await requestWordPress(connection, endpoint, {method:'POST',body:JSON.stringify(payload)}, fetchImpl);
  if (!Number.isSafeInteger(post?.id) || (postId !== null && post.id !== postId) || post.status !== 'publish' || !post.link?.startsWith(`https://${SITE}/`)) {
    throw failure('WordPress a répondu sans publication vérifiable. Vérifiez le site avant de recommencer.');
  }
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
