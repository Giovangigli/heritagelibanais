import {eventDateTime, renderEventPage} from './studio-event-page.mjs';

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
export function renderPublicationContent(proposal, uploadedMedia = []) {
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

export function renderPublicationPreview(proposal, media) {
  if (proposal.output.siteEvent) return renderEventPage(proposal, media[0], {preview:true});
  return '<header class="container publication-detail-heading"><h1 class="section-title">'
    + escapeHtml(proposal.output.title) + '</h1></header>' + renderPublicationContent(proposal, media);
}
