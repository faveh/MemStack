// The safety rules the real-runs runner applies before every step.
//   node --test exam/real-runs/real-runs.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unsafeStep } from './run.js';
import { GOALS } from './goals.js';

test('stops before logging in, buying, posting or filling in personal data', () => {
  for (const label of ['Sign in', 'Log in', 'Add to basket', 'Buy now', 'Checkout', 'Subscribe to our newsletter', 'Post comment', 'Star', 'Donate', 'Book tickets']) {
    assert.ok(unsafeStep({ action: 'click', label }), label);
  }
  assert.ok(unsafeStep({ action: 'type', label: 'Email address', value: 'a@b.c' }));
  assert.ok(unsafeStep({ action: 'open_url', value: 'https://github.com/login' }));
  assert.ok(unsafeStep({ action: 'click', label: 'Accept cookies and subscribe' }));
});

test('lets read-only steps and cookie banners through', () => {
  for (const label of ['Reject all cookies', 'Accept all cookies', 'Releases', '312 comments', 'Travel', 'Opening times', 'Books', 'Weather']) {
    assert.equal(unsafeStep({ action: 'click', label }), null, label);
  }
  assert.equal(unsafeStep({ action: 'type', label: 'Search Wikipedia', value: 'Lagos' }), null);
  assert.equal(unsafeStep({ action: 'type', label: 'Search by name or postcode', value: 'Cardiff' }), null);
  assert.equal(unsafeStep({ action: 'type', label: 'Local forecast by "City, St" or ZIP code', value: 'Seattle, WA' }), null);
  assert.equal(unsafeStep({ action: 'open_url', value: 'https://github.com/nodejs/node/releases' }), null);
  assert.equal(unsafeStep({ action: 'scroll', value: 'down' }), null);
});

test('about 50 goals, no more than 8 per site, none phrased as a question', () => {
  assert.ok(GOALS.length >= 50);
  assert.equal(new Set(GOALS.map(g => g.id)).size, GOALS.length);
  const perSite = GOALS.reduce((m, g) => ({ ...m, [new URL(g.url).host]: (m[new URL(g.url).host] || 0) + 1 }), {});
  for (const [site, n] of Object.entries(perSite)) assert.ok(n <= 8, site);
  for (const g of GOALS) assert.doesNotMatch(g.goal, /\?$|^(what|when|where|who|which|how|is|are|does|do|can)\b/i, g.id);
});
