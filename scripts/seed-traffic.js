// Sends varied, realistic next-action and done-check calls through Mubit so both
// tasks reach the 25 kept examples Mubit needs before it trains a first adapter.
// Uses exactly the same system prompts and message builders as the live agent,
// so every call lands in the same Mubit task.
//
//   npm run seed                      # 60 next-action + 20 done-check calls
//   npm run seed -- --count 30 --checks 10
//   npm run seed -- --dry-run         # print one example message, send nothing

import { loadEnv } from '../server/env.js';
import { TASKS, buildNextActionMessage, buildDoneCheckMessage } from '../server/prompts.js';
import { NEW_TAB, TUBE_URL, resultTitles, trattoria, trattoriaLesson, tubelyHome, tubelyResults, tubelyWatch } from '../exam/showme/pages.js';

loadEnv();
const { callTask, getConfig } = await import('../server/llm.js');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : Number(args[i + 1]);
};
const dryRun = args.includes('--dry-run');
const COUNT = flag('count', 60);
const CHECKS = flag('checks', 20);
const CONCURRENCY = flag('concurrency', 3);

const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const shuffle = arr => arr.map(v => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map(([, v]) => v);
const NUMBERS = ['one', 'two', 'three', 'four', 'five', 'six'];
const NAMES = ['Ada', 'Tunde', 'Priya', 'Sam Okafor', 'Lena', 'Kofi', 'Mia Chen', 'Desmond'];

let idCounter = 1;
const el = (role, label, extra = {}) => ({ id: `e${idCounter++}`, role, label, ...extra });

// Each generator returns one decision point: a page, a goal and the steps taken so far.
const generators = [
  function restaurant() {
    idCounter = Math.floor(Math.random() * 20) + 1;
    const name = pick(['Trattoria Nove', 'Casa Lume', 'The Brass Fig', 'Mangal Yard', 'Suya Spot']);
    const n = Math.floor(Math.random() * 5) + 1;
    const time = pick(['seven', 'eight', 'half past seven', 'nine', '8pm', '19:30']);
    const goal = pick([`Book a table for ${NUMBERS[n]} at ${time}`, `Reserve a table for ${n} people at ${time} tonight`, `Get us a table for ${NUMBERS[n]} at ${time} tomorrow`]);
    const els = [
      el('select', 'Party size', { value: '', options: ['1', '2', '3', '4', '5', '6', '7', '8'] }),
      el('select', pick(['Day', 'Date']), { value: 'Tonight', options: ['Tonight', 'Tomorrow', 'Saturday'] }),
      ...shuffle(['A', 'B', 'C', 'D']).slice(0, 4).sort().map(s => el('radio', `Sitting ${s}`, { group: 'Sitting', checked: false })),
      el('textbox', 'Name for the booking', { value: '' }),
      el('button', pick(['Reserve table', 'Book now', 'Confirm booking'])),
    ];
    const history = [];
    const stage = Math.floor(Math.random() * 3);
    if (stage >= 1) { els[0].value = String(n); history.push({ action: 'select', label: 'Party size', role: 'select', value: String(n) }); }
    if (stage >= 2) { els[2].checked = true; history.push({ action: 'click', label: els[2].label, role: 'radio', value: '' }); }
    const withPopup = stage === 0 && Math.random() < 0.4;
    const elements = withPopup
      ? [el('button', 'Subscribe', { inDialog: true }), el('button', pick(['No thanks', 'Not now', 'Close']), { inDialog: true })]
      : els;
    const lesson = {
      goal: 'Book a table for two at eight',
      steps: [
        { action: 'select', label: 'Party size', role: 'select', value: '2' },
        { action: 'click', label: 'Sitting C', role: 'radio', value: '' },
        { action: 'type', label: 'Name for the booking', role: 'textbox', value: 'Alex' },
        { action: 'click', label: els[els.length - 1].label, role: 'button', value: '' },
      ],
    };
    return { goal, page: { url: `https://${name.toLowerCase().replace(/\W+/g, '')}.example/book`, title: `${name} — Book a table`, headings: [name, 'Book a table'], elements }, history, lesson };
  },

  function signup() {
    idCounter = Math.floor(Math.random() * 30) + 1;
    const person = pick(NAMES);
    const email = `${person.split(' ')[0].toLowerCase()}@example.com`;
    const goal = pick([`Sign me up for the newsletter as ${email}`, `Create an account for ${person} with ${email}`, `Register ${email} for the beta waitlist`]);
    const elements = [
      el('link', 'Pricing'), el('link', 'Log in'),
      el('textbox', 'Full name', { value: '' }), el('textbox', 'Work email', { value: '' }),
      el('checkbox', 'I agree to the terms', { checked: false }),
      el('button', pick(['Join the waitlist', 'Create account', 'Sign up'])),
    ];
    const history = [];
    if (Math.random() < 0.5) { elements[2].value = person; history.push({ action: 'type', label: 'Full name', role: 'textbox', value: person }); }
    return { goal, page: { url: 'https://app.example/signup', title: 'Sign up', headings: ['Get early access'], elements }, history };
  },

  function search() {
    idCounter = Math.floor(Math.random() * 40) + 1;
    const item = pick(['wireless earbuds', 'running shoes size 10', 'a USB-C hub', 'a standing desk', 'noise cancelling headphones']);
    const goal = pick([`Search for ${item}`, `Find ${item} under £100`, `Look up ${item} and sort by price`]);
    const elements = [
      el('link', 'Home'), el('link', 'Deals'), el('textbox', 'Search products', { value: '' }),
      el('button', 'Search'), el('select', 'Sort by', { value: 'Relevance', options: ['Relevance', 'Price: low to high', 'Price: high to low', 'Rating'] }),
      el('link', 'Basket (0)'),
    ];
    const history = [];
    if (Math.random() < 0.5) { elements[2].value = item; history.push({ action: 'type', label: 'Search products', role: 'textbox', value: item }); }
    return { goal, page: { url: 'https://shop.example/', title: 'Shop', headings: ['Shop everything'], elements }, history };
  },

  function cookieBanner() {
    idCounter = Math.floor(Math.random() * 10) + 1;
    const goal = pick(['Read the latest article', 'Open the pricing page', 'Check the opening hours', 'Find the contact page']);
    const elements = [
      el('button', pick(['Accept all', 'Allow all cookies']), { inDialog: true }),
      el('button', pick(['Reject all', 'Necessary only', 'Reject non-essential']), { inDialog: true }),
      el('link', 'Manage preferences', { inDialog: true }),
    ];
    return { goal, page: { url: 'https://news.example/', title: 'News', headings: ['We value your privacy'], elements }, history: [] };
  },

  function blankStart() {
    const goal = pick([
      `Open YouTube and play a ${pick(['Burna Boy', 'Tems', 'Wizkid', 'Asake', 'Adele'])} video`,
      `Go to Wikipedia and look up ${pick(['Lagos', 'the Thames', 'Alan Turing', 'jollof rice'])}`,
      'Check the weather in London on the BBC',
      `Search Google for ${pick(['cheap flights to Lagos', 'best ramen in Soho', 'hackathons in London'])}`,
      `Find ${pick(['running shoes', 'a USB-C hub', 'noise cancelling headphones'])} on Amazon`,
    ]);
    return { goal, page: { url: 'chrome://newtab/', title: 'New Tab', headings: [], elements: [], note: 'none (browser start page: use open_url to go to a site)' }, history: [] };
  },

  function videoResults() {
    idCounter = Math.floor(Math.random() * 60) + 1;
    const artist = pick(['Burna Boy', 'Tems', 'Wizkid', 'Asake', 'Adele']);
    const goal = pick([`Play a ${artist} video`, `Open YouTube and play ${artist}`, `Watch ${artist} live`]);
    const searched = Math.random() < 0.6;
    const elements = [
      el('link', 'YouTube Home'), el('textbox', 'Search', { value: searched ? artist : '' }), el('button', 'Search'),
      el('button', 'Search with your voice'), el('link', 'Shorts'), el('link', 'Subscriptions'),
      ...(searched ? shuffle([`${artist} - Official Music Video`, `${artist} live at Glastonbury`, `${artist} interview`, `Best of ${artist} playlist`])
        .map(t => el('link', `${t} 12M views 2 years ago`)) : [el('link', 'Trending video 1M views'), el('link', 'Lo-fi beats 3M views')]),
    ];
    const history = searched
      ? [{ action: 'open_url', label: null, role: null, value: `https://www.youtube.com/results?search_query=${encodeURIComponent(artist)}` }]
      : [{ action: 'open_url', label: null, role: null, value: 'https://www.youtube.com' }];
    const url = searched ? `https://www.youtube.com/results?search_query=${encodeURIComponent(artist)}` : 'https://www.youtube.com/';
    return { goal, page: { url, title: 'YouTube', headings: [], scroll: '0% down, 412 controls on the page', elements }, history };
  },

  // Show Me's own demo sites, as the extension snapshots them, at every step of a booking
  // or a video. Names and artists come from this file's lists only: exam/showme/heldout.js
  // keeps other names, artists and two page variants back for the held-out exam.
  function trattoriaNove() {
    const n = String(Math.floor(Math.random() * 8) + 1);
    const day = pick(['Tonight', 'Tomorrow', 'Saturday']);
    const person = pick(NAMES).split(' ')[0];
    const when = day === 'Tonight' ? pick(['', ' tonight']) : ` ${day.toLowerCase()}`;
    const goal = pick([
      `Book a table for ${NUMBERS[n - 1] || n}${when} at eight, name ${person}`,
      `Reserve a table for ${n}${when} at 20:00 under ${person}`,
      `Book Trattoria Nove for ${n} people${when} at 8pm, the name is ${person}`,
    ]);
    const steps = [
      { action: 'click', label: 'No thanks', role: 'button', value: '' },
      { action: 'select', label: 'Party size', role: 'select', value: n },
      ...(day === 'Tonight' ? [] : [{ action: 'select', label: 'Day', role: 'select', value: day }]),
      { action: 'click', label: 'Sitting C', role: 'radio', value: '' },
      { action: 'type', label: 'Name for the booking', role: 'textbox', value: person },
      { action: 'click', label: 'Reserve table', role: 'button', value: '' },
    ];
    const stage = Math.floor(Math.random() * (steps.length + 1));
    const history = steps.slice(0, stage);
    const did = label => history.some(s => s.label === label);
    const page = stage === 0 ? trattoria({ dialog: true })
      : stage === steps.length ? trattoria({ confirmed: { party: n, day, sitting: 'C', name: person } })
      : trattoria({ party: did('Party size') ? n : '', day: did('Day') ? day : 'Tonight', sitting: did('Sitting C') ? 'C' : undefined, name: did('Name for the booking') ? person : '' });
    return { goal, page, history, lesson: trattoriaLesson() };
  },

  function tubely() {
    const artist = pick(ARTISTS);
    const goal = pick([`open ${TUBE_URL} and play a ${artist} video`, `Play ${artist} on Tubely`, `Find a ${artist} video on Tubely and play it`]);
    const title = resultTitles(artist)[pick([0, 0, 1])];
    const steps = [
      { action: 'open_url', label: null, role: null, value: TUBE_URL },
      pick([{ action: 'type', label: 'Search videos', role: 'combobox', value: artist, submit: true }, { action: 'open_url', label: null, role: null, value: `${TUBE_URL}results.html?q=${encodeURIComponent(artist)}` }]),
      { action: 'click', label: `▶ ${title} Tubely · 1.2M views`, role: 'link', value: '' },
      { action: 'click', label: '▶ Play', role: 'button', value: '' },
    ];
    const stage = Math.floor(Math.random() * (steps.length + 1));
    const pages = [NEW_TAB, tubelyHome(), tubelyResults(artist), tubelyWatch(title), tubelyWatch(title, { playing: true })];
    return { goal, page: pages[stage], history: steps.slice(0, stage) };
  },

  function support() {
    idCounter = Math.floor(Math.random() * 25) + 1;
    const order = `#${Math.floor(10000 + Math.random() * 90000)}`;
    const goal = pick([`Ask support where order ${order} is`, `Request a refund for order ${order}`, `Report that order ${order} arrived damaged`]);
    const elements = [
      el('select', 'Topic', { value: '', options: ['Delivery', 'Refunds', 'Damaged item', 'Account', 'Other'] }),
      el('textbox', 'Order number', { value: '' }), el('textbox', 'Message', { value: '' }),
      el('button', 'Send message'), el('link', 'Help centre'),
    ];
    return { goal, page: { url: 'https://help.example/contact', title: 'Contact us', headings: ['How can we help?'], elements }, history: [] };
  },
];

// Half the calls are on the demo sites, the pages the live demo sends.
const DEMO_SITES = ['trattoriaNove', 'tubely'];
const sample = () => (Math.random() < 0.5
  ? pick(generators.filter(g => DEMO_SITES.includes(g.name)))
  : pick(generators.filter(g => !DEMO_SITES.includes(g.name))))();

// About a third of restaurant calls carry a recalled lesson, as the live agent's do
// after a "show me". Lessons are always sensible: a wrong lesson would train a wrong adapter.
function maybeDemo(sample) {
  if (!sample.lesson || Math.random() > 0.35) return null;
  return sample.lesson;
}

// Done-check practice: coherent goal + result pages, roughly half real successes and
// half near-misses (one detail wrong) or no confirmation at all. Near-misses teach the
// adapter to catch "booked, but at the wrong time", the mistake it made in testing.
const SITTINGS = [['17:30', 'half past five'], ['18:45', 'quarter to seven'], ['19:30', 'half past seven'], ['20:00', 'eight'], ['21:15', 'quarter past nine']];
const DAYS = ['Tonight', 'Tomorrow', 'Saturday'];
const PEOPLE = ['Ada', 'Kofi', 'Priya', 'Sam', 'Lena', 'Tunde', 'Mia'];
const ARTISTS = ['Burna Boy', 'Wizkid', 'Tems', 'Asake', 'Adele', 'Rema'];
const ITEMS = ['running shoes size 10', 'a USB-C hub', 'noise cancelling headphones', 'a standing desk'];
const other = (list, not) => pick(list.filter(x => x !== not));

function doneCheckSample() {
  const roll = Math.random(); // < .5 success, < .9 near-miss, else nothing confirmed
  const kind = pick(['restaurant', 'restaurant', 'video', 'waitlist', 'search', 'support']);
  if (kind === 'restaurant') {
    const n = Math.floor(Math.random() * 5) + 2;
    const [time, spoken] = pick(SITTINGS);
    const day = pick(DAYS);
    const name = pick(PEOPLE);
    const goal = `Book a table for ${NUMBERS[n - 1]} at ${spoken}${day === 'Tonight' ? '' : ' ' + day.toLowerCase()}`;
    const booked = (guests, t, d) => `Booking confirmed. Table for ${guests} guests, ${d}, Sitting ${'ABCDE'[SITTINGS.findIndex(x => x[0] === t)]} (${t}). See you soon, ${name}.`;
    if (roll < 0.5) return { goal, text: booked(n, time, day) };
    if (roll < 0.9) {
      const miss = pick(['time', 'time', 'party', 'day']);
      if (miss === 'time') return { goal, text: booked(n, other(SITTINGS.map(x => x[0]), time), day) };
      if (miss === 'party') return { goal, text: booked(n === 2 ? 3 : n - 1, time, day) };
      return { goal, text: booked(n, time, other(DAYS, day)) };
    }
    return { goal, text: pick(['Please choose a sitting, a name.', 'Sorry, that sitting is full. Please choose another time.', 'Book a table. Party size Day Sitting Name for the booking Reserve table']) };
  }
  if (kind === 'video') {
    const artist = pick(ARTISTS);
    const goal = pick([`Play a video by ${artist}`, `Open YouTube and play ${artist}`]);
    if (roll < 0.5) return { goal, text: `Now playing: ${artist} — Official Music Video. Tubely · 1.2M views` };
    if (roll < 0.9) return { goal, text: `Now playing: ${other(ARTISTS, artist)} — Official Music Video. Tubely · 1.2M views` };
    return { goal, text: `Results for “${artist}”. ${artist} — Official Music Video. ${artist} live at Wembley. Paused` };
  }
  if (kind === 'waitlist') {
    const who = pick(PEOPLE).toLowerCase();
    const goal = `Sign me up for the beta waitlist as ${who}@example.com`;
    if (roll < 0.5) return { goal, text: `Thanks! You're on the waitlist. We sent a confirmation to ${who}@example.com.` };
    if (roll < 0.9) return { goal, text: `Thanks! You're on the waitlist. We sent a confirmation to ${other(PEOPLE.map(p => p.toLowerCase()), who)}@example.com.` };
    return { goal, text: 'Please enter a valid email address.' };
  }
  if (kind === 'search') {
    const item = pick(ITEMS);
    const goal = `Find ${item} sorted by price`;
    if (roll < 0.5) return { goal, text: `Search results for "${item}" — 48 results, sorted by Price: low to high.` };
    if (roll < 0.9) return { goal, text: `Search results for "${item}" — 48 results, sorted by Relevance.` };
    return { goal, text: `No results for "${item}". Try a different search.` };
  }
  const order = `#${Math.floor(10000 + Math.random() * 90000)}`;
  const goal = `Ask support where order ${order} is`;
  if (roll < 0.5) return { goal, text: `Message sent. We'll reply about order ${order} within 24 hours.` };
  if (roll < 0.9) return { goal, text: `Message sent. We'll reply about order #${Math.floor(10000 + Math.random() * 90000)} within 24 hours.` };
  return { goal, text: 'Please fill in the message field.' };
}

async function runPool(jobs) {
  let ok = 0, failed = 0, next = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (next < jobs.length) {
      const i = next++;
      try {
        await jobs[i]();
        ok++;
      } catch (err) {
        failed++;
        console.error(`  call ${i + 1} failed: ${err.message}`);
        if (/401|403|starter_credit/.test(err.message)) throw err;
      }
      if ((ok + failed) % 10 === 0) console.log(`  ${ok + failed}/${jobs.length} (${failed} failed)`);
    }
  });
  await Promise.all(workers);
  return { ok, failed };
}

