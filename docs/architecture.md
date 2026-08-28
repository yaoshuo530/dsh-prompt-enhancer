# Architecture

`dsh-prompt-enhancer` is a DeepSeek Harness (DSH) Cordis plugin with two halves:
a Host half that runs in the DSH Node.js process, and a Client half that runs
in the browser (DSH web).

## Overview

```
┌────────────────────────────── Browser (Client half) ──────────────────────────────┐
│  composer tool row: "✨ Enhance" button   ── click ──▶  POST /__dsh-enhance/api    │
│  overlay cards: busy / clarify / preview / error      (JSON RPC via fetch)         │
└───────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌────────────────────────────── DSH process (Host half) ─────────────────────────────┐
│  prepare(args)  ──▶ assemble context ──▶ llm.stream (reasoningEffort: off) ──▶ JSON │
│  complete(args) ──▶ assemble context ──▶ llm.stream ──▶ enhanced prompt text        │
│                                                                                     │
│  context = systemPrompt.assemble()        (persona / memory / skills)               │
│          + sessionQuery.readSurface()     (last 30 messages)                        │
│          + agent.options / agent-default-model   (model route)                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

## Host half (`lib/index.js`)

- Registers `POST /__dsh-enhance/api` on the DSH web server (`webServer.register`,
  prefix `/__dsh-enhance`).
- API methods:
  - `prepare({ text, sessionId })` — decides whether clarification is needed;
    returns `{ needClarification, questions[], assumptions[] }` (structured JSON).
  - `complete({ text, sessionId, answers[], assumptions[] })` — generates the
    final enhanced prompt as plain text; returns `{ enhanced }`.
- Context assembly (`collectContext`):
  - `systemPrompt.assemble({ agent, scope: agent })` — the agent's full system
    prompt (persona, memory injections, skill guidance).
  - `sessionQuery.readSurface(sessionId)` — the session's current model surface
    (last 30 user/assistant messages).
- Model calls (`llm.stream`) use the session's model route (`agent.options`,
  falling back to `agent-default-model`), with `reasoningEffort: 'off'` for
  speed and deterministic structured output.
- Timeouts: context reads 30s, prepare 90s, complete 120s.

## Client half (`lib/client.js`)

- ModuleLoader-format browser plugin (`window.__ModuleLoader__.load`).
- UI contributions:
  - `conversation.input.right` — the "✨ Enhance" button (id `enhance-prompt`).
  - `shell.overlay` — overlay cards (id `enhance-overlay`): busy state,
    clarification questions, preview, error.
- Communication with the Host half uses `fetch('/__dsh-enhance/api', ...)`.
- State updates use functional setState (`force(v => v + 1)`) to avoid React
  bail-out (a fixed bug where the UI stuck on the "enhancing" card).

## Data flow (user journey)

1. User types a draft prompt and clicks "✨ Enhance".
2. Client calls `prepare`; Host assembles context and asks the model whether
   clarification is needed.
3. If clarification needed → clarify card → user answers → `complete`.
   Otherwise → `complete` directly with empty answers.
4. `complete` returns the enhanced prompt → preview card → "Apply to input"
   writes it to the composer via `inputActions.setDraft(text)`.

## Styling

Buttons reuse DSH theme tokens:
`--dsw-alias-button-info-fill` (DeepSeek blue) with `#fff` text, matching the
DSH send button.
