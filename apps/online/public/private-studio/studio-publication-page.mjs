import {eventDateTime} from './studio-event-page.mjs';
import {compositionToLegacy, ensureComposition, GABARITS, MEDIA_COUNTS} from './composition-v2.mjs';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const paragraph = value => String(value ?? '').split(/\n\s*\n/).map(part => part.trim()).filter(Boolean).map(part => `<p>${escapeHtml(part).replace(/\n/g, '<br>')}</p>`).join('\n');
export const STORY_PUBLICATION_FORMAT = 'story-carousel-v2';

function storyImage(item, placement = {}) {
  const fit = placement.fit === 'cover' ? ' studio-image-cover' : '';
  const size = placement.taille === 'reduite' ? ' studio-image-small' : '';
  return `<figure class="new-slide-media${fit}${size}"><img src="${escapeHtml(item.url)}" alt="${escapeHtml(placement.alt || item.alt)}">${item.credit ? `<figcaption>${escapeHtml(item.credit)}</figcaption>` : ''}</figure>`;
}

function storySlides(proposal, uploadedMedia) {
  const {basis, output} = proposal;
  const composition = ensureComposition(output, basis);
  if (composition.cartes.length) return compositionToLegacy(composition).slides;
  // A source-only dossier predates the card editor.
  return [
    {gabarit: 'couverture', title: output.title},
    {gabarit: 'texte', body: basis.sourceText, legacyImages: uploadedMedia},
  ];
}

export function storyCoverMedia(proposal, uploadedMedia) {
  const cover = storySlides(proposal, uploadedMedia)[0];
  if (!cover) return undefined;
  const imageId = cover.mediaPlacements?.[0]?.media_id;
  if (imageId) return uploadedMedia.find(item => item.mediaId === imageId);
  if (!proposal.output.composition && !proposal.output.slides?.length) return uploadedMedia[0];
  return undefined;
}

export function renderStoryPreview(proposal, media) {
  return renderStoryPublication(proposal, media, '', true);
}

function renderStoryCard(slide, index, total, mediaById) {
  const layout = GABARITS.includes(slide.gabarit) ? slide.gabarit : 'texte';
  const cover = layout === 'couverture';
  const images = slide.legacyImages?.map(item => storyImage(item)) ?? (slide.mediaPlacements || [])
    .slice(0, MEDIA_COUNTS[layout][1])
    .flatMap(placement => {
      const image = mediaById.get(placement.media_id);
      return image ? [storyImage(image, placement)] : [];
    });
  const background = slide.background || (index % 2 ? 'sand' : 'sage');
  const relief = !cover && ['filet', 'intertitre'].includes(slide.relief) ? slide.relief : '';
  const classes = [
    'new-story-slide', cover && 'new-story-cover', !images.length && 'new-slide-text-only',
    `studio-card-${layout}`, background === 'sand' ? 'studio-card-sand' : 'studio-card-sage',
    images.length > 0 && 'studio-card-with-media', relief && `studio-card-${relief}`,
  ].filter(Boolean).join(' ');
  let heading = slide.title;
  let body = String(slide.body || '');
  if (relief === 'intertitre' && !heading) {
    const firstLine = body.match(/^([^\r\n]{1,82})\r?\n+/);
    if (firstLine && !/[.!?]$/.test(firstLine[1].trim())) {
      heading = firstLine[1];
      body = body.slice(firstLine[0].length);
    }
  }
  const title = heading ? `<h2>${escapeHtml(heading)}</h2>` : '';
  const copy = title || body ? `<div class="${cover ? 'new-cover-content' : 'new-slide-copy'}">${title}${paragraph(body)}</div>` : '';
  const gallery = images.length ? `<div class="new-slide-media-group">${images.join('')}</div>` : '';
  const number = `${index + 1} / ${total}`;
  return `<article class="${classes}" data-slide aria-label="Carte ${index + 1} sur ${total}"><div class="new-slide-top"><span>Héritage Libanais</span><span>${number}</span></div>${copy}${gallery}<div class="new-slide-foot"><span>Récit</span><span aria-hidden="true">•</span></div></article>`;
}

