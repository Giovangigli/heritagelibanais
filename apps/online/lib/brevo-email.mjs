const COLORS = Object.freeze({ ink: '#123C32', green: '#1B5A45', red: '#B82F2B', paper: '#F7F4EC', sand: '#E6DDCB', mist: '#DCE8DF' });
const SITE = 'https://heritage-libanais.fr';

const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
function httpsUrl(value, fallback) {
  try { const url = new URL(String(value)); return url.protocol === 'https:' ? url.href : fallback; }
  catch { return fallback; }
}
function paragraph(value) { return `<p style="margin:0 0 20px;color:${COLORS.ink};font:16px/1.55 Arial,sans-serif">${escapeHtml(value)}</p>`; }
function row(label, value) {
  if (!value) return '';
  return `<tr><td style="padding:11px 0;border-top:1px solid #C7CEC3;color:${COLORS.ink};font:700 11px/1.4 Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;width:115px;vertical-align:top">${escapeHtml(label)}</td><td style="padding:11px 0;border-top:1px solid #C7CEC3;color:${COLORS.ink};font:15px/1.45 Arial,sans-serif">${escapeHtml(value)}</td></tr>`;
}
function button(label, href) {
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:28px 0"><tr><td bgcolor="${COLORS.ink}" style="padding:13px 20px"><a href="${escapeHtml(href)}" style="color:#FFFFFF;text-decoration:none;font:700 15px/1.3 Arial,sans-serif">${escapeHtml(label)} &nbsp;↗</a></td></tr></table>`;
}
function image(url, alt, credit) {
  if (!url) return '';
  const safe = httpsUrl(url, '');
  if (!safe) return '';
  return `<img src="${escapeHtml(safe)}" alt="${escapeHtml(alt || '')}" width="560" style="display:block;width:100%;height:auto;border:0;background:${COLORS.mist}">${credit ? `<p style="margin:6px 0 22px;color:#5C675E;font:12px/1.4 Arial,sans-serif">${escapeHtml(credit)}</p>` : ''}`;
}
function shell(kicker, title, body, previewText) {
  return `<!doctype html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head><body style="margin:0;padding:0;background:${COLORS.paper}"><div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(previewText)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${COLORS.paper}"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#FFFDFA"><tr><td style="padding:30px 20px 26px;background:${COLORS.ink};color:#FFFFFF"><a href="${SITE}" style="color:#FFFFFF;text-decoration:none;font:600 24px/1.15 Georgia,serif">Héritage Libanais</a><div style="margin-top:8px;color:#DCE8DF;font:700 11px/1.4 Arial,sans-serif;letter-spacing:.15em;text-transform:uppercase">La lettre</div></td></tr><tr><td style="padding:30px 20px 34px"><p style="margin:0 0 12px;color:${COLORS.red};font:700 11px/1.4 Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase">${escapeHtml(kicker)}</p><h1 style="margin:0 0 24px;color:${COLORS.ink};font:600 34px/1.12 Georgia,serif">${escapeHtml(title)}</h1>${body}</td></tr><tr><td style="padding:22px 20px;background:${COLORS.mist};color:${COLORS.ink};font:13px/1.6 Arial,sans-serif"><strong>Héritage Libanais</strong><br><a href="${SITE}" style="color:${COLORS.ink}">heritage-libanais.fr</a> · <a href="https://www.instagram.com/heritagelibanais/" style="color:${COLORS.ink}">Instagram</a><br><a href="{{ unsubscribe }}" style="color:${COLORS.ink}">Se désinscrire de la lettre</a></td></tr></table></td></tr></table></body></html>`;
}

