import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePublishedPosts} from './mailing-content.mjs';
import {nextParisMorning} from './mailing-api.mjs';

test('published catalogue separates stories from future dated events',()=>{
  const posts=[
    {id:1,date:'2026-11-02T12:00:00',link:'https://heritage-libanais.fr/recit/',title:{rendered:'Le cèdre &amp; le Liban'},content:{rendered:'<section class="editorial-carousel"><img class="new-cover-mark" src="https://heritage-libanais.fr/logo.png"><div class="new-slide-copy"><p>Un premier paragraphe vérifié et relu.</p></div><img src="https://heritage-libanais.fr/cedre.jpg" alt="Un cèdre &amp; la montagne"></section>'}},
    {id:2,date:'2026-11-03T12:00:00',link:'https://heritage-libanais.fr/ancien/',title:{rendered:'Ancien événement'},content:{rendered:'<section class="event-hero"><time datetime="2026-06-04T18:30:00+02:00">4 juin</time></section>'}},
    {id:3,date:'2026-11-04T12:00:00',link:'https://heritage-libanais.fr/futur/',title:{rendered:'Prochaine rencontre'},content:{rendered:'<section class="event-hero"><time datetime="2026-12-04T18:30:00+01:00">4 décembre</time><div class="event-story-copy"><p>Une rencontre à venir.</p></div></section>'}},
  ];
  const result=parsePublishedPosts(posts,Date.parse('2026-11-05T12:00:00Z'));
  assert.deepEqual(result.map(x=>x.id),[3,1]);
  assert.equal(result[1].title,'Le cèdre & le Liban');
  assert.equal(result[1].intro,'Un premier paragraphe vérifié et relu.');
  assert.equal(result[1].imageUrl,'https://heritage-libanais.fr/cedre.jpg');
  assert.equal(result[1].imageAlt,'Un cèdre & la montagne');
  assert.match(result[0].date,/4 décembre 2026/);
});

test('two Paris mornings stay at 10:00 when daylight saving time changes',()=>{
  assert.equal(nextParisMorning(1,new Date('2026-03-28T12:00:00Z')),'2026-03-29T08:00:00.000Z');
  assert.equal(nextParisMorning(2,new Date('2026-03-28T12:00:00Z')),'2026-03-30T08:00:00.000Z');
  assert.equal(nextParisMorning(1,new Date('2026-10-24T12:00:00Z')),'2026-10-25T09:00:00.000Z');
});
