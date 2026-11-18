// Call with the workspace and published event resolved by the server.
function checkScope(workspaceId, eventPostId) {
  if (typeof workspaceId !== 'string' || !workspaceId.trim() ||
      !Number.isSafeInteger(eventPostId) || eventPostId <= 0) {
    throw new TypeError('Un événement publié et son espace Studio sont requis.');
  }
}

export async function addEventRegistration(db, { workspaceId, eventPostId, name, email }) {
  checkScope(workspaceId, eventPostId);
  const attendeeName = typeof name === 'string' ? name.trim() : '';
  const address = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!attendeeName || attendeeName.length > 160 || /[\u0000-\u001f\u007f]/u.test(attendeeName) ||
      address.length > 254 || !/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/u.test(address)) {
    throw new TypeError('Indiquez votre nom et une adresse e-mail valide.');
  }

  // D1 enforces uniqueness even when two requests arrive at the same time.
  const registration = await db.prepare(
    `INSERT INTO studio_event_registrations (id, workspace_id, event_post_id, email, name, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (workspace_id, event_post_id, email) DO NOTHING
     RETURNING id`,
  ).bind(crypto.randomUUID(), workspaceId, eventPostId, address, attendeeName, new Date().toISOString()).first();

  return { created: Boolean(registration), id: registration?.id ?? null };
}

export async function listEventRegistrations(db, { workspaceId, eventPostId, afterEmail = '', limit = 100 }) {
  checkScope(workspaceId, eventPostId);
  if (typeof afterEmail !== 'string' || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    throw new TypeError('Pagination invalide.');
  }

  const { results } = await db.prepare(
    `SELECT id, name, email, created_at FROM studio_event_registrations
     WHERE workspace_id = ? AND event_post_id = ? AND email > ?
     ORDER BY email LIMIT ?`,
  ).bind(workspaceId, eventPostId, afterEmail, limit).all();
  return results;
}
