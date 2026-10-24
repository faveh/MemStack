# Show Me exam: does the Mubit adapter learn, and does it carry over?

This folder tests Show Me's next-action step on real websites from Mind2Web. It compares
the Mubit-routed system with provider-only routes on accuracy, cost and speed. It also checks
how well the learning carries over to work that is not the same as the training: new tasks,
new websites and new domains.

**We never force the adapter.** The routed run sends the same Sonnet 5.5 call as the baseline.
Mubit alone decides whether its adapter or the provider answers. We count the calls the adapter
served (response header `x-middleware-served-by` contains `vllm`). So the adapter share *is* the
measure of when Mubit trusts its adapter.

## Results

<!-- results:start -->
| Route | Split | Steps | Step SR | Ele.Acc | Op-F1 | Median ms | p90 ms | $ / 1,000 steps | Adapter share |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Sonnet 5.5, teacher (train, recorded) | train | 400 | 64.8% | 70.5% | 82.3% | 1312 | 2347 | $3.02 | – |
| Sonnet 5.5, provider only | test_task | 200 | 68% | 76.5% | 84.4% | 1278 | 1952 | $3.04 | – |
| Sonnet 5.5, provider only | test_website | 200 | 58.5% | 69.5% | 73.7% | 1167 | 1929 | $3.06 | – |
| Sonnet 5.5, provider only | test_domain | 200 | 60.5% | 67% | 83.9% | 1174 | 1991 | $2.94 | – |
| Sonnet 5.5, provider only | all | 600 | 62.3% | 71% | 80.7% | 1199 | 1947 | $3.02 | – |
| Haiku 4.5, provider only | test_task | 200 | 57.5% | 70% | 80.4% | 926 | 1529 | $1.19 | – |
| Haiku 4.5, provider only | test_website | 200 | 52.5% | 68% | 72.7% | 903 | 1641 | $1.21 | – |
| Haiku 4.5, provider only | test_domain | 200 | 52% | 63% | 79% | 933 | 1899 | $1.20 | – |
| Haiku 4.5, provider only | all | 600 | 54% | 67% | 77.4% | 922 | 1764 | $1.20 | – |
| gpt-6-luna, provider only | test_task | 200 | 53% | 61.5% | 70% | 1528 | 2208 | $0.10 | – |
| gpt-6-luna, provider only | test_website | 200 | 48% | 55.5% | 63.1% | 1421 | 2253 | $0.09 | – |
| gpt-6-luna, provider only | test_domain | 200 | 48.5% | 56.5% | 65.9% | 1533 | 3989 | $0.09 | – |
| gpt-6-luna, provider only | all | 600 | 49.8% | 57.8% | 66.3% | 1483 | 2629 | $0.09 | – |
<!-- results:end -->

**Status (24 Oct, 15:33 UTC).** The 400 teacher calls are in Mubit (recorded) and the three provider
baselines are done. The adapter is not Live yet: the probe's two calls (recording off, then on) were
both answered by the provider, with only `x-middleware-request-id` in the reply. The routed row comes
once Mubit has a passing version. Estimated spend so far: $3.79 of the $8 cap.

**What the baselines say.** Sonnet 5.5 is the best provider (62% Step SR over the 3 test splits) and
the teacher. It drops 7 to 10 points from known sites (68%) to new sites (58.5%) and new domains
(60.5%). Haiku 4.5 costs 40% of Sonnet for 8 points less; gpt-6-luna costs 3% of Sonnet for 12 points less.
The adapter's job is to get near Sonnet's line at near luna's price, and the split columns show
whether that holds on sites and domains it never saw.

- **Step SR**: the right element AND the right operation (click/type/select, and the exact typed or selected value). Mind2Web's step success.
- **Ele.Acc**: the right element. **Op-F1**: token F1 of "operation value", a softer value score.
- **$ / 1,000 steps**: list prices from `server/ledger.js` (Sonnet 5.5 $2/$10, Haiku 4.5 $1/$5 per million tokens), gpt-6-luna $0.10/$0.50 (third-party pages quoting OpenAI). Adapter-served calls have no published price: they are counted at 5% of the provider call, the estimate `server/ledger.js` uses.
- **Latency**: wall time of each gateway call, 4 calls at once.
- **Adapter share**: share of answered calls the adapter served, with its `version=N`.

## Method

