function normalizedEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function includesEmail(value, email) {
  return Boolean(email) && typeof value === 'string' && value.split(',').some(entry => normalizedEmail(entry) === email);
}

export function resolveStudioAccess(env, user) {
  if (!user?.userId) return null;
  const ownerEmail = normalizedEmail(env.STUDIO_OWNER_EMAIL);
  if (!ownerEmail) {
    return {role:'personal', workspaceUserId:user.userId, canManageConnections:true, canScheduleMailing:true};
  }
  const email = normalizedEmail(user.email);
  const ownerUserId = typeof env.STUDIO_OWNER_USER_ID === 'string' ? env.STUDIO_OWNER_USER_ID.trim() : '';
  if (email === ownerEmail) {
    if (ownerUserId && ownerUserId !== user.userId) return null;
    return {role:'owner', workspaceUserId:user.userId, canManageConnections:true, canScheduleMailing:true};
  }
  if (!ownerUserId || !includesEmail(env.STUDIO_EDITOR_EMAILS, email)) return null;
  return {
    role:'editor', workspaceUserId:ownerUserId, canManageConnections:false,
    canScheduleMailing:includesEmail(env.STUDIO_MAILING_EDITOR_EMAILS, email),
  };
}

export async function studioStorageScope(user, access) {
  const scope = JSON.stringify([user.userId, access.workspaceUserId]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(scope));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
