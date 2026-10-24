# Show Me held-out exam: the demo sites

A backup to the Mind2Web exam (`exam/`). It trains Mubit's adapter on Show Me's own live
task, on its own demo sites (Trattoria Nove and Tubely), and tests it on goals and page
variants the training never saw. This is an easier task than Mind2Web, so an adapter should
pass sooner.

**We never force the adapter.** Every call is the live agent's own next-action call: the same
system prompt, message builder, model (`claude-haiku-4-5`, the starter credit's Anthropic model)
and request body. Mubit alone decides whether its adapter or the provider answers. We count the
calls the adapter served (response header `x-middleware-served-by` contains `vllm`).

## Results

| Route | Questions | Accuracy | Median ms | $ / 1,000 steps | Adapter share |
| --- | ---: | ---: | ---: | ---: | ---: |
| Haiku 4.5, provider (all) | 44 | 88.6% | 1329 | $1.25 | 0% |
| … Trattoria Nove | 23 | 87.0% | 1906 | $1.47 | 0% |
| … Tubely | 21 | 90.5% | 1200 | $1.00 | 0% |
| … held-out page variants | 7 | 71.4% | 1504 | $1.57 | 0% |
| Routed (later) | 44 | – | – | – | – |

**Status (24 Oct 2026, 17:05 BST).** 160 training calls are in Mubit, recorded, in the live tasks:
120 next-action and 40 done-check, all answered. The probe's two live-style calls were both
answered by the provider, with only `x-middleware-request-id` in the reply: no adapter is Live yet.
Run the routed exam once Mubit shows a passing next-action version. Estimated spend: $0.23
(seed $0.12, probe and two exam runs $0.11) of the $2 cap.

**What the misses are.** 5 of 44. Three are on the booking with no recalled demonstration: the
sitting times show only on hover, so the model guesses a sitting instead of asking the human
(`ask_human` is the expected answer, as in the live demo before it is taught). Two are on Tubely:
a click on the search box instead of typing in it, and a click on a "music" result for a
Stormzy goal.

- **Accuracy**: the chosen action matches one of the hand-written right actions for that step
  (action, element, and value where it matters). A step can have several right actions, for
  example filling the party size or the day first.
- **$ / 1,000 steps**: list price of Haiku 4.5 ($1 / $5 per million tokens, `server/ledger.js`).
  Adapter-served calls are counted at 5% of the provider call, the estimate `server/ledger.js` uses.
- **Latency**: wall time of each gateway call, 3 calls at once.
- **Adapter share**: share of answered calls the adapter served, with its `version=N`.

## Method

1. **Pages** (`pages.js`). Snapshots of the demo sites shaped like `extension/content.js`
   output: the same roles, labels, element ids, headings and visible text. Both the seed and the
   exam build their messages from these.
2. **Training** (`scripts/seed-traffic.js`). Half of the next-action calls are now on the demo
   sites, at every step of a booking or a video, with the human's lesson recalled about a third
   of the time. Run with recording on (the default), so Mubit keeps them as examples.
3. **Held out** (`heldout.js`). 44 questions. Known sites, new goals: names (Folake, Chidi,
   Ngozi), artists (Davido, Ayra Starr, Little Simz, Stormzy) and phrasings
   the seed never sends. Two page variants the seed never builds: Trattoria Nove after a failed
   submit ("Please choose a sitting."), and Tubely results for a nav category when the goal names
   an artist. A test checks that the seed mentions none of them.
4. **Exam** (`run.js`). Sent with `x-middleware-record: metadata`, so Mubit keeps no request or
   answer and the exam never trains anything.

The first run's rubric was too strict in two places, fixed before the run above: a search for
"Little Simz interview" now counts as a right search, and blank-tab questions are kept only for
the goal that gives the Tubely address (the others cannot know it).

## Run it

```bash
export MUBIT_API_KEY="$(security find-generic-password -s mubit-api-key -w)"   # never print it
MUBIT_PROVIDER=anthropic MUBIT_MODEL=claude-haiku-4-5 npm run seed -- --count 120 --checks 40 --concurrency 3
node exam/showme/run.js --probe             # 2 live-style calls: does the adapter answer yet?
node exam/showme/run.js --route provider    # held-out exam, recording off
node exam/showme/run.js --route routed      # the same exam once an adapter is Live
node --test exam/showme/                    # scorer and held-out set tests, no network
```

The live agent must run the same model to use this adapter: set `MUBIT_MODEL=claude-haiku-4-5`
in `.env` (the code's default, `claude-haiku-5-5`, is refused on the starter credit).

`run.js` reads the key from `MUBIT_API_KEY` or the macOS keychain item `mubit-api-key`. It writes
per-call logs and results to `$SHOWME_EXAM_DIR` (default `exam/showme/data/`, gitignored). A hard
cap of $2 of estimated spend stops it; set `SHOWME_DATA_DIR` to the seed's data folder so the cap
counts the seed's calls too.
