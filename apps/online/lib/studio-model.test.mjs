import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STATUSES, createProposal, dossierGaps, emptyState, markReady, saveDossier, separateDossiers, validate, workflowStepIndex,
} from '../public/private-studio/studio-model.mjs';

const propose = (dossier) => createProposal(saveDossier(emptyState(), dossier));

test('a story can be validated without entering separate sources or facts', () => {
  const dossier = { ...emptyState().dossier, title: 'La côte du Liban', sourceText: 'Le rivage ouvre sur la mer.' };
  const reviewed = validate(markReady(propose(dossier)), 'Éditeur');
  assert.equal(reviewed.status, 'Carte site en brouillon');
  assert.equal(reviewed.draft.sources, '');
  assert.equal(reviewed.draft.facts, '');
});

test('legacy mixed drafts keep their story and event proposals in separate workspaces',()=>{
  const story={...emptyState().dossier,title:'Premier récit',sourceText:'Texte du récit.'};
  const event={...emptyState('evenement').dossier,title:'Rencontre',sourceText:'Programme.'};
  const previous=propose(story);
  const mixed=createProposal(saveDossier(previous,event));
  const separated=separateDossiers(mixed);
  assert.deepEqual(separated.proposals,[mixed.proposals[1]]);
  assert.deepEqual(separated.otherDossier.proposals,previous.proposals);
  assert.deepEqual(separated.otherDossier.dossier,story);
  assert.equal(separateDossiers(separated),separated);
  assert.equal(createProposal(saveDossier(separated,event)).proposals.at(-1).number,3);
});

test('a changed event input requires a refreshed preview before validation',()=>{
  const dossier={...emptyState('evenement').dossier,title:'Rencontre',sourceText:'Programme.',eventIcon:'cedar'};
  Object.assign(dossier.event,{startDate:'2026-12-10',startTime:'18:00',venue:'Salle fictive'});
  const output={title:dossier.title,summary:dossier.sourceText,contentType:'evenement',siteEvent:true,event:dossier.event};
  const state=createProposal(saveDossier(emptyState('evenement'),dossier),output);
  assert.equal(validate(state,'Éditeur').draft.title,'Rencontre');
  state.dossier.eventIcon='book';
  assert.throws(()=>validate(state,'Éditeur'),/Actualisez l’aperçu/);
});

test('an event still requires the date, start time and place, and photo mode requires a photo', () => {
  const dossier = { ...emptyState().dossier, contentType: 'evenement', title: 'Une rencontre' };
  assert.deepEqual(dossierGaps(dossier), ['évènement : date', 'évènement : horaire', 'évènement : lieu ou accès en ligne']);
  assert.throws(() => markReady(propose(dossier)), /date.*horaire.*lieu/);
  const withDetails = {
    ...dossier, event: { ...dossier.event, startDate: '15 novembre 2026', startTime: '18 h', venue: 'Beyrouth' },
  };
  assert.equal(validate(markReady(propose(withDetails)), 'Éditeur').status, 'Carte site en brouillon');
  assert.throws(() => markReady(propose({ ...withDetails, mediaMode: 'photos' })), /une photo/);
});

test('saved statuses map to four workflow steps', () => {
  assert.deepEqual(STATUSES.map(workflowStepIndex), [0, 0, 1, 1, 2, 2, 3, 3, 3, 3]);
  assert.equal(workflowStepIndex(undefined), 0);
});

test('event publishing keeps only the selected image without removing images from the working dossier',async()=>{
  const {publicationMedia}=await import('../public/private-studio/studio-model.mjs');
  const dossier={contentType:'evenement',mediaMode:'photos',media:[{id:'a'},{id:'b'}],eventImageId:'b'};
  assert.deepEqual(publicationMedia(dossier).map(item=>item.id),['b']);
  assert.deepEqual(publicationMedia({...dossier,eventImageId:null}),[]);
  assert.deepEqual(publicationMedia({...dossier,contentType:'recit'}).map(item=>item.id),['a','b']);
  assert.equal(dossier.media.length,2);
});
