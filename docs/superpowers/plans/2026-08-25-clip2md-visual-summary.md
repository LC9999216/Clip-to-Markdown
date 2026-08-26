# Clip2MD V1 Visual Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a secure, user-triggered X/Twitter visual summary Side Panel without regressing Clip2MD saving.

**Architecture:** Reuse the existing content-script `EXTRACT` contract and `ContentDocument`; keep AI settings, HTTP, validation, orchestration, state, and cache outside the content script. Store per-tab progress/results in `chrome.storage.session`, render with safe native DOM, and route Side Panel saves through `runSave`.

**Tech Stack:** Chrome Manifest V3, TypeScript, native HTML/CSS, esbuild, Vitest/jsdom.

---

### Task 1: Side Panel shell and shortcut

**Files:**
- Modify: `src/manifest.json`
- Modify: `src/_locales/zh_CN/messages.json`
- Modify: `src/_locales/en/messages.json`
- Modify: `build.mjs`
- Create: `src/sidepanel/sidepanel.html`
- Create: `src/sidepanel/sidepanel.css`
- Create: `src/sidepanel/sidepanel.ts`
- Test: `tests/visual-summary.test.ts`

- [ ] Write manifest/build tests for `sidePanel`, Chrome 116, optional host patterns, the command, static asset copies, and the sidepanel IIFE entry.
- [ ] Run `npm test -- tests/visual-summary.test.ts` and confirm failure because Side Panel integration is absent.
- [ ] Add the minimum manifest/build/locales and a non-blank responsive Side Panel shell.
- [ ] Add command handling that opens the panel immediately for the command tab or active tab.
- [ ] Run the targeted test, typecheck, and build; inspect `dist/sidepanel.{html,css,js}`.
- [ ] Commit as `feat(visual-summary): add side panel shortcut shell`.

### Task 2: ContentDocument analysis input

**Files:**
- Create: `src/analysis/types.ts`
- Create: `src/analysis/input.ts`
- Test: `tests/analysis-input.test.ts`

- [ ] Write failing tests using Tweet and X Article `ContentDocument` values; assert title/author/body mapping, no truncation at 16000, and `12000 + marker + 4000` truncation above the limit.
- [ ] Run `npm test -- tests/analysis-input.test.ts` and confirm missing-module failure.
- [ ] Implement `buildAnalysisInput(document)` using `renderBody(document)` and `MAX_ANALYSIS_CHARS = 16000`; no DOM or raw AST enters the return type.
- [ ] Run the targeted test and typecheck.
- [ ] Commit as `feat(analysis): build bounded content input`.

### Task 3: AI settings V3 and runtime permission UI

**Files:**
- Create: `src/core/ai-settings.ts`
- Modify: `src/core/settings.ts`
- Modify: `src/options/options.html`
- Modify: `src/options/options.css`
- Modify: `src/options/options.ts`
- Modify: `tests/core/settings.test.ts`
- Modify: `tests/options.test.ts`

- [ ] Write failing tests for V2-to-V3 migration, preserved legacy fields, default AI settings, HTTPS/local HTTP acceptance, remote HTTP rejection, API key trimming, password toggle, field save, and direct user-gesture permission request.
- [ ] Run the two targeted test files and confirm expected failures.
- [ ] Implement `AiSettings`, `DEFAULT_AI_SETTINGS`, `normalizeAiEndpoint`, `getAiOriginPattern`, V3 migration, and normalized persistence.
- [ ] Add the AI card between shortcut and Obsidian cards with enable, Endpoint, secret toggle, Model, authorize/test controls, accessible status, and matching responsive styling.
- [ ] Run targeted tests and typecheck.
- [ ] Commit as `feat(settings): add secure visual summary AI configuration`.

### Task 4: Schema, prompt, and AI client

**Files:**
- Create: `src/analysis/schema.ts`
- Create: `src/analysis/prompt.ts`
- Create: `src/analysis/client.ts`
- Test: `tests/analysis-schema.test.ts`
- Test: `tests/ai-client.test.ts`

- [ ] Write failing schema tests for the valid example, enum/confidence/empty fields, text caps, key point/takeaway counts, depth 3, node count 10, and non-string values.
- [ ] Implement `validateVisualSummary` and `parseVisualSummary`, truncating only safe text fields and rejecting structural violations.
- [ ] Write failing fetch tests for 200, 401/403, 404, 429, 5xx, timeout, network failure, empty choices, JSON fence, invalid JSON, repair success, and repair failure.
- [ ] Implement the prompt and `analyzeContent(input, settings, options?)` with `AbortController`, no SDK/`response_format`, exact error codes, and one repair request maximum.
- [ ] Run targeted tests and typecheck.
- [ ] Commit as `feat(analysis): add validated OpenAI compatible pipeline`.

