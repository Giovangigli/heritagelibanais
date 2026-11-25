import {eventIconPreviewUrl,renderEventPage} from './studio-event-page.mjs';
import {renderPublicationPreview} from './studio-publication-page.mjs';
import { workflowStepIndex, emptyState, emptyEvent, contentType, EVENT_ICONS, eventIcon, eventPreviewMatches, separateDossiers, eventDetails, dossierGaps, hasIntake, saveDossier, createProposal, proposalSlides, publicationMedia, archive, createStudioSession, requestStudioComposition } from './studio-model.mjs';
import { buildCompositionInput, storyCreationIssue, applyCompositionResponse, compositionToLegacy, editCompositionCard, ensureComposition, validateCompositionState, CARD_BACKGROUNDS, MEDIA_COUNTS, STORY_GABARITS, resolveFreeRevisionScope, suggestImageLayout } from './composition-v2.mjs';
import {renderInstagramJpeg} from './studio-instagram-render.mjs';

const $ = (id) => document.getElementById(id);
let studioAccess;
try {
  const response = await fetch('/api/access', {cache:'no-store', signal:AbortSignal.timeout(5000)});
  if (response.status === 401) {
    const link = document.createElement('a');
    link.href = '/signin-with-chatgpt?return_to=%2F';
    link.textContent = 'Se reconnecter au Studio';
    $('studio-loading').replaceChildren(link);
    throw new Error('Connexion au Studio requise.');
  }
  if (!response.ok) throw new Error('Votre accès au Studio n’a pas pu être vérifié.');
  studioAccess = await response.json();
  if (typeof studioAccess.storageScope !== 'string' || !studioAccess.storageScope) throw new Error('Votre espace de travail n’a pas pu être ouvert.');
} catch (error) {
  $('main').hidden = true;
  if (!$('studio-loading').querySelector('a')) $('studio-loading').textContent = error.message + ' Rechargez la page pour réessayer.';
  throw error;
}
const previousStorageKey = 'heritage-studio-mvp-v1';
const storageKey = previousStorageKey + ':' + studioAccess.storageScope;
try {
  if (studioAccess.role === 'owner' && !localStorage.getItem(storageKey)) {
    for (const suffix of ['', '-pending', '-revision']) {
      const value = localStorage.getItem(previousStorageKey + suffix);
      if (value !== null) localStorage.setItem(storageKey + suffix, value);
    }
  }
} catch { /* The online draft can still be restored. */ }
$('admin-connection-link').hidden = !studioAccess.canManageConnections;
$('revision-setup-link').hidden = !studioAccess.canManageConnections;
$('mailing-confirmation').hidden = !studioAccess.canScheduleMailing;
$('mailing-send').hidden = !studioAccess.canScheduleMailing;
const newMediaId = () => globalThis.crypto?.randomUUID?.() || 'media-' + Date.now() + '-' + Math.random().toString(36).slice(2);
const form = $('dossier-form');
const visual = $('event-visual');
for (const [key, label] of Object.entries(EVENT_ICONS)) visual.add(new Option(label, key));
let eventPhotoId = null;
const dossierFields = ['title', 'sourceText', 'sources', 'theme'];
const templateLabels = {
  couverture: 'Couverture · titre',
  colonnes: 'Texte + image large',
  image_haut: 'Texte + image verticale',
  comparaison: 'Texte + deux images côte à côte',
  images_superposees: 'Texte + deux images superposées',
  assemblage: 'Texte + assemblage',
  texte: 'Texte seul',
  affiche: 'Affiche d’évènement',
  fiche: 'Fiche pratique',
};
const displayTemplate = (layout) => layout === 'document_detail' ? 'comparaison' : layout;
const templateLabel = (layout) => templateLabels[displayTemplate(layout)];
const eventKeys = Object.keys(emptyEvent()).filter((key) => key !== 'missingFields');
const mediaFiles = new Map();
const mediaPreviews = new Map();
let bridgeStatusRequest = 0;
let emailDraftKey = '';
let state;
try {
  const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
  state = saved?.schema === 1 && saved.dossier && Array.isArray(saved.proposals) ? saved : emptyState();
} catch { state = emptyState(); }
let cloudRevision = Number(localStorage.getItem(storageKey + '-revision') || 0);
let cloudConflict = false;
let cloudSaveTimer;
let cloudSaving = false;
let cloudPending = false;
try {
  const response = await fetch('/api/session', {cache:'no-store',signal:AbortSignal.timeout(10000)});
  const saved = await response.json();
  if (!response.ok) throw new Error(saved.error || 'La sauvegarde en ligne est indisponible.');
  const pending = localStorage.getItem(storageKey + '-pending') === 'true';
  const sameDraft = pending && JSON.stringify(saved.state) === JSON.stringify(state);
  if (pending && !sameDraft && saved.revision !== cloudRevision) {
    showSessionConflict();
  } else {
    if (sameDraft) localStorage.removeItem(storageKey + '-pending');
    if (!pending && saved.state?.schema === 1 && Array.isArray(saved.state.proposals)) state = saved.state;
    cloudRevision = saved.revision;
    localStorage.setItem(storageKey + '-revision', String(cloudRevision));
  }
} catch (error) { $('cloud-save-status').textContent = error.message; }
state = separateDossiers(state);
let media = structuredClone(state.dossier.media || []);
const mediaUrls = new Map();
const rightsUrls = new Map();
let selectedVersion = state.manualDraft?.fromVersion ?? state.proposals.at(-1)?.number ?? 0;
let slideIndex = 0;
const session = createStudioSession();
let resetSnapshot = null;
let publishing = false;
const workspaceMedia = new Map();

async function refreshWordPressConnection(){
  const status=$('wordpress-connection-status');
  status.textContent='Vérification de la connexion WordPress…';
  try{
    const response=await fetch('/api/publication/status',{cache:'no-store',signal:AbortSignal.timeout(12000)});
    const result=await response.json();
    if(!response.ok)throw new Error(result.error||'Connexion indisponible.');
    status.textContent=result.connected?'WordPress est connecté. La validation publiera immédiatement.':result.reason==='missing'?'La connexion WordPress doit être configurée avant publication.':'La connexion WordPress doit être vérifiée par l’administrateur.';
    $('wordpress-setup').hidden=!studioAccess.canManageConnections||result.managed||result.connected;
  }catch{status.textContent='La connexion WordPress est momentanément indisponible.';}
}
async function refreshPublicationList(){
  const status=$('publications-status'),list=$('publications-list');
  status.textContent='Lecture des publications…';
  try{
    const response=await fetch('/api/publication/list',{cache:'no-store',signal:AbortSignal.timeout(10000)});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'Liste indisponible.');
    list.replaceChildren();
    for(const post of result.posts||[]){
      const item=document.createElement('li');
      const link=document.createElement('a');link.href=post.url;link.target='_blank';link.rel='noopener';link.textContent=(post.type==='evenement'?'Événement · ':'Récit · ')+post.title;
      const label=document.createElement('span');label.textContent=post.status==='publish'?' · En ligne':' · Dans la corbeille';
      item.append(link,label);
      if(post.status==='publish'){
        if (post.editable || state.draft?.wordpressPostId === post.post_id || state.otherDossier?.draft?.wordpressPostId === post.post_id) {
          const edit=document.createElement('button');edit.type='button';edit.className='button secondary';edit.textContent='Modifier dans le Studio';
          edit.addEventListener('click',()=>openPublishedDossier(post,edit));item.append(edit);
        }
        const button=document.createElement('button');button.type='button';button.className='button secondary';button.textContent='Retirer du site';
        button.addEventListener('click',()=>trashPublication(post.post_id));item.append(button);
      }else if(post.status==='trash'){
        const button=document.createElement('button');button.type='button';button.className='button secondary';button.textContent='Restaurer sur le site';
        button.addEventListener('click',async()=>{
          try{
            const response=await fetch('/api/publication/restore',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({postId:post.post_id,revision:cloudRevision})});
            const result=await response.json();if(!response.ok)throw new Error(result.error||'La restauration a échoué.');
            if(result.state){state=result.state;cloudRevision=result.revision;localStorage.setItem(storageKey,JSON.stringify(state));localStorage.setItem(storageKey+'-revision',String(cloudRevision));render();}
            await refreshPublicationList();feedback('Publication restaurée sur WordPress.');
          }catch(error){feedback(error.message,true);}
        });item.append(button);
      }
      list.append(item);
    }
    status.textContent=result.posts?.length?`${result.posts.length} publication(s) créées depuis le Studio.`:'Aucune publication créée depuis le Studio.';
  }catch(error){status.textContent=error.message;}
}

async function openPublishedDossier(post,button) {
  if (publishing) return;
  const type=post.type==='evenement'?'evenement':'recit';
  const target=contentType(state.dossier)===type?state:state.otherDossier;
  const openEditor=()=>{
    focusStep(type==='evenement'?'dossier-title':'card-editor-title');
    feedback(type==='evenement'?'Modifiez la saisie puis actualisez l’aperçu.':'Modifiez les cartes puis validez une nouvelle version.');
  };
  if (target?.draft?.wordpressPostId===post.post_id) {
    openEditorialWorkspace(type);
    openEditor();
    return;
  }
  if (hasIntake(target?.dossier || emptyState(type).dossier) && target.status!=='Publié') {
    feedback('Terminez le brouillon de cet atelier avant d’ouvrir une autre publication.',true);
    return;
  }
  button.disabled=true;
  try {
    const response=await fetch('/api/publication/dossier/'+post.post_id,{cache:'no-store',signal:AbortSignal.timeout(10000)});
    const result=await response.json();
    if (!response.ok) throw new Error(result.error || 'Le dossier source est indisponible.');
    if (publishing || target!==(contentType(state.dossier)===type?state:state.otherDossier)) return;
    openEditorialWorkspace(type);
    resetDossier();
    state={...result.state,otherDossier:state.otherDossier};
    media=structuredClone(state.dossier.media || []);
    selectedVersion=state.proposals.at(-1)?.number ?? 0;
    setForm();
    updateGaps();
    render();
    persist();
    void restoreSavedMedia();
    openEditor();
  } catch(error) {
    feedback(error.message,true);
  } finally {
    button.disabled=false;
  }
}

function syncGenerationControls() {
  const running = Boolean(session.active);
  form.querySelector('button[type="submit"]').disabled = running;
  $('save-revision').disabled = running;
  $('accept-revision').disabled = running;
  for (const id of ['archive']) $(id).disabled = running;
  if (state.proposals.length) updateProposalGaps({ ...currentProposal(), output: readOutput() });
  $('cancel-generation').hidden = !running;
  $('generation-help').hidden = !running;
  form.setAttribute('aria-busy', String(running));
}
function cancelGeneration(message = 'Attente annulée. Votre dossier et vos versions sont conservés.') {
  const isCreation = session.active?.kind === 'create';
  if (!session.cancel()) return;
  syncGenerationControls();
  feedback(message, false, isCreation ? 'compose-feedback' : 'message');
}
function discardResetUndo() {
  if (!resetSnapshot) return;
  const retained = new Set([...mediaUrls.values(), ...rightsUrls.values()]);
  for (const url of [...resetSnapshot.mediaUrls.values(), ...resetSnapshot.rightsUrls.values()]) {
    if (!retained.has(url)) URL.revokeObjectURL(url);
  }
  resetSnapshot = null;
  $('reset-notice').hidden = true;
}
function dossierEdited() {
  discardResetUndo();
  cancelGeneration('Le dossier a été modifié : l’attente précédente est annulée. Vous pouvez préparer une nouvelle proposition.');
}
function replaceMap(target, source) {
  target.clear();
  for (const [key, value] of source) target.set(key, value);
}
function resetDossier() {
  if (publishing) return;
  discardResetUndo();
  state.dossier = structuredClone(readDossier());
  resetSnapshot = {
    state: structuredClone(state), media: structuredClone(media),
    mediaFiles: new Map(mediaFiles), mediaPreviews: new Map(mediaPreviews),
    mediaUrls: new Map(mediaUrls), rightsUrls: new Map(rightsUrls),
    selectedVersion, slideIndex,
    confirmed: $('final-confirmation').checked,
    correction: $('correction-request').value,
  };
  session.invalidate();
  state = {...emptyState(contentType(state.dossier)),otherDossier:state.otherDossier}; media = []; selectedVersion = 0; slideIndex = 0;
  mediaFiles.clear(); mediaPreviews.clear(); mediaUrls.clear(); rightsUrls.clear();
  form.reset();
  $('final-confirmation').checked = false;
  $('correction-request').value = '';
  feedback('', false, 'compose-feedback');
  $('slide-frame').replaceChildren();
  $('dossier-details').open = false;
  setForm(); updateGaps(); render(); syncGenerationControls();
  $('reset-notice').hidden = false;
  feedback('Le dossier de cet atelier est prêt.');
  form.elements.sourceText.focus();
}
function undoReset() {
  if (!resetSnapshot) return;
  const previous = resetSnapshot;
  session.invalidate();
  state = previous.state; media = previous.media; selectedVersion = previous.selectedVersion;
  replaceMap(mediaFiles, previous.mediaFiles); replaceMap(mediaPreviews, previous.mediaPreviews);
  replaceMap(mediaUrls, previous.mediaUrls); replaceMap(rightsUrls, previous.rightsUrls);
  resetSnapshot = null;
  setForm(); updateGaps(); render(); syncGenerationControls();
  slideIndex = previous.slideIndex; if (state.proposals.length) renderSlide();
  $('final-confirmation').checked = previous.confirmed;
  $('correction-request').value = previous.correction;
  $('reset-notice').hidden = true;
  feedback('Dossier précédent restauré avec ses images et ses versions.');
}

function openEditorialWorkspace(type) {
  if (publishing) return;
  if (type !== contentType(state.dossier)) {
    discardResetUndo();
    session.invalidate();
    const {otherDossier, ...outgoing} = state;
    workspaceMedia.set(contentType(outgoing.dossier), {
      files:new Map(mediaFiles), previews:new Map(mediaPreviews), urls:new Map(mediaUrls), rights:new Map(rightsUrls),
    });
    state = {...(otherDossier ?? emptyState(type)),otherDossier:outgoing};
    const cached = workspaceMedia.get(type);
    replaceMap(mediaFiles,cached?.files || []);
    replaceMap(mediaPreviews,cached?.previews || []);
    replaceMap(mediaUrls,cached?.urls || []);
    replaceMap(rightsUrls,cached?.rights || []);
    workspaceMedia.delete(type);
    media = structuredClone(state.dossier.media || []);
    selectedVersion = state.manualDraft?.fromVersion ?? state.proposals.at(-1)?.number ?? 0;
    slideIndex = 0;
    form.reset();
    $('final-confirmation').checked = false;
    $('correction-request').value = state.correctionRequest || '';
    feedback('');
    feedback('', false, 'compose-feedback');
    setForm(); updateGaps({save:false}); render(); syncGenerationControls();
    void restoreSavedMedia();
  }
  mailingTab(type === 'evenement' ? 'event' : 'editor');
}

