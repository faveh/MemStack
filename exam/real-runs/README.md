# Show Me on real websites

Show Me's practice calls came from made-up pages (`scripts/seed-traffic.js`). These runs put
the real extension on real public websites, so the adapter Mubit trains for Show Me also
learns from real pages.

## Results

<!-- results:start -->
| Phase | Runs done | Finished | Failed | Stopped (safety) | Hit 12-step cap | Errors | Sites skipped | Steps | Mubit calls | Est. cost | Adapter share |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| before-fix | 19 | 9 | 7 | 1 | 1 | 1 | 2 | 70 | 138 | $0.19 | 0% |
| fix-proof | 5 | 1 | 4 | 0 | 0 | 0 | 0 | 22 | 51 | $0.06 | 0% |
| after-fix | 29 | 19 | 6 | 1 | 1 | 2 | 2 | 88 | 140 | $0.22 | 0% |
| all | 53 | 29 | 17 | 2 | 2 | 3 | 4 | 180 | 329 | $0.47 | 0% |

Calls by task: link-check 65, next-action 231, done-check 33.
<!-- results:end -->

**What the numbers say (24 Oct).** 53 runs on real sites, 29 finished, for $0.47 of the $1.50
cap. Before the fix 9 of 19 runs finished (47%); after it, 19 of 29 (66%). The two groups are
different goals, so this is a rough comparison, not a controlled one. Main failures after the fix: 3 scroll
loops on pages where the answer is far down, 1 repeated click and 2 page-load errors. Mubit's
adapter served none of the calls: it is not Live yet. The `before-fix` safety stop was a false
alarm (a ZIP-code search box on weather.gov); the rule now lets search boxes like that through.

- **Finished**: the agent said done and the done-check agreed.
- **Failed**: the agent gave up, repeated itself, or the done-check said the goal was not met.
- **Stopped (safety)**: the next step would log in, buy, post, send or fill in personal data, so
  the runner stopped the run before that step.
- **Hit 12-step cap**: the run used its 12 steps without finishing.
- **Sites skipped**: the site showed a CAPTCHA or blocked the bot, so nothing ran.
- **Est. cost**: list price for every call (Haiku 4.5, $1 / $5 per million tokens).
- **Adapter share**: share of answered calls with `vllm` in `x-middleware-served-by`.

## The scroll-loop fix

The first 19 runs (`before-fix`) showed one main failure: on a long page, Show Me scrolled
down again and again until it stopped itself (5 of 7 failures, all on Wikipedia).

**Why.** After a scroll, the model saw nothing new. The page text in each step's message was
the first 300 characters from the top of the page, so a scroll changed only the "Scroll: n%
down" line. The done-check had the same problem: it read the first 1,500 characters, so it
could not see an answer that the agent had scrolled to.

**The fix** (two small changes, no change to any system prompt or tool list, so the calls stay
in the same Mubit tasks):

- `extension/content.js`: the page snapshot also sends `screenText`, the text on screen now.
- `server/prompts.js`: the next-action message shows the on-screen text (up to 600
  characters), and the done-check message puts the on-screen text before the text from the top.

**Proof** on the 5 Wikipedia goals that looped, rerun with the next-action change only: 4 of 5
stopped scrolling and said done on the right page (before: 5 of 5 looped). But the old
done-check then said "not done" on 3 of those 4. With the done-check change, the done-check on
the 4 pages where those runs ended said done on 4 of 4. These 5 runs are the `fix-proof`
row in the table. The `after-fix` row is the goals not run before, with both changes.

## How it runs

- **The real extension.** Headless Chromium (new headless) loads `extension/` unpacked. An
  extension page imports `extension/agent-core.js` and calls `runAgent` on a real tab, the same
  loop the side panel runs. Page reading is `extension/content.js`; Mo Guard runs as usual.
- **The real server, unchanged.** `server/index.js` runs on a free port with
  `MUBIT_PROVIDER=anthropic MUBIT_MODEL=claude-haiku-4-5`. Recording stays on (no
  `x-middleware-record` header), so the calls land in the same Mubit tasks as the practice calls.
- **One small pass-through.** The server's Mubit base URL points at a local pass-through that
  sends each call on to `api.mubit.ai` unchanged. It notes the `x-middleware-served-by` header,
  the tokens and the cost, and it refuses calls once the spend reaches $1.45 of the $1.50 cap.
- **Read-only goals.** 52 goals on 23 sites ([goals.js](goals.js)), at most 8 per site: find a
  fact, read a price, look up a train or the weather, find a recipe, open a release, find
  opening hours. Before every step the runner checks the action. It stops the run before a
  log in, sign up, purchase, booking, post, message or personal-data form. A cookie banner is
  the only thing it lets the agent accept.
- **Nothing from third-party pages is kept in the repo.** Results go to `exam/real-runs/data/`
  (gitignored), or `$REALRUNS_DIR`.

```sh
npm ci && npx playwright install chromium
node exam/real-runs/run.js                # every goal not run yet (the key comes from the keychain item mubit-api-key, or MUBIT_API_KEY)
node exam/real-runs/run.js --limit 10     # the next 10
node exam/real-runs/run.js --report       # rewrite the table above from the results
node --test exam/real-runs/real-runs.test.js
```