### Task 5: Session cache and Background orchestrator

**Files:**
- Create: `src/analysis/cache.ts`
- Create: `src/background/visual-summary.ts`
- Modify: `src/types/messages.ts`
- Modify: `src/background/background.ts`
- Modify: `tests/setup.ts`
- Modify: `tests/background.test.ts`
- Test: `tests/visual-summary.test.ts`

- [ ] Extend the Chrome mock with `storage.session`, `storage.onChanged`, permissions, sidePanel, tab activation, and deterministic tab messaging.
- [ ] Write failing tests for unsupported platform, missing AI config, missing host permission, cache hit, force bypass, status transitions, and stale request rejection.
- [ ] Implement stable cache keys and per-tab state helpers under `clip2md.visualSummary.*`.
- [ ] Implement `startVisualAnalysis(tabId, { force })`, settings/permission checks, `EXTRACT`, X-only gate, input/client/cache flow, actionable error state, and requestId guards.
- [ ] Add strict request guards for `START_VISUAL_ANALYSIS`, `GET_VISUAL_ANALYSIS_STATE`, and `TEST_AI`; never include the API key in messages or responses.
- [ ] Run targeted tests, full background tests, and typecheck.
- [ ] Commit as `feat(background): orchestrate cached visual analysis`.

### Task 6: Safe completed Side Panel UI

**Files:**
- Create: `src/sidepanel/tree-renderer.ts`
- Modify: `src/sidepanel/sidepanel.ts`
- Modify: `src/sidepanel/sidepanel.html`
- Modify: `src/sidepanel/sidepanel.css`
- Test: `tests/sidepanel.test.ts`

- [ ] Write failing jsdom tests for idle/extracting/analyzing/done/error states, article labels, tab changes, storage changes, regenerate, settings navigation, safe text rendering, 10-node tree rendering, and no stale-tab content.
- [ ] Implement DOM-only renderers using `createElement` and `textContent`; do not assign AI output through `innerHTML`.
- [ ] Implement current-tab initialization, session state reads, `storage.onChanged`, `tabs.onActivated`, regenerate with `force: true`, and action-specific Chinese errors.
- [ ] Match the existing settings visual language, dark mode, 300px layout, focus states, and reduced motion.
- [ ] Run Side Panel tests and typecheck.
- [ ] Commit as `feat(sidepanel): render safe visual summaries`.

### Task 7: Save-current-tab integration

**Files:**
- Modify: `src/types/messages.ts`
- Modify: `src/background/quick-save.ts`
- Modify: `src/background/background.ts`
- Modify: `src/sidepanel/sidepanel.ts`
- Modify: `tests/quick-save.test.ts`
- Modify: `tests/background.test.ts`

- [ ] Write failing tests proving `runSave(target, tabId?)` uses the supplied tab without querying, while existing shortcuts still query the active tab and preserve custom-folder/download/Obsidian behavior.
- [ ] Implement optional `tabId`, validate `SAVE_CURRENT_TAB`, and call `runSave('default', tabId)` from Background.
- [ ] Wire the Side Panel save button and accessible pending/result status.
- [ ] Run quick-save/background/sidepanel tests and typecheck.
- [ ] Commit as `feat(visual-summary): reuse markdown save pipeline`.

### Task 8: Privacy, documentation, and full regression

**Files:**
- Modify: `privacy/index.md`
- Modify: `README.md`
- Modify: tests as required by regressions only

- [ ] Document explicit-trigger-only article transmission, user-owned Endpoint, local API-key storage, no Clip2MD proxy/server, no injection/sharing/analytics, runtime host authorization, configuration, shortcut, cache, and provider limits.
- [ ] Search source for `innerHTML`, API-key logging, broad static host permissions, and unintended automatic analysis; inspect every match.
- [ ] Run `npm run typecheck`, `npm test`, and `npm run build`; fix only feature-caused regressions.
- [ ] Load `dist` in Chrome/Edge when available and exercise Tweet, X Article, non-X, unconfigured, cache, regenerate, SPA, save, and 300px/dark layouts.
- [ ] Commit as `docs: document visual summary privacy and usage`.

### Task 9: Final review

**Files:**
- Review all changes after checkpoint `925f6b6`.

- [ ] Run `git diff --check 925f6b6..HEAD` and inspect `git diff --stat` plus the complete source diff.
- [ ] Request a code review against this design and plan; resolve every Critical/Important issue with a failing test first.
- [ ] Re-run the complete typecheck/test/build suite after review fixes.
- [ ] Record manual-test limits honestly and provide the requested file, architecture, security, test, installation, and remaining-issues report.

