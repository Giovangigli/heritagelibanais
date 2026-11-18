import { addEventRegistration } from './event-registrations.mjs';
import { parsePublishedPosts } from './mailing-content.mjs';

const encoder = new TextEncoder();
const response = (body, status) => Response.json(body, {
  status,
  headers: { 'Cache-Control': 'no-store' },
});

async function authorized(secret, supplied) {
  if (typeof secret !== 'string' || secret.length < 32 || !supplied || supplied.length !== secret.length) return false;
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  const expected = await crypto.subtle.sign('HMAC', key, encoder.encode(secret));
  return crypto.subtle.verify('HMAC', key, expected, encoder.encode(supplied));
}

export async function registerForPublishedEvent(request, env, readBody, fetchImpl = fetch) {
  if (!env.STUDIO_OWNER_USER_ID || !await authorized(env.EVENT_REGISTRATION_SECRET, request.headers.get('X-Heritage-Registration'))) {
    return response({ error: 'Accès refusé.' }, 403);
  }
  const input = await readBody(request);
  const postId = input?.postId;
  if (!Number.isSafeInteger(postId) || postId <= 0 || input?.accepted !== true) {
    return response({ error: 'Choisissez un événement et acceptez les conditions d’inscription.' }, 400);
  }

  const url = `https://heritage-libanais.fr/wp-json/wp/v2/posts/${postId}?_fields=id,status,link,title,content`;
  const result = await fetchImpl(url, { signal: AbortSignal.timeout(8000), redirect: 'error' });
  if (!result.ok && result.status !== 404) return response({ error: 'Le site est temporairement indisponible.' }, 502);
  const post = result.ok ? await result.json() : null;
  const event = post?.id === postId && post.status === 'publish' && parsePublishedPosts([post])[0];
  if (!event || event.type !== 'evenement' || !post.content.rendered.includes('studio-native-registration')) {
    return response({ error: 'Les inscriptions ne sont pas ouvertes pour cet événement.' }, 409);
  }

  try {
    await addEventRegistration(env.DB, {
      workspaceId: env.STUDIO_OWNER_USER_ID,
      eventPostId: postId,
      name: input.name,
      email: input.email,
    });
  } catch (error) {
    if (error instanceof TypeError) return response({ error: error.message }, 400);
    throw error;
  }
  return response({ ok: true }, 200);
}
