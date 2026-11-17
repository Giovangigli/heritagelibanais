/** Canonical, lossless composition state shared by the Studio and its workflow. */
export const CONTRAT = 'hl.composition.2';
export const STORY_EDITORIAL_REQUEST_ID = 'studio-recit-editorial-v1';
export const STORY_EDITORIAL_INSTRUCTION = 'Adapte le corps de ce récit au présent de narration. Écris de façon directe, avec des phrases claires. Varie le rythme aux moments importants avec des verbes précis et des transitions naturelles. Supprime les répétitions, les formules creuses et les détails superficiels qui ne servent pas le sujet. Préserve les faits essentiels, les noms, les dates utiles, les liens de cause et les réserves historiques ; ne transforme aucune hypothèse en certitude et n’invente aucun fait. Conserve le titre fourni. Compose au maximum 10 cartes, couverture comprise : regroupe les phrases par unités de sens et choisis pour chacune les images qui éclairent précisément son contenu. Une carte peut réunir plusieurs phrases et plusieurs blocs ; le nombre de cartes dépend du récit, pas du nombre de phrases. Justifie chaque association dans lien. Les consignes particulières de départ peuvent préciser le ton ou demander une conservation littérale ; dans ce cas, respecte cette exception et signale ce qui a été conservé.';
export const STORY_GABARITS = Object.freeze(['couverture', 'colonnes', 'image_haut', 'comparaison', 'images_superposees', 'assemblage', 'texte']);
export const GABARITS = Object.freeze([...STORY_GABARITS, 'document_detail', 'affiche', 'fiche']);
export const CARD_BACKGROUNDS = Object.freeze(['sage', 'sand']);
export const TEXT_RELIEFS = Object.freeze(['simple', 'filet', 'intertitre']);
export const MOTIFS = Object.freeze(['aucun', 'sceau', 'cedre', 'montagnes', 'colonnes']);
export const CHAMPS = Object.freeze(['titre_affiche', 'date_debut', 'date_fin', 'heure_debut', 'heure_fin', 'fuseau', 'lieu', 'adresse', 'ville', 'intervenants', 'inscription', 'lien_inscription', 'tarif', 'contact']);
const ROLES = ['archive', 'portrait', 'carte', 'symbole', 'lieu', 'oeuvre', 'detail', 'contexte'];
const STATUTS = ['proposition', 'sans_changement', 'a_preciser', 'impossible'];
const RETOURS = ['appliquee', 'deja_satisfaite', 'a_preciser', 'impossible', 'contradictoire', 'en_attente'];
const ALERTES = ['media_manquant', 'variante', 'credit', 'source', 'orthographe', 'champ_manquant', 'conflit', 'lisibilite', 'dossier'];
const EVENT_KEYS = { titre_affiche: 'posterTitle', date_debut: 'startDate', date_fin: 'endDate', heure_debut: 'startTime', heure_fin: 'endTime', fuseau: 'timezone', lieu: 'venue', adresse: 'address', ville: 'city', intervenants: 'speakers', inscription: 'registration', lien_inscription: 'registrationUrl', tarif: 'price', contact: 'contact' };
const LAYOUTS = { couverture: 'cover', texte: 'text', colonnes: 'split', image_haut: 'image-top', comparaison: 'pair', images_superposees: 'stacked-pair', document_detail: 'pair', assemblage: 'equation', affiche: 'poster', fiche: 'text' };
const OLD_GABARITS = { cover: 'couverture', text: 'texte', split: 'colonnes', 'image-top': 'image_haut', pair: 'comparaison', 'stacked-pair': 'images_superposees', equation: 'assemblage', poster: 'affiche' };
const OLD_MOTIFS = { none: 'aucun', cedar: 'cedre', mountains: 'montagnes', columns: 'colonnes', seal: 'sceau' };
export const MEDIA_COUNTS = { couverture: [0, 1], texte: [0, 0], colonnes: [1, 1], image_haut: [1, 1], comparaison: [2, 2], images_superposees: [2, 2], document_detail: [2, 2], assemblage: [2, 3], affiche: [0, 1], fiche: [0, 1] };
// Ratios of the individual image slots in the fixed Studio artboards.
const SLOT_RATIOS = { colonnes: 462 / 390, image_haut: 462 / 700, comparaison: 220 / 420, images_superposees: 462 / 390 };
export function imageAspectRatio(image) {
  const { width, height } = image ?? {};
  return Number.isSafeInteger(width) && width > 0 && Number.isSafeInteger(height) && height > 0 ? width / height : null;
}
export function suggestImageLayout(images) {
  const layouts = images.length === 1 ? ['colonnes', 'image_haut'] : images.length === 2 ? ['comparaison', 'images_superposees'] : [];
  if (!layouts.length) return null;
  const ratios = images.map(imageAspectRatio);
  if (ratios.some(ratio => ratio === null)) return layouts[0];
  const fill = layout => ratios.reduce((total, ratio) => total + Math.min(ratio / SLOT_RATIOS[layout], SLOT_RATIOS[layout] / ratio), 0);
  return fill(layouts[1]) > fill(layouts[0]) ? layouts[1] : layouts[0];
}
function validateImagePlacements(cards, previousCards, equivalentMedias) {
  const counts = (list) => {
    const result = new Map();
    for (const card of list) for (const { media_id } of card.medias) {
      const key = equivalentMedias?.get(media_id) ?? media_id;
      result.set(key, (result.get(key) ?? 0) + 1);
    }
    return result;
  };
  const previous = counts(previousCards);
  for (const [id, count] of counts(cards)) {
    assert(count <= Math.max(1, previous.get(id) ?? 0), 'Une image doit figurer une seule fois dans la proposition, couverture comprise : ' + id + '.');
  }
}
const copy = (value) => JSON.parse(JSON.stringify(value));
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const uid = (prefix) => prefix + '-' + (globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + '-' + Math.random().toString(36).slice(2));
const fail = (message) => { throw new Error('Composition : ' + message); };
const assert = (condition, message) => { if (!condition) fail(message); };
const str = (v, label, nullable = false) => assert(typeof v === 'string' || (nullable && v === null), label + ' doit être une chaîne' + (nullable ? ' ou null.' : '.'));
const list = (v, label) => assert(Array.isArray(v), label + ' doit être un tableau.');
const enumeration = (v, values, label) => assert(values.includes(v), label + ' invalide : ' + String(v));
const keys = (v, expected, label) => {
  assert(v && typeof v === 'object' && !Array.isArray(v), label + ' doit être un objet.');
  assert(Object.keys(v).length === expected.length && expected.every((k) => own(v, k)), label + ' contient des propriétés manquantes ou inconnues.');
};
const strings = (v, label) => { list(v, label); v.forEach((x) => str(x, label)); };
const unique = (values, label) => assert(new Set(values).size === values.length, label + ' contient un doublon.');
const lookup = (values, id, label = 'identifiant') => { const value = values.find((item) => item.id === id); assert(value, label + ' inconnu : ' + id); return value; };
const activeRequests = (input) => input.mode === 'revision' ? input.demandes_revision : input.consignes_initiales;