1. **Data.** Multimodal-Mind2Web parquet (Hugging Face `osunlp/Multimodal-Mind2Web`), pulled with DuckDB, only the needed columns. Splits:
   - `train`: the teacher's examples. 400 steps from whole tasks, only on sites that also appear in `test_task`.
   - `test_task`: known sites, new tasks.
   - `test_website`: 10 sites never seen in training.
   - `test_domain`: domains never seen in training (Info, Service).
   - 200 steps per test split, whole tasks spread over sites, fixed seed. Steps with no right element are dropped.
2. **Conversion** (`convert.js`, `describe.py`). Each step becomes Show Me's own next-action message, built by `server/prompts.js`: goal, `URL: (not recorded) site: <site>`, 300 characters of page text, 25 elements (the right one plus 24 control-like elements from the same page, fixed seed, page order, ids `e1..e25`; role and label rules from `extension/content.js`), and the last 8 steps already taken.
3. **One Mubit task.** The system prompt is Show Me's next-action prompt plus one line: "Pages come from a recorded dataset; the URL is not recorded, so do not use open_url." This keeps the exam out of Show Me's live task. Training and exam calls send this exact prompt to the same model (`claude-sonnet-5-5`), so the adapter trains for the exam task.
4. **Teacher.** Sonnet 5.5 answers the 400 train steps through Mubit with recording on and `metadata.user_id` = the Mind2Web task id. Mubit keeps these as examples and trains its adapter by itself (it first trains at 25 kept examples).
5. **Baselines.** Sonnet 5.5, Haiku 4.5 and gpt-6-luna answer the 600 test steps through Mubit with `x-middleware-record: metadata`. Mubit keeps no request or answer, so test data never trains anything.
6. **Routed run.** Once an adapter version is Live, the Sonnet exam runs again, unforced. Mubit picks.

## Run it

```bash
uv run --with duckdb --with lxml python -I exam/pull.py meta     # light columns, all splits (~25 s)
uv run --with duckdb --with lxml python -I exam/pull.py sample   # fixed-seed sample
uv run --with duckdb --with lxml python -I exam/pull.py html     # page HTML for sampled rows only
node exam/run.js --route teacher                       # train calls, recording on
node exam/run.js --route sonnet                        # also: haiku, luna
node exam/run.js --probe                               # does Mubit route to the adapter now?
node exam/run.js --route routed --no-cache             # unforced Sonnet exam; add --record full if the probe says so
node exam/report.js                                    # results.json + the table above
node --test exam/                                      # converter and scorer tests, no network
```

The Mubit key comes from `MUBIT_API_KEY` or the macOS keychain item `mubit-api-key`. Responses are
cached by input hash in `exam/.cache/`, so a rerun costs nothing. A hard budget cap of $8 of
estimated spend stops every route. Data and per-call logs stay in `exam/data/` (gitignored).

## Honest limits

- **Easier than published Mind2Web.** Papers rank every element on the page (hundreds). We give a short list of 25 that always holds the right answer, like the second stage of MindAct. Our numbers do not compare with published ones. They compare routes with each other: every route sees the same inputs.
- **The adapter learns the teacher, not the ground truth.** Mubit tests an adapter on how well it matches Sonnet's answers. Sonnet's own accuracy is the ceiling.
- **Small samples.** 200 steps per split gives about ±7 points at 95%. `test_website` has only 10 sites.
- **Exact value match is strict.** "Brooklyn - Central, NY" fails against "Brooklyn Central". Op-F1 shows the softer view.
- **Routing is not documented.** The `x-middleware-served-by` header and automatic routing to a Live adapter come from what we saw, not from Mubit's docs.
- **No page URL or title.** Mind2Web gives only the site name; Show Me normally sees both.
- **Test data.** Test-split examples are never committed, printed or recorded by Mubit (the authors ask that benchmark data stays out of training corpora). Only aggregates leave `exam/data/`.

## Credits

Mind2Web data, CC BY 4.0:

- Deng, X., Gu, Y., Zheng, B., Chen, S., Stevens, S., Wang, B., Sun, H. and Su, Y. (2023). *Mind2Web: Towards a Generalist Agent for the Web.* NeurIPS 2023 Datasets and Benchmarks.
- Zheng, B., Gou, B., Kil, J., Sun, H. and Su, Y. (2024). *GPT-4V(ision) is a Generalist Web Agent, if Grounded.* ICML 2024 (Multimodal-Mind2Web).