export function renderStoryTemplate(layout) {
  const image = {url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 240 160'%3E%3Crect width='240' height='160' fill='%23e9e8df'/%3E%3Cpath d='M30 130l60-65 41 44 32-32 48 53z' fill='%23b1c5b7'/%3E%3Ccircle cx='163' cy='47' r='14' fill='%23b82f2b'/%3E%3C/svg%3E", alt: ''};
  const count = MEDIA_COUNTS[layout][1];
  const mediaPlacements = Array.from({length: count}, () => ({media_id: 'sample'}));
  const slide = {gabarit: layout, title: layout === 'couverture' ? 'Titre du récit' : 'Texte de la carte', mediaPlacements};
  if (layout !== 'couverture') slide.body = 'Le texte et les images prennent place dans les zones prévues par ce gabarit.';
  return storyCarousel(renderStoryCard(slide, 0, 1, new Map([['sample', image]])), 1);
}

function storyCarousel(cards, count, heading = '', sources = '') {
  // User-authored text is literal on WordPress, including shortcode syntax.
  const content = `<div class="hl-wp-story">${heading}<section class="container editorial-carousel new-editorial-carousel studio-story-carousel" aria-label="Cartes du récit"><div class="editorial-track" data-carousel-track role="region" tabindex="0" aria-label="${count} cartes">${cards}</div>${sources}</section></div>`;
  return content.replaceAll('[', '&#91;').replaceAll(']', '&#93;');
}

function renderStoryPublication(proposal, uploadedMedia, sources, preview = false) {
  const slides = storySlides(proposal, uploadedMedia);
  const mediaById = new Map(uploadedMedia.map(item => [item.mediaId, item]));
  const cards = slides.map((slide, index) => renderStoryCard(slide, index, slides.length, mediaById)).join('');

  const heading = !preview
    ? `<header class="container publication-detail-heading"><h1 class="section-title">${escapeHtml(proposal.output.title)}</h1></header>`
    : '';
  return storyCarousel(cards, slides.length, heading, sources);
}

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
export function renderPublicationContent(proposal, uploadedMedia = []) {
  const { basis, output } = proposal;
  const event = output.contentType === 'evenement' || basis.contentType === 'evenement';
  if (!event) {
    const sources = basis.sources?.trim() ? `<section class="carousel-source-notes"><h2>Sources</h2><div class="source-note-text">${paragraph(basis.sources)}</div></section>` : '';
    return renderStoryPublication(proposal, uploadedMedia, sources);
  }
  const details = output.event || basis.event || {};
  const body = approvedBody(proposal);
  const figures = uploadedMedia.map(item => `<figure class="studio-image"><img src="${escapeHtml(item.url)}" alt="${escapeHtml(item.alt)}">${item.credit ? `<figcaption>${escapeHtml(item.credit)}</figcaption>` : ''}</figure>`).join('\n');
  const eventSources = basis.sources?.trim() ? `<section class="studio-sources"><h2>Sources</h2>${paragraph(basis.sources)}</section>` : '';
  const eventDate = `${details.startDate || ''} ${details.startTime || ''}`.trim();
  const time = `<time datetime="${eventDateTime(details)}">${escapeHtml(eventDate)}</time>`;
  const practical = [details.venue, details.address, details.city, details.registrationUrl].filter(Boolean).map(value => `<p>${escapeHtml(value)}</p>`).join('');
  const registrationClass = details.registrationUrl?.trim() ? '' : ' studio-native-registration';
  return `<article class="event-hero studio-publication${registrationClass}">${time}<div class="event-story-copy">${body}</div>${figures}<section class="event-practical"><h2>Informations pratiques</h2>${practical}</section>${eventSources}</article>`;
}