function validateBlock(block) {
  keys(block, ['id', 'role', 'texte', 'separateur'], 'Bloc');
  str(block.id, 'ID du bloc'); assert(block.id.length > 0, 'ID de bloc vide.');
  enumeration(block.role, ['titre', 'corps'], 'Rôle du bloc'); str(block.texte, 'Texte'); str(block.separateur, 'Séparateur');
}
function validatePlacement(placement) {
  keys(placement, ['media_id', 'role', 'fit', 'taille', 'alt', 'lien'], 'Placement');
  str(placement.media_id, 'ID du média'); enumeration(placement.role, ROLES, 'Rôle du média');
  enumeration(placement.fit, ['contain', 'cover'], 'Cadrage'); enumeration(placement.taille, ['normale', 'reduite'], 'Taille');
  str(placement.alt, 'Alternative'); str(placement.lien, 'Lien éditorial');
}
function validateCard(card) {
  const fields = ['id', 'gabarit', 'motif', 'blocs', 'medias', 'champs'];
  if (card && own(card, 'fond')) {
    fields.push('fond');
    enumeration(card.fond, CARD_BACKGROUNDS, 'Fond de carte');
  }
  if (card && own(card, 'relief')) {
    fields.push('relief');
    enumeration(card.relief, TEXT_RELIEFS, 'Relief du texte');
  }
  keys(card, fields, 'Carte');
  str(card.id, 'ID de carte'); assert(card.id.length > 0, 'ID de carte vide.');
  enumeration(card.gabarit, GABARITS, 'Gabarit'); enumeration(card.motif, MOTIFS, 'Motif');
  strings(card.blocs, 'Références de blocs'); list(card.medias, 'Placements'); card.medias.forEach(validatePlacement);
  list(card.champs, 'Champs affichés'); card.champs.forEach((key) => enumeration(key, CHAMPS, 'Champ'));
}
function validateProof(proof) {
  keys(proof, ['type', 'ref', 'extrait'], 'Preuve'); enumeration(proof.type, ['saisie', 'texte', 'media', 'consigne'], 'Origine de preuve');
  str(proof.ref, 'Référence de preuve'); str(proof.extrait, 'Extrait de preuve');
}
function validateFact(fact) {
  keys(fact, ['cle', 'valeur', 'preuve'], 'Information pratique'); enumeration(fact.cle, CHAMPS, 'Clé pratique');
  str(fact.valeur, 'Valeur pratique'); validateProof(fact.preuve);
}
function validateMedia(media) {
  keys(media, ['id', 'nom', 'admis', 'apercu_joint', 'legende', 'source', 'credit', 'droits', 'lie_a'], 'Média');
  str(media.id, 'ID de média'); assert(media.id.length > 0, 'ID de média vide.'); str(media.nom, 'Nom de média');
  assert(typeof media.admis === 'boolean' && typeof media.apercu_joint === 'boolean', 'Disponibilité du média invalide.');
  for (const k of ['legende', 'source', 'credit', 'droits']) str(media[k], k, true);
  strings(media.lie_a, 'Relations de média');
}
function validateRequest(request) {
  keys(request, ['id', 'texte', 'portee'], 'Consigne'); str(request.id, 'ID de consigne'); assert(request.id.length > 0, 'ID de consigne vide.');
  str(request.texte, 'Consigne'); strings(request.portee, 'Portée');
  request.portee.forEach((scope) => assert(/^(?:composition|cartes\/(?:ajout|ordre)|carte:[^/]+\/(?:medias|gabarit|motif|blocs|champs|relief|retrait)|texte:(?:[^/]+)|texte\/ordre|champ:[^/]+)$/.test(scope), 'Portée inconnue : ' + scope));
}

export function validateCompositionInput(input) {
  keys(input, ['contrat', 'requete_id', 'base_version', 'mode', 'type', 'textes', 'medias', 'pratique', 'etat', 'consignes_initiales', 'demandes_revision', 'gabarits', 'max_cartes'], 'Entrée');
  assert(input.contrat === CONTRAT, 'Contrat inconnu.'); str(input.requete_id, 'Requête'); str(input.base_version, 'Version');
  assert(input.requete_id.length && input.base_version.length, 'Requête ou version vide.');
  enumeration(input.mode, ['creation', 'revision'], 'Mode'); enumeration(input.type, ['recit', 'evenement'], 'Type');
  list(input.textes, 'Blocs'); input.textes.forEach(validateBlock); unique(input.textes.map((x) => x.id), 'IDs de blocs');
  list(input.medias, 'Médias'); input.medias.forEach(validateMedia); unique(input.medias.map((x) => x.id), 'IDs de médias');
  list(input.pratique, 'Champs pratiques'); input.pratique.forEach(validateFact); unique(input.pratique.map((x) => x.cle), 'Clés pratiques');
  for (const field of ['consignes_initiales', 'demandes_revision']) { list(input[field], field); input[field].forEach(validateRequest); unique(input[field].map((x) => x.id), 'IDs de consignes'); }
  assert((input.mode === 'creation' ? input.demandes_revision : input.consignes_initiales).length === 0, 'Des consignes inactives ont été renvoyées.');
  list(input.gabarits, 'Gabarits'); input.gabarits.forEach((g) => enumeration(g, GABARITS, 'Gabarit')); unique(input.gabarits, 'Gabarits');
  assert(input.max_cartes === null || (Number.isInteger(input.max_cartes) && input.max_cartes > 0), 'Limite de cartes invalide.');
  if (input.mode === 'creation') assert(input.etat === null, 'Une création ne reçoit pas de cartes actuelles.');
  else { keys(input.etat, ['cartes'], 'État actuel'); list(input.etat.cartes, 'Cartes actuelles'); input.etat.cartes.forEach(validateCard); unique(input.etat.cartes.map((x) => x.id), 'IDs de cartes'); }
  for (const media of input.medias) media.lie_a.forEach((id) => lookup(input.medias, id, 'Média lié'));
  return true;
}

export function storyCreationIssue(input) {
  if (input.mode !== 'creation' || input.type !== 'recit') return null;
  if (!input.textes.some(block => block.role === 'titre' && block.texte.trim())) {
    return 'Indiquez le titre de couverture dans « Titre du récit » ou commencez votre texte par « Titre : … ».';
  }
  if (!input.textes.some(block => block.role === 'corps' && block.texte.trim())) {
    return 'Ajoutez le texte du récit avant de lancer la composition.';
  }
  return null;
}

const OP_KEYS = {
  fixer_medias: ['carte_id', 'medias'], fixer_gabarit: ['carte_id', 'gabarit'], fixer_motif: ['carte_id', 'motif'],
  fixer_relief: ['carte_id', 'relief'],
  fixer_blocs: ['carte_id', 'blocs'], fixer_champs: ['carte_id', 'champs'], ajouter_carte: ['apres_carte_id', 'carte'],
  retirer_carte: ['carte_id'], ordonner_cartes: ['ordre'], editer_texte: ['bloc_id', 'avant', 'apres'],
  inserer_texte: ['apres_bloc_id', 'separateur_avant', 'bloc'], renseigner_champ: ['cle', 'avant', 'apres', 'preuve'],
};
function validateOperation(op) {
  assert(op && own(OP_KEYS, op.action), 'Opération inconnue.'); keys(op, ['action', 'consigne_id', ...OP_KEYS[op.action]], 'Opération ' + op.action);
  str(op.consigne_id, 'Consigne de l’opération', op.action === 'renseigner_champ');
  if (own(op, 'carte_id')) str(op.carte_id, 'Carte ciblée');
  switch (op.action) {
    case 'fixer_medias': list(op.medias, 'Médias'); op.medias.forEach(validatePlacement); break;
    case 'fixer_gabarit': enumeration(op.gabarit, GABARITS, 'Gabarit'); break;
    case 'fixer_motif': enumeration(op.motif, MOTIFS, 'Motif'); break;
    case 'fixer_relief': enumeration(op.relief, TEXT_RELIEFS, 'Relief du texte'); break;
    case 'fixer_blocs': strings(op.blocs, 'Blocs'); break;
    case 'fixer_champs': list(op.champs, 'Champs'); op.champs.forEach((k) => enumeration(k, CHAMPS, 'Champ')); break;
    case 'ajouter_carte': str(op.apres_carte_id, 'Ancre de carte', true); validateCard(op.carte); break;
    case 'ordonner_cartes': strings(op.ordre, 'Ordre des cartes'); break;
    case 'editer_texte': str(op.bloc_id, 'Bloc ciblé'); str(op.avant, 'Texte avant'); str(op.apres, 'Texte après', true); break;
    case 'inserer_texte': str(op.apres_bloc_id, 'Ancre de bloc', true); str(op.separateur_avant, 'Séparateur avant'); validateBlock(op.bloc); break;
    case 'renseigner_champ': enumeration(op.cle, CHAMPS, 'Champ'); str(op.avant, 'Valeur avant', true); str(op.apres, 'Valeur après', true); validateProof(op.preuve); break;
  }
}
export function validateCompositionResponse(response) {
  keys(response, ['contrat', 'requete_id', 'base_version', 'mode', 'type', 'statut', 'cartes', 'operations', 'retours', 'alertes'], 'Réponse');
  assert(response.contrat === CONTRAT, 'Contrat de réponse inconnu.'); str(response.requete_id, 'Requête'); str(response.base_version, 'Version');
  enumeration(response.mode, ['creation', 'revision'], 'Mode'); enumeration(response.type, ['recit', 'evenement'], 'Type'); enumeration(response.statut, STATUTS, 'Statut');
  list(response.cartes, 'Cartes'); response.cartes.forEach(validateCard); list(response.operations, 'Opérations'); response.operations.forEach(validateOperation);
  list(response.retours, 'Retours'); response.retours.forEach((r) => { keys(r, ['consigne_id', 'etat', 'cibles', 'message'], 'Retour'); str(r.consigne_id, 'Consigne'); enumeration(r.etat, RETOURS, 'État du retour'); strings(r.cibles, 'Cibles'); str(r.message, 'Message'); });
  list(response.alertes, 'Alertes'); response.alertes.forEach((a) => { keys(a, ['code', 'cible', 'message'], 'Alerte'); enumeration(a.code, ALERTES, 'Code d’alerte'); str(a.cible, 'Cible'); str(a.message, 'Message'); });
  return true;
}

