// Held-out next-action questions on Show Me's demo sites. The seed script never uses
// these goals, names or artists, nor the two held-out page variants:
//   - Trattoria Nove after a failed submit (the "Please choose a sitting." error shown);
//   - Tubely results for a nav category ("music") when the goal names an artist.
// showme.test.js checks that scripts/seed-traffic.js mentions none of HELD_OUT.

import {
  NEW_TAB, TRATTORIA_IDS as T, TUBE_URL, resultTitles, trattoria, trattoriaLesson, tubelyHome, tubelyResults, tubelyWatch,
} from './pages.js';

export const HELD_OUT = {
  names: ['Folake', 'Chidi', 'Ngozi'],
  artists: ['Davido', 'Ayra Starr', 'Little Simz', 'Stormzy'],
  error: 'Please choose a sitting.',
};

const BOOKINGS = [
  { goal: 'Can you book us a table for seven on Saturday at eight? Put it under Folake.', party: '7', day: 'Saturday', name: 'Folake', demo: true },
  { goal: "Reserve Saturday's eight o'clock sitting for a party of four, booking name Chidi", party: '4', day: 'Saturday', name: 'Chidi', demo: true },
  { goal: 'I need a table tomorrow at 8pm for three people, under the name Ngozi', party: '3', day: 'Tomorrow', name: 'Ngozi', demo: false },
];

const step = (action, label, role, value = '') => ({ action, label, role, value });
const sittingC = { action: 'click', element_ids: [T.sitting.C] };
const askHuman = { action: 'ask_human' };

function bookingQuestions(b, bi) {
  const demo = b.demo ? trattoriaLesson() : null;
  const fillParty = { action: 'select', element_ids: [T.party], value: b.party };
  const fillDay = { action: 'select', element_ids: [T.day], value: b.day };
  const fillName = { action: 'type', element_ids: [T.name], value: b.name };
  const sitting = b.demo ? sittingC : askHuman;
  const h = {
    noThanks: step('click', 'No thanks', 'button'),
    party: step('select', 'Party size', 'select', b.party),
    day: step('select', 'Day', 'select', b.day),
    sitting: step('click', 'Sitting C', 'radio'),
    name: step('type', 'Name for the booking', 'textbox', b.name),
    reserve: step('click', 'Reserve table', 'button'),
  };
  const q = (id, page, history, expected, variant = 'known') => ({ id: `trattoria-${bi + 1}-${id}`, site: 'trattoria', variant, goal: b.goal, page, history, demo, expected });
  return [
    q('popup', trattoria({ dialog: true }), [], [{ action: 'click', element_ids: [T.noThanks] }]),
    q('fresh', trattoria(), [h.noThanks], [fillParty, fillDay, fillName]),
    q('party', trattoria({ party: b.party }), [h.noThanks, h.party], [fillDay, fillName, ...(b.demo ? [sittingC] : [])]),
    q('day', trattoria({ party: b.party, day: b.day }), [h.noThanks, h.party, h.day], [sitting, fillName]),
    ...(b.demo ? [q('sitting', trattoria({ party: b.party, day: b.day, sitting: 'C' }), [h.noThanks, h.party, h.day, h.sitting], [fillName])] : []),
    q('filled', trattoria({ party: b.party, day: b.day, sitting: 'C', name: b.name }),
      [h.noThanks, h.party, h.day, h.sitting, h.name], [{ action: 'click', element_ids: [T.reserve] }]),
    q('confirmed', trattoria({ confirmed: { party: b.party, day: b.day, sitting: 'C', name: b.name } }),
      [h.noThanks, h.party, h.day, h.sitting, h.name, h.reserve], [{ action: 'done' }]),
    q('error', trattoria({ party: b.party, day: b.day, name: b.name, error: HELD_OUT.error }),
      [h.noThanks, h.party, h.day, h.name, h.reserve], [sitting], 'variant'),
  ];
}

const VIDEO_GOALS = [
  { artist: 'Davido', goal: `open ${TUBE_URL} and play a Davido video`, pick: titles => titles.filter(t => !/playlist/i.test(t)) },
  { artist: 'Ayra Starr', goal: 'Watch Ayra Starr live at Wembley on Tubely', pick: titles => titles.filter(t => /live at Wembley/.test(t)) },
  { artist: 'Little Simz', goal: 'Find the Little Simz interview on Tubely and play it', pick: titles => titles.filter(t => /interview/.test(t)) },
  { artist: 'Stormzy', goal: "Put on Stormzy's official music video on Tubely", pick: titles => titles.filter(t => /Official Music Video/.test(t)) },
];

// A search that starts with the artist is right ("Little Simz interview" finds the interview too).
const SPACE = '(%20|\\+| )';
const qParam = artist => `q=${artist.split(' ').join(SPACE)}(${SPACE}[^&]*)?`;

function videoQuestions(v, vi) {
  const titles = resultTitles(v.artist);
  const right = v.pick(titles);
  const rightIds = right.map(t => `e${4 + titles.indexOf(t)}`);
  const search = [
    { action: 'type', element_ids: ['e2'], value_match: `^${v.artist}( .*)?$` },
    { action: 'open_url', value_match: `^${TUBE_URL.replace(/[.]/g, '\\.')}results\\.html\\?${qParam(v.artist)}$` },
  ];
  const opened = { action: 'open_url', label: null, role: null, value: TUBE_URL };
  const typed = step('type', 'Search videos', 'combobox', v.artist);
  const clicked = { action: 'click', label: `▶ ${right[0]} Tubely · 1.2M views`, role: 'link', value: '' };
  const q = (id, page, history, expected, variant = 'known') => ({ id: `tubely-${vi + 1}-${id}`, site: 'tubely', variant, goal: v.goal, page, history, expected });
  return [
    // Only a goal that gives the address can be answered from a blank tab.
    ...(v.goal.includes(TUBE_URL) ? [q('newtab', NEW_TAB, [], [{ action: 'open_url', value_match: `^${TUBE_URL.replace(/[.]/g, '\\.')}` }])] : []),
    q('home', tubelyHome(), [opened], search),
    q('results', tubelyResults(v.artist), [opened, typed], [{ action: 'click', element_ids: rightIds }]),
    q('paused', tubelyWatch(right[0]), [opened, typed, clicked], [{ action: 'click', element_ids: ['e4'] }]),
    q('playing', tubelyWatch(right[0], { playing: true }), [opened, typed, clicked, step('click', '▶ Play', 'button')], [{ action: 'done' }]),
    q('category', tubelyResults('music'), [opened, step('click', 'Music', 'link')], search, 'variant'),
  ];
}

export const QUESTIONS = [...BOOKINGS.flatMap(bookingQuestions), ...VIDEO_GOALS.flatMap(videoQuestions)];