function persist() {
  try { localStorage.setItem(storageKey, JSON.stringify(state)); }
  catch { feedback('Le navigateur refuse le stockage local. La démonstration reste dans cette session.', true); }
  cloudPending = true;
  localStorage.setItem(storageKey + '-pending', 'true');
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(saveCloudSession, 500);
}
function showSessionConflict(focus = false) {
  cloudConflict = true;
  $('session-conflict').hidden = false;
  $('cloud-save-status').textContent = 'Vos modifications sont conservées dans cet onglet.';
  if (focus) focusStep('session-conflict-title');
}
async function saveCloudSession() {
  if (cloudSaving || !cloudPending || cloudConflict || publishing) return;
  cloudSaving = true;
  cloudPending = false;
  let saved = false;
  $('cloud-save-status').textContent = 'Enregistrement du dossier…';
  try {
    const response = await fetch('/api/session', {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:structuredClone(state),revision:cloudRevision}),signal:AbortSignal.timeout(10000)});
    const result = await response.json();
    if (!response.ok) {
      if (response.status===409) showSessionConflict();
      throw new Error(result.error || 'La sauvegarde en ligne a échoué.');
    }
    cloudRevision = result.revision;
    localStorage.setItem(storageKey + '-revision', String(cloudRevision));
    if (!cloudPending) localStorage.removeItem(storageKey + '-pending');
    $('cloud-save-status').textContent = 'Dossier et versions enregistrés dans votre espace privé.';
    saved = true;
  } catch (error) {
    cloudPending = true;
    $('cloud-save-status').textContent = error.message + ' Vos saisies restent dans ce navigateur.';
  } finally {
    cloudSaving = false;
    if (saved && cloudPending) void saveCloudSession();
  }
  return saved;
}
async function chooseSessionDraft(keepLocal) {
  if (!cloudConflict || publishing || cloudSaving) return;
  const buttons = [$('session-keep-local'),$('session-load-online')];
  buttons.forEach(button => button.disabled = true);
  try {
    const response = await fetch('/api/session',{cache:'no-store',signal:AbortSignal.timeout(10000)});
    const online = await response.json();
    if (!response.ok) throw new Error(online.error || 'Le brouillon en ligne est indisponible.');
    if (keepLocal) {
      if (!window.confirm('Enregistrer le brouillon de cet onglet à la place du brouillon en ligne ?')) return;
      cloudRevision = online.revision;
      cloudPending = true;
      cloudConflict = false;
      if (!await saveCloudSession() || cloudConflict) {
        showSessionConflict();
        return;
      }
      $('session-conflict').hidden = true;
      feedback('Brouillon repris. Vous pouvez le publier.');
    } else {
      if (!window.confirm('Charger le brouillon en ligne et abandonner les modifications de cet onglet ?')) return;
      localStorage.setItem(storageKey,JSON.stringify(online.state));
      localStorage.setItem(storageKey+'-revision',String(online.revision));
      localStorage.removeItem(storageKey+'-pending');
      location.reload();
    }
  } catch (error) {
    feedback(error.message,true);
  } finally {
    buttons.forEach(button => button.disabled = false);
  }
}
$('session-keep-local').addEventListener('click',()=>chooseSessionDraft(true));
$('session-load-online').addEventListener('click',()=>chooseSessionDraft(false));
async function uploadSavedMedia(id,file) {
  const response = await fetch('/api/media/' + encodeURIComponent(id), {method:'PUT',headers:{'Content-Type':file.type || 'image/svg+xml'},body:file});
  if(!response.ok) { const result=await response.json(); throw new Error(result.error || 'Image non enregistrée.'); }
}
async function restoreSavedMedia() {
  const epoch = session.epoch;
  const sources = new Map([...media,...state.proposals.flatMap(entry=>entry.basis.media||[])].map(item=>[item.id,item]));
  await Promise.all([...sources.values()].map(async item=>{
    try {
      const response=await fetch('/api/media/'+encodeURIComponent(item.id),{cache:'no-store',signal:AbortSignal.timeout(12000)});if(!response.ok)return;
      const blob=await response.blob();const file=new File([blob],item.name,{type:blob.type});const preview=await imagePreviewData(file);
      if(!session.isEpochCurrent(epoch)||mediaFiles.has(item.id))return;
      mediaFiles.set(item.id,file);mediaPreviews.set(item.id,preview);mediaUrls.set(item.id,URL.createObjectURL(file));
    } catch { /* Missing files remain visible as images to reattach. */ }
  }));
  if(!session.isEpochCurrent(epoch))return;
  renderMedia();
  updateGaps({save:false});
  if(state.proposals.length)render();
}
function feedback(message, error = false, id = 'message') {
  const target = $(id);
  target.textContent = message;
  target.classList.toggle('error', error);
  if (id === 'compose-feedback') target.hidden = !message;
}
function checkedTime(value) {
  const time = Date.parse(value);
  return Number.isFinite(time)
    ? ' Vérification à ' + new Intl.DateTimeFormat('fr-FR', {timeZone:'Europe/Paris',hour:'2-digit',minute:'2-digit'}).format(time) + '.'
    : '';
}
async function refreshBridgeStatus(signal) {
  const request = ++bridgeStatusRequest;
  let status = null;
  try {
    const response = await fetch('/api/status', { cache: 'no-store', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000) });
    if (response.ok) status = await response.json();
  } catch (error) { if (signal?.aborted) throw error; }
  if (signal?.aborted) throw new DOMException('Demande annulée.', 'AbortError');
  const ready = status?.connected === true && status.protocol === 4;
  if (request !== bridgeStatusRequest) return ready;
  const setup = status?.status === 'setup';
  const unavailable = setup
    ? (studioAccess.canManageConnections ? 'La connexion au modèle reste à configurer.' : 'L’administrateur doit configurer la connexion au modèle.')
    : 'Le modèle est momentanément indisponible.';
  const checked = checkedTime(status?.checkedAt);
  $('intake-status').textContent = (ready
    ? 'Modèle connecté. Vous pouvez composer une proposition à partir du texte et des aperçus des images.'
    : unavailable + ' Vos saisies et l’édition manuelle restent disponibles.') + checked;
  $('revision-connection').textContent = ready
    ? 'Le modèle est connecté. Vous pouvez envoyer une demande à l’IA.' + checked
    : unavailable + ' Vous pouvez modifier et enregistrer cette version à la main.' + checked;
  $('revision-connection-actions').hidden = ready;
  return ready;
}
function focusStep(id) {
  const target = $(id);
  target.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  target.focus({ preventScroll: true });
}
function focusManualEditor() { focusStep('card-editor-title'); }
function act(operation, success) {
  try {
    state = operation();
    selectedVersion = state.proposals.at(-1)?.number || 0;
    slideIndex = 0;
    persist();
    render();
    feedback(success);
    return true;
  } catch (error) { feedback(error.message, true); return false; }
}
function setForm() {
  for (const key of dossierFields) {
    form.elements[key].value = key === 'theme' && ['Patrimoine', 'Culture'].includes(state.dossier.theme)
      ? 'Récit' : state.dossier[key] || '';
  }
  form.elements.contentType.value = contentType(state.dossier);
  for (const key of eventKeys) form.elements['event_' + key].value = key === 'speakers' ? (state.dossier.event?.speakers || []).join('\n') : state.dossier.event?.[key] || '';
  form.elements.event_registrationMode.value = state.dossier.event?.registrationMode || (state.dossier.event?.registrationUrl ? 'external' : 'none');
  form.elements.usePhotos.checked = state.dossier.storyUsesPhotos ?? state.dossier.mediaMode === 'photos';
  eventPhotoId = state.dossier.eventImageId ?? publicationMedia(state.dossier)[0]?.id ?? null;
  visual.value = eventIcon(state.dossier) || (state.dossier.eventVisualMode ?? (eventPhotoId ? 'photo' : ''));
  updateContentType();
  renderMedia();
}
function readDossier() {
  const dossier = { ...state.dossier };
  for (const key of dossierFields) dossier[key] = ['title','sourceText'].includes(key) ? form.elements[key].value : form.elements[key].value.trim();
  dossier.contentType = form.elements.contentType.value;
  dossier.event = emptyEvent();
  for (const key of eventKeys) dossier.event[key] = key === 'speakers' ? form.elements['event_' + key].value.split('\n').map(name=>name.trim()).filter(Boolean) : form.elements['event_' + key].value;
  dossier.storyUsesPhotos = form.elements.usePhotos.checked;
  if (dossier.contentType === 'evenement') {
    dossier.theme = 'Événement';
    dossier.eventImageId = eventPhotoId;
    dossier.eventIcon = eventIcon({eventIcon:visual.value});
    dossier.eventVisualMode = visual.value;
    dossier.mediaMode = visual.value === 'photo' && eventPhotoId ? 'photos' : 'none';
  } else {
    dossier.mediaMode = media.length && dossier.storyUsesPhotos ? 'photos' : 'none';
  }
  dossier.media = structuredClone(media);
  return dossier;
}
function updateContentType() {
  const isEvent = form.elements.contentType.value === 'evenement';
  $('event-fields').hidden = !isEvent;
  for (const field of $('event-fields').querySelectorAll('input, textarea, select')) field.disabled = !isEvent;
  updateRegistrationField();
  $('story-photos-field').hidden = isEvent;
  $('event-visual-field').hidden = !isEvent;
  $('story-version-bar').hidden = isEvent;
  $('dossier-preview-button').textContent = isEvent ? 'Prévisualiser la page' : 'Générer l’aperçu';
  $('drop-zone').querySelector('strong').textContent = isEvent ? 'Glissez une image ici' : 'Glissez les images ici';
  $('drop-zone').querySelector('span').textContent = isEvent ? 'ou choisissez un fichier' : 'ou cliquez pour choisir une ou plusieurs images';
  $('drop-zone').setAttribute('aria-label',isEvent?'Choisir l’image de l’événement':'Glisser des images ou choisir des fichiers');
  $('media-files').multiple = !isEvent;
  $('media-files').accept = isEvent ? 'image/png,image/jpeg,image/webp' : 'image/png,image/jpeg,image/webp,image/svg+xml,.svg';
  $('intake-status').hidden = isEvent;
  $('story-templates').hidden = isEvent;
  if (isEvent) $('story-template-info').hidePopover?.();
  $('dossier-field-title').textContent = isEvent ? 'Titre de l’événement' : 'Titre du récit';
  $('story-title-help').hidden = isEvent;
  form.elements.title.placeholder = isEvent ? 'Conférence, rencontre, exposition…' : 'Le titre exact de la couverture';
  $('dossier-title').textContent = isEvent ? 'Nouvel évènement' : 'Nouveau récit';
  $('dossier-intro').textContent = isEvent ? 'Modifiez la description, les informations pratiques et le visuel dans ce formulaire.' : 'Collez le texte relu de votre récit. Ajoutez des images si vous en avez.';
  $('source-text-label').textContent = isEvent ? 'Texte ou programme de l’évènement' : 'Texte du récit';
  $('source-text-help').textContent = isEvent ? 'Vous pouvez aussi renseigner les informations pratiques ci-dessous.' : 'Le Studio propose jusqu’à 10 cartes, couverture comprise. Vous pourrez ensuite ajuster le découpage.';
  form.elements.sourceText.placeholder = isEvent ? 'Collez le programme, la description ou le texte de l’affiche.' : 'Collez votre récit ici.';
  if (form.elements.theme.value === '') form.elements.theme.value = 'Récit';
  updateEventVisual();
  renderWorkflow();
  updatePreviewVisibility();
}
function updateRegistrationField() {
  const external = form.elements.contentType.value === 'evenement' && form.elements.event_registrationMode.value === 'external';
  $('event-external-field').hidden = !external;
  form.elements.event_registrationUrl.disabled = !external;
}
function updateEventVisual() {
  const isEvent = form.elements.contentType.value === 'evenement';
  const icon = isEvent && eventIcon({eventIcon:visual.value});
  const iconPreview = $('event-icon-preview');
  iconPreview.hidden = !icon;
  if (icon) iconPreview.src = eventIconPreviewUrl(icon);
  $('drop-zone').hidden = isEvent && visual.value !== 'photo';
  $('media-count').hidden = isEvent && visual.value !== 'photo';
}
function updatePreviewVisibility() {
  const waitingForEvent = form.elements.contentType.value === 'evenement' &&
    currentProposal()?.output?.siteEvent !== true;
  $('studio-output').hidden = waitingForEvent && !state.draft;
  $('studio-review').hidden = waitingForEvent;
  $('studio-workspace').classList.toggle('event-workspace', waitingForEvent || currentProposal()?.output?.siteEvent === true);
}
function renderMedia() {
  const visible = form.elements.contentType.value === 'evenement'
    ? media.filter(item => visual.value === 'photo' && item.id === eventPhotoId)
    : media;
  const list = $('media-list');
  list.replaceChildren();
  $('media-section').hidden = visible.length === 0;
  visible.forEach((item) => {
    const row = document.createElement('div'); row.className = 'media-item';
    const thumb = document.createElement('div'); thumb.className = 'media-thumb';
    if (mediaUrls.has(item.id)) {
      const img = document.createElement('img'); img.src = mediaPreviews.get(item.id)?.dataUrl || mediaUrls.get(item.id); img.alt = '';
      thumb.append(img);
    } else thumb.textContent = 'Fichier à rattacher';
    const info = document.createElement('div'); info.className = 'media-info';
    const name = document.createElement('strong'); name.textContent = item.name;
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Retirer ce visuel';
    remove.addEventListener('click', () => {
      dossierEdited();
      if (mediaUrls.has(item.id)) URL.revokeObjectURL(mediaUrls.get(item.id));
      if (rightsUrls.has(item.id)) URL.revokeObjectURL(rightsUrls.get(item.id));
      mediaUrls.delete(item.id); rightsUrls.delete(item.id);
      mediaFiles.delete(item.id); mediaPreviews.delete(item.id);
      if (eventPhotoId === item.id) eventPhotoId = null;
      media = media.filter((entry) => entry.id !== item.id); renderMedia(); updateGaps();
      if (state.proposals.length) render();
    });
    info.append(name, remove);
    row.append(thumb, info); list.append(row);
  });
}
function renderPublicationImageMetadata(entry) {
  const group = $('publication-image-metadata');
  const list = $('publication-images');
  const images = entry ? publicationMedia(entry.basis) : [];
  group.hidden = images.length === 0;
  list.replaceChildren();

  for (const item of images) {
    const row = document.createElement('div');
    row.className = 'publication-image fields';
    const name = document.createElement('h3');
    name.textContent = item.name || 'Image';
    row.append(name);

    const labeled = (label, control) => {
      const field = document.createElement('label');
      field.append(document.createTextNode(label), control);
      return field;
    };
    const update = (key, value) => {
      item[key] = value;
      const source = media.find(image => image.id === item.id);
      if (source) source[key] = value;
      const compositionImage = entry.output.composition?.medias.find(image => image.id === item.id);
      if (compositionImage && key === 'credit') compositionImage.credit = value || null;
      if (compositionImage && key === 'rights') compositionImage.droits = value || null;
      updateGaps();
      renderWordPressPreview(entry);
      if (entry.output.contentType === 'recit') renderSlide();
    };

    const credit = document.createElement('input');
    credit.type = 'text';
    credit.placeholder = 'Auteur, organisme et provenance';
    credit.value = item.credit || '';
    credit.addEventListener('input', () => update('credit', credit.value));

    const rights = document.createElement('select');
    const rightsOptions = ['', 'à vérifier', 'confirmés', 'non utilisable'];
    if (item.rights && !rightsOptions.includes(item.rights)) rightsOptions.push(item.rights);
    for (const value of rightsOptions) rights.add(new Option(value || 'Non renseignés', value));
    rights.value = item.rights || '';
    rights.addEventListener('change', () => update('rights', rights.value));

    const evidence = document.createElement('input');
    evidence.type = 'text';
    evidence.placeholder = 'URL de licence, référence ou autorisation datée';
    evidence.value = item.rightsEvidence || '';
    evidence.addEventListener('input', () => update('rightsEvidence', evidence.value));

    const proofStatus = document.createElement('p');
    proofStatus.className = 'proof-status';
    const renderProof = () => {
      if (rightsUrls.has(item.id)) {
        const link = document.createElement('a');
        link.href = rightsUrls.get(item.id);
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = 'Voir le justificatif : ' + item.rightsFileName;
        proofStatus.replaceChildren(link);
      } else if (item.rightsFileName) {
        proofStatus.textContent = 'Justificatif « ' + item.rightsFileName + ' » à rattacher après rechargement.';
      }
    };
    const proofFile = document.createElement('input');
    proofFile.type = 'file';
    proofFile.accept = '.pdf,.png,.jpg,.jpeg,.webp,.txt';
    proofFile.addEventListener('change', () => {
      const file = proofFile.files?.[0];
      if (!file) return;
      if (rightsUrls.has(item.id)) URL.revokeObjectURL(rightsUrls.get(item.id));
      rightsUrls.set(item.id, URL.createObjectURL(file));
      update('rightsFileName', file.name);
      renderProof();
    });
    renderProof();
    row.append(
      labeled('Crédit et provenance', credit),
      labeled('Droits d’utilisation', rights),
      labeled('Référence de licence ou d’autorisation', evidence),
      labeled('Joindre un justificatif (session locale)', proofFile),
      proofStatus,
    );
    list.append(row);
  }
}
function updateGaps({save=true}={}) {
  const dossier = readDossier();
  state.dossier = structuredClone(dossier);
  if (save) persist();
  if (dossier.contentType === 'evenement') {
    $('media-count').textContent = eventPhotoId ? 'Ajouter un fichier remplace l’image de cet événement.' : 'Choisissez une image.';
    if (currentProposal()?.output?.siteEvent) {
      if (eventPreviewOutdated(currentProposal())) $('final-confirmation').checked = false;
      updateProposalGaps(currentProposal());
    }
    return;
  }
  $('media-count').textContent = media.length
    ? media.length + ' image' + (media.length > 1 ? 's' : '') + ' déposée' + (media.length > 1 ? 's' : '') + (dossier.mediaMode === 'photos' ? (media.length > 1 ? ', disponibles pour la proposition visuelle. ' : ', disponible pour la proposition visuelle. ') : ', non retenue' + (media.length > 1 ? 's' : '') + ' pour la proposition. ')
    : 'Aucune image déposée. Les fichiers ne sont pas envoyés.';
}
function eventPreviewOutdated(entry) {
  return entry.output.siteEvent && !eventPreviewMatches(entry.basis,state.dossier);
}
function currentProposal() { return state.proposals.find((entry) => entry.number === selectedVersion) || state.proposals.at(-1); }
function canonicalOutput(entry = currentProposal()) {
  if (!entry) return {};
  if (entry.output.siteEvent) return entry.output;
  if (!entry.output.composition) entry.output = { ...entry.output, ...compositionToLegacy(ensureComposition(entry.output, entry.basis), entry.basis) };
  return entry.output;
}
function currentComposition() { return readOutput().composition; }
function selectedCard() { return currentComposition()?.cartes?.[slideIndex]; }
function pendingRevision() {
  // Keep the stored field name so drafts saved before this update still open.
  const draft = state.manualDraft;
  return draft && draft.fromVersion === currentProposal()?.number ? draft : null;
}
function stageRevision(output, request = pendingRevision()?.request) {
  state.manualDraft = { fromVersion: currentProposal().number, output, request };
}
function nextBaseVersion() { return 'base-' + newMediaId(); }
function cardTexts(comp, card) {
  const texts = new Map((comp?.textes || []).map((block) => [block.id, block]));
  const blocks = (card?.blocs || []).map((id) => texts.get(id)).filter(Boolean);
  const join = (role) => blocks.filter((block) => (block.role === 'titre') === (role === 'titre')).map((block, index, list) => block.texte + (index < list.length - 1 ? block.separateur || '' : '')).join('');
  return { title: join('titre'), body: join('corps') };
}
function compositionDiff(previous, next) {
  if (!previous) return [];
  const changes = [];
  const before = new Map(previous.cartes.map((card) => [card.id, card]));
  const after = new Set(next.cartes.map((card) => card.id));
  next.cartes.forEach((card, index) => {
    const old = before.get(card.id); const label = 'Carte ' + (index + 1);
    if (!old) { changes.push(label + ' ajoutée.'); return; }
    if (previous.cartes.findIndex((item) => item.id === card.id) !== index) changes.push(label + ' déplacée.');
    if (JSON.stringify(cardTexts(previous, old)) !== JSON.stringify(cardTexts(next, card))) changes.push(label + ' : texte modifié.');
    if (old.gabarit !== card.gabarit) changes.push(label + ' : mise en page ' + old.gabarit + ' → ' + card.gabarit + '.');
    if (old.fond !== card.fond) changes.push(label + ' : fond modifié.');
    if ((old.relief ?? 'simple') !== (card.relief ?? 'simple')) changes.push(label + ' : relief du texte modifié.');
    if (JSON.stringify(old.medias) !== JSON.stringify(card.medias)) changes.push(label + ' : images, ordre ou cadrage modifiés.');
    if (JSON.stringify(old.champs) !== JSON.stringify(card.champs)) changes.push(label + ' : informations pratiques modifiées.');
  });
  for (const card of previous.cartes) if (!after.has(card.id)) changes.push('Carte retirée : ' + (cardTexts(previous, card).title || card.id) + '. Son texte reste dans le dossier.');
  if (JSON.stringify(previous.pratique) !== JSON.stringify(next.pratique)) changes.push('Informations pratiques mises à jour.');
  return changes;
}
function savePendingRevision() {
  const draft = pendingRevision();
  if (!draft || session.active) return;
  const issues = manualCompositionIssues(draft.output.composition);
  const error = $('revision-validation-error');
  error.textContent = issues.join(' ');
  error.hidden = !issues.length;
  if (issues.length) return;
  const previous = currentProposal();
  const output = structuredClone(draft.output);
  const request = draft.request || 'Retouches manuelles depuis V' + previous.number;
  const number = (state.proposals.at(-1)?.number || 0) + 1;
  const basis = structuredClone(previous.basis);
  if (output.contentType === 'evenement') basis.event = { ...emptyEvent(), ...structuredClone(output.event || {}) };
  const entry = { number, at: new Date().toISOString(), basis, output, request, diff: compositionDiff(canonicalOutput(previous).composition, output.composition) };
  state.proposals.push(entry); state.status = 'Proposition'; delete state.manualDraft;
  state.history.push({ status: state.status, at: entry.at, note: 'V' + number + ' · ' + request });
  selectedVersion = number;
  $('final-confirmation').checked = false;
  persist();
  render();
  $('version-select').focus({ preventScroll: true });
  feedback('Modifications validées dans la version V' + number + '.');
}
function manualEdit(transform, rerenderEditor = false) {
  const entry = currentProposal(); if (!entry) return;
  cancelGeneration('Vous avez modifié la version : la réponse en attente sera ignorée.');
  discardResetUndo();
  try {
    const comp = transform(structuredClone(currentComposition()));
    comp.base_version = nextBaseVersion(); comp.retours = []; comp.operations = [];
    stageRevision(compositionToLegacy(comp, entry.basis));
    $('revision-validation-error').hidden = true;
    persist(); renderSlide(); renderVersionFeedback();
    if (rerenderEditor) renderCardEditor();
    renderEventOutput({ ...entry, output: readOutput() });
    renderWordPressPreview({ ...entry, output: readOutput() });
    updateProposalGaps({ ...entry, output: readOutput() });
    const issues = manualCompositionIssues(comp);
    showCardEditIssues(issues);
  } catch (error) { feedback('Modification non appliquée : ' + error.message, true); renderCardEditor(); }
}
function manualCompositionIssues(comp) {
  const issues=comp.cartes.flatMap((card,index) => {
    const [min,max]=MEDIA_COUNTS[card.gabarit];
    if (card.medias.length>=min && card.medias.length<=max) return [];
    const count=min===max?String(min):min+' à '+max;
    return ['Carte '+(index+1)+' · '+templateLabel(card.gabarit)+' demande '+count+' image(s). Ajustez les images ou le gabarit.'];
  });
  try { validateCompositionState(comp,{allowIncompleteContent:true,allowUnavailableMedia:true}); }
  catch(error){if(!issues.length)issues.push(error.message);}
  return issues;
}
function preserveCompositionAlerts(previous, next) {
  if (!previous) return next;
  const alive = new Set([...next.cartes.map((item)=>item.id),...next.textes.map((item)=>item.id),...next.medias.map((item)=>item.id)]);
  const oldIds = new Set([...previous.cartes.map((item)=>item.id),...previous.textes.map((item)=>item.id),...previous.medias.map((item)=>item.id)]);
  const received = new Set(next.alertes.map((alert)=>alert.code+'|'+alert.cible));
  const retained = previous.alertes.filter((alert)=>{
    const target=String(alert.cible||'').replace(/^(?:carte|texte|media):/,'').split('/')[0];
    return (!oldIds.has(target)||alive.has(target))&&!received.has(alert.code+'|'+alert.cible);
  });
  return { ...next, alertes:[...retained,...next.alertes] };
}
function updateProposalGaps(entry) {
  const versionGaps = dossierGaps({ ...entry.basis, event: entry.output.event || entry.basis.event });
  const missingPhotos = contentType(entry.basis) === 'evenement'
    ? publicationMedia(entry.basis).some(item => !mediaUrls.has(item.id))
    : proposalSlides(entry).some(slide => slide.mediaItems.some(item => !mediaUrls.has(item.id)));
  const note = $('validation-gaps');
  const outdated = eventPreviewOutdated(entry);
  note.textContent = outdated ? 'La saisie a changé. Actualisez l’aperçu avant de publier.' : versionGaps.length
    ? 'Informations manquantes dans cette proposition (' + versionGaps.join(', ') + '). Complétez-la avant de continuer.'
    : missingPhotos ? 'Rattachez les photos de cette version avant de publier.'
    : '';
  note.hidden = !note.textContent;
  const blocked = Boolean(pendingRevision()) || versionGaps.length > 0 || missingPhotos || outdated;
  $('validate').disabled = publishing || Boolean(session.active) || blocked;
  $('validate').textContent = state.draft?.wordpressStatus==='publish' ? 'Valider et mettre à jour sur le site' : 'Valider et publier sur le site';
}
function readOutput() {
  return pendingRevision()?.output ?? canonicalOutput();
}
function renderEventOutput(entry) {
  const isEvent = (entry.output.contentType || contentType(entry.basis)) === 'evenement';
  $('event-output').hidden = !isEvent;
  $('preview-label').textContent = isEvent ? 'APERÇU · AFFICHE ET FICHE' : 'APERÇU · RÉCIT';
  const details = $('event-output-details'); details.replaceChildren();
  if (isEvent) {
    for (const [label, value] of eventDetails(entry.output.event || entry.basis.event)) {
      const term = document.createElement('dt'); term.textContent = label;
      const description = document.createElement('dd'); description.textContent = value;
      details.append(term, description);
    }
    if (!details.children.length) { const empty = document.createElement('dd'); empty.textContent = 'Informations pratiques à compléter.'; details.append(empty); }
  }
  const checks = $('proposal-checks'); checks.replaceChildren();
  const messages = [...(Array.isArray(entry.output.checks) ? entry.output.checks : []), ...(entry.output.composition?.alertes || []).map((alert) => alert.message), ...(entry.output.event?.missingFields || []).map((field) => 'À compléter : ' + field)];
  if (messages.length) {
    const title = document.createElement('strong'); title.textContent = 'Points à relire';
    const list = document.createElement('ul');
    [...new Set(messages)].forEach((message) => { const item = document.createElement('li'); item.textContent = message; list.append(item); });
    checks.append(title, list);
  }
  checks.hidden = !messages.length;
}
function renderRevisionControls(entry) {
  const pending = Boolean(pendingRevision());
  $('revision-notice').hidden = !pending;
  $('version-select').disabled = pending;
  const isLatest = Boolean(entry && entry.number === state.proposals.at(-1)?.number);
  $('validation-panel').hidden = pending || !isLatest || !['Proposition', 'Prêt à valider'].includes(state.status);
  $('draft-panel').hidden = pending || !state.draft;
  $('archive').hidden = pending || !state.draft;
  return pending;
}
function renderVersionFeedback() {
  const entry = currentProposal(); const comp = currentComposition();
  const pending = renderRevisionControls(entry);
  $('revision-basis').textContent = 'Base : V' + entry.number + (pending ? ' avec les modifications affichées.' : '.') + ' Carte affichée : ' + (slideIndex + 1) + '.';
  const labels = { appliquee:'Appliquée', deja_satisfaite:'Déjà satisfaite', a_preciser:'À préciser', impossible:'Impossible', contradictoire:'Contradictoire', en_attente:'En attente' };
  const list = $('instruction-feedback-list'); list.replaceChildren();
  for (const retour of comp?.retours || []) {
    const item = document.createElement('li'); item.className = 'instruction-' + retour.etat;
    const tag = document.createElement('strong'); tag.textContent = labels[retour.etat] || retour.etat;
    item.append(tag, document.createTextNode(' · ' + retour.message));
    if (retour.cibles?.length) { const targets = document.createElement('small'); targets.textContent = retour.cibles.join(', '); item.append(targets); }
    list.append(item);
  }
  $('instruction-feedback').hidden = !list.children.length;
  const changes = pending ? compositionDiff(canonicalOutput(entry).composition, comp) : entry.diff || [];
  const diff = $('composition-diff-list'); diff.replaceChildren();
  for (const message of changes) { const li = document.createElement('li'); li.textContent = message; diff.append(li); }
  $('composition-diff').hidden = !changes.length;
}
function selectOptions(control, values, value) {
  control.replaceChildren();
  for (const [key, label] of values) { const option = document.createElement('option'); option.value = key; option.textContent = label; control.append(option); }
  control.value = value;
}
function unusedCardImages(comp) {
  const identity = id => mediaPreviews.get(id)?.dataUrl ?? id;
  const placed = new Set(comp.cartes.flatMap(card => card.medias.map(item => identity(item.media_id))));
  return comp.medias.filter(item => item.admis !== false && !placed.has(identity(item.id)));
}
function showCardEditIssues(issues) {
  const help = $('card-edit-help');
  help.textContent = issues.join(' ');
  help.hidden = !issues.length;
}
function renderCardEditor() {
  const comp = currentComposition(); const card = selectedCard(); if (!card) return;
  const copy = cardTexts(comp, card);
  selectOptions($('card-select'), comp.cartes.map((item,index) => [String(index), 'Carte ' + (index + 1) + ' · ' + (cardTexts(comp,item).title || templateLabel(item.gabarit))]), String(slideIndex));
  $('card-title').value = copy.title; $('card-body').value = copy.body;
  $('card-body').disabled=comp.type==='recit' && slideIndex===0;
  $('card-body-help').textContent = $('card-body').disabled
    ? 'La couverture contient uniquement le titre, modifiable ci-dessus. Choisissez une autre carte pour modifier le texte du récit.'
    : 'L’IA conserve vos modifications du texte sauf si vous lui demandez de le réécrire.';
  const layouts = comp.type === 'evenement' || slideIndex === 0 ? [card.gabarit] : STORY_GABARITS.filter(layout => layout !== 'couverture');
  selectOptions($('card-layout'), layouts.map(layout => [layout === 'comparaison' && card.gabarit === 'document_detail' ? card.gabarit : layout, templateLabel(layout)]), card.gabarit);
  $('card-background').value = card.fond ?? '';
  $('card-relief-field').hidden = comp.type !== 'recit' || card.gabarit === 'couverture';
  $('card-relief').value = card.relief ?? 'simple';
  $('card-move-up').disabled = comp.type==='evenement' || slideIndex <= 1; $('card-move-down').disabled = comp.type==='evenement' || slideIndex === 0 || slideIndex === comp.cartes.length - 1;
  $('card-remove').disabled = comp.type==='evenement' || slideIndex === 0 || comp.cartes.length < 3;
  $('card-add').disabled=comp.type==='evenement';
  const list = $('card-media-list'); list.replaceChildren();
  const lookup = new Map(comp.medias.map((item) => [item.id,item]));
  (card.medias || []).forEach((placement,index) => {
    const row = document.createElement('div'); row.className = 'placement-editor';
    const head = document.createElement('div'); head.className = 'placement-head';
    const name = document.createElement('strong'); name.textContent = (index + 1) + '. ' + (lookup.get(placement.media_id)?.nom || placement.media_id); head.append(name);
    const action = (label, fn, disabled = false) => { const button=document.createElement('button');button.type='button';button.textContent=label;button.disabled=disabled;button.addEventListener('click',fn);return button; };
    const update = (fn) => manualEdit((next) => { const selected=next.cartes[slideIndex]; selected.medias=fn(selected.medias); return next; },true);
    head.append(action('↑',()=>update((items)=>{[items[index-1],items[index]]=[items[index],items[index-1]];return items;}),index===0),action('↓',()=>update((items)=>{[items[index+1],items[index]]=[items[index],items[index+1]];return items;}),index===card.medias.length-1),action('Retirer',()=>update((items)=>items.filter((_,i)=>i!==index))));
    row.append(head);
    const controls = document.createElement('div'); controls.className='placement-fields';
    for (const [key,label,options] of [
      ['role','Rôle',[['archive','Archive'],['portrait','Portrait'],['carte','Carte'],['symbole','Symbole'],['lieu','Lieu'],['oeuvre','Œuvre'],['detail','Détail'],['contexte','Contexte']]],
      ['fit','Cadrage',[['contain','Entier · sans recadrage'],['cover','Remplir · recadrage']]],
      ['taille','Taille',[['normale','Normale'],['reduite','Réduite']]],
    ]) {
      const field=document.createElement('label');field.textContent=label;const select=document.createElement('select');selectOptions(select,options,placement[key] || options[0][0]);
      select.addEventListener('change',()=>update((items)=>items.map((item,i)=>i===index?{...item,[key]:select.value}:item)));field.append(select);controls.append(field);
    }
    row.append(controls);list.append(row);
  });
  const available = unusedCardImages(comp);
  selectOptions($('card-add-media'), [['','Choisir une image…'],...available.map((item)=>[item.id,item.nom])], '');
  $('card-add-media-button').disabled=!available.length || card.medias.length >= (['couverture','affiche','fiche'].includes(card.gabarit)?1:3);
  const issues = manualCompositionIssues(comp);
  showCardEditIssues(issues);
  $('card-practical-editor').hidden=comp.type!=='evenement';
  const practicalFields=$('card-practical-fields');practicalFields.replaceChildren();
  if(comp.type==='evenement') for(const [key,label] of Object.entries(practicalLabels)){
    const field=document.createElement('label');field.textContent=label;
    const input=document.createElement('input');input.value=comp.pratique.find((item)=>item.cle===key)?.valeur || '';
    input.addEventListener('input',()=>manualEdit((next)=>editCompositionCard(next,next.cartes[slideIndex].id,{pratique:{[key]:input.value}})));
    field.append(input);practicalFields.append(field);
  }
  renderVersionFeedback();
}
function renderCardFrame(frame, comp, card, position, empty = false) {
  const story = comp.type === 'recit';
  const copyText = cardTexts(comp, card);
  frame.replaceChildren();
  frame.className='slide-frame '+(card.gabarit==='couverture'?'cover':'story')+' background-'+(card.fond ?? CARD_BACKGROUNDS[position%2])+' layout-'+card.gabarit;
  if (story) frame.classList.add('story-template', 'template-' + displayTemplate(card.gabarit));
  const brand=document.createElement('span');brand.className='slide-logo';brand.textContent='Héritage Libanais';
  const index=document.createElement('span');index.className='slide-index';index.textContent=empty?'— / —':String(position+1).padStart(2,'0')+' / '+String(comp.cartes.length).padStart(2,'0');
  const copy=document.createElement('div');copy.className='slide-copy';
  if (!story) {
    const kicker=document.createElement('span');kicker.className='slide-label';kicker.textContent=card.gabarit==='fiche'?'Informations pratiques':'Nos rencontres';copy.append(kicker);
  }
  if (empty) {
    const placeholder=document.createElement('span');placeholder.className='template-empty-box';
    placeholder.textContent=card.gabarit==='couverture'?'Titre':'Texte';copy.append(placeholder);
  }
  const relief = story && card.gabarit !== 'couverture' ? card.relief : null;
  if(copyText.title){const title=document.createElement('h3');title.textContent=copyText.title;if(relief==='intertitre')title.classList.add('slide-intertitle');copy.append(title);}
  if (copyText.body) {
    const accented = relief === 'filet' || relief === 'intertitre';
    const body = document.createElement(accented ? 'div' : 'p');
    body.className = 'slide-body';
    if (accented) {
      const heading = relief === 'intertitre' && !copyText.title ? copyText.body.match(/^([^\r\n]{1,82})\r?\n+/) : null;
      if (heading && !/[.!?]$/.test(heading[1].trim())) {
        const title = document.createElement('p');
        title.className = 'slide-intertitle';
        title.textContent = heading[1];
        body.append(title);
      }
      if (relief === 'filet') body.classList.add('slide-body-filet');
      const passage = body.children.length ? copyText.body.slice(heading[0].length) : copyText.body;
      for (const part of passage.split(/(?:\r?\n[\t ]*){2,}/)) {
        const paragraph = document.createElement('p');
        paragraph.textContent = part;
        body.append(paragraph);
      }
    } else body.textContent = copyText.body;
    copy.append(body);
  }
  if(card.champs?.length){
    const fields=document.createElement('dl');fields.className='slide-practical';
    const normalise=(value)=>String(value).toLocaleLowerCase('fr').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/(\d{1,2})\s*[h:]\s*(\d{2})/g,'$1$2').replace(/[^\p{L}\p{N}@.]+/gu,' ').trim();
    const visibleText=normalise(copyText.title+' '+copyText.body);
    for(const key of card.champs){const field=comp.pratique.find((item)=>item.cle===key);if(!field?.valeur||visibleText.includes(normalise(field.valeur)))continue;const term=document.createElement('dt');term.textContent=practicalLabels[key]||key;const value=document.createElement('dd');value.textContent=Array.isArray(field.valeur)?field.valeur.join(', '):field.valeur;fields.append(term,value);}if(fields.children.length)copy.append(fields);
  }
  const lookup=new Map(comp.medias.map((item)=>[item.id,item]));
  const [minImages,maxImages]=story?MEDIA_COUNTS[card.gabarit]:[0,3];
  const placements=card.medias.slice(0,maxImages);
  while(placements.length<minImages) placements.push({role:'contexte',taille:'normale'});
  if(placements.length){
    const gallery=document.createElement('div');gallery.className='slide-gallery count-'+placements.length;
    placements.forEach((placement,itemIndex)=>{
      const item=lookup.get(placement.media_id);const figure=document.createElement('figure');figure.className='media-role-'+placement.role+' media-size-'+placement.taille;
      if(empty||!placement.media_id){const placeholder=document.createElement('span');placeholder.className='template-empty-box';placeholder.textContent='Image';figure.append(placeholder);}
      else if(mediaUrls.has(placement.media_id)){const photo=document.createElement('img');photo.className='slide-photo';photo.src=mediaUrls.get(placement.media_id);photo.alt=placement.alt||item?.nom||'';photo.style.objectFit=placement.fit||'contain';photo.style.objectPosition='center';figure.append(photo);}
      else{const missing=document.createElement('span');missing.className='slide-missing-photo';missing.textContent='Visuel à rattacher : '+(item?.nom||placement.media_id);figure.append(missing);}
      if(item?.credit){const credit=document.createElement('figcaption');credit.textContent=item.credit;figure.append(credit);}
      if(card.gabarit==='assemblage'&&itemIndex){const plus=document.createElement('span');plus.className='media-plus';plus.textContent='+';figure.prepend(plus);}gallery.append(figure);
    });frame.append(gallery);
  }
  frame.append(brand,index,copy);
}
function renderStoryTemplates() {
  const list = $('story-template-list');
  const comp = { type: 'recit', textes: [], medias: [], cartes: [] };
  const resize = new ResizeObserver(entries => {
    for (const { target } of entries) {
      if (target.clientWidth) target.firstElementChild.style.setProperty('--preview-scale', String(target.clientWidth / 1080));
    }
  });
  for (const [position, gabarit] of STORY_GABARITS.entries()) {
    const sample = document.createElement('figure');
    const stage = document.createElement('div');
    stage.className = 'slide-stage';
    stage.setAttribute('aria-hidden', 'true');
    const frame = document.createElement('div');
    const caption = document.createElement('figcaption');
    caption.textContent = templateLabel(gabarit);
    const count = gabarit === 'assemblage' ? 3 : MEDIA_COUNTS[gabarit][0];
    const medias = Array.from({ length: count }, () => ({ role: 'contexte', taille: 'normale' }));
    renderCardFrame(frame, comp, { gabarit, blocs: [], medias, champs: [] }, position, true);
    stage.append(frame);
    sample.append(stage, caption);
    list.append(sample);
    resize.observe(stage);
  }
}
function renderSlide() {
  const comp=currentComposition(); const frame=$('slide-frame');
  if (!comp?.cartes?.length) { frame.replaceChildren(); return; }
  slideIndex=Math.max(0,Math.min(slideIndex,comp.cartes.length-1));
  const card=comp.cartes[slideIndex];
  renderCardFrame(frame, comp, card, slideIndex);
  $('visual-direction').textContent='Gabarit : '+templateLabel(card.gabarit)+'.';
  $('slide-counter').textContent=(slideIndex+1)+' / '+comp.cartes.length;
  $('slide-prev').disabled=slideIndex<=0;$('slide-next').disabled=slideIndex>=comp.cartes.length-1;
  fitSlidePreview();
}
function fitSlidePreview() {
  const stage=$('slide-stage'),frame=$('slide-frame');
  if(!stage.clientWidth||!frame.children.length)return;
  frame.style.setProperty('--preview-scale',String(stage.clientWidth/1080));
  const copy=frame.querySelector('.slide-copy'),gallery=frame.querySelector('.slide-gallery');
  const fixed=frame.classList.contains('story-template');
  if(gallery&&!fixed) gallery.style.height=Math.max(160,Math.min(420,1350-104-72-copy.scrollHeight-32))+'px';
  const dense=fixed ? copy.scrollHeight>copy.clientHeight+2 : frame.scrollHeight>1352 || [copy,gallery].some(element=>element&&element.offsetTop+element.offsetHeight>1279);
  $('slide-fit-warning').textContent=dense?'Cette carte est trop chargée. Répartissez son texte sur une autre carte.':'';
}
const practicalLabels={titre_affiche:'Titre de l’affiche',date_debut:'Date de début',date_fin:'Date de fin',heure_debut:'Heure de début',heure_fin:'Heure de fin',fuseau:'Fuseau horaire',lieu:'Lieu',adresse:'Adresse',ville:'Ville',intervenants:'Intervenants',inscription:'Modalités d’inscription',lien_inscription:'Lien d’inscription',tarif:'Tarif',contact:'Contact'};

