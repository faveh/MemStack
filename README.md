# MemStack
A memory stack project

**Show Me** — the browser agent you teach by hand. You say a task, the agent tries it in the browser, and
when it fails you show it once. Every step you demonstrate goes through [Mubit](https://docs.mubit.ai) as a
training example, so the agent's decision step becomes a small model we own.

- Idea, demo script and build plan: [docs/IDEA.md](docs/IDEA.md)
- Run and test it locally: [TESTING.md](TESTING.md)

## Quick start

```bash
npm install
npm start          # backend on http://localhost:8787 (mock model until you add a Mubit key)
```

Then load `extension/` as an unpacked extension in Chrome, open <http://localhost:8787/demo/> and click the
Show Me icon. Details in [TESTING.md](TESTING.md).

## Exam: does the adapter learn?

[exam/README.md](exam/README.md) tests Show Me's next-action step on Mind2Web: Mubit-routed vs provider-only
(accuracy, cost, speed, adapter share), on new tasks, new websites and new domains.

## How it fits together

| Part | What it does |
| --- | --- |
| `extension/content.js` | Reads the page as a short list of interactive elements (text, no screenshots), performs actions, records your demonstrations. |
| `extension/sidepanel.*` | Goal box with voice and talk-back; agent loop (open URL, click, type + Enter, keys, back, scroll, ask for help); "Show me how" teaching; mistake view; live savings; ledger. |
| `extension/panel-mubit.js`, `panel-judges.js` | The Mubit tab (live calls, flow, tasks, lessons, savings) and the Judges tab (criteria that tick from live evidence). |
| `extension/mascot.js` | Mo, the mascot on every page, and the voice waveform next to it. |
| `extension/mubit-bridge.js` | Reads kept examples and adapter status from Mubit's console when it's open in a tab (read-only). |
| `extension/background.js` | Toolbar icon and the ⌥Space talk shortcut. |
| `server/index.js` | Backend the extension calls. Holds the Mubit key; Mubit refuses browser calls. |
| `server/llm.js` | Sends every model call to Claude (or OpenAI) through Mubit's gateway; mock model when no key is set. |
| `server/prompts.js` | The three fixed system prompts, one per Mubit task: `next-action`, `done-check`, `safety-gate`. |
| `server/memory.js` | MemStack memory: demonstrations, recalled into later runs on the same page. |
| `server/ledger.js` | Local log of every call for the ledger: counts, latency, cost. |
| `server/demo-site/` | Trattoria Nove (restaurant) and Tubely (offline video site), the stage demo pages. |
| `scripts/seed-traffic.js` | Sends varied calls through Mubit so tasks reach 25 kept examples and train. |