const config = getConfig();
if (dryRun) {
  const s = sample();
  console.log(buildNextActionMessage({ goal: s.goal, page: s.page, history: s.history, demo: maybeDemo(s) }));
  console.log('\nDone-check samples:');
  for (let i = 0; i < 6; i++) { const d = doneCheckSample(); console.log(`- ${d.goal}  →  ${d.text}`); }
  process.exit(0);
}
if (config.provider === 'mock') {
  console.error('No MUBIT_API_KEY in .env, so there is nothing to seed. Add your key (see .env.example) and run again.');
  process.exit(1);
}

console.log(`Seeding through Mubit: ${COUNT} next-action + ${CHECKS} done-check calls on ${config.provider} / ${config.model}`);
const jobs = [];
for (let i = 0; i < COUNT; i++) {
  jobs.push(async () => {
    const s = sample();
    await callTask({ task: TASKS.nextAction, userMessage: buildNextActionMessage({ goal: s.goal, page: s.page, history: s.history, demo: maybeDemo(s) }), sessionId: `seed-na-${Date.now()}-${i}`, kind: 'live' });
  });
}
for (let i = 0; i < CHECKS; i++) {
  jobs.push(async () => {
    const { goal, text } = doneCheckSample();
    const page = { url: 'https://example.app/result', text };
    await callTask({ task: TASKS.doneCheck, userMessage: buildDoneCheckMessage({ goal, page }), sessionId: `seed-dc-${Date.now()}-${i}`, kind: 'live' });
  });
}
let ok, failed;
try {
  ({ ok, failed } = await runPool(jobs));
} catch (err) {
  console.error(`Stopped: ${err.message}`);
  console.error('Check MUBIT_API_KEY, how calls are paid (starter credit or provider key) and MUBIT_MODEL in .env.');
  process.exit(1);
}
console.log(`Done: ${ok} sent, ${failed} failed. Open Mubit → Tasks to watch "next-action" and "done-check" count towards 25.`);
