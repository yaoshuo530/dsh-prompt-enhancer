# dsh-prompt-enhancer

![License](https://img.shields.io/github/license/yaoshuo530/dsh-prompt-enhancer)
![Release](https://img.shields.io/github/v/release/yaoshuo530/dsh-prompt-enhancer)
![CI](https://github.com/yaoshuo530/dsh-prompt-enhancer/actions/workflows/ci.yml/badge.svg)
[中文](README.zh.md)

A prompt-enhancement plugin for [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) (DSH): an **"✨ Enhance"** button in the composer that rewrites your draft prompt into a more detailed, clearer, and structured version using **first-principles thinking** — grounded in your session context, memory, and recent conversation. When key information is missing, it asks you through a clarification card before generating.

## Features

- **One-click enhance**: an "✨ Enhance" button on the right end of the composer tool row
- **First-principles methodology**: Think (return to the essence) → Plan (break down the structure) → Execute (organize the expression) → Review (check coherence)
- **Context-aware**: automatically reads the current session's agent system prompt (persona, memory, skill injections) and the recent conversation history
- **Clarification card**: when the model judges key information is missing, it pops up a card (option buttons + free-text input + cancel) and continues after you answer
- **Preview then apply**: the enhanced prompt is shown for review first; clicking "Apply to input" writes it into the composer — it is never sent automatically
- **DSH-native look & feel**: blue button with white text, reusing DSH's send-button theme tokens (`--dsw-alias-button-info-fill`)

## Installation

### Method 1: Host profile plugin (recommended — survives refresh and restart)

1. Clone or copy this repository to any local path, e.g. `~/dsh-plugins/dsh-prompt-enhancer`
2. Edit the DSH web profile (`~/.dsh/profiles/web/`):
   - Append to `package.json` → `dependencies`:
     ```json
     "dsh-prompt-enhancer": "link:/absolute/path/to/dsh-prompt-enhancer"
     ```
   - Append to `cordis.patch.yml`:
     ```yaml
     - insert:
         - name: dsh-prompt-enhancer
     ```
3. Run `pnpm install` in `~/.dsh/profiles/web/`
4. Restart `dsh web`, then refresh the page — the button appears in the composer tool row

### Method 2: Agent preset plugin

Add the plugin row to your agent preset's composition (`~/.dsh/.agent-presets/<id>/agent.cordis.yml`) and mount the package in that preset. Note: loading the browser UI via the host profile (Method 1) is the most stable.

## Configuration

None required. The plugin automatically uses:

- **Model route**: the current session agent's model (`agent.options`), falling back to the `agent-default-model` selection; it calls the model with thinking disabled (`reasoningEffort: off`) for speed and stability
- **Context**: `systemPrompt.assemble()` (persona / memory / skills) + `sessionQuery.readSurface()` (last 30 messages)

## Usage

1. Type a draft prompt in the composer, e.g. `Write a weekly summary report`
2. Click the **"✨ Enhance"** button
3. If the model decides key information is missing, a **clarification card** appears (e.g. "What did you complete this week?", "Who is the audience?") — select or type your answers, then click "Generate"
4. Preview the enhanced prompt, click **"Apply to input"** to write it into the composer, then edit and send as you like

The output language follows your input language.

## Example

Input:

```
Write a weekly summary report
```

Enhanced output:

```markdown
## Objective
Generate a submittable weekly report that covers this week's completed work,
achievements, issues, and next week's plan, so progress can be synced with
your manager or team.

## Background
You want a clearly structured, results-focused weekly report. Fill in the
placeholders below with your own details.

## Requirements
- Summarize completed tasks, milestones, and outcomes this week
- Note any blockers or issues and their current status
- List next week's planned work with priorities
- Keep the tone concise and professional; use bullet points and short sentences

## Output Format
Markdown with the sections: This Week's Work / Achievements / Issues / Next Week's Plan

## Acceptance Criteria
- All four sections are present and non-empty
- No placeholders remain
- The report can be submitted as-is
```

## Dependencies

- DeepSeek Harness (DSH) web, with at least one working model route (e.g. DeepSeek official API)
- Node.js `^22.19.0 || >=24`
- Browser-side packages (bundled with DSH web): `@deepseek-ai/dsh-client-runtime`, `@deepseek-ai/dsh-client-connection`, `@deepseek-ai/dsh-client-ui-slots`, `@deepseek-ai/dsh-client-locale`

## How It Works

| Component | Description |
|---|---|
| Host half (`lib/index.js`) | Serves `POST /__dsh-enhance/api` JSON RPC: `prepare` (decides whether clarification is needed and returns a structured question JSON), `complete` (generates the final enhanced prompt as plain text); assembles context and calls `llm.stream` |
| Client half (`lib/client.js`) | ModuleLoader browser plugin: the composer button (`conversation.input.right`) and the overlay cards (`shell.overlay` — busy / clarify / preview / error states) |

## License

[MIT](LICENSE)