function renderWorkflow() {
  const labels = ['Saisie', 'Aperçu', 'Publication'];
  const current = [0, 1, 1, 2][workflowStepIndex(state.status)];
  $('current-status').textContent = state.status === 'Archivé' ? 'Dossier archivé' : labels[current];
  const steps = $('steps'); steps.replaceChildren();
  labels.forEach((label, index) => {
    const li = document.createElement('li');
    li.className = index === current ? 'current' : index < current ? 'done' : '';
    if (index === current) li.setAttribute('aria-current', 'step');
    const number = document.createElement('span'); number.textContent = String(index + 1).padStart(2, '0');
    li.append(number, document.createTextNode(label)); steps.append(li);
  });
}
function render() {
  renderWorkflow();
  updatePreviewVisibility();
  $('proposal-empty').hidden = state.proposals.length > 0;
  $('proposal-area').hidden = state.proposals.length === 0;
  if (state.proposals.length) {
    const select = $('version-select'); select.replaceChildren();
    state.proposals.forEach((entry) => {
      const option = document.createElement('option'); option.value = entry.number; option.textContent = 'V' + entry.number; select.append(option);
    });
    if (!state.proposals.some((item) => item.number === selectedVersion)) selectedVersion = state.proposals.at(-1).number;
    select.value = String(selectedVersion);
    const entry = currentProposal();
    canonicalOutput(entry);
    $('version-date').textContent = new Date(entry.at).toLocaleString('fr-FR');
    $('version-request').hidden = !entry.request;
    $('version-request').textContent = entry.request ? 'Demande ayant conduit à cette version : ' + entry.request : '';
    const displayed = { ...entry, output: readOutput() };
    updateProposalGaps(displayed);
    renderWordPressPreview(displayed);
    const siteEvent = displayed.output.siteEvent === true;
    $('review-title').textContent = siteEvent ? 'Aperçu sur le site' : 'Aperçu';
    $('review-help').textContent = siteEvent
      ? 'Relisez la page de l’événement. Modifiez-la depuis la saisie.'
      : 'Relisez les cartes et modifiez directement leurs textes, images et mise en page. L’aperçu se met à jour immédiatement.';
    if (siteEvent) $('site-preview').open = true;
    $('card-workbench').hidden = siteEvent;
    renderEventOutput(displayed);
    if (siteEvent) {
      $('event-output').hidden = true;
      $('visual-direction').textContent = '';
      $('instruction-feedback').hidden = true;
      $('composition-diff').hidden = true;
      renderRevisionControls(entry);
    } else {
      renderSlide();
      renderCardEditor();
    }
  } else {
    $('review-title').textContent = 'Aperçu';
    $('review-help').textContent = 'Relisez les cartes et modifiez directement leurs textes, images et mise en page. L’aperçu se met à jour immédiatement.';
    $('version-select').replaceChildren();
    $('version-date').textContent = '';
    renderRevisionControls();
  }
  renderPublicationImageMetadata(currentProposal());
  $('revision-validation-error').hidden = true;
  if (state.draft) {
    const draft = state.draft;
    if (emailDraftKey !== draft.validatedAt) {
      emailDraftKey = draft.validatedAt;
      $('email-title').value = draft.title || '';
      $('email-intro').value = draft.summary || '';
      $('email-url').value = draft.wordpressUrl || '';
      $('email-preview-status').textContent = '';
      $('email-preview-panel').hidden = true;
    }
    $('card-theme').textContent = draft.contentType === 'evenement' ? 'Évènement' : draft.theme;
    $('card-meta').textContent = draft.contentType === 'evenement' ? [draft.event?.startDate, draft.event?.startTime, draft.event?.venue].filter(Boolean).join(' · ') : [draft.theme, draft.place, draft.date].filter(Boolean).join(' · ');
    $('draft-card-title').textContent = draft.title;
    $('card-summary').textContent = draft.summary;
    const live = draft.wordpressStatus === 'publish';
    $('wordpress-status').textContent = live ? 'PUBLIÉ SUR WORDPRESS' : 'RETIRÉ DU SITE';
    $('wordpress-link').hidden = !live;
    $('wordpress-link').href = live ? draft.wordpressUrl : '#';
    $('prepare-mailing').hidden = !live;
    $('wordpress-trash').hidden = !live;
    $('draft-details').textContent = 'Version V' + draft.version + ' · Validée par ' + draft.reviewer + ' · ' + (live ? 'Article n°' + draft.wordpressPostId + ' publié.' : 'Article placé dans la corbeille WordPress.');
  }
  const history = $('history-list'); history.replaceChildren();
  state.history.slice().reverse().forEach((event) => {
    const li = document.createElement('li');
    const strong = document.createElement('strong'); strong.textContent = event.status;
    const time = document.createElement('time'); time.dateTime = event.at; time.textContent = new Date(event.at).toLocaleString('fr-FR');
    li.append(strong, document.createTextNode(event.note + ' · '), time); history.append(li);
  });
}
function renderWordPressPreview(entry) {
  const media=publicationMedia(entry.basis).flatMap(item=>{
    const url=mediaPreviews.get(item.id)?.dataUrl;
    return url?[{url,alt:item.alt || entry.output.title,credit:typeof item.credit==='string'?item.credit.trim():''}]:[];
  });
  const local=location.hostname==='127.0.0.1'||location.hostname==='localhost';
  const theme=new URL('/wp-content/themes/heritage-libanais/',local?'http://127.0.0.1:48888/':'https://heritage-libanais.fr/');
  const styles=['design-system.css','stories.css'];
  if (entry.output.siteEvent) styles.push(new URL('./event-page.css?v=2',import.meta.url).href);
  const links=styles.map(file=>`<link rel="stylesheet" href="${new URL(file,theme).href}">`).join('');
  let html;
  try { html=renderPublicationPreview(entry,media); }
  catch { html='<p>Complétez les informations du dossier pour afficher l’aperçu WordPress.</p>'; }
  const frame=$('site-preview-frame');
  const srcdoc=`<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${links}<body><main>${html}</main></body></html>`;
  if (frame.srcdoc!==srcdoc) frame.srcdoc=srcdoc;
}
async function imageSource(file) {
  if (file.type !== 'image/svg+xml' && !/\.svg$/i.test(file.name)) {
    try {
      const bitmap = await createImageBitmap(file);
      return { width: bitmap.width, height: bitmap.height, drawable: bitmap, close: () => bitmap.close() };
    } catch { /* The image element also handles browser-specific bitmap decoding limits. */ }
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('Impossible de lire « ' + file.name + ' ».'));
      image.src = url;
    });
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('Dimensions manquantes pour « ' + file.name + ' ».');
    return { width: image.naturalWidth, height: image.naturalHeight, drawable: image, close: () => URL.revokeObjectURL(url) };
  } catch (error) { URL.revokeObjectURL(url); throw error; }
}
async function imagePreviewData(file) {
  const bitmap = await imageSource(file);
  const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap.drawable, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const preview = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.78));
  if (!preview) throw new Error('Impossible de préparer une photo pour n8n.');
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Impossible de lire une photo pour n8n.'));
    reader.readAsDataURL(preview);
  });
  return { dataUrl, width: bitmap.width, height: bitmap.height };
}
async function contactSheetData(dossier, job, files) {
  const items = dossier.media;
  const columns = 4;
  const cellWidth = 320;
  const cellHeight = 300;
  const canvas = document.createElement('canvas');
  canvas.width = items.length ? columns * cellWidth : 64;
  canvas.height = items.length ? Math.ceil(items.length / columns) * cellHeight : 64;
  const context = canvas.getContext('2d');
  context.fillStyle = '#f5f3ef';
  context.fillRect(0, 0, canvas.width, canvas.height);
  for (const [index, item] of items.entries()) {
    session.assertCurrent(job);
    const bitmap = await imageSource(files.get(item.id));
    try {
      session.assertCurrent(job);
      const x = (index % columns) * cellWidth;
      const y = Math.floor(index / columns) * cellHeight;
      const scale = Math.min((cellWidth - 20) / bitmap.width, (cellHeight - 48) / bitmap.height);
      const width = bitmap.width * scale;
      const height = bitmap.height * scale;
      context.drawImage(bitmap.drawable, x + (cellWidth - width) / 2, y + 36 + (cellHeight - 48 - height) / 2, width, height);
      context.fillStyle = '#073e2a';
      context.font = 'bold 22px sans-serif';
      context.fillText(String(index + 1).padStart(2, '0'), x + 12, y + 26);
    } finally { bitmap.close(); }
  }
  return canvas.toDataURL('image/jpeg', 0.78);
}
async function sendIntake(dossier, revision, job) {
  session.assertCurrent(job);
  if (dossier.media.length > 8) throw new Error('Le premier essai n8n accepte huit photos au maximum.');
  const files = new Map(mediaFiles);
  const previews = new Map(mediaPreviews);
  const photos = [];
  for (const item of dossier.media) {
    session.assertCurrent(job);
    const file = files.get(item.id);
    if (!file) throw new Error('Rattachez « ' + item.name + ' » avant l’envoi à n8n.');
    const preview = previews.get(item.id) || await imagePreviewData(file);
    photos.push({
      id: item.id, name: item.name, selected: dossier.mediaMode === 'photos',
      credit: item.credit || '', rights: item.rights || 'à vérifier',
      rightsEvidence: item.rightsEvidence || '', sourceBytes: file.size,
      previewDataUrl: preview.dataUrl, width: preview.width, height: preview.height,
    });
    session.assertCurrent(job);
  }
  const contactSheetDataUrl = await contactSheetData(dossier, job, files);
  session.assertCurrent(job);
  const entreeComposition = buildCompositionInput({ dossier, photos, currentOutput: revision?.previousOutput, mode: revision ? 'revision' : 'creation', instruction: revision?.instruction, scope: revision?.scope, requestId: newMediaId() });
  const issue = storyCreationIssue(entreeComposition);
  if (issue) throw new Error(issue);
  job.compositionInput = entreeComposition;
  const result = await requestStudioComposition({ schema: 2, dossier, entreeComposition, photos, contactSheetDataUrl, reliefDisponible: true }, {
    signal: job.controller.signal,
    onProgress: ({ message }) => {
      if (session.isCurrent(job)) feedback(message, false, job.kind === 'create' ? 'compose-feedback' : 'message');
    },
  });
  session.assertCurrent(job);
  if (revision && currentComposition()?.base_version !== entreeComposition.base_version) throw new Error('La version affichée a changé. Cette réponse a été ignorée pour conserver vos modifications.');
  if (!result.output.compositionResponse) throw new Error('La connexion n8n ne renvoie pas la réponse de composition vérifiable. Cette réponse a été ignorée.');
  const composition = preserveCompositionAlerts(revision?.previousOutput?.composition,applyCompositionResponse(entreeComposition, result.output.compositionResponse, { currentVersion: entreeComposition.base_version, appliedRequestIds: revision?.previousOutput?.composition?.applied_requests || [] }));
  return { ...result.output, ...compositionToLegacy(composition, dossier), compositionResponse: result.output.compositionResponse };
}
function prepareSiteEvent(dossier) {
  const title = dossier.title.trim();
  const event = structuredClone(dossier.event);
  const summary = dossier.sourceText.trim().split(/\n\s*\n/)[0].slice(0, 240) || event.venue;
  const output = {title, summary, contentType:'evenement', siteEvent:true, event};
  renderEventPage({basis:dossier, output});
  const image = publicationMedia(dossier)[0];
  if (dossier.eventVisualMode === 'photo' && !image) throw new Error('Importez une image ou choisissez un autre visuel.');
  if (image && !mediaUrls.has(image.id)) throw new Error('Rattachez « ' + image.name + ' » pour vérifier son rendu.');
  const prepared = act(() => createProposal(saveDossier(state, dossier), output), 'Aperçu du site prêt à relire.');
  if (prepared) {
    $('final-confirmation').checked = false;
    focusStep('review-title');
  }
}
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const dossier = readDossier();
  const showComposeFeedback = (message, error = false) => feedback(message, error, 'compose-feedback');
  if (!hasIntake(dossier)) return showComposeFeedback(
    dossier.contentType === 'evenement' ? 'Ajoutez un programme, une affiche ou les informations de l’évènement.' : 'Ajoutez le texte du récit avant de lancer la composition.',
    true,
  );
  if (dossier.contentType !== 'evenement' && pendingRevision()) {
    if ($('studio-output').hidden) return showComposeFeedback('Revenez au récit pour valider ou annuler sa retouche en cours.', true);
    return focusStep('revision-notice');
  }
  if (dossier.contentType === 'evenement') {
    try {
      showComposeFeedback('');
      prepareSiteEvent(dossier);
    } catch (error) {
      showComposeFeedback(error.message, true);
    }
    return;
  }
  state.dossier = structuredClone(dossier);
  persist();
  const job = session.start('create');
  syncGenerationControls();
  try {
    const issue = storyCreationIssue(buildCompositionInput({ dossier, mode: 'creation' }));
    if (issue) throw new Error(issue);
    showComposeFeedback('Vérification de la connexion…');
    const remote = await refreshBridgeStatus(job.controller.signal);
    session.assertCurrent(job);
    if (!remote) throw new Error('La composition est momentanément indisponible. Vos saisies sont conservées.');
    showComposeFeedback('Préparation de la proposition…');
    const output = await sendIntake(dossier, null, job);
    session.assertCurrent(job);
    if (output.composition && !output.composition.cartes?.length) {
      const messages = [...(output.composition.retours || []).map((item)=>item.message), ...(output.composition.alertes || []).map((item)=>item.message)];
      showComposeFeedback(messages.join(' ') || 'Précisez le dossier ou les consignes pour préparer la proposition.', true);
      if (!state.proposals.length) $('proposal-empty').textContent = messages.join(' ') || 'Le modèle demande une précision avant de composer les cartes.';
      return;
    }
    const prepared = act(() => createProposal(saveDossier(state, dossier), output), 'Proposition prête à relire.');
    showComposeFeedback('');
    updateGaps();
    if (prepared) requestAnimationFrame(() => {
      if (!session.isEpochCurrent(job.epoch) || job.controller.signal.aborted) return;
      focusStep('review-title');
    });
  } catch (error) {
    if (session.isCurrent(job)) showComposeFeedback(error.message, true);
  } finally {
    if (session.finish(job)) syncGenerationControls();
  }
});
form.addEventListener('input', () => { dossierEdited(); updateGaps(); });
form.addEventListener('change', (event) => {
  dossierEdited();
  if (event.target === visual) { updateEventVisual(); renderMedia(); }
  if (event.target.name === 'event_registrationMode') updateRegistrationField();
  updateGaps();
});
$('media-files').addEventListener('change', (event) => {
  addFiles(event.target.files);
  event.target.value = '';
});
async function addFiles(files) {
  const epoch = session.epoch;
  dossierEdited();
  const isEvent = form.elements.contentType.value === 'evenement';
  if (isEvent && visual.value !== 'photo') return;
  const accepted = ['image/png','image/jpeg','image/webp'];
  const valid = Array.from(files).filter(file => accepted.includes(file.type) || (!isEvent && (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name))));
  for (const file of isEvent ? valid.slice(0,1) : valid) {
    let preview;
    try { preview = await imagePreviewData(file); }
    catch (error) { if (!session.isEpochCurrent(epoch)) return; feedback(error.message, true); continue; }
    if (!session.isEpochCurrent(epoch)) return;
    const existing = media.find((item) => (!isEvent || item.id === eventPhotoId) && !mediaUrls.has(item.id) && item.name === file.name && (!item.size || item.size === file.size));
    if (existing) {
      mediaUrls.set(existing.id, URL.createObjectURL(file));
      mediaFiles.set(existing.id, file);
      mediaPreviews.set(existing.id, preview);
      try { await uploadSavedMedia(existing.id,file); } catch(error) { feedback(error.message,true); }
      continue;
    }
    const id = newMediaId();
    if (isEvent) {
      media = media.filter(item => item.id !== eventPhotoId);
      eventPhotoId = id;
    }
    media.push({ id, name: file.name, size: file.size, credit: '', rights: '', rightsEvidence: '', rightsFileName: '' });
    mediaUrls.set(id, URL.createObjectURL(file));
    mediaFiles.set(id, file);
    mediaPreviews.set(id, preview);
    if (isEvent) { renderMedia(); updateGaps(); }
    try { await uploadSavedMedia(id,file); } catch(error) { feedback(error.message,true); }
  }
  if (!session.isEpochCurrent(epoch)) return;
  if (media.length) {
    if (!isEvent) form.elements.usePhotos.checked = true;
    $('media-section').hidden = false;
  }
  renderMedia(); updateGaps();
  if (state.proposals.length) render();
}
const dropZone = $('drop-zone');
dropZone.addEventListener('click', (event) => { if (event.target !== $('media-files')) $('media-files').click(); });
dropZone.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); $('media-files').click(); } });
dropZone.addEventListener('dragover', (event) => { event.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', (event) => { event.preventDefault(); dropZone.classList.remove('drag-over'); addFiles(event.dataTransfer.files); });
$('version-select').addEventListener('change', (event) => {
  const requestedVersion=Number(event.target.value);
  cancelGeneration('La version affichée a changé : la réponse en attente sera ignorée.');
  selectedVersion=requestedVersion;slideIndex=0;render();
});
function showCard(index) {
  const x=window.scrollX,y=window.scrollY;
  slideIndex=index;renderSlide();renderCardEditor();
  window.scrollTo({left:x,top:y,behavior:'instant'});
  requestAnimationFrame(()=>window.scrollTo({left:x,top:y,behavior:'instant'}));
}
$('slide-prev').addEventListener('click',()=>showCard(slideIndex-1));
$('slide-next').addEventListener('click',()=>showCard(slideIndex+1));
$('card-select').addEventListener('change',(event)=>showCard(Number(event.target.value)));
for(const [id,key] of [['card-title','title'],['card-body','body'],['card-layout','gabarit']]){
  $(id).addEventListener(key==='gabarit'?'change':'input',()=>manualEdit((comp)=>editCompositionCard(comp,comp.cartes[slideIndex].id,{[key]:$(id).value}),key==='gabarit'));
}
$('card-background').addEventListener('change', () => {
  manualEdit(comp => editCompositionCard(comp, selectedCard().id, { fond: $('card-background').value || null }), true);
});
$('card-relief').addEventListener('change', () => {
  manualEdit(comp => editCompositionCard(comp, selectedCard().id, { relief: $('card-relief').value }), true);
});
$('card-add-media-button').addEventListener('click',()=>{
  const id=$('card-add-media').value;if(!id)return;
  if(!unusedCardImages(currentComposition()).some(item=>item.id===id)){
    renderCardEditor();
    return feedback('Cette image est déjà utilisée sur une carte. Retirez-la de cette carte pour la déplacer.',true);
  }
  if(['couverture','affiche','fiche'].includes(selectedCard().gabarit)&&selectedCard().medias.length)return;
  manualEdit((comp)=>{const card=comp.cartes[slideIndex];const source=comp.medias.find((item)=>item.id===id);card.medias.push({media_id:id,role:'contexte',fit:'contain',taille:'normale',alt:source?.nom||'',lien:source?.lie_a?.[0]||''});
    if (card.gabarit === 'texte' || card.medias.length === 2 && MEDIA_COUNTS[card.gabarit][1] === 1) {
      card.gabarit = suggestImageLayout(card.medias.map(item => mediaPreviews.get(item.media_id)));
    }
    if (card.medias.length > 2) card.gabarit = 'assemblage';
    return comp;},true);
});
function moveCard(direction){manualEdit((comp)=>{const next=slideIndex+direction;if(comp.type==='evenement'||slideIndex===0||next<1||next>=comp.cartes.length)return comp;[comp.cartes[slideIndex],comp.cartes[next]]=[comp.cartes[next],comp.cartes[slideIndex]];const texts=new Map(comp.textes.map((block)=>[block.id,block]));comp.textes=comp.cartes.flatMap((card)=>card.blocs.map((id)=>texts.get(id)));slideIndex=next;return comp;},true);}
$('card-move-up').addEventListener('click',()=>moveCard(-1));$('card-move-down').addEventListener('click',()=>moveCard(1));
$('card-add').addEventListener('click',()=>manualEdit((comp)=>{const card={id:'carte-'+newMediaId(),gabarit:'texte',motif:'aucun',blocs:[],medias:[],champs:[]};comp.cartes.splice(slideIndex+1,0,card);slideIndex++;return comp;},true));
$('card-remove').addEventListener('click',()=>manualEdit((comp)=>{
  if(comp.type==='evenement'||slideIndex===0||comp.cartes.length<3)return comp;const [removed]=comp.cartes.splice(slideIndex,1);const target=comp.cartes[Math.min(slideIndex,comp.cartes.length-1)];
  // Removing a card moves its text to its neighbour, preserving every source block.
  target.blocs=slideIndex>=comp.cartes.length?[...target.blocs,...removed.blocs]:[...removed.blocs,...target.blocs];slideIndex=Math.min(slideIndex,comp.cartes.length-1);return comp;
},true));
$('accept-revision').addEventListener('click', savePendingRevision);
$('edit-without-ai').addEventListener('click',focusManualEditor);
$('retry-connection').addEventListener('click',()=>refreshBridgeStatus());
$('discard-revision').addEventListener('click', () => {
  cancelGeneration();
  delete state.manualDraft;
  persist();
  render();
  $('version-select').focus({ preventScroll: true });
  feedback('Modifications annulées. La version enregistrée est restaurée.');
});
$('correction-request').addEventListener('input', () => {
  state.correctionRequest = $('correction-request').value;
  persist();
});
$('save-revision').addEventListener('click',async()=>{
  const field = $('correction-request');
  const submitted = field.value;
  const instruction = submitted.trim();
  if(!instruction)return feedback('Décrivez la modification à appliquer à cette version.',true);
  const entry = currentProposal();
  const pending = pendingRevision();
  const previousOutput = structuredClone(readOutput());
  if (pending) {
    const issues = manualCompositionIssues(previousOutput.composition);
    if (issues.length) return feedback(issues.join(' '), true);
  }
  const scope=resolveFreeRevisionScope(previousOutput.composition,instruction,selectedCard().id);
  if(!scope.length)return feedback('Précisez la retouche et la carte concernée. Par exemple « Ajoute un filet rouge sur la carte 2 ».',true);
  const job=session.start('revise');const basis=structuredClone(entry.basis);
  syncGenerationControls();
  try{
    if(!await refreshBridgeStatus(job.controller.signal)) {
      session.assertCurrent(job);
      feedback('L’envoi à l’IA est indisponible. Vous pouvez utiliser l’éditeur manuel au-dessus.',true);
      return;
    }
    session.assertCurrent(job);
    feedback('L’IA prépare votre demande à partir de V'+entry.number+'…');
    const output=await sendIntake(basis,{instruction,previousOutput,scope},job);session.assertCurrent(job);
    const comp=output.composition;
    const unchanged=JSON.stringify({textes:comp.textes,cartes:comp.cartes,pratique:comp.pratique})===JSON.stringify({textes:previousOutput.composition.textes,cartes:previousOutput.composition.cartes,pratique:previousOutput.composition.pratique});
    const needsDetail = ['a_preciser','impossible'].includes(comp.statut);
    if (!needsDetail && field.value === submitted) state.correctionRequest = field.value = '';
    if(unchanged){
      // Feedback belongs to the request; an unchanged plan does not create a duplicate version.
      const target = pending ?? entry;
      target.output = { ...target.output, composition: { ...target.output.composition, retours: comp.retours, alertes: comp.alertes, statut: comp.statut, applied_requests: comp.applied_requests } };
    } else {
      stageRevision(output, instruction);
    }
    persist();
    render();
    if (unchanged) feedback(comp.retours.map(item=>item.message).join(' ') || 'La version est déjà conforme à votre demande.', needsDetail);
    else {
      feedback('Retouche IA prête à relire.');
      focusStep('revision-notice');
    }
  }catch(error){if(session.isCurrent(job))feedback(error.message,true);}
  finally{if(session.finish(job))syncGenerationControls();}
});
$('cancel-generation').addEventListener('click',()=>cancelGeneration());
$('reset-dossier').addEventListener('click', resetDossier);
$('undo-reset').addEventListener('click', undoReset);
$('validate').addEventListener('click', async () => {
  if (!$('final-confirmation').checked) return feedback('Confirmez la relecture du texte et des visuels.', true);
  if (publishing || (currentProposal() && eventPreviewOutdated(currentProposal()))) return;
  if (cloudConflict) return showSessionConflict(true);
  publishing = true;
  $('studio-workspace').inert = true;
  const button=$('validate');button.disabled=true;const updating=state.draft?.wordpressStatus==='publish';
  feedback(updating?'Mise à jour sur WordPress en cours…':'Publication sur WordPress en cours…');
  try {
    clearTimeout(cloudSaveTimer);
    while(cloudSaving) await new Promise(resolve=>setTimeout(resolve,50));
    if (cloudConflict) return showSessionConflict(true);
    const response=await fetch('/api/publication/publish',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:cloudRevision,preview:state}),signal:AbortSignal.timeout(25000)});
    const result=await response.json();
    if (result.code==='session_conflict') {
      persist();
      return showSessionConflict(true);
    }
    if(!response.ok)throw new Error(result.error||'La publication a échoué.');
    state=result.state;
    cloudPending=false;
    localStorage.setItem(storageKey,JSON.stringify(state));
    if (result.revision===null) {
      localStorage.setItem(storageKey+'-pending','true');
      showSessionConflict();
    } else {
      cloudRevision=result.revision;
      localStorage.setItem(storageKey+'-revision',String(cloudRevision));
      localStorage.removeItem(storageKey+'-pending');
    }
    render();refreshPublicationList();feedback(updating?'Publication mise à jour. Vérifiez la page WordPress.':'Publié sur WordPress. Vérifiez la page.');focusStep('draft-title');
  } catch(error) { feedback(error.message,true); }
  finally {
    publishing = false;
    $('studio-workspace').inert = false;
    if (currentProposal()) updateProposalGaps(currentProposal());
  }
});
$('wordpress-connect').addEventListener('click',async()=>{
  if(!studioAccess.canManageConnections)return;
  const button=$('wordpress-connect');button.disabled=true;
  $('wordpress-connection-status').textContent='Vérification de la connexion WordPress…';
  try{
    const token=$('wordpress-token').value.trim();
    const connection=token?{token}:{username:$('wordpress-username').value.trim(),password:$('wordpress-password').value};
    const response=await fetch('/api/publication/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(connection),signal:AbortSignal.timeout(20000)});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'Connexion refusée.');
    $('wordpress-token').value='';$('wordpress-password').value='';await refreshWordPressConnection();
  }catch(error){$('wordpress-connection-status').textContent=error.message;}finally{button.disabled=false;}
});
async function trashPublication(postId){
  if(!window.confirm('Retirer cette publication du site et la placer dans la corbeille WordPress ?'))return;
  $('wordpress-trash').disabled=true;
  try{
    const response=await fetch('/api/publication/trash',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:cloudRevision,postId}),signal:AbortSignal.timeout(25000)});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'La suppression a échoué.');
    if(result.state){
      state=result.state;cloudRevision=result.revision;
      localStorage.setItem(storageKey,JSON.stringify(state));localStorage.setItem(storageKey+'-revision',String(cloudRevision));localStorage.removeItem(storageKey+'-pending');
      render();
    }
    await refreshPublicationList();feedback('Publication placée dans la corbeille WordPress.');
  }catch(error){feedback(error.message,true);}finally{$('wordpress-trash').disabled=false;}
}
$('wordpress-trash').addEventListener('click',()=>{if(state.draft?.wordpressPostId)trashPublication(state.draft.wordpressPostId);});
$('publications-refresh').addEventListener('click',refreshPublicationList);
$('prepare-mailing').addEventListener('click',async()=>{
  if(!state.draft?.wordpressPostId)return;
  mailingLoaded=true;
  mailingTab('mailing');
  const intro=$('email-intro').value.trim();
  await mailingRefresh({postId:String(state.draft.wordpressPostId),intro:intro===(state.draft.summary||'').trim()?undefined:intro});
});
$('email-preview-button').addEventListener('click', async () => {
  const draft = state.draft;
  if (!draft) return;
  const button = $('email-preview-button');
  const status = $('email-preview-status');
  const input = {title:$('email-title').value.trim(),intro:$('email-intro').value.trim(),url:$('email-url').value.trim()};
  if (draft.contentType === 'evenement') Object.assign(input, {
    date:draft.event?.startDate || '', time:draft.event?.startTime || '', venue:draft.event?.venue || '',
    city:draft.event?.city || '', price:draft.event?.price || '', registrationUrl:draft.event?.registrationUrl || ''
  });
  else Object.assign(input, {
    sections:(draft.slides || []).slice(1).filter(slide => slide.kind !== 'closing' && slide.title && slide.body).slice(0, 3).map(slide => ({title:slide.title,text:slide.body})),
    sources:draft.sources || ''
  });
  button.disabled = true; status.textContent = 'Préparation de l’aperçu…';
  try {
    const response = await fetch('/api/email/preview', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:draft.contentType,input}),signal:AbortSignal.timeout(10000)});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'L’aperçu est indisponible.');
    $('email-preview-subject').textContent = result.subject;
    $('email-preview-preheader').textContent = result.previewText;
    $('email-preview-frame').srcdoc = result.html;
    $('email-preview-panel').hidden = false;
    status.textContent = 'Aperçu prêt. Aucun e-mail envoyé.';
  } catch (error) { status.textContent = error.message; }
  finally { button.disabled = false; }
});
$('archive').addEventListener('click', () => act(() => archive(state), 'Dossier archivé localement.'));
let mailingLoaded=false;
let mailingPosts=[];
let mailingPreview=null;
let mailingCanSend=false;
let mailingSending=false;
let mailingCheckedRequest=0;
let mailingCatalogueRequest=0;
let mailingPreviewController;
let mailingPreviewTimer;
const mailingStorageKey = storageKey + '-mailing';
const mailingFields = {intro:'mailing-intro',subject:'mailing-subject-input',previewText:'mailing-preheader-input'};
const mailingAudienceLabels = {
  newsletter:'Abonnés confirmés à la Newsletter',
  newsletter_unregistered:'Abonnés à la Newsletter non inscrits à cet événement',
  event_registrants:'Inscrits à cet événement',
};
const mailingDrafts = new Map();
const externalRegistrations = new Map();
let selectedMailing = {};
let legacyMailingDraftKey;
try {
  selectedMailing = JSON.parse(localStorage.getItem(mailingStorageKey) || '{}') || {};
  const {drafts,postId,purpose,intro,subject,previewText}=selectedMailing;
  for(const [key, draft] of Object.entries(drafts || {}))mailingDrafts.set(key,draft);
  if(!drafts && postId && purpose){
    legacyMailingDraftKey=postId+':'+purpose;
    mailingDrafts.set(legacyMailingDraftKey,{intro,subject,previewText});
  }
} catch { /* A local draft is optional. */ }
const mailingPost=()=>mailingPosts.find(post=>post.id===Number($('mailing-post').value));
const mailingPurpose=()=>$('mailing-purpose').value;
const mailingAudience=()=>$('mailing-audience-select').value;
const mailingDraftKey=()=>$('mailing-post').value+':'+mailingPurpose();
const mailingUsesExternal=()=>!$('mailing-external').hidden;
function saveMailingDraft() {
  selectedMailing={postId:$('mailing-post').value,purpose:mailingPurpose(),audience:mailingAudience(),drafts:Object.fromEntries(mailingDrafts)};
  try { localStorage.setItem(mailingStorageKey, JSON.stringify(selectedMailing)); }
  catch { /* The open draft remains editable. */ }
}
function updateMailingSend() {
  $('mailing-send').disabled=!mailingCanSend||mailingSending||!mailingPreview||
    Boolean(mailingPreview.audience.problem)||!$('mailing-confirm').checked;
}
function mailingInvalidate() {
  clearTimeout(mailingPreviewTimer);
  mailingPreviewController?.abort();
  mailingPreview=null;
  $('mailing-preview-panel').hidden=true;
  $('mailing-confirm').checked=false;
  $('mailing-preview-status').textContent='';
  $('mailing-preview').disabled=!mailingPost();
  updateMailingSend();
}
function mailingInput() {
  const input={postId:mailingPost().id,purpose:mailingPurpose(),audience:mailingAudience()};
  const draft=mailingDrafts.get(mailingDraftKey());
  for(const key of Object.keys(mailingFields)){
    if(draft?.[key])input[key]=draft[key];
  }
  if(mailingUsesExternal() && $('mailing-external-complete').checked){
    input.externalRegistrations=$('mailing-external-emails').value.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  }
  return input;
}
function selectMailingAudience(preferred) {
  const post=mailingPost();
  const purpose=mailingPurpose();
  const signup=post?.type==='evenement'&&post.registrationSource!=='none'&&Boolean(purpose);
  const defaultAudience=purpose==='follow_up'?'newsletter_unregistered'
    : ['confirmation','reminder','thanks'].includes(purpose)?'event_registrants':'newsletter';
  const choices=signup&&defaultAudience==='newsletter'?['newsletter','newsletter_unregistered']:[defaultAudience];
  const select=$('mailing-audience-select');
  for(const option of select.options)option.disabled=!choices.includes(option.value);
  select.value=choices.includes(preferred)?preferred:defaultAudience;
  select.disabled=!post||!purpose||choices.length===1;
}
function updateMailingAudience() {
  const post=mailingPost();
  const selected=mailingAudience();
  const immediate=selected==='newsletter_unregistered';
  const external=post?.registrationSource==='external';
  $('mailing-external').hidden=!external||selected==='newsletter';
  $('mailing-event-list').hidden=!studioAccess.canScheduleMailing||
    !['wordpress','studio','external'].includes(post?.registrationSource)||(external&&selected==='newsletter');
  $('mailing-sync-status').textContent='La liste Brevo est réservée aux inscriptions à cet événement.';
  $('mailing-sync-list').textContent='Synchroniser les inscrits dans Brevo';
  $('mailing-quota-note').textContent=immediate
    ? 'Envoi immédiat à 250 destinataires maximum, selon le quota Brevo disponible.'
    : 'Le Studio programme jusqu’à 250 e-mails par jour, à 10 h, à partir du lendemain.';
  $('mailing-send-title').textContent=immediate?'3. Envoyer maintenant':'3. Programmer l’envoi';
  $('mailing-confirm-label').textContent=immediate
    ? 'J’ai relu le contenu, le lien et les destinataires. Je veux envoyer ce mail maintenant.'
    : 'J’ai relu le contenu, le lien et les destinataires. Je veux programmer cet envoi dans Brevo.';
  $('mailing-send').textContent=immediate?'Revérifier et envoyer':'Programmer dans Brevo';
}
function loadMailingEditor(preferredAudience) {
  const post=mailingPost();
  const event=post?.type==='evenement';
  $('mailing-purpose-field').hidden=!event;
  selectMailingAudience(preferredAudience);
  updateMailingAudience();
  const external=externalRegistrations.get(post?.id);
  $('mailing-external-emails').value=external?.emails||'';
  $('mailing-external-complete').checked=Boolean(external?.complete);
  const csv=$('mailing-registrations-csv');
  csv.hidden=studioAccess.role!=='owner'||!['studio','wordpress'].includes(post?.registrationSource);
  if(!csv.hidden)csv.href='/api/mailing/registrations.csv?postId='+post.id;
  const draft=mailingDrafts.get(mailingDraftKey());
  for(const [key,id] of Object.entries(mailingFields)){
    $(id).disabled=!post;
    $(id).value=draft?.[key]||'';
    $(id).placeholder='';
  }
}
function selectMailingPost(purpose, intro, preferredAudience) {
  const post=mailingPost();
  const noSignup=post?.registrationSource==='none';
  const options=[...$('mailing-purpose').options];
  for(const option of options){
    option.disabled=post?.past ? option.value!=='thanks' || noSignup
      : noSignup && !['invitation','announcement'].includes(option.value);
  }
  $('mailing-purpose').value=post?.type==='evenement'
    ? options.find(option=>option.value===purpose&&!option.disabled)?.value || options.find(option=>!option.disabled)?.value || ''
    : 'announcement';
  if(post && legacyMailingDraftKey?.startsWith(post.id+':')){
    const legacy=mailingDrafts.get(legacyMailingDraftKey);
    // The previous editor stored the prefilled invitation when switching models.
    if(post.type==='evenement' && [post.intro,'Nous avons le plaisir de vous inviter à cette rencontre. Retrouvez les informations pratiques sur le site.'].includes(legacy.intro)){
      delete legacy.intro;
    }
    legacyMailingDraftKey=undefined;
  }
  if(intro && post?.type==='recit'){
    const key=mailingDraftKey();
    mailingDrafts.set(key,{...mailingDrafts.get(key),intro});
  }
  loadMailingEditor(preferredAudience);
  saveMailingDraft();
  $('mailing-post-note').textContent=post?.type==='evenement'?post.date:'';
  scheduleMailingPreview();
}
function scheduleMailingPreview(delay=0) {
  mailingInvalidate();
  $('mailing-audience').textContent=mailingPost()?'Vérification des destinataires…':'Choisissez une publication.';
  if(!mailingPost())return;
  if(!mailingPurpose()){
    $('mailing-audience').textContent='Cet événement passé ne proposait pas d’inscription.';
    $('mailing-preview').disabled=true;
    return;
  }
  if(delay)mailingPreviewTimer=setTimeout(loadMailingPreview,delay);
  else void loadMailingPreview();
}
async function loadMailingPreview() {
  const controller=new AbortController();
  mailingPreviewController=controller;
  const input=mailingInput();
  $('mailing-preview').disabled=true;
  $('mailing-preview-status').textContent='Préparation de l’aperçu…';
  try{
    const result=await mailingJson('/api/mailing/preview',{
      method:'POST',body:JSON.stringify(input),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(45000)]),
    });
    if(controller.signal.aborted)return;
    mailingPreview={...result,input,requestId:crypto.randomUUID()};
    const defaults={intro:result.intro,subject:result.email.subject,previewText:result.email.previewText};
    for(const [key,id] of Object.entries(mailingFields)){
      if(input[key])continue;
      $(id).placeholder=defaults[key];
      if(document.activeElement!==$(id))$(id).value=defaults[key];
    }
    const {audience}=result;
    const label=audience.name || mailingAudienceLabels[audience.kind];
    const count=audience.count===null?'':` · ${audience.count} destinataire(s)`;
    const excluded=audience.kind==='newsletter_unregistered'&&audience.excludedCount!==null
      ? ` · ${audience.excludedCount} abonné(s) déjà inscrit(s) exclu(s)` : '';
    $('mailing-audience').textContent=label+count+excluded+(audience.problem?' — '+audience.problem:'');
    $('mailing-subject').textContent=result.email.subject;
    $('mailing-preheader').textContent=result.email.previewText;
    $('mailing-preview-frame').srcdoc=result.email.html;
    $('mailing-preview-panel').hidden=false;
    $('mailing-preview-status').textContent='';
    updateMailingSend();
  }catch(error){
    if(controller.signal.aborted)return;
    $('mailing-preview-status').textContent=error.message;
    $('mailing-audience').textContent='Destinataires à vérifier.';
  }finally{
    if(!controller.signal.aborted)$('mailing-preview').disabled=false;
  }
}
function mailingTab(name){
  const mailing=name==='mailing';
  const editorial=name==='editor'||name==='event';
  $('editor-intro').hidden=!editorial;
  $('editor-view').hidden=!editorial;
  $('mailing-view').hidden=!mailing;
  $('instagram-view').hidden=name!=='instagram';
  for(const section of ['editor','event','mailing','instagram']){
    const selected=name===section;
    const tab=$('tab-'+section);
    tab.classList.toggle('active',selected);
    if(selected)tab.setAttribute('aria-current','page');else tab.removeAttribute('aria-current');
  }
  if(mailing&&!mailingLoaded){mailingLoaded=true;mailingRefresh();}
}
async function mailingJson(path,options={}){
  const response=await fetch(path,{...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}});
  const result=await response.json();
  if(!response.ok)throw Object.assign(new Error(result.error||result.job?.error||'Cette action est momentanément indisponible.'),{job:result.job,status:response.status});
  return result;
}
async function refreshMailingConnection(){
  const request = ++mailingCheckedRequest;
  const status = $('mailing-connection-status');
  const check = $('mailing-recheck');
  mailingCanSend = false;
  $('mailing-send').disabled = true;
  check.disabled = true;
  status.textContent = 'Vérification de la connexion à Brevo…';
  try {
    const result = await mailingJson('/api/mailing/status', {cache:'no-store',signal:AbortSignal.timeout(12000)});
    if (request !== mailingCheckedRequest) return;
    const keyNeedsSetup = ['credentials_missing','credentials_rejected','account_mismatch'].includes(result.reason) || (!result.status && !result.connected);
    $('mailing-setup').hidden = !studioAccess.canManageConnections || result.connectionManaged;
    $('mailing-setup').open = keyNeedsSetup;
    mailingCanSend = studioAccess.canScheduleMailing && result.readyToSend === true;
    const messages = {
      credentials_missing: 'L’administrateur doit configurer la connexion à Brevo.',
      credentials_rejected: 'L’administrateur doit vérifier la connexion à Brevo.',
      account_mismatch: 'Le compte Brevo configuré doit être vérifié par l’administrateur.',
      list_missing: 'La liste de La Newsletter doit être vérifiée par l’administrateur.',
      sender_not_ready: 'Brevo est connecté. L’adresse d’envoi reste à configurer.',
      provider_unavailable: 'Brevo est momentanément indisponible.',
      plan_mismatch: 'L’administrateur doit vérifier le forfait Brevo.',
      quota_exhausted: 'Le quota quotidien Brevo est atteint. Réessayez après son renouvellement.'
    };
    status.textContent = (messages[result.reason] || (result.connected ? 'Brevo est connecté.' : 'La connexion à Brevo reste à configurer.')) + checkedTime(result.lastCheckedAt);
    $('mailing-send-status').textContent = studioAccess.canScheduleMailing ? '' : 'Votre compte peut préparer le mail. La programmation est réservée à l’administrateur.';
    updateMailingSend();
  } catch {
    if (request !== mailingCheckedRequest) return;
    $('mailing-setup').hidden = true;
    status.textContent = 'La connexion à Brevo n’a pas pu être vérifiée. Vous pouvez préparer l’aperçu.';
  } finally {
    if (request === mailingCheckedRequest) check.disabled = false;
  }
}
async function mailingRefresh({postId,intro}={}){
  const request=++mailingCatalogueRequest;
  $('mailing-post-note').textContent='Lecture des publications…';
  void refreshMailingConnection();
  try {
    const result=await mailingJson('/api/mailing/content?includePastEvents=1',{cache:'no-store',signal:AbortSignal.timeout(12000)});
    if(request!==mailingCatalogueRequest)return;
    mailingPosts=result.posts||[];
    const select=$('mailing-post');
    const preferred=postId||selectedMailing.postId||'';
    select.replaceChildren(new Option('Choisir une publication',''));
    const groups=[
      ['Événements à venir',post=>post.type==='evenement'&&!post.past],
      ['Événements passés',post=>post.type==='evenement'&&post.past],
      ['Récits',post=>post.type==='recit'],
    ];
    for(const [label,matches] of groups){
      const group=document.createElement('optgroup');
      group.label=label;
      for(const post of mailingPosts.filter(matches))group.append(new Option(post.title,String(post.id)));
      if(group.children.length)select.append(group);
    }
    select.value=mailingPosts.some(post=>String(post.id)===preferred)?preferred:'';
    selectMailingPost(postId?undefined:selectedMailing.purpose,intro,postId?undefined:selectedMailing.audience);
    if(!mailingPosts.length)$('mailing-post-note').textContent='Aucune publication disponible pour un envoi.';
    else if(postId&&!select.value)$('mailing-post-note').textContent='Cette publication n’apparaît pas encore dans WordPress.';
  }catch(error){
    if(request===mailingCatalogueRequest)$('mailing-post-note').textContent=error.message;
  }
}
function mailingShowJob(job){
  const box=$('mailing-job');box.replaceChildren();box.hidden=false;
  const title=document.createElement('strong');title.textContent=job.status==='submitted'?'Envoi déclenché dans Brevo':job.status==='scheduled'?'Envoi programmé dans Brevo':'Envoi à vérifier dans Brevo';box.append(title);
  const content=document.createElement('p');content.textContent=job.title||'';box.append(content);
  for(const part of job.batches||[]){const line=document.createElement('p');const date=part.scheduledAt?new Date(part.scheduledAt).toLocaleString('fr-FR',{timeZone:'Europe/Paris',dateStyle:'full',timeStyle:'short'}):'';line.textContent=[`${part.count} destinataire(s)`,date,part.campaignId?'campagne Brevo '+part.campaignId:''].filter(Boolean).join(' · ');box.append(line);}
  if(job.error){const error=document.createElement('p');error.textContent=job.error;box.append(error);}
}
$('tab-editor').addEventListener('click',()=>openEditorialWorkspace('recit'));
$('tab-event').addEventListener('click',()=>openEditorialWorkspace('evenement'));
let instagramConnected=false;
let instagramPrepared=[];
let instagramPreparedPostId=null;
let instagramRequestId=null;
const instagramJson=(path,options={})=>mailingJson(path,options);
async function refreshConnectionsOverview(){
  const entries=[['n8n','/api/status'],['brevo','/api/mailing/status'],['instagram','/api/instagram/status']];
  await Promise.all(entries.map(async([name,path])=>{
    const label=$('home-'+name+'-status');
    try{
      const result=await instagramJson(path,{cache:'no-store',signal:AbortSignal.timeout(12000)});
      const ready=name==='brevo'?result.status==='ready':result.connected===true;
      label.dataset.status=ready?'ready':result.status==='setup'||result.reason==='credentials_missing'?'setup':'unavailable';
      label.textContent=ready?(name==='instagram'?'Connecté · @'+result.username:'Connecté'):label.dataset.status==='setup'?'À configurer':'À vérifier';
    }catch{label.dataset.status='unavailable';label.textContent='Indisponible';}
  }));
}
async function refreshInstagramConnection(){
  const status=$('instagram-connection-status');status.textContent='Vérification de la connexion Meta…';
  try{
    const result=await instagramJson('/api/instagram/status',{cache:'no-store',signal:AbortSignal.timeout(12000)});
    instagramConnected=result.connected===true;
    $('instagram-setup').hidden=!studioAccess.canManageConnections||result.managed;
    $('instagram-setup').open=!instagramConnected&&studioAccess.canManageConnections&&!result.managed;
    status.textContent=instagramConnected?`Connecté à @${result.username}.`:result.reason==='missing'?'Connectez le compte Instagram professionnel pour publier.':result.reason==='account_mismatch'?'Le jeton pointe vers un autre compte Instagram.':'La connexion Meta doit être vérifiée.';
  }catch{instagramConnected=false;status.textContent='La connexion Meta est momentanément indisponible.';}
  $('instagram-publish').disabled=!instagramConnected||instagramPrepared.length<2;
  void refreshConnectionsOverview();
}
function clearInstagramPreview(){
  for(const item of instagramPrepared)URL.revokeObjectURL(item.previewUrl);
  instagramPrepared=[];instagramPreparedPostId=null;instagramRequestId=null;
  $('instagram-preview').replaceChildren();$('instagram-publish').disabled=true;
}
async function refreshInstagramStory(){
  clearInstagramPreview();
  const select=$('instagram-post'),status=$('instagram-status');
  select.replaceChildren(new Option('Choisir un récit',''));
  const postId=state.draft?.wordpressStatus==='publish'?state.draft.wordpressPostId:null;
  if(!postId){status.textContent='Publiez d’abord un récit depuis l’atelier éditorial.';return;}
  try{
    const {posts}=await instagramJson('/api/mailing/content',{cache:'no-store',signal:AbortSignal.timeout(12000)});
    const post=posts.find(item=>item.id===postId&&item.type==='recit');
    if(!post){status.textContent='Le récit du dossier actuel ne figure plus parmi les publications du site.';return;}
    const option=new Option(post.title,String(post.id));option.dataset.url=post.url;select.add(option);select.value=String(post.id);
    $('instagram-source').href=post.url;$('instagram-source').hidden=false;
    if(!$('instagram-caption').value.trim())$('instagram-caption').value=`${post.title}\n\nÀ lire sur heritage-libanais.fr : ${post.url}`;
    status.textContent='Récit validé et publié. Préparez les cartes pour vérifier leur rendu.';
  }catch(error){status.textContent=error.message;}
}
function showInstagramJob(job){
  const box=$('instagram-job');box.hidden=false;box.replaceChildren();
  const title=document.createElement('strong');title.textContent=job.status==='published'?'Carrousel publié':'Envoi à vérifier dans Instagram';box.append(title);
  const line=document.createElement('p');line.textContent=`${job.title} · @${job.username} · ${job.status}`;box.append(line);
  if(job.permalink){const link=document.createElement('a');link.href=job.permalink;link.target='_blank';link.rel='noopener';link.textContent='Voir sur Instagram';box.append(link);}
  if(job.error){const message=document.createElement('p');message.textContent=job.error;box.append(message);}
}
$('tab-instagram').addEventListener('click',async()=>{
  mailingTab('instagram');
  await Promise.all([refreshInstagramConnection(),refreshInstagramStory()]);
  try{const {jobs}=await instagramJson('/api/instagram/jobs');if(jobs.length)showInstagramJob(jobs[0]);}catch{}
});
$('instagram-post').addEventListener('change',()=>{
  clearInstagramPreview();
  const url=$('instagram-post').selectedOptions[0]?.dataset.url;
  $('instagram-source').hidden=!url;if(url)$('instagram-source').href=url;
});
$('instagram-connect').addEventListener('click',async()=>{
  const button=$('instagram-connect');button.disabled=true;
  try{
    const result=await instagramJson('/api/instagram/setup',{method:'POST',body:JSON.stringify({username:$('instagram-username').value,token:$('instagram-token').value})});
    $('instagram-token').value='';$('instagram-username').value=result.username;
    await refreshInstagramConnection();
  }catch(error){$('instagram-connection-status').textContent=error.message;}
  finally{button.disabled=false;}
});
$('instagram-recheck').addEventListener('click',refreshInstagramConnection);
$('instagram-prepare').addEventListener('click',async()=>{
  const button=$('instagram-prepare');button.disabled=true;clearInstagramPreview();
  const status=$('instagram-status');
  try{
    const postId=Number($('instagram-post').value);
    const version=state.proposals.find(entry=>entry.number===state.draft?.version)||state.proposals.at(-1);
    const comp=version?.output?.composition;
    if(!postId||postId!==state.draft?.wordpressPostId||state.draft?.wordpressStatus!=='publish'||comp?.type!=='recit')throw new Error('Ouvrez un récit validé et publié dans l’atelier.');
    if(!Array.isArray(comp.cartes)||comp.cartes.length<2||comp.cartes.length>10)throw new Error('Le carrousel doit contenir de 2 à 10 cartes.');
    for(const [index,card] of comp.cartes.entries()){
      status.textContent=`Création du JPEG ${index+1}/${comp.cartes.length}…`;
      const blob=await renderInstagramJpeg(frame=>renderCardFrame(frame,comp,card,index));
      if(blob.size>8_000_000)throw new Error(`La carte ${index+1} dépasse 8 Mo. Réduisez ses images.`);
      const previewUrl=URL.createObjectURL(blob);
      instagramPrepared.push({blob,previewUrl,id:null});
      const figure=document.createElement('figure');const image=document.createElement('img');image.src=previewUrl;image.alt=`Carte ${index+1} du carrousel`;const caption=document.createElement('figcaption');caption.textContent=`Carte ${index+1}`;figure.append(image,caption);$('instagram-preview').append(figure);
    }
    instagramPreparedPostId=postId;instagramRequestId=crypto.randomUUID();
    status.textContent=`${instagramPrepared.length} cartes prêtes. Relisez chaque image et la légende.`;
    $('instagram-publish').disabled=!instagramConnected;
  }catch(error){status.textContent=error.message;clearInstagramPreview();}
  finally{button.disabled=false;}
});
$('instagram-publish').addEventListener('click',async()=>{
  const status=$('instagram-publish-status'),button=$('instagram-publish');
  if(!instagramConnected||instagramPrepared.length<2||!$('instagram-confirm').checked){status.textContent='Relisez les cartes et cochez la confirmation avant de publier.';return;}
  const caption=$('instagram-caption').value.trim();if(!caption){status.textContent='Ajoutez une légende Instagram.';return;}
  button.disabled=true;
  try{
    for(const [index,item] of instagramPrepared.entries()){
      if(item.id)continue;
      status.textContent=`Transfert de la carte ${index+1}/${instagramPrepared.length} vers WordPress…`;
      const response=await fetch(`/api/instagram/asset?postId=${instagramPreparedPostId}&position=${index+1}`,{method:'POST',headers:{'Content-Type':'image/jpeg'},body:item.blob,signal:AbortSignal.timeout(45000)});
      const result=await response.json();if(!response.ok)throw new Error(result.error||'Le transfert a échoué.');
      item.id=result.asset.id;
    }
    status.textContent='Publication du carrousel par Meta…';
    const {job}=await instagramJson('/api/instagram/publish',{method:'POST',body:JSON.stringify({postId:instagramPreparedPostId,assetIds:instagramPrepared.map(item=>item.id),caption,confirmed:true,requestId:instagramRequestId}),signal:AbortSignal.timeout(120000)});
    showInstagramJob(job);status.textContent=job.status==='published'?'Le carrousel est en ligne sur Instagram.':'Vérifiez le résultat sur Instagram avant tout nouvel essai.';
    if(job.status==='published')clearInstagramPreview();
  }catch(error){status.textContent=error.message+' Vérifiez l’historique ci-dessous avant de recommencer.';
    try{const {jobs}=await instagramJson('/api/instagram/jobs');const job=jobs.find(item=>item.requestId===instagramRequestId);if(job){showInstagramJob(job);if(job.status!=='failed')return;instagramRequestId=crypto.randomUUID();}}catch{}
    button.disabled=false;
  }
});
$('home-brevo-link').addEventListener('click',event=>{event.preventDefault();$('tab-mailing').click();});
$('home-instagram-link').addEventListener('click',event=>{event.preventDefault();$('tab-instagram').click();});
$('tab-mailing').addEventListener('click',()=>mailingTab('mailing'));
let automationPreviewRequest=0;
async function loadAutomationPreview() {
  const request=++automationPreviewRequest;
  const subject=$('mailing-automation-subject');
  const frame=$('mailing-automation-frame');
  frame.hidden=true;
  subject.textContent='Chargement de l’aperçu…';
  try {
    const kind=$('mailing-automation-template').value;
    const preview=await mailingJson('/api/mailing/automation-preview?kind='+encodeURIComponent(kind));
    if(request!==automationPreviewRequest)return;
    subject.textContent=preview.subject;
    frame.srcdoc=preview.html;
    frame.hidden=false;
  }catch(error){
    if(request===automationPreviewRequest)subject.textContent=error.message;
  }
}
$('mailing-automation-preview').addEventListener('click',loadAutomationPreview);
$('mailing-automation-template').addEventListener('change',loadAutomationPreview);
$('mailing-automation').addEventListener('toggle',event=>{
  if(event.target.open && !automationPreviewRequest)void loadAutomationPreview();
});
$('mailing-refresh').addEventListener('click',()=>void mailingRefresh());
$('mailing-recheck').addEventListener('click',async()=>{
  await refreshMailingConnection();
  if(mailingPost())scheduleMailingPreview();
});
$('mailing-post').addEventListener('change',()=>selectMailingPost());
$('mailing-purpose').addEventListener('change',()=>{
  loadMailingEditor();
  saveMailingDraft();
  scheduleMailingPreview();
});
$('mailing-audience-select').addEventListener('change',()=>{
  updateMailingAudience();
  saveMailingDraft();
  scheduleMailingPreview();
});
$('mailing-sync-list').addEventListener('click',async()=>{
  const post=mailingPost();
  if(!post)return;
  const input=mailingInput();
  const button=$('mailing-sync-list');
  const status=$('mailing-sync-status');
  button.disabled=true;
  status.textContent='Synchronisation de la liste Brevo…';
  try{
    const {listId,name,count,pending}=await mailingJson('/api/mailing/event-list',{method:'POST',body:JSON.stringify({
      postId:post.id,externalRegistrations:input.externalRegistrations,
    })});
    if(mailingPost()?.id===post.id){
      status.textContent=pending?`${name} · Synchronisation en cours dans Brevo.`:`${name} · ${count} inscrit(s) · Liste Brevo n° ${listId}.`;
      button.textContent=pending?'Vérifier la synchronisation':'Synchroniser les inscrits dans Brevo';
    }
  }catch(error){
    if(mailingPost()?.id===post.id)status.textContent=error.message;
  }finally{button.disabled=false;}
});
for(const [key,id] of Object.entries(mailingFields))$(id).addEventListener('input',event=>{
  const draftKey=mailingDraftKey();
  mailingDrafts.set(draftKey,{...mailingDrafts.get(draftKey),[key]:event.target.value.trim()});
  saveMailingDraft();
  scheduleMailingPreview(300);
});
function saveExternalRegistrations(){
  externalRegistrations.set(mailingPost().id,{
    emails:$('mailing-external-emails').value,
    complete:$('mailing-external-complete').checked,
  });
}
$('mailing-external-emails').addEventListener('input',()=>{
  const complete=$('mailing-external-complete');
  const wasComplete=complete.checked;
  complete.checked=false;
  saveExternalRegistrations();
  if(wasComplete)scheduleMailingPreview();
});
$('mailing-external-complete').addEventListener('change',()=>{
  saveExternalRegistrations();
  scheduleMailingPreview();
});
$('mailing-confirm').addEventListener('change',updateMailingSend);
$('mailing-connect').addEventListener('click',async()=>{
  if (!studioAccess.canManageConnections) return;
  const button=$('mailing-connect');button.disabled=true;$('mailing-connection-status').textContent='Vérification de la clé…';
  try{await mailingJson('/api/mailing/setup',{method:'POST',body:JSON.stringify({apiKey:$('mailing-api-key').value})});$('mailing-api-key').value='';await refreshMailingConnection();if(mailingPost())scheduleMailingPreview();}
  catch(e){$('mailing-connection-status').textContent=e.message;}
  finally{button.disabled=false;}
});
$('mailing-preview').addEventListener('click',()=>scheduleMailingPreview());
$('mailing-send').addEventListener('click',async()=>{
  const preview=mailingPreview;
  if(!mailingCanSend||mailingSending||!preview||preview.audience.problem||!$('mailing-confirm').checked)return;
  mailingSending=true;
  updateMailingSend();
  $('mailing-send-status').textContent=preview.audience.kind==='newsletter_unregistered'
    ? 'Nouvelle vérification des destinataires…' : 'Programmation dans Brevo…';
  try{
    const {job}=await mailingJson('/api/mailing/send',{method:'POST',body:JSON.stringify({
      ...preview.input,contentHash:preview.contentHash,requestId:preview.requestId,confirmed:true,
    })});
    mailingShowJob(job);
    $('mailing-send-status').textContent=job.status==='submitted'?'Envoi déclenché dans Brevo.'
      :job.status==='scheduled'?'Envoi programmé.':'Une étape doit être vérifiée dans Brevo.';
    if(mailingPreview===preview)mailingPreview=null;
  }catch(error){
    $('mailing-send-status').textContent=error.message;
    if(error.job)mailingShowJob(error.job);
    if((error.job||error.status===409)&&mailingPreview===preview)mailingInvalidate();
  }finally{
    mailingSending=false;
    $('mailing-confirm').checked=false;
    updateMailingSend();
  }
});
$('mailing-preview').disabled=true;
$('correction-request').value=state.correctionRequest||'';
setForm();
mailingTab(contentType(state.dossier)==='evenement'?'event':'editor');
$('main').inert=false;
$('studio-loading').hidden=true;
updateGaps({save:false});
try {
  renderStoryTemplates();
  render();
  syncGenerationControls();
} catch (error) {
  console.error('Studio preview initialization failed', error);
  feedback('L’aperçu enregistré n’a pas pu s’afficher. Vous pouvez modifier la saisie et générer un aperçu.', true, 'compose-feedback');
}
refreshBridgeStatus();
void refreshConnectionsOverview();
refreshWordPressConnection();
refreshPublicationList();
window.addEventListener('focus',()=>refreshBridgeStatus());
new ResizeObserver(fitSlidePreview).observe($('slide-stage'));
document.fonts.ready.then(fitSlidePreview);
void restoreSavedMedia().catch(error => {
  console.error('Studio media restoration failed', error);
  feedback('Certaines images n’ont pas pu être restaurées. Vous pouvez les rattacher dans la saisie.', true, 'compose-feedback');
});
if(localStorage.getItem(storageKey+'-pending')==='true'&&!cloudConflict){cloudPending=true;saveCloudSession();}