/** Split at reversible paragraph boundaries and useful sentence endings. No trim or Unicode normalisation. */
export function splitCompositionText(value, { role = 'corps', prefix = 'b', sentenceLength = 260 } = {}) {
  const source = String(value ?? '');
  if (!source.length) return [];
  const chunks = [];
  let cursor = 0;
  const boundary = /(?:\r\n|\n|\r)[\t \u00a0]*(?:(?:\r\n|\n|\r)[\t \u00a0]*)*/g;
  for (const match of source.matchAll(boundary)) {
    chunks.push({ texte: source.slice(cursor, match.index), separateur: match[0] }); cursor = match.index + match[0].length;
  }
  if (cursor < source.length || !chunks.length) chunks.push({ texte: source.slice(cursor), separateur: '' });
  const result = [];
  for (const chunk of chunks) {
    if (chunk.texte.length < sentenceLength) { result.push(chunk); continue; }
    let start = 0;
    const sentences = /[.!?…][»”"')\]]*([\t \u00a0]+)(?=\S)/g;
    for (const match of chunk.texte.matchAll(sentences)) {
      const cut = match.index + match[0].length - match[1].length;
      result.push({ texte: chunk.texte.slice(start, cut), separateur: match[1] }); start = match.index + match[0].length;
    }
    const tail = chunk.texte.slice(start);
    if (tail.length || !result.length) result.push({ texte: tail, separateur: chunk.separateur });
    else result[result.length - 1].separateur += chunk.separateur;
  }
  return result.map((part, index) => ({ id: prefix + String(index + 1).padStart(3, '0'), role, ...part }));
}

function initialBlocks(dossier) {
  if (Array.isArray(dossier.textes)) { dossier.textes.forEach(validateBlock); return copy(dossier.textes); }
  let source = String(dossier.sourceText ?? '');
  let title = String(dossier.title ?? '');
  // A field label identifies a supplied title; it is not part of the publication text.
  const titleLine = source.match(/^([\t ]*Titre(?: proposé)?[\t ]*[:：][\t ]*)([^\r\n]*)(\r\n|\n|\r|$)/i);
  let titleSeparator = '\n\n';
  if (titleLine) {
    title = titleLine[2]; source = source.slice(titleLine[0].length); titleSeparator = titleLine[3];
    const leading = source.match(/^(?:[\t \u00a0]*(?:\r\n|\n|\r))+/)?.[0] || '';
    titleSeparator += leading; source = source.slice(leading.length);
  } else {
    const opening = source.match(/^([^\r\n]+)((?:\r\n|\n|\r(?!\n))(?:(?:[\t \u00a0]*(?:\r\n|\n|\r(?!\n)))+|(?=[\t \u00a0]*image(?: de)? couverture[\t \u00a0]*[:：])))/i);
    if (opening && source.slice(opening[0].length).trim().length) {
      const candidate = opening[1].trim();
      const nominalHeading = candidate.length <= 160 && candidate.split(/\s+/).length <= 22
        && /^\p{Lu}/u.test(candidate) && !/[.!?…:;,][»”"')\]]*$/.test(candidate)
        && !/^(?:Je|Nous|Vous|Il|Ils|Elle|Elles|On|Ce|Cela|Ceci)\b/u.test(candidate)
        && !/(?<!\p{L})(?:est|sont|était|étaient|sera|seront|reste|restent|avait|avaient|possède|possèdent|montre|montrent|raconte|racontent|présente|présentent)(?!\p{L})/iu.test(candidate);
      const mayInfer = dossier.contentType !== 'evenement' && dossier.theme !== 'Événement';
      if (title === opening[1] || (!title.length && mayInfer && nominalHeading)) {
        title = opening[1]; titleSeparator = opening[2]; source = source.slice(opening[0].length);
      }
    }
  }
  const blocks = splitCompositionText(source);
  if (title.length) blocks.unshift({ id: 't001', role: 'titre', texte: title, separateur: blocks.length ? titleSeparator : '' });
  return blocks;
}

function catalogue(dossier, photos = [], existing = []) {
  // Preview availability describes this request, not a previous successful request.
  const records = new Map(existing.map((m) => [m.id, { ...copy(m), apercu_joint: false }]));
  for (const item of [...(dossier.media || []), ...photos]) {
    if (!item?.id) continue;
    const before = records.get(item.id);
    const hasPreview = Boolean(item.previewDataUrl || item.apercu_joint === true || photos.some((p) => p.id === item.id && (p.previewDataUrl || p.apercu_joint)));
    records.set(item.id, {
      id: item.id, nom: String(item.nom ?? item.name ?? before?.nom ?? item.id),
      admis: typeof item.admis === 'boolean' ? item.admis : item.selected === false ? false : before?.admis ?? dossier.mediaMode !== 'none',
      apercu_joint: hasPreview || Boolean(before?.apercu_joint),
      legende: item.legende ?? item.legend ?? item.description ?? before?.legende ?? null,
      source: item.source ?? before?.source ?? null, credit: item.credit || before?.credit || null,
      droits: item.droits ?? item.rights ?? before?.droits ?? null,
      lie_a: copy(item.lie_a ?? item.relatedIds ?? before?.lie_a ?? []),
    });
  }
  return [...records.values()];
}

function practicalFromDossier(dossier) {
  if (Array.isArray(dossier.pratique)) return copy(dossier.pratique);
  const event = dossier.event || {};
  return CHAMPS.flatMap((cle) => {
    let value = event[cle] ?? event[EVENT_KEYS[cle]];
    if (Array.isArray(value)) value = value.join('\n');
    if (value === undefined || value === null || value === '') return [];
    return [{ cle, valeur: String(value), preuve: { type: 'saisie', ref: 'event.' + EVENT_KEYS[cle], extrait: String(value) } }];
  });
}

/** Resolve a free request only when its target is unambiguous in the displayed version. */
export function resolveRevisionScope(comp, instruction, selection = null) {
  if (Array.isArray(selection)) return [...new Set(selection)];
  if (typeof selection === 'string' && selection) return [selection];
  const text = String(instruction || '');
  const lower = text.toLocaleLowerCase('fr');
  const cards = comp.cartes || [];
  if (/\b(?:recompose|recomposer|recomposition|réorganise|réorganiser)\b.*(?:ensemble|tout|général|récit|composition)|(?:toute|l’ensemble de) la composition/i.test(text)) return ['composition'];
  let targets = [];
  const selectedId = selection?.cardId ?? selection?.carte_id;
  if (selectedId) targets = cards.filter((c) => c.id === selectedId);
  if (!targets.length) {
    const numeric = [...lower.matchAll(/\b(?:carte|slide|c)\s*(?:n[°o]?\s*)?(\d+)\b/g)].map((m) => Number(m[1]) - 1);
    targets = [...new Set(numeric)].map((i) => cards[i]).filter(Boolean);
    if (numeric.length && targets.length !== new Set(numeric).size) return [];
  }
  if (!targets.length && /\bderni[eè]re(?:\s+carte)?\b/.test(lower) && cards.length) targets = [cards.at(-1)];
  if (!targets.length && /\b(?:premi[eè]re carte|couverture|affiche)\b/.test(lower)) targets = cards.filter((c) => c.gabarit === 'couverture' || c.gabarit === 'affiche');
  if (!targets.length) {
    const named = (comp.medias || []).filter((m) => [m.id, m.nom].some((name) => name?.length > 2 && lower.includes(name.toLocaleLowerCase('fr'))));
    if (named.length === 1) {
      const ids = new Set([named[0].id, ...named[0].lie_a]);
      targets = cards.filter((c) => c.medias.some((m) => ids.has(m.media_id)));
      if (targets.length !== 1) return [];
    }
  }
  const field = selection?.field;
  const textEdit = field === 'body' || field === 'title' || field === 'texte' || /\b(?:remplace|remplacer|corrige|corriger)\s+[«“"]/.test(lower) || /\b(?:corrige|corriger|orthographe|mot|mots|phrase|texte|titre|expression)\b/.test(lower) && /\b(?:corrige|corriger|remplace|remplacer|ajoute|ajouter|supprime|supprimer|retire|retirer|modifie|modifier|change|changer)\b/.test(lower);
  if (textEdit && targets.length === 1) {
    const roles = field === 'title' ? ['titre'] : field === 'body' ? ['corps'] : ['titre', 'corps'];
    const scope = targets[0].blocs.filter((id) => roles.includes(comp.textes.find((b) => b.id === id)?.role)).map((id) => 'texte:' + id);
    if (/\b(?:ajoute|ajouter|insère|insérer)\b/.test(lower)) scope.push('texte:+', 'carte:' + targets[0].id + '/blocs');
    return scope;
  }
  if (!targets.length && textEdit) {
    // Spaces inside French quotation marks delimit the request, not the canonical block.
    const quoted = [...text.matchAll(/[«“"]([^»”"]+)[»”"]/g)].map((m) => m[1].trim());
    const matching = (comp.textes || []).filter((b) => quoted.length && b.texte.includes(quoted[0]));
    if (matching.length === 1) return ['texte:' + matching[0].id];
  }
  if (!targets.length) {
    const fieldNames = { date: 'date_debut', horaire: 'heure_debut', heure: 'heure_debut', lieu: 'lieu', adresse: 'adresse', ville: 'ville', tarif: 'tarif', prix: 'tarif', contact: 'contact', inscription: 'inscription', intervenants: 'intervenants' };
    const found = Object.entries(fieldNames).filter(([name]) => new RegExp('\\b' + name + '\\b').test(lower));
    if (found.length === 1 && /\b(?:remplace|modifie|corrige|renseigne|supprime|ajoute)\b/.test(lower)) return ['champ:' + found[0][1]];
    return [];
  }
  if (/\b(?:retire|retirer|supprime|supprimer)\b/.test(lower) && !/\b(?:image|photo|média|media|visuel|motif|cercle|annotation|texte|phrase|mot)\b/.test(lower)) return targets.map((c) => 'carte:' + c.id + '/retrait');
  let property = ['medias', 'gabarit', 'motif', 'blocs', 'champs'].includes(field) ? field : null;
  if (!property && /\b(?:motif|cèdre|cedre|sceau|montagnes)\b/.test(lower)) property = 'motif';
  if (!property && /\b(?:image|images|photo|photos|média|médias|media|visuel|portrait|cadrage|cercle|annotation)\b/.test(lower)) property = 'medias';
  if (!property && /\b(?:gabarit|mise en page|colonnes|a[èé]re|disposition)\b/.test(lower)) property = 'gabarit';
  if (!property) return [];
  const result = targets.map((c) => 'carte:' + c.id + '/' + property);
  if (property === 'medias' && targets.some((c) => c.medias.length > 1) && /\b(?:seulement|seule|retire|supprime)\b/.test(lower) && !/garde.*(?:mise en page|emplacements)/.test(lower)) result.push(...targets.map((c) => 'carte:' + c.id + '/gabarit'));
  return result;
}

/** Infer a bounded edit from the request, using the displayed card when no other card is named. */
export function resolveFreeRevisionScope(comp, instruction, displayedId) {
  const fold = value => value.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/’/g, "'");
  const clauses = fold(instruction)
    .split(/\bsans (?:changer|modifier|retoucher|toucher|reecrire)\b/)[0]
    .split(/[,;\n]|\b(?:mais|puis|et)\b/)
    .map(part => part.trim())
    .filter(part => !/^(?:garde|garder|conserve|conserver|preserve|preserver)\b/.test(part) || /^(?:garde|garder|conserve|conserver) seulement\b/.test(part));
  const query = clauses.join(' ');
  const cards = comp.cartes || [];
  const numbers = [...query.matchAll(/\b(?:cartes?|slides?)\s*(?:n[°o]?\s*)?(\d+)\b/g)].map(match => Number(match[1]) - 1);
  const ordinals = ['premiere', 'deuxieme', 'troisieme', 'quatrieme', 'cinquieme', 'sixieme', 'septieme', 'huitieme', 'neuvieme', 'dixieme'];
  ordinals.forEach((word, index) => { if (query.includes(word + ' carte')) numbers.push(index); });
  if (/\b(?:derniere carte|derniere diapositive)\b/.test(query)) numbers.push(cards.length - 1);
  if (!numbers.length && /\b(?:couverture|affiche)\b/.test(query)) numbers.push(0);
  if (!numbers.length && comp.type === 'evenement' && /\bfiche\b/.test(query)) numbers.push(1);
  if (numbers.some(index => !cards[index])) return [];
  const all = /\b(?:tout|toutes?)\s+(?:le recit|le texte|le carrousel|les cartes|la composition)\b|\bl'ensemble\b|\b(?:les|ces)\s+(?:deux|trois|quatre|cinq|\d+)\s+(?:differentes?\s+)?sections\b/.test(query);
  const recompose = /\b(?:recompos\w*|reorganis\w*|reagenc\w*|reordonn\w*)\b/.test(query);
  const global = all || recompose && /\b(?:recit|carrousel|composition|les cartes)\b/.test(query);
  const explicit = resolveRevisionScope(comp, instruction);
  const targets = numbers.length ? [...new Set(numbers)].map(index => cards[index]) : global ? cards : cards.filter(card => explicit.some(scope => scope.startsWith('carte:' + card.id + '/')));
  if (!targets.length) targets.push(...cards.filter(card => card.id === displayedId));
  const textEdit = /\b(?:reecri\w*|reformul\w*|alleg\w*|racc?ourci\w*|enjoliv\w*|embelli\w*|fluidifi\w*|condens\w*|au present|orthographe|faute)\b/.test(query)
    || clauses.some(part => /\b(?:corrig\w*|modifi\w*|remplac\w*|chang\w*|ajout\w*|retir\w*|supprim\w*|enlev\w*|simplifi\w*|retravail\w*|enrichi\w*|clarifi\w*)\b.*\b(?:text[e]?|titre|phrase|mot|formulation|expression)\b/.test(part))
    || explicit.some(scope => scope.startsWith('texte:'));
  const relief = /\b(?:rouge|filet|relief|intertitres?|encadr\w*|surlign\w*|mettre en avant|met[st]? en avant|mettre en valeur)\b/.test(query);
  const media = /\b(?:images?|photos?|visuels?|medias?|portraits?|cadrage|recadr\w*|cercle|annotation)\b/.test(query);
  const layout = /\b(?:gabarit|mise en page|colonnes|disposition|superpos\w*|cote a cote|aer\w*|l'une sous l'autre|l'une en dessous de l'autre)\b/.test(query);
  const scope = explicit.filter(item => item.startsWith('champ:') || !numbers.length && !global && item.startsWith('texte:'));
  if (global && recompose) scope.push('composition');
  if (textEdit && !scope.some(item => item.startsWith('texte:'))) {
    const title = /\btitre\b/.test(query);
    for (const card of targets) for (const id of card.blocs) {
      const block = comp.textes.find(item => item.id === id);
      if (block && (title ? block.role === 'titre' : block.role === 'corps')) scope.push('texte:' + id);
    }
    if (!global && targets.length === 1 && /\b(?:ajout\w*|inser\w*)\b.*\b(?:phrase|texte)\b/.test(query)) scope.push('texte:+', 'carte:' + targets[0].id + '/blocs');
  }
  for (const card of targets) {
    const prefix = 'carte:' + card.id + '/';
    if (relief && comp.type === 'recit' && card.gabarit !== 'couverture') scope.push(prefix + 'relief');
    if (media || recompose && !global) scope.push(prefix + 'medias');
    if (layout || recompose && !global || media && /\b(?:retir\w*|supprim\w*|enlev\w*|ajout\w*|seulement|sans image)\b/.test(query)) scope.push(prefix + 'gabarit');
    if (!media && !textEdit && !relief && /\b(?:retir\w*|supprim\w*|enlev\w*)\b.*\bcarte\b/.test(query) && targets.length === 1 && cards.length > 2 && card.gabarit !== 'couverture') {
      const index = cards.indexOf(card);
      const neighbor = cards[index + 1] || cards[index - 1];
      scope.push(prefix + 'retrait', 'carte:' + neighbor.id + '/blocs');
    }
  }
  return [...new Set(scope)];
}

export function buildCompositionInput({ dossier = {}, photos = [], currentOutput = null, mode, instruction, scope, requestId, baseVersion, editorial = true } = {}) {
  const revision = mode === 'revise' || mode === 'revision' || (!mode && Boolean(currentOutput));
  const current = revision ? ensureComposition(currentOutput, dossier, photos) : null;
  const text = instruction ?? (revision ? '' : dossier.brief || '');
  const sourceBlocks = current?.textes || initialBlocks(dossier);
  const type = current?.type || (dossier.contentType === 'evenement' || dossier.theme === 'Événement' ? 'evenement' : 'recit');
  const layouts = type === 'recit' ? [...STORY_GABARITS] : GABARITS;
  if (type === 'recit' && current?.cartes.some(card => card.gabarit === 'document_detail')) layouts.push('document_detail');
  const scopeBase = current || { textes: sourceBlocks, cartes: [], medias: [] };
  const infer = (words) => resolveRevisionScope(scopeBase, words, scope);
  const instructions = Array.isArray(text) ? text.map((r, i) => typeof r === 'string' ? { id: 'i' + (i + 1), texte: r, portee: infer(r) } : { id: r.id || 'i' + (i + 1), texte: r.texte ?? r.text ?? '', portee: r.portee ?? infer(r.texte ?? r.text) }) : text ? [{ id: revision ? 'revision-1' : 'initiale-1', texte: String(text), portee: infer(text) }] : [];
  const input = {
    contrat: CONTRAT, requete_id: requestId || uid('requete'), base_version: baseVersion || current?.base_version || uid('depot'),
    mode: revision ? 'revision' : 'creation', type,
    textes: copy(sourceBlocks), medias: catalogue(dossier, photos, current?.medias || []),
    pratique: copy(current?.pratique || practicalFromDossier(dossier)), etat: current ? { cartes: copy(current.cartes) } : null,
    consignes_initiales: revision ? [] : instructions, demandes_revision: revision ? instructions : [],
    gabarits: copy(dossier.gabarits || layouts), max_cartes: dossier.max_cartes ?? dossier.maxCards ?? null,
  };
  if (input.type === 'recit') {
    input.max_cartes = revision ? null : Math.min(input.max_cartes ?? 10, 10);
    const bodyIds = input.textes.filter(block => block.role === 'corps' && block.texte.trim()).map(block => block.id);
    if (!revision && editorial && bodyIds.length && input.textes.some(block => block.role === 'titre' && block.texte.trim())) {
      assert(!input.consignes_initiales.some(request => request.id === STORY_EDITORIAL_REQUEST_ID), 'Identifiant de consigne réservé au Studio.');
      input.consignes_initiales.push({ id: STORY_EDITORIAL_REQUEST_ID, texte: STORY_EDITORIAL_INSTRUCTION, portee: bodyIds.map(id => 'texte:' + id) });
    }
  }
  validateCompositionInput(input); return input;
}

function inputState(input) {
  return { contrat: CONTRAT, type: input.type, base_version: input.base_version, textes: copy(input.textes), medias: copy(input.medias), pratique: copy(input.pratique), cartes: copy(input.etat?.cartes || []), statut: 'sans_changement', retours: [], alertes: [], operations: [], applied_requests: [] };
}

function operationTarget(op) {
  if (op.action === 'editer_texte') return 'texte:' + op.bloc_id;
  if (op.action === 'inserer_texte') return 'texte:' + op.bloc.id;
  if (op.action === 'renseigner_champ') return 'champ:' + op.cle;
  if (op.action === 'ajouter_carte') return 'cartes/ajout';
  if (op.action === 'retirer_carte') return 'carte:' + op.carte_id + '/retrait';
  if (op.action === 'ordonner_cartes') return 'cartes/ordre';
  return 'carte:' + op.carte_id + '/' + op.action.slice(6);
}

function validateReturnTargets(input, response, state) {
  const cardIds = new Set([...(input.etat?.cartes || []), ...state.cartes].map((c) => c.id));
  const textIds = new Set([...input.textes, ...state.textes].map((b) => b.id));
  for (const retour of response.retours) {
    unique(retour.cibles, 'Cibles du retour');
    for (const target of retour.cibles) {
      const card = target.match(/^carte:([^/]+)(?:\/(medias|gabarit|motif|blocs|champs|relief|retrait))?$/);
      const text = target.match(/^texte:(.+)$/);
      const field = target.match(/^champ:(.+)$/);
      assert(card ? cardIds.has(card[1]) : text ? text[1] === '+' || textIds.has(text[1]) : field ? CHAMPS.includes(field[1]) : ['composition', 'cartes/ajout', 'cartes/ordre', 'texte/ordre'].includes(target), 'Cible de retour inconnue : ' + target);
    }
    if (input.mode === 'revision' && retour.etat === 'appliquee') {
      for (const operation of response.operations.filter((o) => o.consigne_id === retour.consigne_id)) {
        const target = operationTarget(operation);
        const covered = retour.cibles.includes(target) || target.startsWith('carte:') && retour.cibles.includes('carte:' + operation.carte_id) || retour.cibles.includes('composition') && !['editer_texte', 'inserer_texte', 'renseigner_champ'].includes(operation.action) || operation.action === 'inserer_texte' && retour.cibles.includes('texte:+');
        assert(covered, 'Un changement effectif manque au retour : ' + target);
      }
    }
  }
}

export function validateCompositionState(comp, { gabarits = GABARITS, maxCartes = null, allowIncompleteLayouts = false, allowIncompleteContent = false, allowUnavailableMedia = false, allowTextOrder = false } = {}) {
  assert(comp?.contrat === CONTRAT, 'État canonique inconnu.'); enumeration(comp.type, ['recit', 'evenement'], 'Type');
  list(comp.textes, 'Blocs'); comp.textes.forEach(validateBlock); unique(comp.textes.map((x) => x.id), 'IDs de blocs');
  list(comp.medias, 'Médias'); comp.medias.forEach(validateMedia); unique(comp.medias.map((x) => x.id), 'IDs de médias');
  list(comp.pratique, 'Champs'); comp.pratique.forEach(validateFact); unique(comp.pratique.map((x) => x.cle), 'Clés pratiques');
  list(comp.cartes, 'Cartes'); comp.cartes.forEach(validateCard); unique(comp.cartes.map((x) => x.id), 'IDs de cartes');
  assert(maxCartes === null || comp.cartes.length <= maxCartes, 'Le plafond de cartes est dépassé.');
  const flattened = [];
  for (const card of comp.cartes) {
    assert(gabarits.includes(card.gabarit), 'Gabarit indisponible : ' + card.gabarit);
    unique(card.blocs, 'Blocs de ' + card.id); unique(card.medias.map((p) => p.media_id), 'Médias de ' + card.id); unique(card.champs, 'Champs de ' + card.id);
    card.blocs.forEach((id) => { lookup(comp.textes, id, 'Bloc'); flattened.push(id); });
    card.champs.forEach((key) => assert(comp.pratique.some((f) => f.cle === key), 'Champ affiché inconnu : ' + key));
    for (const placement of card.medias) {
      const media = lookup(comp.medias, placement.media_id, 'Média');
      if (!allowUnavailableMedia) assert(media.admis && media.apercu_joint, 'Média non admis ou aperçu absent : ' + media.id);
    }
    const [min, max] = MEDIA_COUNTS[card.gabarit];
    if (!allowIncompleteLayouts) assert(card.medias.length >= min && card.medias.length <= max, 'Nombre de médias incompatible avec ' + card.gabarit + ' (' + card.id + ').');
  }
  unique(flattened, 'Affectations des blocs');
  assert(flattened.length === comp.textes.length && comp.textes.every((b) => flattened.includes(b.id)), 'Un bloc a été omis ou laissé sans carte.');
  if (!allowTextOrder) assert(equal(flattened, comp.textes.map((b) => b.id)), 'L’ordre du texte a été modifié.');
  if (comp.type === 'recit') {
    assert(comp.cartes.length > 0 && comp.cartes[0].gabarit === 'couverture', 'Le récit doit commencer par une couverture.');
    assert(comp.cartes.slice(1).every((c) => !['couverture', 'affiche', 'fiche'].includes(c.gabarit)), 'Gabarit de récit incompatible.');
    assert(comp.cartes[0].blocs.every((id) => lookup(comp.textes, id).role === 'titre'), 'La couverture ne doit contenir que le titre fourni.');
    const firstTitle = comp.textes.find((b) => b.role === 'titre');
    if (firstTitle) assert(comp.cartes[0].blocs.includes(firstTitle.id), 'Le titre fourni manque à la couverture.');
    if (!allowIncompleteContent) {
      assert(firstTitle && firstTitle.texte.length, 'Le titre du récit doit être fourni avant composition.');
      assert(comp.textes.some((b) => b.role === 'corps' && b.texte.length), 'Le corps du récit doit être fourni avant composition.');
    }
  } else {
    assert(comp.cartes.length === 2 && comp.cartes[0].gabarit === 'affiche' && comp.cartes[1].gabarit === 'fiche', 'L’évènement nécessite une affiche puis une fiche.');
    assert(comp.pratique.every((f) => comp.cartes[1].champs.includes(f.cle)), 'Tous les champs connus doivent être accessibles sur la fiche.');
  }
  return true;
}

function authorize(input, op, requests) {
  if (op.consigne_id === null) {
    assert(input.mode === 'creation' && op.action === 'renseigner_champ', 'Opération sans consigne interdite.'); return null;
  }
  const request = lookup(requests, op.consigne_id, 'Consigne active');
  const scopes = request.portee;
  let needed;
  switch (op.action) {
    case 'editer_texte': needed = 'texte:' + op.bloc_id; break;
    case 'inserer_texte': needed = 'texte:+'; break;
    case 'renseigner_champ': needed = 'champ:' + op.cle; break;
    case 'ajouter_carte': needed = 'cartes/ajout'; break;
    case 'retirer_carte': needed = 'carte:' + op.carte_id + '/retrait'; break;
    case 'ordonner_cartes': needed = 'cartes/ordre'; break;
    default: needed = 'carte:' + op.carte_id + '/' + op.action.slice(6);
  }
  const compositionOp = !['editer_texte', 'inserer_texte', 'renseigner_champ'].includes(op.action);
  const unrestrictedCreation = input.mode === 'creation' && compositionOp && scopes.length === 0;
  assert(scopes.includes(needed) || (compositionOp && scopes.includes('composition')) || unrestrictedCreation, 'Mutation hors portée : ' + needed);
  return request;
}

function verifyProof(input, state, op, request) {
  const proof = op.preuve;
  if (op.apres === null) return;
  assert(proof.extrait.length > 0 && proof.extrait.includes(op.apres), 'La valeur pratique ne figure pas littéralement dans sa preuve.');
  if (proof.type === 'texte') {
    const block = lookup(state.textes, proof.ref, 'Bloc de preuve'); assert(block.texte.includes(proof.extrait), 'Extrait de preuve absent du texte.');
  } else if (proof.type === 'consigne') {
    const source = lookup(activeRequests(input), proof.ref, 'Consigne de preuve'); assert(source.texte.includes(proof.extrait), 'Extrait absent de la consigne.');
  } else if (proof.type === 'media') {
    const media = lookup(state.medias, proof.ref, 'Média de preuve'); assert(media.admis && media.apercu_joint, 'Aperçu de preuve absent.');
  } else {
    const existing = input.pratique.find((f) => f.cle === op.cle && f.preuve.type === 'saisie');
    assert(existing && existing.valeur === op.apres && existing.preuve.ref === proof.ref, 'La saisie citée ne correspond pas au dossier.');
  }
  const existing = input.pratique.find((f) => f.cle === op.cle && f.preuve.type === 'saisie');
  if (existing && op.apres !== existing.valeur) assert(request && request.portee.includes('champ:' + op.cle), 'Une lecture ne peut remplacer une saisie existante.');
}

/** Apply a complete validated batch to a copy. Throws before the displayed state can be changed. */
export function applyCompositionResponse(input, response, options = {}) {
  validateCompositionInput(input); validateCompositionResponse(response);
  for (const k of ['contrat', 'requete_id', 'base_version', 'mode', 'type']) assert(response[k] === input[k], 'Réponse périmée ou étrangère : ' + k);
  assert(!options.currentVersion || options.currentVersion === input.base_version, 'La version affichée a changé pendant le calcul.');
  const applied = options.appliedRequestIds || options.applied_requests || [];
  assert(!applied.includes(input.requete_id), 'Cette requête a déjà été appliquée.');
  const requests = activeRequests(input);
  unique(response.retours.map((r) => r.consigne_id), 'Retours de consignes');
  assert(equal(response.retours.map((r) => r.consigne_id), requests.map((r) => r.id)), 'Un retour, dans l’ordre, est requis pour chaque consigne active.');
  response.retours.forEach((r) => {
    assert(r.message.length > 0, 'Un retour doit expliquer son résultat.');
    if (r.etat === 'appliquee' || r.etat === 'deja_satisfaite') assert(r.cibles.length > 0, 'Le retour doit désigner une cible vérifiable.');
  });
  if (input.mode === 'revision') assert(response.cartes.length === 0, 'Une révision doit fournir uniquement des opérations.');
  const state = inputState(input);
  state.statut = response.statut; state.retours = copy(response.retours); state.alertes = copy(response.alertes); state.operations = copy(response.operations);
  state.requete_id = input.requete_id;
  state.applied_requests = [...applied, input.requete_id];
  if (response.statut !== 'proposition') {
    assert(!response.cartes.length && !response.operations.length, 'Une réponse sans proposition ne doit rien modifier.');
    assert(response.retours.every((r) => r.etat !== 'appliquee'), 'Une réponse sans mutation ne peut annoncer une application.');
    if (response.statut === 'sans_changement') assert(response.retours.every((r) => r.etat === 'deja_satisfaite'), 'Le constat sans changement doit être déjà satisfait.');
    const dossierIncomplete = requests.length === 0 && response.alertes.some((a) => a.code === 'dossier' && a.message.length > 0);
    if (response.statut === 'a_preciser') assert(dossierIncomplete || response.retours.some((r) => ['a_preciser', 'contradictoire'].includes(r.etat)), 'Le blocage doit demander une précision.');
    if (response.statut === 'impossible') assert(dossierIncomplete || response.retours.some((r) => r.etat === 'impossible'), 'Le blocage doit être expliqué.');
    validateReturnTargets(input, response, state);
    return state;
  }
  assert(response.retours.every((r) => ['appliquee', 'deja_satisfaite'].includes(r.etat)), 'Une proposition ne peut appliquer un lot encore bloqué.');
  if (input.mode === 'creation') { assert(response.cartes.length > 0, 'La création est vide.'); state.cartes = copy(response.cartes); }
  state.operations = [];
  const changedRequests = new Set();
  const textOrderAllowed = requests.some((r) => r.portee.includes('texte/ordre'));
  for (const op of response.operations) {
    const request = authorize(input, op, requests);
    if (input.mode === 'creation') assert(['editer_texte', 'inserer_texte', 'renseigner_champ'].includes(op.action), 'Une création reçoit son plan directement dans cartes.');
    const before = JSON.stringify({ textes: state.textes, cartes: state.cartes, pratique: state.pratique });
    if (op.action.startsWith('fixer_')) {
      const card = lookup(state.cartes, op.carte_id, 'Carte'); const property = op.action.slice(6);
      if (property === 'relief' && (card.relief ?? 'simple') === op.relief) continue;
      if (property === 'medias') {
        for (const placement of op.medias) {
          const survivor = card.medias.find((p) => p.media_id === placement.media_id);
          if (survivor) {
            const permissions = { role: /rôle|role|fonction/i, fit: /cadrage|recadr|rogn|contain|cover/i, taille: /taille|rédui|redui|agrandi|respir/i, alt: /alt|description|décri|decri|légende|legende/i, lien: /lien|association|raison|justifi|description/i };
            for (const field of ['role', 'fit', 'taille', 'alt', 'lien']) if (survivor[field] !== placement[field]) assert(permissions[field].test(request.texte), 'Un champ du placement conservé a été réécrit hors demande : ' + field);
          }
        }
      }
      card[property] = copy(op[property]);
    } else if (op.action === 'ajouter_carte') {
      assert(!state.cartes.some((c) => c.id === op.carte.id), 'ID de carte déjà utilisé.');
      const index = op.apres_carte_id === null ? -1 : state.cartes.indexOf(lookup(state.cartes, op.apres_carte_id, 'Ancre de carte'));
      state.cartes.splice(index + 1, 0, copy(op.carte));
    } else if (op.action === 'retirer_carte') {
      const card = lookup(state.cartes, op.carte_id, 'Carte'); state.cartes.splice(state.cartes.indexOf(card), 1);
    } else if (op.action === 'ordonner_cartes') {
      unique(op.ordre, 'Permutation'); assert(op.ordre.length === state.cartes.length && op.ordre.every((id) => state.cartes.some((c) => c.id === id)), 'La permutation doit contenir toutes les cartes.');
      state.cartes = op.ordre.map((id) => lookup(state.cartes, id));
    } else if (op.action === 'editer_texte') {
      const block = lookup(state.textes, op.bloc_id, 'Bloc'); assert(block.texte === op.avant, 'Le texte avant est périmé : ' + op.bloc_id);
      if (op.apres === null) { state.textes.splice(state.textes.indexOf(block), 1); state.cartes.forEach((c) => { c.blocs = c.blocs.filter((id) => id !== op.bloc_id); }); }
      else block.texte = op.apres;
    } else if (op.action === 'inserer_texte') {
      assert(!state.textes.some((b) => b.id === op.bloc.id), 'ID de bloc déjà utilisé.');
      const anchor = op.apres_bloc_id === null ? null : lookup(state.textes, op.apres_bloc_id, 'Ancre de bloc');
      if (!anchor) assert(op.separateur_avant === '', 'Le séparateur avant doit être vide en tête.');
      if (anchor) anchor.separateur = op.separateur_avant;
      state.textes.splice(anchor ? state.textes.indexOf(anchor) + 1 : 0, 0, copy(op.bloc));
    } else if (op.action === 'renseigner_champ') {
      const old = state.pratique.find((f) => f.cle === op.cle);
      assert((old?.valeur ?? null) === op.avant, 'La valeur pratique avant est périmée : ' + op.cle);
      assert(op.avant !== op.apres, 'Un renseignement pratique sans effet est interdit.');
      verifyProof(input, state, op, request);
      if (old) state.pratique.splice(state.pratique.indexOf(old), 1);
      if (op.apres !== null) state.pratique.push({ cle: op.cle, valeur: op.apres, preuve: copy(op.preuve) });
      else state.cartes.forEach((c) => { c.champs = c.champs.filter((key) => key !== op.cle); });
    }
    const after = JSON.stringify({ textes: state.textes, cartes: state.cartes, pratique: state.pratique });
    if (before === after) continue;
    state.operations.push(copy(op));
    if (op.consigne_id) changedRequests.add(op.consigne_id);
  }
  if (input.mode === 'revision') {
    assert(state.operations.length > 0, 'La demande ne change rien à cette version. Précisez la retouche souhaitée.');
    for (const result of response.retours) {
      if (result.etat === 'appliquee') assert(changedRequests.has(result.consigne_id), 'Le retour annonce une modification sans opération.');
      else assert(!changedRequests.has(result.consigne_id), 'Une demande déjà satisfaite ne peut produire de mutation.');
    }
  }
  if (textOrderAllowed) {
    const order = state.cartes.flatMap((c) => c.blocs);
    state.textes = order.map((id) => lookup(state.textes, id, 'Bloc'));
  }
  validateCompositionState(state, { gabarits: input.gabarits, maxCartes: input.type === 'recit' ? input.mode === 'creation' ? Math.min(input.max_cartes ?? 10, 10) : null : input.max_cartes });
  validateImagePlacements(state.cartes, input.etat?.cartes ?? [], options.equivalentMedias);
  validateReturnTargets(input, { ...response, operations: state.operations }, state);
  if (state.type === 'evenement') {
    const date = state.pratique.find((f) => f.cle === 'date_debut');
    if (date && !/\b(?:19|20|21)\d{2}\b/.test(date.valeur) && !state.alertes.some((a) => a.code === 'champ_manquant' && /ann[eé]e/i.test(a.message))) fail('Une date sans année doit être signalée à compléter.');
  }
  // A replay of the same accepted request resolves to the same version, even in a stateless worker.
  state.base_version = 'version-' + input.requete_id;
  return state;
}

export function cardText(comp, cardOrId, role) {
  const card = typeof cardOrId === 'string' ? lookup(comp.cartes, cardOrId, 'Carte') : cardOrId;
  const blocks = card.blocs.map((id) => lookup(comp.textes, id, 'Bloc')).filter((b) => !role || b.role === role);
  return blocks.map((b, i) => b.texte + (i < blocks.length - 1 ? b.separateur : '')).join('');
}

function manualRoleEdit(comp, card, role, value) {
  const ids = card.blocs.filter((id) => lookup(comp.textes, id).role === role);
  const old = ids.map((id) => lookup(comp.textes, id));
  if (cardText(comp, card, role) === value) return;
  const pieces = role === 'titre' ? (value.length ? [{ id: old[0]?.id || uid('t'), role, texte: value, separateur: old.at(-1)?.separateur || '' }] : []) : splitCompositionText(value, { role, prefix: uid('b') + '-' });
  pieces.forEach((b, i) => { b.id = old[i]?.id || b.id; });
  if (role !== 'titre' && pieces.length && old.length) pieces.at(-1).separateur += old.at(-1).separateur;
  let previousIndex;
  if (old.length) previousIndex = comp.textes.indexOf(old[0]);
  else if (card.blocs.length) {
    const indexes = card.blocs.map((id) => comp.textes.findIndex((b) => b.id === id));
    previousIndex = role === 'titre' ? Math.min(...indexes) : Math.max(...indexes) + 1;
  } else {
    const nextId = comp.cartes.slice(comp.cartes.indexOf(card) + 1).flatMap((c) => c.blocs)[0];
    previousIndex = nextId ? comp.textes.findIndex((b) => b.id === nextId) : comp.textes.length;
  }
  if (!old.length && pieces.length) {
    if (previousIndex < comp.textes.length && !pieces.at(-1).separateur) pieces.at(-1).separateur = '\n\n';
    const previous = comp.textes[previousIndex - 1];
    if (previous && !previous.separateur) previous.separateur = '\n\n';
  }
  comp.textes = comp.textes.filter((b) => !ids.includes(b.id));
  comp.textes.splice(previousIndex, 0, ...pieces);
  let insertAt = card.blocs.findIndex((id) => ids.includes(id));
  if (insertAt < 0) insertAt = role === 'titre' ? 0 : card.blocs.length;
  card.blocs = card.blocs.filter((id) => !ids.includes(id)); card.blocs.splice(insertAt, 0, ...pieces.map((b) => b.id));
}

export function editCompositionCard(comp, cardId, changes = {}) {
  const next = copy(comp); const card = lookup(next.cartes, cardId, 'Carte');
  if (own(changes, 'title')) { str(changes.title, 'Titre saisi'); manualRoleEdit(next, card, 'titre', changes.title); }
  if (own(changes, 'body')) { str(changes.body, 'Texte saisi'); manualRoleEdit(next, card, 'corps', changes.body); }
  if (own(changes, 'gabarit')) { enumeration(changes.gabarit, GABARITS, 'Gabarit'); card.gabarit = changes.gabarit; }
  if (own(changes, 'fond')) {
    if (changes.fond === null) delete card.fond;
    else { enumeration(changes.fond, CARD_BACKGROUNDS, 'Fond de carte'); card.fond = changes.fond; }
  }
  if (own(changes, 'relief')) { enumeration(changes.relief, TEXT_RELIEFS, 'Relief du texte'); card.relief = changes.relief; }
  if (own(changes, 'motif')) { enumeration(changes.motif, MOTIFS, 'Motif'); card.motif = changes.motif; }
  if (own(changes, 'medias')) {
    list(changes.medias, 'Placements');
    card.medias = changes.medias.map((p) => typeof p === 'string' ? placementFor(next, p) : copy(p)); card.medias.forEach(validatePlacement);
  }
  if (own(changes, 'mediaIds')) card.medias = changes.mediaIds.map((id) => card.medias.find((p) => p.media_id === id) || placementFor(next, id));
  if (own(changes, 'fit')) card.medias.forEach((p) => { enumeration(changes.fit, ['cover', 'contain'], 'Cadrage'); p.fit = changes.fit; });
  if (own(changes, 'taille')) card.medias.forEach((p) => { enumeration(changes.taille, ['normale', 'reduite'], 'Taille'); p.taille = changes.taille; });
  if (own(changes, 'champs')) card.champs = copy(changes.champs);
  if (own(changes, 'pratique')) {
    const entries = Array.isArray(changes.pratique) ? changes.pratique.map((f) => [f.cle, f.valeur]) : Object.entries(changes.pratique);
    for (const [cle, value] of entries) {
      enumeration(cle, CHAMPS, 'Champ'); next.pratique = next.pratique.filter((f) => f.cle !== cle);
      if (value !== null && value !== '') next.pratique.push({ cle, valeur: String(value), preuve: { type: 'saisie', ref: 'edition.' + cle, extrait: String(value) } });
      else next.cartes.forEach((c) => { c.champs = c.champs.filter((key) => key !== cle); });
    }
    if (next.type === 'evenement') next.cartes.find((c) => c.gabarit === 'fiche').champs = next.pratique.map((f) => f.cle);
  }
  next.base_version = uid('version'); next.statut = 'proposition'; next.operations = []; next.retours = [];
  // Manual controls may temporarily select a gabarit before selecting its images.
  validateCompositionState(next, { allowIncompleteLayouts: true, allowIncompleteContent: true, allowUnavailableMedia: true });
  return next;
}

function placementFor(comp, id, slide = {}) {
  const media = lookup(comp.medias, id, 'Média');
  return { media_id: id, role: slide.role && ROLES.includes(slide.role) ? slide.role : 'contexte', fit: slide.fit === 'cover' ? 'cover' : 'contain', taille: 'normale', alt: slide.alt || media.legende || media.nom, lien: slide.direction || 'Visuel sélectionné dans la version affichée.' };
}

/** Existing drafts migrate from what is displayed, never from the original deposit. */
export function migrateLegacyComposition(output = {}, dossier = {}, photos = []) {
  if (output?.composition?.contrat === CONTRAT) return copy(output.composition);
  if (output?.contrat === CONTRAT && Array.isArray(output.cartes)) return copy(output);
  const type = output.contentType === 'evenement' || dossier.contentType === 'evenement' ? 'evenement' : 'recit';
  const comp = { contrat: CONTRAT, type, base_version: uid('version'), textes: [], medias: catalogue(dossier, photos), pratique: practicalFromDossier({ ...dossier, event: output.event || dossier.event }), cartes: [], statut: 'proposition', retours: [], alertes: [], operations: [], applied_requests: [] };
  let slides = output.slides;
  if (!Array.isArray(slides) || !slides.length) {
    const textCards = typeof output.cards === 'string' ? output.cards.split('\n').filter((t) => t.length) : [];
    slides = textCards.map((body, i) => ({ title: i === 0 ? body : '', body: i === 0 ? '' : body, layout: i === 0 ? 'cover' : 'text' }));
  }
  for (const [index, slide] of (slides || []).entries()) {
    const card = { id: slide.canonicalId || slide.id || 'c' + (index + 1), gabarit: slide.gabarit || OLD_GABARITS[slide.layout] || (index === 0 ? 'couverture' : 'texte'), motif: MOTIFS.includes(slide.motif) ? slide.motif : OLD_MOTIFS[slide.motif] || 'aucun', blocs: [], medias: [], champs: copy(slide.fields || []) };
    for (const [role, value] of [['titre', String(slide.title ?? '')], ['corps', String(slide.body ?? '')]]) {
      const blocks = splitCompositionText(value, { role, prefix: card.id + '-' + (role === 'titre' ? 't' : 'b') });
      blocks.forEach((b) => { comp.textes.push(b); card.blocs.push(b.id); });
    }
    const ids = [...new Set([...(slide.mediaIds || []), slide.photoId].filter(Boolean))];
    card.medias = Array.isArray(slide.mediaPlacements) ? copy(slide.mediaPlacements) : ids.map((id) => placementFor(comp, id, slide));
    if (type === 'evenement') { card.gabarit = index === 0 ? 'affiche' : 'fiche'; if (index === 1) card.champs = comp.pratique.map((f) => f.cle); }
    else if (index === 0) card.gabarit = 'couverture';
    else if (card.medias.length === 0) card.gabarit = 'texte';
    else if (card.medias.length === 1 && !['colonnes', 'image_haut'].includes(card.gabarit)) card.gabarit = 'colonnes';
    else if (card.medias.length === 2 && !['comparaison', 'images_superposees', 'document_detail', 'assemblage'].includes(card.gabarit)) card.gabarit = 'comparaison';
    else if (card.medias.length === 3) card.gabarit = 'assemblage';
    comp.cartes.push(card);
  }
  comp.textes.forEach((b, i) => { if (i < comp.textes.length - 1 && !b.separateur) b.separateur = '\n\n'; });
  return comp;
}
export const ensureComposition = (output, dossier = {}, photos = []) => migrateLegacyComposition(output, dossier, photos);

export function compositionToLegacy(comp) {
  const composition = copy(comp);
  const titleBlock = comp.textes.find((b) => b.role === 'titre');
  const title = titleBlock?.texte || comp.pratique.find((f) => f.cle === 'titre_affiche')?.valeur || '';
  const event = comp.type === 'evenement' ? Object.fromEntries(Object.values(EVENT_KEYS).map((key) => [key, key === 'speakers' ? [] : ''])) : null;
  if (event) {
    for (const fact of comp.pratique) event[EVENT_KEYS[fact.cle]] = fact.cle === 'intervenants' ? fact.valeur.split('\n') : fact.valeur;
    event.missingFields = comp.alertes.filter((a) => a.code === 'champ_manquant').map((a) => a.message);
  }
  const slides = comp.cartes.map((card, index) => ({
    id: card.id, canonicalId: card.id, gabarit: card.gabarit, kind: index === 0 ? 'cover' : comp.type === 'evenement' ? 'event' : 'story',
    title: cardText(comp, card, 'titre'), body: cardText(comp, card, 'corps'),
    photoId: card.medias[0]?.media_id || null, mediaIds: card.medias.map((p) => p.media_id), mediaPlacements: copy(card.medias),
    sourceBlockIds: copy(card.blocs), fields: copy(card.champs), practical: card.champs.map((key) => comp.pratique.find((f) => f.cle === key)).filter(Boolean).map(copy),
    background: card.fond ?? CARD_BACKGROUNDS[index % 2], layout: LAYOUTS[card.gabarit], ...(card.relief ? { relief: card.relief } : {}),
    fit: card.medias[0]?.fit || 'contain', motif: ({ aucun: 'none', cedre: 'cedar', montagnes: 'mountains', colonnes: 'columns', sceau: 'seal' })[card.motif],
    canonicalMotif: card.motif, alt: card.medias.map((p) => p.alt).join(' / '), direction: card.medias.map((p) => p.lien).join(' '),
  }));
  slides.forEach((slide) => { slide.renderedBody = [slide.body, ...slide.practical.map((f) => f.valeur)].filter(Boolean).join('\n'); });
  const body = comp.textes.filter((b) => b.role === 'corps');
  const summary = body[0]?.texte || (comp.type === 'evenement' ? comp.pratique.filter((f) => f.cle !== 'titre_affiche').map((f) => f.valeur).join(' · ') || title : '');
  const textCaption = comp.textes.map((b) => b.texte + b.separateur).join('');
  const caption = textCaption || (comp.type === 'evenement' ? comp.pratique.map((f) => f.valeur).join('\n') : '');
  return { title, summary, cards: slides.map((s) => [s.title, s.renderedBody].filter(Boolean).join(' — ')).join('\n'), caption, contentType: comp.type, slides, event, checks: comp.alertes.map((a) => a.message), composition };
}
