import {validateCompositionInput} from '../public/private-studio/composition-v2.mjs';
function validPayload(body) {
  if (![1, 2].includes(body?.schema) || !Array.isArray(body.photos) || body.photos.length > 8) return false;
  if (body.schema === 2) {
    try { validateCompositionInput(body.entreeComposition); } catch { return false; }
    if (body.entreeComposition.textes.reduce((length, block) => length + block.texte.length + block.separateur.length, 0) > 100_000) return false;
  } else {
    if (!body.dossier || typeof body.dossier !== 'object' || String(body.dossier.sourceText || '').length > 100_000) return false;
    const hasEvent = body.dossier.contentType === 'evenement' && (String(body.dossier.title || '').trim() || Object.values(body.dossier.event || {}).some((value) => Array.isArray(value) ? value.some(Boolean) : typeof value === 'string' && value.trim()));
    if (!String(body.dossier.sourceText || '').trim() && body.photos.length === 0 && !hasEvent) return false;
  }
  if (body.contactSheetDataUrl != null && (typeof body.contactSheetDataUrl !== 'string' || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(body.contactSheetDataUrl) || body.contactSheetDataUrl.length > 2_000_000)) return false;
  const ids = new Set();
  for (const photo of body.photos) {
    if (!photo || typeof photo.id !== 'string' || typeof photo.name !== 'string' || typeof photo.previewDataUrl !== 'string') return false;
    if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(photo.previewDataUrl) || photo.previewDataUrl.length > 2_000_000) return false;
    if (ids.has(photo.id)) return false;
    ids.add(photo.id);
  }
  if (body.schema === 2 && body.entreeComposition.medias.some((media) => media.apercu_joint && !ids.has(media.id))) return false;
  return true;
}

function findDraft(value, depth = 0) {
  if (depth > 7 || value == null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try { return findDraft(JSON.parse(trimmed), depth + 1); } catch { return null; }
  }
  if (typeof value !== 'object') return null;
  if (value.composition?.contrat === 'hl.composition.2' && value.compositionResponse?.contrat === 'hl.composition.2') {
    return Object.fromEntries(['title', 'summary', 'cards', 'caption', 'contentType', 'slides', 'event', 'checks', 'composition', 'compositionResponse'].filter((key) => value[key] !== undefined).map((key) => [key, value[key]]));
  }
  if (typeof value.title === 'string' && typeof value.summary === 'string' && typeof value.caption === 'string') {
    const cards = Array.isArray(value.cards) ? value.cards.join('\n') : value.cards;
    if (typeof cards === 'string' && value.title.trim() && value.summary.trim() && cards.trim()) {
      const draft = { title: value.title.trim(), summary: value.summary.trim(), cards: cards.trim(), caption: value.caption.trim() };
      for (const key of ['contentType', 'slides', 'event', 'checks', 'composition', 'compositionResponse']) if (value[key] !== undefined) draft[key] = value[key];
      return draft;
    }
  }
  for (const child of Object.values(value)) {
    const draft = findDraft(child, depth + 1);
    if (draft) return draft;
  }
  return null;
}


export {validPayload,findDraft};
