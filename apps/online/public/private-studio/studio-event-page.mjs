import {eventDetails, eventIcon} from './studio-model.mjs';

export const eventIconPreviewUrl = key => /^\d{2}-[a-z]+(?:-[a-z]+)*$/.test(key)
  ? new URL(`../dist/assets/pictogrammes/clair/${key}.svg`, import.meta.url).href
  : new URL(`./event-icons/pictogram-${key}.svg`, import.meta.url).href;

const invalidEvent = message => Object.assign(new Error(message), {status: 400});
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const paragraph = value => String(value ?? '').split(/\n\s*\n/).map(part => part.trim()).filter(Boolean).map(part => `<p>${escapeHtml(part).replace(/\n/g, '<br>')}</p>`).join('\n');

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
  else throw invalidEvent('Indiquez une date d’événement complète, par exemple « 22 novembre 2026 ».',400);
  const check=new Date(Date.UTC(year,month-1,day));
  if(check.getUTCFullYear()!==year||check.getUTCMonth()!==month-1||check.getUTCDate()!==day)throw invalidEvent('La date de l’événement est invalide.',400);
  const time=String(event?.startTime||'').trim().match(/^(\d{1,2})\s*(?:h|:)\s*(\d{0,2})$/i);
  if(!time)throw invalidEvent('Indiquez une heure complète, par exemple « 18 h 30 ».',400);
  const hour=Number(time[1]),minute=Number(time[2]||0);
  if(hour>23||minute>59)throw invalidEvent('L’heure de l’événement est invalide.',400);
  const offset=new Intl.DateTimeFormat('en-US',{timeZone:'Europe/Paris',timeZoneName:'shortOffset'}).formatToParts(new Date(Date.UTC(year,month-1,day,12))).find(part=>part.type==='timeZoneName')?.value==='GMT+2'?'+02:00':'+01:00';
  return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}T${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}:00${offset}`;
}

export function registrationMode(event) {
  return ['site', 'external'].includes(event?.registrationMode) ? event.registrationMode : 'none';
}

function externalSignupUrl(value) {
  try {
    const url = new URL(value);
    if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) return url.href;
  } catch { /* Display a field error below. */ }
  throw invalidEvent('Indiquez un lien d’inscription externe valide.');
}

const registrationPreview = `<section id="inscription" class="studio-event-registration" aria-labelledby="studio-event-registration-title">
  <h2 id="studio-event-registration-title">S’inscrire à l’événement</h2>
  <form>
    <label>Nom et prénom <input autocomplete="name" required></label>
    <label>Adresse e-mail <input type="email" autocomplete="email" required></label>
    <label class="studio-event-optin"><input type="checkbox" required> J’accepte que mes coordonnées soient utilisées pour gérer cette inscription et me contacter au sujet de cet événement.</label>
    <button class="studio-event-button" type="submit">Confirmer mon inscription</button>
  </form>
</section>`;

export function renderEventPage(proposal, image, {preview = false} = {}) {
  const {basis, output} = proposal;
  const {title} = output;
  const details = output.event || basis.event;
  if (!title?.trim()) throw invalidEvent('Indiquez le titre de l’événement.');
  if (!details?.venue?.trim()) throw invalidEvent('Indiquez le lieu ou le lien d’accès à l’événement.');
  const datetime = eventDateTime(details);
  const mode = registrationMode(details);
  const external = mode === 'external' ? externalSignupUrl(details.registrationUrl) : '';
  const marker = mode === 'site' ? 'studio-wordpress-registration' : mode === 'external' ? 'studio-event-external-registration' : 'studio-event-no-registration';
  const practical = eventDetails({...details, registrationUrl:''}).map(([label,value]) =>
    `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('');
  const icon = eventIcon(basis);
  const figure = icon
    ? (preview
      ? `<figure class="studio-image studio-event-pictogram"><img src="${escapeHtml(eventIconPreviewUrl(icon))}" alt=""></figure>`
      : `\n\n[hl_studio_event_icon name="${icon}"]\n\n`)
    : image?.url ? `<figure class="studio-image"><img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.alt || title)}">${image.credit ? `<figcaption>${escapeHtml(image.credit)}</figcaption>` : ''}</figure>` : '';
  const body = paragraph(basis.sourceText);
  const sources = paragraph(basis.sources);
  const signup = mode === 'site' ? (preview ? registrationPreview : '\n\n[hl_event_registration]\n\n') : '';
  const button = mode === 'site' ? `<a class="studio-event-button" href="#inscription">S’inscrire</a>` :
    external ? `<a class="studio-event-button" href="${escapeHtml(external)}">S’inscrire sur le site partenaire</a>` : '';
  return `<article class="studio-event-page ${marker}${icon ? ' studio-event-icon-' + icon : ''}">
  <header class="event-hero studio-event-hero">
    <div class="studio-event-heading">
      <p class="studio-event-kicker">Événement</p>
      <h1>${escapeHtml(title)}</h1>
      <time datetime="${datetime}">${escapeHtml(details.startDate)} · ${escapeHtml(details.startTime)}</time>
      <p>${escapeHtml(details.venue)}</p>
      ${button}
    </div>
    ${figure}
  </header>
  <div class="studio-event-content">
    ${body ? `<section class="event-story-copy" aria-label="Présentation">${body}</section>` : ''}
    <section class="event-practical"><h2>Informations pratiques</h2><dl>${practical}</dl></section>
    ${signup}
    ${sources ? `<section class="studio-event-sources"><h2>Sources</h2>${sources}</section>` : ''}
  </div>
</article>`;
}
