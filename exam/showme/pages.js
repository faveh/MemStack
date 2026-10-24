// Page snapshots of Show Me's two demo sites, shaped like extension/content.js output:
// same roles, labels, element ids, headings and visible text. The seed script and the
// held-out exam both build their next-action messages from these, so the adapter
// trains on the pages the live demo sends.

export const DEMO_ORIGIN = 'http://localhost:8787';
export const TRATTORIA_URL = `${DEMO_ORIGIN}/demo/`;
export const TUBE_URL = `${DEMO_ORIGIN}/demo/tube/`;

const PARTY_OPTIONS = ['1', '2', '3', '4', '5', '6', '7', '8'];
const DAYS = ['Tonight', 'Tomorrow', 'Saturday'];
export const SITTINGS = { A: '17:30', B: '18:45', C: '20:00', D: '21:15' };

const INFO_TEXT = 'Opening hours Monday Closed Tuesday to Saturday 12:00–23:00 Sunday 12:00–21:00, Sunday roast until 16:00';
const NEWSLETTER_TEXT = 'Join the Nove table Get first dibs on truffle season and our supper clubs. Subscribe No thanks';

// The newsletter pop-up opens on load, so its two buttons are seen first and take e1, e2;
// the form's controls get e3..e10 once it is dismissed.
export const TRATTORIA_IDS = {
  subscribe: 'e1', noThanks: 'e2', party: 'e3', day: 'e4',
  sitting: { A: 'e5', B: 'e6', C: 'e7', D: 'e8' }, name: 'e9', reserve: 'e10', again: 'e11',
};

// state: { dialog, party, day, sitting ('A'..'D'), name, error, confirmed: { party, day, sitting, name } }
export function trattoria(state = {}) {
  const ids = TRATTORIA_IDS;
  const base = { url: TRATTORIA_URL, title: 'Trattoria Nove — Book a table' };
  if (state.dialog) {
    return {
      ...base,
      headings: ['Trattoria Nove', 'Book a table', 'Opening hours', 'Good to know'],
      scroll: '0% down, 10 controls on the page',
      text: `Trattoria Nove Seasonal Roman cooking · Hackney Book a table Party size Choose… 1 2 3 4 5 6 7 8 Day Tonight Tomorrow Saturday Sitting Sitting A Sitting B Sitting C Sitting D Hover a sitting to see its time. Name for the booking Reserve table ${INFO_TEXT} ${NEWSLETTER_TEXT}`,
      elements: [
        { id: ids.subscribe, role: 'button', label: 'Subscribe', inDialog: true },
        { id: ids.noThanks, role: 'button', label: 'No thanks', inDialog: true },
      ],
    };
  }
  if (state.confirmed) {
    const c = state.confirmed;
    const guests = c.party === '1' ? '1 guest' : `${c.party} guests`;
    return {
      ...base,
      headings: ['Trattoria Nove', 'Booking confirmed', 'Opening hours', 'Good to know'],
      text: `Trattoria Nove Seasonal Roman cooking · Hackney Booking confirmed Table for ${guests}, ${c.day}, Sitting ${c.sitting} (${SITTINGS[c.sitting]}). See you soon, ${c.name}. Make another booking ${INFO_TEXT}`,
      elements: [{ id: ids.again, role: 'button', label: 'Make another booking' }],
    };
  }
  const day = state.day || 'Tonight';
  const error = state.error ? ` ${state.error}` : '';
  return {
    ...base,
    headings: ['Trattoria Nove', 'Book a table', 'Opening hours', 'Good to know'],
    scroll: '0% down, 8 controls on the page',
    text: `Trattoria Nove Seasonal Roman cooking · Hackney Book a table Party size ${state.party || 'Choose…'} 1 2 3 4 5 6 7 8 Day ${day} Tonight Tomorrow Saturday Sitting Sitting A Sitting B Sitting C Sitting D Hover a sitting to see its time. Name for the booking ${state.name || ''} Reserve table${error} ${INFO_TEXT}`,
    elements: [
      { id: ids.party, role: 'select', label: 'Party size', value: state.party || '', options: PARTY_OPTIONS },
      { id: ids.day, role: 'select', label: 'Day', value: day, options: DAYS },
      ...Object.keys(SITTINGS).map(s => ({ id: ids.sitting[s], role: 'radio', label: `Sitting ${s}`, group: 'Sitting', checked: state.sitting === s })),
      { id: ids.name, role: 'textbox', label: 'Name for the booking', value: state.name || '' },
      { id: ids.reserve, role: 'button', label: 'Reserve table' },
    ],
  };
}