export function renderStoryEmail(input) {
  const title = String(input.title || '').trim();
  if (!title || !input.intro || !input.url) throw new TypeError('Title, introduction and article URL are required.');
  const url = httpsUrl(input.url, ''); if (!url) throw new TypeError('The article URL must use HTTPS.');
  const previewText = String(input.previewText || input.intro).trim();
  const parts = [image(input.imageUrl, input.imageAlt || title, input.imageCredit), paragraph(input.intro)];
  for (const item of (input.sections || []).slice(0, 3)) {
    if (!item?.title || !item?.text) continue;
    parts.push(`<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 15px;background:${COLORS.mist}"><tr><td style="padding:18px"><h2 style="margin:0 0 8px;color:${COLORS.ink};font:600 22px/1.2 Georgia,serif">${escapeHtml(item.title)}</h2>${paragraph(item.text)}</td></tr></table>`);
  }
  parts.push(button('Voir le récit', url));
  if (input.sources) parts.push(`<p style="margin:0;color:#5C675E;font:12px/1.5 Arial,sans-serif">Sources et crédits : ${escapeHtml(input.sources)}</p>`);
  return { subject: String(input.subject || `À lire · ${title}`).trim(), previewText, html: shell('Récit en images', title, parts.join(''), previewText) };
}

export function renderEventEmail(input) {
  const title = String(input.title || '').trim();
  if (!title || !input.intro || !input.date || !input.url) throw new TypeError('Title, introduction, date and event URL are required.');
  const url = httpsUrl(input.url, ''); if (!url) throw new TypeError('The event URL must use HTTPS.');
  const reminder = input.purpose === 'reminder';
  const previewText = String(input.previewText || `${input.date}${input.city ? ` · ${input.city}` : ''}`).trim();
  const details = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:16px 0 0">${row('Date', input.date)}${row('Horaire', input.time)}${row('Lieu', input.venue)}${row('Ville', input.city)}${row('Tarif', input.price)}</table>`;
  const body = image(input.imageUrl, input.imageAlt || title, input.imageCredit) + paragraph(input.intro) + details + button(input.registrationUrl ? 'S’inscrire' : 'Voir l’évènement', input.registrationUrl ? httpsUrl(input.registrationUrl, url) : url) + (input.practicalNote ? paragraph(input.practicalNote) : '');
  return { subject: String(input.subject || `${reminder ? 'Rappel' : 'Rencontre'} · ${title} · ${input.date}`).trim(), previewText, html: shell(reminder ? 'Rappel de l’événement' : 'Nos rencontres', title, body, previewText) };
}

export function renderWelcomeTemplate() {
  const storyImage = '{% if params.STORY_IMAGE_URL %}<img src="{{ params.STORY_IMAGE_URL }}" alt="{{ params.STORY_IMAGE_ALT }}" width="560" style="display:block;width:100%;height:auto;border:0">{% endif %}';
  const story = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:26px 0;background:${COLORS.mist}"><tr><td style="padding:20px"><p style="margin:0 0 7px;color:${COLORS.red};font:700 11px Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase">Le dernier récit</p><h2 style="margin:0;color:${COLORS.ink};font:600 23px/1.2 Georgia,serif">{{ params.STORY_TITLE }}</h2></td></tr><tr><td>${storyImage}</td></tr></table>${button('Lire le récit', '{{ params.STORY_URL }}')}`;
  const event = `{% if params.EVENT_URL %}<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:28px 0 0;border-top:1px solid #C7CEC3"><tr><td style="padding:20px 0 0"><p style="margin:0 0 7px;color:${COLORS.red};font:700 11px Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase">À venir</p><h2 style="margin:0 0 9px;color:${COLORS.ink};font:600 23px/1.2 Georgia,serif">{{ params.EVENT_TITLE }}</h2><p style="margin:0;color:${COLORS.ink};font:15px/1.5 Arial,sans-serif">{{ params.EVENT_DATE }}</p>${button('Voir l’évènement', '{{ params.EVENT_URL }}')}</td></tr></table>{% endif %}`;
  const body = paragraph('Merci d’avoir confirmé votre inscription à La lettre Héritage Libanais. Vous recevrez nos nouveaux récits et les annonces de rencontres.') + paragraph('Pour commencer, voici le récit le plus récent publié sur notre site.') + story + event;
  return {subject:'Bienvenue dans La lettre · Héritage Libanais',html:shell('Bienvenue', 'Une histoire à recevoir.', body, 'Votre inscription est confirmée. Découvrez notre dernier récit.')};
}
