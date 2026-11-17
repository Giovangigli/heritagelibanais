export const STATUSES = [
  'À compléter', 'À vérifier', 'Proposition', 'Corrections demandées',
  'Prêt à valider', 'Validé', 'Carte site en brouillon', 'Archivé',
];

export function workflowStepIndex(status) {
  switch (status) {
    case 'Proposition':
    case 'Corrections demandées':
      return 1;
    case 'Prêt à valider':
    case 'Validé':
      return 2;
    case 'Carte site en brouillon':
    case 'Archivé':
      return 3;
    default:
      return 0;
  }
}

export const emptyEvent = () => ({
  startDate: '', endDate: '', startTime: '', endTime: '', timezone: '', venue: '',
  address: '', city: '', speakers: [], registrationUrl: '', price: '', contact: '', missingFields: [],
});

export const emptyState = () => ({
  schema: 1,
  status: STATUSES[0],
  dossier: {
    title: '', sourceText: '', sources: '', facts: '', theme: 'Récit',
    place: '', date: '', cta: '', brief: '', publishedUrl: '', mediaMode: 'none', media: [],
    contentType: 'recit', event: emptyEvent(),
  },
  proposals: [], correctionRequest: '', draft: null, history: [],
});

const snapshot = (value) => JSON.parse(JSON.stringify(value));
const clean = (value) => String(value || '').trim();
const firstSentence = (value) => clean(value).match(/^.*?[.!?](?:[»”"'])*(?=\s|$)/s)?.[0] || clean(value);
const sourceContent = (value) => {
  const lines = clean(value).split(/\r?\n/);
  let sourceTitle = '';
  if (/^titre(?: proposé)?\s*[:：–-]\s*.+/i.test(lines[0] || '')) {
    sourceTitle = lines.shift().replace(/^titre(?: proposé)?\s*[:：–-]\s*/i, '').trim();
  } else if (/^titre(?: proposé)?\s*:?$/i.test(lines[0] || '')) {
    lines.shift();
    while (lines.length && !lines[0].trim()) lines.shift();
    sourceTitle = (lines.shift() || '').trim();
  }
  // Paragraph boundaries change the layout only: every source word stays in order.
  const parts = lines.join('\n').trim().split(/\n\s*\n|\n/).map((part) => part.trim()).filter(Boolean);
  return { sourceTitle, parts };
};

export const contentType = (dossier) => dossier?.contentType === 'evenement' || (!dossier?.contentType && dossier?.theme === 'Événement') ? 'evenement' : 'recit';

export function eventDetails(event = {}) {
  return [
    ['Date', [event.startDate, event.endDate ? 'au ' + event.endDate : ''].filter(Boolean).join(' ')],
    ['Horaire', [event.startTime, event.endTime ? '– ' + event.endTime : '', event.timezone].filter(Boolean).join(' ')],
    ['Lieu', [event.venue, event.address, event.city].filter(Boolean).join(', ')],
    ['Intervenants', (event.speakers || []).join(', ')],
    ['Inscription', event.registrationUrl], ['Tarif', event.price], ['Contact', event.contact],
  ].filter(([, value]) => clean(value));
}

export function eventMissingFields(event = {}) {
  return [['startDate', 'date'], ['startTime', 'horaire'], ['venue', 'lieu ou accès en ligne']]
    .filter(([key]) => !clean(event[key])).map(([, label]) => label);
}

export function dossierGaps(dossier) {
  const gaps = [];
  if (dossier.mediaMode === 'photos' && !dossier.media?.length) gaps.push('une photo');
  if (contentType(dossier) === 'evenement') gaps.push(...eventMissingFields(dossier.event).map((field) => 'évènement : ' + field));
  return gaps;
}

export function hasIntake(dossier) {
  return Boolean(clean(dossier.sourceText) || dossier.media?.length || (contentType(dossier) === 'evenement' && (clean(dossier.title) || eventDetails(dossier.event).length)));
}

export function saveDossier(state, dossier) {
  const next = snapshot(state);
  next.dossier = snapshot(dossier);
  next.status = hasIntake(dossier) ? STATUSES[1] : STATUSES[0];
  next.correctionRequest = '';
  next.draft = null;
  next.history.push({ status: next.status, at: new Date().toISOString(), note: 'Dossier enregistré ou rouvert pour vérification' });
  return next;
}

export function suggestedOutput(dossier) {
  const type = contentType(dossier);
  const { sourceTitle, parts } = sourceContent(dossier.sourceText);
  const explicitTitle = clean(dossier.title).replace(/^titre(?: proposé)?\s*[:：–-]\s*/i, '');
  const title = sourceTitle || explicitTitle || firstSentence(parts[0]) || (type === 'evenement' ? 'Évènement à nommer' : 'Récit à nommer');
  const bodyParts = parts;
  const availableMedia = dossier.mediaMode === 'photos' ? dossier.media || [] : [];
  const event = type === 'evenement' ? { ...emptyEvent(), ...snapshot(dossier.event || {}) } : null;
  const checks = ['Texte conservé ; proposition de découpage et de mise en page. Les éventuelles fautes sont à signaler pour relecture, sans correction automatique.'];
  let slides;
  if (event) {
    event.missingFields = eventMissingFields(event);
    const details = eventDetails(event).map(([label, value]) => label + ' : ' + value).join(' · ');
    slides = [
      { kind: 'cover', title, body: [bodyParts.join('\n\n'), [event.startDate, event.startTime].filter(Boolean).join(' · '), [event.venue, event.city].filter(Boolean).join(', ')].filter(Boolean).join('\n'), photoId: availableMedia[0]?.id || null, layout: 'poster', direction: 'Affiche : titre, puis informations pratiques ; conserver le visuel fourni sans déformation.' },
      { kind: 'event', title: 'Informations pratiques', body: details || 'Informations pratiques à compléter.', photoId: null, layout: 'text', direction: 'Fiche pratique lisible, sans ajouter de date ni de lieu.' },
    ];
    if (event.missingFields.length) checks.push('À compléter : ' + event.missingFields.join(', ') + '.');
  } else {
    slides = [{ kind: 'cover', title, body: '', photoId: availableMedia[0]?.id || null, layout: 'cover', direction: 'Couverture avec le titre source conservé et le premier visuel proposé.' }];
    bodyParts.forEach((part, index) => slides.push({ kind: 'story', title: '', body: part, photoId: availableMedia[index + 1]?.id || null, layout: availableMedia[index + 1] ? 'image-top' : 'text', direction: 'Paragraphe source conservé mot pour mot ; proposition de mise en page et de cadrage.' }));
    if (slides.length === 1) slides.push({ kind: 'story', title: '', body: 'Texte du récit à compléter à partir des images déposées.', photoId: null, layout: 'text', direction: 'Les images seules ne permettent pas de déduire un récit historique.' });
    if (clean(dossier.cta)) slides.push({ kind: 'closing', title: '', body: clean(dossier.cta), photoId: null, layout: 'text', direction: 'Invitation à poursuivre le récit.' });
  }
  slides = slides.map((slide, index) => ({ mediaIds: slide.photoId ? [slide.photoId] : [], background: index % 2 ? 'sand' : 'sage', fit: 'contain', motif: slide.photoId ? 'none' : 'cedar', alt: '', ...slide }));
  const captionBody = bodyParts.join('\n\n');
  const caption = [title, captionBody === title ? '' : captionBody, event ? eventDetails(event).map(([label, value]) => label + ' : ' + value).join('\n') : '', clean(dossier.cta)].filter(Boolean).join('\n\n');
  return {
    title, summary: firstSentence(parts[0]) || (event ? eventDetails(event).map(([, value]) => value).join(' · ') : '') || 'Résumé à rédiger après description des images.',
    cards: slides.map((slide) => [slide.title, slide.body].filter(Boolean).join(' — ').replace(/\s+/g, ' ')).join('\n'), caption,
    contentType: type, slides, event, checks,
  };
}

export function proposalSlides(entry) {
  const media = entry?.basis?.mediaMode === 'photos' ? entry.basis.media || [] : [];
  const lookup = new Map(media.map((item) => [item.id, item]));
  if (Array.isArray(entry?.output?.slides) && entry.output.slides.length) {
    return entry.output.slides.map((slide, index) => {
      const ids = [...new Set([...(Array.isArray(slide.mediaIds) ? slide.mediaIds : []), slide.photoId].filter(Boolean))];
      const mediaItems = ids.map((id) => lookup.get(id)).filter(Boolean);
      return { ...slide, text: [slide.title, slide.body].filter(Boolean).join(' — ').replace(/\s+/g, ' '), media: mediaItems[0] || null, mediaItems,
        background: ['sage','sand'].includes(slide.background) ? slide.background : index % 2 ? 'sand' : 'sage', layout: ['cover','image-top','text','split','poster','pair','stacked-pair','equation'].includes(slide.layout) ? slide.layout : 'text',
        fit: slide.fit === 'cover' ? 'cover' : 'contain', motif: ['cedar','mountains','columns','none'].includes(slide.motif) ? slide.motif : 'none',
      };
    });
  }
  const cards = String(entry?.output?.cards || '').split('\n').map((line) => line.trim()).filter(Boolean);
  return cards.map((text, index) => ({
    title: index === 0 ? text : '', body: index ? text : '', text,
    media: media[index] || null, mediaItems: media[index] ? [media[index]] : [],
    background: index % 2 ? 'sand' : 'sage', layout: media[index] ? 'image-top' : 'text', fit: 'contain', motif: 'none',
    kind: index === 0 ? 'cover' : clean(entry?.basis?.cta) && index === cards.length - 1 ? 'closing' : 'story',
  }));
}

export function createProposal(state, output = suggestedOutput(state.dossier)) {
  if (state.status !== STATUSES[1] || !hasIntake(state.dossier)) throw new Error('Ajoutez un texte libre ou des images pour préparer le brouillon.');
  const next = snapshot(state);
  const number = next.proposals.length + 1;
  next.proposals.push({ number, at: new Date().toISOString(), basis: snapshot(next.dossier), output: snapshot(output), request: '' });
  next.status = STATUSES[2];
  next.history.push({ status: next.status, at: new Date().toISOString(), note: `Proposition V${number}` });
  return next;
}

export function requestCorrection(state, request) {
  if (![STATUSES[2], STATUSES[4]].includes(state.status)) throw new Error('Aucune proposition à corriger.');
  if (!clean(request)) throw new Error('Indiquez la correction demandée.');
  const next = snapshot(state);
  next.correctionRequest = clean(request);
  next.status = STATUSES[3];
  next.history.push({ status: next.status, at: new Date().toISOString(), note: `Sur V${next.proposals.at(-1).number} : ${next.correctionRequest}` });
  return next;
}

export function cancelCorrection(state) {
  if (state.status !== STATUSES[3]) throw new Error('Aucune demande de correction à annuler.');
  const next = snapshot(state);
  next.correctionRequest = '';
  next.status = STATUSES[2];
  next.history.push({ status: next.status, at: new Date().toISOString(), note: 'Demande de correction annulée ; proposition conservée' });
  return next;
}

export function saveRevision(state, output) {
  if (state.status !== STATUSES[3]) throw new Error('Demandez d’abord une correction.');
  const previous = state.proposals.at(-1);
  if (!clean(output.title) || !clean(output.summary) || !clean(output.cards)) throw new Error('Complétez le titre, le résumé et les cartes.');
  if (JSON.stringify(output) === JSON.stringify(previous.output)) throw new Error('Modifiez la proposition avant d’enregistrer une nouvelle version.');
  const next = snapshot(state);
  const number = previous.number + 1;
  next.proposals.push({ number, at: new Date().toISOString(), basis: snapshot(previous.basis), output: snapshot(output), request: next.correctionRequest });
  next.correctionRequest = '';
  next.status = STATUSES[2];
  next.history.push({ status: next.status, at: new Date().toISOString(), note: `Proposition V${number} après corrections` });
  return next;
}

export function markReady(state) {
  if (state.status !== STATUSES[2]) throw new Error('Il faut une proposition à relire.');
  if (!clean(state.proposals.at(-1).output.title) || !clean(state.proposals.at(-1).output.summary)) throw new Error('Complétez le titre et le résumé de la proposition.');
  const gaps = dossierGaps(state.proposals.at(-1).basis);
  if (gaps.length) throw new Error('Complétez le dossier avant de valider. Il manque ' + gaps.join(', ') + '.');
  const next = snapshot(state);
  next.status = STATUSES[4];
  next.history.push({ status: next.status, at: new Date().toISOString(), note: `V${next.proposals.at(-1).number} soumise à validation` });
  return next;
}

export function validate(state, reviewer) {
  if (state.status !== STATUSES[4]) throw new Error('La proposition doit être prête à valider.');
  const gaps = dossierGaps(state.proposals.at(-1).basis);
  if (gaps.length) throw new Error('Complétez le dossier avant de valider. Il manque ' + gaps.join(', ') + '.');
  if (!clean(reviewer)) throw new Error('Indiquez le nom de la personne qui valide.');
  const next = snapshot(state);
  const proposal = next.proposals.at(-1);
  const at = new Date().toISOString();
  next.history.push({ status: STATUSES[5], at, note: `V${proposal.number} validée par ${clean(reviewer)}` });
  next.draft = {
    localSimulation: true, wordpressStatus: 'draft', version: proposal.number,
    title: proposal.output.title, summary: proposal.output.summary,
    contentType: contentType(proposal.basis), event: snapshot(proposal.output.event || proposal.basis.event || null),
    slides: snapshot(proposal.output.slides || []), checks: snapshot(proposal.output.checks || []),
    theme: proposal.basis.theme, place: proposal.basis.place, date: proposal.basis.date,
    cta: proposal.basis.cta, media: snapshot(proposal.basis.media),
    sources: proposal.basis.sources, facts: proposal.basis.facts,
    reviewer: clean(reviewer), validatedAt: at,
  };
  next.status = STATUSES[6];
  next.history.push({ status: next.status, at, note: 'Carte brouillon préparée dans ce navigateur uniquement' });
  return next;
}

export function archive(state) {
  if (!state.proposals.length) throw new Error('Aucune proposition à archiver.');
  const next = snapshot(state);
  next.status = STATUSES[7];
  next.history.push({ status: next.status, at: new Date().toISOString(), note: 'Dossier archivé localement' });
  return next;
}

export function createStudioSession() {
  let currentEpoch = 0;
  let activeJob = null;

  const isCurrent = (job) => Boolean(job && activeJob === job && job.epoch === currentEpoch && !job.controller.signal.aborted);
  const cancel = () => {
    if (!activeJob) return false;
    const previous = activeJob;
    activeJob = null;
    previous.controller.abort();
    return true;
  };

  return {
    get epoch() { return currentEpoch; },
    get active() { return activeJob; },
    start(kind) {
      cancel();
      const job = { kind, controller: new AbortController(), epoch: currentEpoch };
      activeJob = job;
      return job;
    },
    isCurrent,
    assertCurrent(job) {
      if (isCurrent(job)) return;
      const error = new Error('Cette préparation a été annulée.');
      error.name = 'AbortError';
      throw error;
    },
    finish(job) {
      if (!isCurrent(job)) return false;
      activeJob = null;
      return true;
    },
    cancel,
    invalidate() {
      currentEpoch += 1;
      cancel();
      return currentEpoch;
    },
    isEpochCurrent(epoch) { return epoch === currentEpoch; },
  };
}

const abortError = () => Object.assign(new Error('Cette préparation a été annulée.'), { name: 'AbortError' });
const abortableSleep = (duration, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(abortError());
  const stop = () => { clearTimeout(timer); reject(abortError()); };
  const timer = setTimeout(() => { signal?.removeEventListener('abort', stop); resolve(); }, duration);
  signal?.addEventListener('abort', stop, { once: true });
});

export async function requestStudioComposition(payload, options = {}) {
  const {
    signal, onProgress = () => {}, fetchImpl = globalThis.fetch,
    sleep = abortableSleep, now = Date.now, pollIntervalMs = 8000,
    timeoutMs = 480000, requestTimeoutMs = 25000,
    ticket = globalThis.crypto.randomUUID(),
  } = options;
  if (!/^[a-zA-Z0-9_-]{24,128}$/.test(ticket)) throw new Error('Identifiant de suivi invalide.');
  const startedAt = now();
  const ensureCurrent = () => {
    if (signal?.aborted) throw abortError();
    if (now() - startedAt >= timeoutMs) throw new Error('L’attente a dépassé huit minutes. Votre version est conservée.');
  };
  const notify = () => {
    ensureCurrent();
    const seconds = Math.floor((now() - startedAt) / 1000);
    onProgress({ ticket, elapsedMs: now() - startedAt, message: 'Composition en cours' + (seconds ? ' · ' + seconds + ' s' : '') + '. Vous pouvez annuler l’attente.' });
  };
  const post = async (body) => {
    ensureCurrent();
    const controller = new AbortController();
    const stop = () => controller.abort();
    signal?.addEventListener('abort', stop, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, Math.min(requestTimeoutMs, timeoutMs - (now() - startedAt)));
    try {
      const response = await fetchImpl('/api/intake', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        signal: controller.signal, body: JSON.stringify(body),
      });
      ensureCurrent();
      const result = await response.json().catch(() => null);
      ensureCurrent();
      if (!response.ok || result?.ok !== true || !result.output) {
        const error = new Error(result?.error || 'n8n n’a pas renvoyé de proposition lisible. Votre version est conservée.');
        error.retryable = result?.code === 'job_not_found' ? now() - startedAt < 30000
          : !['invalid_composition_response', 'n8n_webhook_not_found', 'n8n_test_webhook_expired', 'job_expired', 'invalid_transport_request'].includes(result?.code)
            && !/\((?:401|403|404)\)/.test(result?.error || '')
            && (response.status >= 500 || response.status === 408 || /\b(?:524|504)\b|indisponible|dépassé le délai/i.test(result?.error || ''));
        throw error;
      }
      return result;
    } catch (error) {
      ensureCurrent();
      if (timedOut || error instanceof TypeError || error.name === 'TimeoutError') error.retryable = true;
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
    }
  };
  const isPending = (result) => {
    const transport = result.output.compositionResponse;
    if (transport?.contrat !== 'hl.studio.job.1') {
      if (transport?.contrat !== 'hl.composition.2') throw new Error('La réponse de composition n’est pas vérifiable. Votre version est conservée.');
      return false;
    }
    if (transport.ticket !== ticket) throw new Error('La réponse de suivi appartient à une autre demande. Votre version est conservée.');
    for (const key of ['requete_id', 'base_version']) if (transport[key] !== undefined && transport[key] !== payload.entreeComposition?.[key]) throw new Error('La réponse de suivi ne correspond pas à la version envoyée. Votre version est conservée.');
    if (transport.statut !== 'en_cours') throw new Error('Le suivi de cette composition n’est plus disponible. Votre version est conservée.');
    return true;
  };
  try {
    const accepted = await post({ ...payload, transport: { action: 'start', ticket } });
    if (accepted.receivedPhotos !== payload.photos.length) throw new Error('Les aperçus reçus ne correspondent pas à cette demande. Votre version est conservée.');
    if (!isPending(accepted)) return accepted;
  } catch (error) {
    if (!error.retryable) throw error;
  }
  const pollPayload = {
    schema: 1, dossier: { sourceText: 'Suivi de composition', media: [], mediaMode: 'none' },
    photos: [], contactSheetDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
    transport: { action: 'poll', ticket },
  };
  for (;;) {
    notify();
    const interval = pollIntervalMs === 8000 && now() - startedAt >= 30000 ? 15000 : pollIntervalMs;
    await sleep(Math.min(interval, timeoutMs - (now() - startedAt)), signal);
    ensureCurrent();
    try {
      const result = await post(pollPayload);
      if (!isPending(result)) return result;
    } catch (error) {
      if (!error.retryable) throw error;
    }
  }
}
