// Fixed system prompts, one per Mubit task.
// Mubit groups calls into a task by model + system prompt + tools + output format.
// Changing any of these strings starts a NEW task and resets the example count,
// so everything that varies per call goes in the user message instead.

export const TASKS = {
  nextAction: 'next-action',
  doneCheck: 'done-check',
  safetyGate: 'safety-gate',
  locate: 'locate',
  refineLesson: 'refine-lesson',
  linkCheck: 'link-check',
};

export const SYSTEM_PROMPTS = {
  // Mo Guard. Fixed labels only, no free text: the adapter is graded on matching Claude.
  [TASKS.linkCheck]: [
    'You check links for phishing. You get a link, the text shown for it, the site it was found on, how old its domain is, and warning signals found by simple rules.',
    'Reply with JSON only, no prose: {"verdict":"safe"|"suspicious"|"phishing","pretends_to_be":"<the real domain it imitates, or empty>"}',
    'Say phishing when the link imitates a known brand or service (a look-alike spelling, the brand\'s name on any other domain including free website builders, or link text showing a different site) to collect logins, payments or personal details.',
    'Say suspicious when a page on free hosting or a throwaway domain uses words like login, verify, account or wallet, or shows another sign of deception without a clear imitation. Link shorteners, email tracking links, personal or project pages, home router addresses and ordinary sites are safe unless something else is wrong. A well-known site\'s own domain is safe. Signals are hints, not proof.',
  ].join('\n'),

  [TASKS.locate]: [
    'You find information on a web page for a user. You get the user\'s question or request and the page\'s text blocks, each with an id.',
    'If the page answers it, pick the block that holds the answer and write a one-sentence answer.',
    'Reply with JSON only, no prose: {"found":true|false,"block_id":"<id from the list, or empty>","answer":"<one short sentence, or empty>"}',
    'Rules: use only ids from the list. Quote numbers, times, prices and names exactly as the page has them. If the page does not contain the answer, reply found false.',
  ].join('\n'),

  [TASKS.refineLesson]: [
    'You clean up a human\'s demonstration of a browser task before it is used to train an agent. You get the goal and the numbered steps: what was done, on which page, and where it led.',
    'Keep the steps a careful person would still need to reach the goal. Drop detours (a result opened and then abandoned), typing that was later corrected, and accidental or repeated clicks.',
    'Reply with JSON only, no prose: {"drop":[<step numbers to drop>],"why":{"<step number>":"<at most 10 words>"}}',
    'Never drop the step that finally achieves the goal. If every step is needed, reply {"drop":[],"why":{}}.',
  ].join('\n'),

  // v3: full browser toolset, decision only. No free-text reason: a small adapter can make
  // the same decision as Claude but never word a reason the same way, and Mubit's test
  // counted that as a miss. (v1 and v2 are separate Mubit tasks.)
  [TASKS.nextAction]: [
    'You control a web browser for a user. You get the user\'s goal, the current page (URL and interactive elements), the steps already taken, and sometimes a demonstration a human recorded.',
    'Choose exactly one next action.',
    'Reply with JSON only, no prose: {"action":"<action>","element_id":"<id from the list, or empty>","value":"<see below, or empty>","submit":false}',
    'Actions:',
    '- click: element_id.',
    '- type: element_id, value = the text. Set "submit":true to press Enter afterwards (search boxes).',
    '- select: element_id, value = the option text.',
    '- press: value = Enter, Escape, Tab, ArrowDown or ArrowUp; element_id optional (default: focused element).',
    '- open_url: value = a full https URL. Use it to go to a site, or straight to a search results URL when you know its pattern.',
    '- back: go back one page.',
    '- scroll: value = down or up, to reveal more of the page.',
    '- wait: the page is still loading.',
    '- ask_human: you are stuck or unsure; value = what you need. A human will show you how.',
    '- done: the goal is complete.',
    'Rules: use only element ids from the list. Do not repeat a step that already succeeded. If a demonstration covers this page, follow it, adapting values to the current goal. Prefer open_url over clicking through menus when you know the address. Reply "done" only when the page shows the goal is achieved or the last step completed it.',
  ].join('\n'),

  // v2: a fixed problem code instead of a free-text reason (see next-action v3).
  [TASKS.doneCheck]: [
    'You check whether a browser task succeeded. You get the user\'s goal and the visible text of the page after the agent finished.',
    'Reply with JSON only, no prose: {"done":true|false,"problem":"none"|"wrong_time"|"wrong_date"|"wrong_count"|"wrong_name"|"wrong_item"|"no_confirmation"|"error"}',
    'Say done only if the page shows the goal was completed with every detail the user asked for: time, date, number of people or amount, name or email, item or video.',
    'If done is true, problem is "none". Otherwise use the first that applies: a different time, date, count or amount, name or email, item or video; no confirmation on the page; or an error message.',
  ].join('\n'),

  [TASKS.safetyGate]: [
    'You protect a user from irreversible browser actions. You get the user\'s goal and the action the agent is about to take.',
    'Reply with JSON only, no prose: {"allow":true|false,"reason":"<at most 12 words>"}',
    'Block payments, purchases, deletions, sending messages or transfers unless the goal clearly asks for exactly that.',
  ].join('\n'),
};

