import {eventDateTime} from './studio-event-page.mjs';
import {compositionToLegacy, ensureComposition, GABARITS, MEDIA_COUNTS} from './composition-v2.mjs';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const paragraph = value => String(value ?? '').split(/\n\s*\n/).map(part => part.trim()).filter(Boolean).map(part => `<p>${escapeHtml(part).replace(/\n/g, '<br>')}</p>`).join('\n');
export const STORY_PUBLICATION_FORMAT = 'story-carousel-v1';

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

function renderStoryPublication(proposal, uploadedMedia, sources) {
  const slides = storySlides(proposal, uploadedMedia);
  const mediaById = new Map(uploadedMedia.map(item => [item.mediaId, item]));
  const cards = slides.map((slide, index) => {
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
    const number = `${index + 1} / ${slides.length}`;
    return `<article class="${classes}" data-slide aria-label="Carte ${index + 1} sur ${slides.length}"><div class="new-slide-top"><span>Héritage Libanais</span><span>${number}</span></div>${layout === 'image_haut' ? gallery + copy : copy + gallery}<div class="new-slide-foot"><span>Récit</span><span aria-hidden="true">•</span></div></article>`;
  });
  const content = `<div class="hl-wp-story"><header class="container publication-detail-heading"><h1 class="section-title">${escapeHtml(proposal.output.title)}</h1></header><section class="container editorial-carousel new-editorial-carousel studio-story-carousel" aria-label="Cartes du récit"><div class="editorial-track" data-carousel-track role="region" tabindex="0" aria-label="${slides.length} cartes">${cards.join('')}</div>${sources}</section></div>`;
  // User-authored text is literal on WordPress, including shortcode syntax.
  return content.replaceAll('[', '&#91;').replaceAll(']', '&#93;');
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