// The demonstration a human records on Trattoria Nove in the demo: the 20:00 sitting is C,
// which only a hover shows. Recalled into later next-action calls on this page.
export function trattoriaLesson({ goal = 'Book a table for two at eight', party = '2', sitting = 'C', name = 'Alex' } = {}) {
  return {
    goal,
    steps: [
      { action: 'click', label: 'No thanks', role: 'button', value: '' },
      { action: 'select', label: 'Party size', role: 'select', value: party },
      { action: 'click', label: `Sitting ${sitting}`, role: 'radio', value: '' },
      { action: 'type', label: 'Name for the booking', role: 'textbox', value: name },
      { action: 'click', label: 'Reserve table', role: 'button', value: '' },
    ],
  };
}

const titleCase = q => q.replace(/\b\w/g, c => c.toUpperCase());
const videoLabel = title => `▶ ${title} Tubely · 1.2M views`;
export const TUBE_HOME_VIDEOS = ['Lagos street food tour', 'Premier League highlights', 'How to make jollof rice', 'Lo-fi beats to study to'];
export const resultTitles = q => {
  const nice = titleCase(q);
  return [`${nice} — Official Music Video`, `${nice} live at Wembley`, `${nice} interview`, `Best of ${nice} (playlist)`, `${nice} reaction video`, `${nice} documentary`];
};

// Header controls are e1..e3 on every Tubely page (a fresh page each time).
export function tubelyHome() {
  return {
    url: TUBE_URL,
    title: 'Tubely',
    headings: ['Trending'],
    text: `▶Tubely Home Music News Sport Trending ${TUBE_HOME_VIDEOS.map(t => `▶ ${t} Tubely · 1.2M views`).join(' ')}`,
    elements: [
      { id: 'e1', role: 'link', label: '▶Tubely' },
      { id: 'e2', role: 'combobox', label: 'Search videos' },
      { id: 'e3', role: 'button', label: 'Search' },
      ...['Home', 'Music', 'News', 'Sport'].map((label, i) => ({ id: `e${4 + i}`, role: 'link', label })),
      ...TUBE_HOME_VIDEOS.map((t, i) => ({ id: `e${8 + i}`, role: 'link', label: videoLabel(t) })),
    ],
  };
}

// Results for q; the video links are e4..e9 in the order resultTitles(q) gives.
export function tubelyResults(q) {
  const titles = resultTitles(q);
  return {
    url: `${TUBE_URL}results.html?q=${encodeURIComponent(q)}`,
    title: 'Search — Tubely',
    headings: [`Results for “${q}”`],
    text: `▶Tubely Results for “${q}” ${titles.map(t => `▶ ${t} Tubely · 1.2M views`).join(' ')}`,
    elements: [
      { id: 'e1', role: 'link', label: '▶Tubely' },
      { id: 'e2', role: 'textbox', label: 'Search videos', value: q },
      { id: 'e3', role: 'button', label: 'Search' },
      ...titles.map((t, i) => ({ id: `e${4 + i}`, role: 'link', label: videoLabel(t) })),
    ],
  };
}

// The watch page; the play button is e4.
export function tubelyWatch(title, { playing = false } = {}) {
  return {
    url: `${TUBE_URL}watch.html?t=${encodeURIComponent(title)}`,
    title: `${title} — Tubely`,
    headings: [title],
    text: `▶Tubely ${playing ? '❚❚ Pause' : '▶ Play'} ${title} ${playing ? `Now playing: ${title}` : 'Paused'}`,
    elements: [
      { id: 'e1', role: 'link', label: '▶Tubely' },
      { id: 'e2', role: 'textbox', label: 'Search videos', value: '' },
      { id: 'e3', role: 'button', label: 'Search' },
      { id: 'e4', role: 'button', label: playing ? '❚❚ Pause' : '▶ Play' },
    ],
  };
}

export const NEW_TAB = { url: 'chrome://newtab/', title: 'New Tab', headings: [], elements: [], note: 'none (browser start page: use open_url to go to a site)' };