// Same cap as the content script, so the model sees every element we validate against.
const MAX_ELEMENTS = 80;

// Turns a page snapshot from the content script into the short text block the
// model sees. Kept compact: Mubit fails training on examples that are too long.
export function formatPage(page) {
  const lines = [];
  lines.push(`URL: ${page.url}`);
  if (page.title) lines.push(`Title: ${page.title}`);
  if (page.headings?.length) lines.push(`Headings: ${page.headings.slice(0, 5).join(' | ')}`);
  if (page.scroll) lines.push(`Scroll: ${page.scroll}`);
  // A little visible text tells the model what state the page is in ("Now playing", errors…).
  // It is the text on screen, so a scroll shows the model what it revealed.
  const text = (page.screenText || page.text || '').replace(/\s+/g, ' ').trim().slice(0, 600);
  if (text) lines.push(`Text: ${text}`);
  lines.push('Elements:');
  const elements = (page.elements || []).slice(0, MAX_ELEMENTS);
  if (!elements.length) lines.push(page.note || 'none');
  for (const el of elements) lines.push(formatElement(el));
  return lines.join('\n');
}

export function formatElement(el) {
  let line = `${el.id} ${el.role} "${el.label}"`;
  if (el.group) line += ` group="${el.group}"`;
  if (el.value !== undefined && el.value !== '') line += ` value="${el.value}"`;
  if (el.checked !== undefined) line += ` checked=${el.checked}`;
  if (el.options?.length) line += ` options=[${el.options.slice(0, 12).join(', ')}]`;
  if (el.disabled) line += ' disabled';
  if (el.inDialog) line += ' [in dialog]';
  return line;
}

export function formatStep(step) {
  const target = step.label ? `${step.role || 'element'} "${step.label}"` : (step.element_id || 'the page');
  switch (step.action) {
    case 'type': return `type "${step.value}" into ${target}${step.submit ? ' and press Enter' : ''}`;
    case 'select': return `select "${step.value}" in ${target}`;
    case 'press': return `press ${step.value}${step.label ? ` on ${target}` : ''}`;
    case 'open_url': return `open ${step.value}`;
    case 'back': return 'go back';
    case 'scroll': return `scroll ${step.value || 'down'}`;
    case 'wait': return 'wait for the page';
    case 'ask_human': return `ask the human: ${step.value}`;
    case 'highlight': return `point out "${step.value}"`;
    case 'new_tab': return 'open a new tab';
    case 'switch_tab': return `switch to the tab ${step.value}`;
    case 'done': return 'done';
    default: return `click ${target}`;
  }
}

export function formatDemonstration(demo) {
  if (!demo) return '';
  const lines = [`Demonstration recorded by a human on this page for the goal "${demo.goal}":`];
  demo.steps.forEach((s, i) => lines.push(`${i + 1}. ${formatStep(s)}`));
  return lines.join('\n');
}

export function buildNextActionMessage({ goal, page, history = [], demo }) {
  const parts = [`Goal: ${goal}`, '', formatPage(page), ''];
  parts.push('Steps already taken:');
  if (Array.isArray(history) && history.length) history.slice(-8).forEach((s, i) => parts.push(`${i + 1}. ${formatStep(s)}`));
  else parts.push('none');
  if (demo) parts.push('', formatDemonstration(demo));
  parts.push('', 'Answer with one JSON object only.');
  return parts.join('\n');
}

export function buildDoneCheckMessage({ goal, page }) {
  // What is on screen first: the agent stops where it found the answer, which on a long
  // page is far below the first 1,500 characters.
  const text = [page.screenText, page.text].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().slice(0, 1500);
  return `Goal: ${goal}\n\nURL: ${page.url}\nPage text: ${text}\n\nAnswer with one JSON object only.`;
}

export function buildSafetyMessage({ goal, action, element }) {
  return `Goal: ${goal}\n\nPending action: ${formatStep({ ...action, label: element?.label, role: element?.role })}`;
}

export function formatBlocks(page) {
  return (page.blocks || []).slice(0, 60).map(b => `${b.id} ${b.tag} "${b.text}"`).join('\n') || 'none';
}

export function buildLocateMessage({ goal, page, hint }) {
  const parts = [`Question: ${goal}`, '', `URL: ${page.url}`];
  if (page.title) parts.push(`Title: ${page.title}`);
  parts.push('Blocks:', formatBlocks(page));
  if (hint) parts.push('', `A human pointed out the answer on this page: "${hint}"`);
  parts.push('', 'Answer with one JSON object only.');
  return parts.join('\n');
}

export function buildRefineMessage({ goal, steps }) {
  const lines = [`Goal: ${goal}`, '', 'Steps:'];
  steps.forEach((s, i) => {
    let line = `${i + 1}. ${formatStep(s)} (on ${s.page?.url || 'unknown page'})`;
    if (s.led_to) line += ` → led to ${s.led_to}`;
    lines.push(line);
  });
  lines.push('', 'Answer with one JSON object only.');
  return lines.join('\n');
}
