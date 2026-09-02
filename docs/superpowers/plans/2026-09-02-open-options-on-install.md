# Open Options on First Install Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open Clip2MD's existing options page exactly once after a fresh extension install, without opening it for updates or unpacked-extension reloads.

**Architecture:** Register one `chrome.runtime.onInstalled` listener in the existing Manifest V3 background entry. Extend the shared Vitest Chrome shim with an install-event dispatcher so the real background wiring can be tested without adding production abstractions.

**Tech Stack:** TypeScript, Chrome Extension Manifest V3 runtime API, Vitest, jsdom, esbuild

---

### Task 1: Add the failing lifecycle tests

**Files:**
- Modify: `tests/setup.ts`
- Modify: `tests/background.test.ts`

- [ ] **Step 1: Extend the Chrome test shim with an install event**

Add an installed-listener collection and dispatcher beside the existing runtime message helpers:

```ts
type InstalledListener = (details: chrome.runtime.InstalledDetails) => void;

const installedListeners: InstalledListener[] = [];

export function dispatchInstalled(details: chrome.runtime.InstalledDetails): void {
  for (const listener of [...installedListeners]) listener(details);
}
```

Expose the runtime enum and listener registration on `chromeMock.runtime`:

```ts
OnInstalledReason: {
  INSTALL: 'install',
  UPDATE: 'update',
  CHROME_UPDATE: 'chrome_update',
  SHARED_MODULE_UPDATE: 'shared_module_update',
},
onInstalled: {
  addListener: (listener: InstalledListener) => installedListeners.push(listener),
  removeListener: (listener: InstalledListener) => {
    const index = installedListeners.indexOf(listener);
    if (index >= 0) installedListeners.splice(index, 1);
  },
},
```

Make `openOptionsPageMock` return a resolved promise initially and after each reset:

```ts
export const openOptionsPageMock = vi.fn(async () => {});

openOptionsPageMock.mockReset();
openOptionsPageMock.mockImplementation(async () => {});
```

- [ ] **Step 2: Add behavior tests against the real background entry**

Import `dispatchInstalled` and `openOptionsPageMock` in `tests/background.test.ts`, then add:

```ts
describe('background first-install setup', () => {
  it('opens the options page exactly once after a fresh install', () => {
    dispatchInstalled({ reason: chrome.runtime.OnInstalledReason.INSTALL });

    expect(openOptionsPageMock).toHaveBeenCalledTimes(1);
  });

  it('does not open the options page after an extension update', () => {
    dispatchInstalled({
      reason: chrome.runtime.OnInstalledReason.UPDATE,
      previousVersion: '0.1.0',
    });

    expect(openOptionsPageMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the targeted test and confirm the new assertion fails**

Run: `npm test -- tests/background.test.ts`

Expected: the fresh-install case fails because `openOptionsPageMock` has zero calls, while the update case passes.

### Task 2: Register the minimal install listener

**Files:**
- Modify: `src/background/background.ts`
- Test: `tests/background.test.ts`

- [ ] **Step 1: Add the lifecycle listener to the background entry**

Insert before `chrome.runtime.onMessage.addListener`:

```ts
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason !== chrome.runtime.OnInstalledReason.INSTALL) return;
  void chrome.runtime.openOptionsPage().catch(() => undefined);
});
```

This uses the manifest's existing `options_ui` registration, opens only for `install`, and deliberately keeps a launch failure non-blocking and silent.

- [ ] **Step 2: Run the targeted lifecycle tests**

Run: `npm test -- tests/background.test.ts`

Expected: all tests in `tests/background.test.ts` pass, including one open for `install` and zero opens for `update`.

- [ ] **Step 3: Review the focused diff**

Run: `git diff --check -- src/background/background.ts tests/setup.ts tests/background.test.ts`

Expected: no whitespace errors; no files outside the three approved implementation/test files appear in the diff.

### Task 3: Verify and deliver

**Files:**
- Verify: `src/manifest.json`
- Verify generated output: `dist/manifest.json`, `dist/background.js`

- [ ] **Step 1: Run the full automated gate**

Run, in order:

```powershell
npm test
npm run typecheck
npm run build
```

Expected: all Vitest suites pass, TypeScript reports no errors, and esbuild completes successfully.

- [ ] **Step 2: Verify the built extension contract**

Run:

```powershell
rg -n 'options_ui|options.html|open_in_tab' src/manifest.json dist/manifest.json
rg -n 'onInstalled|openOptionsPage' dist/background.js
```

Expected: both manifests retain `options.html` with `open_in_tab: true`, and the built background bundle contains the install listener and options-page call.

- [ ] **Step 3: Request mandatory code review and resolve only feature-related findings**

Review the three changed code/test files for correctness, scope, and regression risk. Do not modify unrelated files or clean pre-existing untracked directories.

- [ ] **Step 4: Commit the implementation**

```powershell
git add -- src/background/background.ts tests/setup.ts tests/background.test.ts
git commit -m "feat: open settings after first install"
```

- [ ] **Step 5: Record manual Chrome acceptance steps**

1. Build the extension and remove any previously loaded Clip2MD instance from `chrome://extensions`.
2. Choose “加载已解压的扩展程序” and select `C:\Users\HP\OneDrive\桌面\example\clip2md\dist`.
3. Verify one `options.html` tab opens automatically.
4. Return to `chrome://extensions`, click “重新加载”, and verify no new options tab opens.

Manual acceptance remains explicitly unverified until performed in the user's real Chrome session.

## Copyable Agent Handoff Prompt

```text
Execute the implementation plan at C:\Users\HP\OneDrive\桌面\example\clip2md\docs\superpowers\plans\2026-09-02-open-options-on-install.md in the existing checkout and branch codex/readme-glanceclip-refresh. Core objective: open the existing Clip2MD options page exactly once on a fresh Chrome extension install, never on update or unpacked-extension reload. Follow TDD: first extend the Chrome runtime test shim and add failing install/update tests, run the targeted test to capture the expected failure, then add the minimal background listener and rerun targeted and full verification. Required gates: npm test, npm run typecheck, npm run build, focused git diff review, built-manifest/background inspection, and mandatory code review. Only modify src/background/background.ts, tests/setup.ts, and tests/background.test.ts for implementation; the already committed spec and plan may remain. Do not touch, delete, stage, or commit .playwright-cli/, tmp-recording/, or unrelated files. Do not push, merge, open a PR, remove/reload the user's installed Chrome extension, or claim real-Chrome acceptance without explicit verification. Final delivery must report branch and HEAD, changed files, targeted/full test results, typecheck/build results, code-review outcome, exact manual Chrome steps, and any partial or unverified work separately.
```
