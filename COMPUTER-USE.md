---
name: electron-computer-use
description: Test an Electron desktop app the way a human would - launch the real app, click real buttons, type into fields, read console and main-process error logs, take screenshots, and decide pass or fail. Use this skill whenever the user asks to test, QA, debug, verify, smoke-test, "try out", or "click through" the Electron app, whenever you have just changed UI or main-process code and need to confirm it works, and whenever the user mentions bugs, errors, crashes, or regressions in the app. Do not claim a feature works until you have run this loop.
---

# Electron Computer Use (real-app testing)

You can drive the real Electron app: launch it, click, type, read errors, and screenshot.
Screenshots alone are NOT enough. Every action must be followed by checking
(1) the UI state, (2) renderer console errors, and (3) main-process errors.

## Three layers (use all of them)

| Layer | What it gives you | Where |
|---|---|---|
| **A. Stable selectors** | Find controls by name, not pixels | `data-testid` + ARIA in the UI |
| **B. Test-mode control server** | Internal state, ALL error logs (main + renderer), direct actions | `src/main/testControl.js` (in-app, test mode only) |
| **C. Playwright drivers** | Real clicks and typing, screenshots, video, traces | `e2e/` (scripted tests + a step-by-step CLI) |

> Package versions and Electron APIs change. Before first use, check `npm ls playwright electron`
> and skim the current Playwright Electron docs if anything below errors.

## Definition of PASS (never skip)

A flow passes only if ALL are true:
1. Every action succeeded (no timeouts, no missing elements).
2. The UI shows the expected result (assert on text/role/state, not only a screenshot).
3. Zero new `error` entries in `/logs` (main + renderer) after the flow.
4. Zero crashes (`render-process-gone`, `uncaughtException`, `unhandledRejection`).

If any fails, report FAIL with evidence (screenshot path, log lines, repro steps). Do not say "looks fine".

---

## 0. One-time setup

```bash
npm i -D playwright @playwright/test
```
(Needs Node 18+ for global `fetch`. Electron must already be a devDependency.)

Add to `package.json`:
```json
{
  "scripts": {
    "e2e": "playwright test",
    "app:test": "APP_TEST_MODE=1 electron . --remote-debugging-port=9222 --user-data-dir=/tmp/app-test-profile"
  }
}
```
Windows: use `cross-env` for the env var and a temp path for `--user-data-dir`.

`playwright.config.js`:
```js
module.exports = {
  testDir: './e2e',
  testMatch: '**/*.spec.js',
  workers: 1,            // one Electron instance at a time
  timeout: 60_000,
  reporter: [['list']],
};
```

Add `e2e-artifacts/` and `.cdp-cursor` to `.gitignore`.

macOS only, for OS-level fallback tools (section 6): grant Accessibility and Screen Recording
to the terminal/IDE running the agent (System Settings -> Privacy & Security).
Playwright itself needs no permissions and does not take over the user's mouse.

---

## 1. Layer A - Stable selectors

Every interactive element gets a `data-testid` plus proper ARIA. Naming: `area-action`.

```html
<button data-testid="save-button" aria-label="Save">Save</button>
<input  data-testid="project-name-input" aria-label="Project name" />
<div    data-testid="error-banner" role="alert"></div>
```
React: `<button data-testid="save-button" onClick={save}>Save</button>`

Rules:
- When you add or change UI, add testids in the same change. Never select by pixel or by brittle CSS class.
- Errors shown to the user should use `role="alert"` so they are visible in the accessibility snapshot.
- Prefer `getByRole` / `getByTestId` over CSS.

---

## 2. Layer B - Test-mode control server (main process)

Gated TWICE: env `APP_TEST_MODE=1` AND `!app.isPackaged`. Binds to 127.0.0.1 on a random
port with a random token, so nothing else can use it. It is never loaded in production.

### 2a. `src/main/testControl.js`

```js
'use strict';
const { app, BrowserWindow } = require('electron');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const util = require('util');
const crypto = require('crypto');

const MAX_LOGS = 3000;
const logs = [];
let seq = 0;
const actions = new Map();
const stateProviders = new Map();
const token = crypto.randomBytes(16).toString('hex');
const infoFile = process.env.APP_TEST_INFO_FILE || path.join(os.tmpdir(), 'app-test-control.json');
let server;

function log(level, source, message, extra = {}) {
  logs.push({ seq: ++seq, t: new Date().toISOString(), level, source, message: String(message), ...extra });
  if (logs.length > MAX_LOGS) logs.shift();
}

function attachWindow(win) {
  const wc = win.webContents;
  const id = win.id;
  // Electron changed this event's signature across versions; support both.
  wc.on('console-message', (...args) => {
    const d = args[0] && typeof args[0].message === 'string'
      ? args[0]
      : { level: args[1], message: args[2], lineNumber: args[3], sourceId: args[4] };
    const lvl = d.level === 'error' || d.level === 3 ? 'error'
      : d.level === 'warning' || d.level === 2 ? 'warn' : 'info';
    log(lvl, `renderer:${id}`, d.message, { line: d.lineNumber, file: d.sourceId });
  });
  wc.on('render-process-gone', (_e, d) => log('error', `renderer:${id}`, `render-process-gone: ${d.reason}`));
  wc.on('did-fail-load', (_e, code, desc, url) => log('error', `renderer:${id}`, `did-fail-load ${code} ${desc} ${url}`));
  wc.on('unresponsive', () => log('error', `renderer:${id}`, 'window unresponsive'));
}

async function windowStates() {
  const out = [];
  for (const win of BrowserWindow.getAllWindows()) {
    let state = null;
    try {
      // Renderer exposes window.__TEST_STATE__ in dev/test builds only (see 2c).
      state = await win.webContents.executeJavaScript('window.__TEST_STATE__ ? window.__TEST_STATE__() : null');
    } catch (e) { state = { error: String(e) }; }
    out.push({
      id: win.id, title: win.getTitle(), url: win.webContents.getURL(),
      bounds: win.getBounds(), focused: win.isFocused(), visible: win.isVisible(), state,
    });
  }
  return out;
}

const readJson = (req) => new Promise((resolve, reject) => {
  let b = '';
  req.on('data', (c) => (b += c));
  req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } });
});

async function handle(req, res) {
  const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (req.headers['x-test-token'] !== token) return send(401, { error: 'bad token' });
  const url = new URL(req.url, 'http://127.0.0.1');
  try {
    if (req.method === 'GET' && url.pathname === '/health') return send(200, { ok: true, pid: process.pid });

    if (req.method === 'GET' && url.pathname === '/state') {
      const custom = {};
      for (const [k, fn] of stateProviders) { try { custom[k] = await fn(); } catch (e) { custom[k] = { error: String(e) }; } }
      return send(200, {
        pid: process.pid, version: app.getVersion(), userData: app.getPath('userData'),
        errorCount: logs.filter((l) => l.level === 'error').length,
        windows: await windowStates(), custom,
      });
    }

    if (req.method === 'GET' && url.pathname === '/logs') {
      const after = Number(url.searchParams.get('after')) || 0;
      const level = url.searchParams.get('level'); // e.g. error
      const out = logs.filter((l) => l.seq > after && (!level || l.level === level));
      return send(200, { lastSeq: seq, count: out.length, logs: out });
    }

    if (req.method === 'POST' && url.pathname === '/logs/clear') { logs.length = 0; return send(200, { ok: true, lastSeq: seq }); }

    if (req.method === 'POST' && url.pathname === '/action') {
      const body = await readJson(req);
      const fn = actions.get(body.name);
      if (!fn) return send(404, { error: `unknown action: ${body.name}`, available: [...actions.keys()] });
      return send(200, { ok: true, result: await fn(body.args || {}) });
    }
    return send(404, { error: 'not found' });
  } catch (e) {
    log('error', 'control', e.stack || e);
    return send(500, { error: String(e) });
  }
}

function init() {
  if (process.env.APP_TEST_MODE !== '1' || app.isPackaged) return null;

  process.on('uncaughtException', (e) => log('error', 'main', `uncaughtException: ${e.stack || e}`));
  process.on('unhandledRejection', (r) => log('error', 'main', `unhandledRejection: ${(r && r.stack) || r}`));
  for (const m of ['error', 'warn']) {
    const orig = console[m].bind(console);
    console[m] = (...a) => { log(m === 'warn' ? 'warn' : 'error', 'main', util.format(...a)); orig(...a); };
  }
  app.on('browser-window-created', (_e, win) => attachWindow(win));

  // Built-in actions
  actions.set('list-actions', () => [...actions.keys()]);
  actions.set('reload', () => { BrowserWindow.getAllWindows().forEach((w) => w.webContents.reload()); return true; });
  // TEST-ONLY escape hatch: run JS in a window. Token-gated, localhost-only, never in prod.
  actions.set('renderer-eval', ({ code, windowId }) => {
    const win = windowId ? BrowserWindow.fromId(windowId) : BrowserWindow.getAllWindows()[0];
    return win.webContents.executeJavaScript(code);
  });

  server = http.createServer(handle);
  server.listen(0, '127.0.0.1', () => {
    fs.writeFileSync(infoFile, JSON.stringify({ port: server.address().port, token, pid: process.pid }));
    log('info', 'control', `listening on ${server.address().port}`);
  });
  const cleanup = () => { try { fs.unlinkSync(infoFile); } catch {} };
  app.on('will-quit', cleanup);

  const api = {
    log,
    registerAction: (name, fn) => actions.set(name, fn),
    registerState: (name, fn) => stateProviders.set(name, fn),
  };
  globalThis.__testControl = api;
  return api;
}

module.exports = { init };
```

### 2b. Load it first in the main process

```js
// main.js - as early as possible, BEFORE creating any window
const { app } = require('electron');
if (process.env.APP_TEST_MODE === '1' && !app.isPackaged) require('./testControl').init();
```

Expose app-specific hooks anywhere in main (safe no-op in production):
```js
globalThis.__testControl?.registerAction('open-settings', () => openSettingsWindow());
globalThis.__testControl?.registerAction('seed-data', ({ fixture }) => seedDatabase(fixture));
globalThis.__testControl?.registerState('db', () => ({ projects: db.count('projects') }));
```

### 2c. Optional renderer state hook (dev/test builds only)

```js
// renderer entry - wrap in whatever dev-only check the project already uses
if (process.env.NODE_ENV !== 'production') {
  window.__TEST_STATE__ = () => ({
    route: location.hash || location.pathname,
    store: window.__STORE__?.getState?.() ?? null, // redux/zustand/etc.
  });
}
```

### 2d. Endpoints

| Call | Purpose |
|---|---|
| `GET /health` | server alive |
| `GET /state` | windows, titles, URLs, renderer state, custom state, `errorCount` |
| `GET /logs?level=error&after=<seq>` | main + renderer logs; use `after` to read only NEW entries |
| `POST /logs/clear` | reset before a flow |
| `POST /action` `{name,args}` | trigger an app action directly (seed data, open window) |

---

## 3. Shared helper for talking to the control server

`e2e/helpers/control.js`
```js
const fs = require('fs');
const os = require('os');
const path = require('path');

function controlClient(infoFile = process.env.APP_TEST_INFO_FILE || path.join(os.tmpdir(), 'app-test-control.json')) {
  const info = () => JSON.parse(fs.readFileSync(infoFile, 'utf8'));
  async function call(method, p, body) {
    const { port, token } = info();
    const r = await fetch(`http://127.0.0.1:${port}${p}`, {
      method,
      headers: { 'x-test-token': token, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return r.json();
  }
  async function waitReady(ms = 20000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      try { if ((await call('GET', '/health')).ok) return; } catch {}
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('control server not ready - is APP_TEST_MODE=1 set and testControl.init() called?');
  }
  return { get: (p) => call('GET', p), post: (p, b) => call('POST', p, b), waitReady, infoFile };
}
module.exports = { controlClient };
```

---

## 4. Layer C1 - Scripted tests (Playwright launches the app)

Use for repeatable flows and for regression tests of every bug you find.

`e2e/helpers/app.js`
```js
const { _electron: electron } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { controlClient } = require('./control');

async function launchApp(opts = {}) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'app-e2e-'));        // clean state every run
  const artifacts = opts.artifacts || path.join('e2e-artifacts', String(Date.now()));
  fs.mkdirSync(artifacts, { recursive: true });
  const infoFile = path.join(userData, 'control.json');

  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userData}`, ...(opts.args || [])],
    cwd: opts.cwd || process.cwd(),
    env: { ...process.env, APP_TEST_MODE: '1', APP_TEST_INFO_FILE: infoFile, ...(opts.env || {}) },
    recordVideo: { dir: path.join(artifacts, 'video') },
  });

  const control = controlClient(infoFile);
  await control.waitReady();

  // Renderer-side issues, as seen by Playwright (in addition to the control server's logs)
  const issues = [];
  const hook = (page) => {
    page.on('console', (m) => { if (m.type() === 'error') issues.push(`console.error: ${m.text()}`); });
    page.on('pageerror', (e) => issues.push(`pageerror: ${e.message}`));
    page.on('crash', () => issues.push('page crashed'));
  };
  app.windows().forEach(hook);
  app.on('window', hook);

  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await app.context().tracing.start({ screenshots: true, snapshots: true });

  let lastSeq = 0;
  let n = 0;
  const report = [];

  /** Run one human-like step, then ALWAYS collect evidence. Throws on action failure or new errors. */
  async function step(name, fn, { allowErrors = false } = {}) {
    n += 1;
    const label = `${String(n).padStart(2, '0')}-${name.replace(/\W+/g, '-').slice(0, 40)}`;
    const issuesBefore = issues.length;
    let actionError = null;
    try { await fn(page); } catch (e) { actionError = e; }

    await page.waitForTimeout(150); // let async errors surface
    await page.screenshot({ path: path.join(artifacts, `${label}.png`) }).catch(() => {});
    const aria = await page.locator('body').ariaSnapshot().catch(() => '(no snapshot)');
    fs.writeFileSync(path.join(artifacts, `${label}.aria.yml`), aria);

    const logRes = await control.get(`/logs?level=error&after=${lastSeq}`);
    lastSeq = logRes.lastSeq;
    const newIssues = issues.slice(issuesBefore);
    const errors = [...logRes.logs.map((l) => `[${l.source}] ${l.message}`), ...newIssues];

    report.push({ step: label, ok: !actionError && (allowErrors || errors.length === 0), actionError: actionError && String(actionError), errors });
    if (actionError) throw actionError;
    if (!allowErrors && errors.length) throw new Error(`New errors after "${name}":\n${errors.join('\n')}`);
  }

  async function close() {
    fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
    await app.context().tracing.stop({ path: path.join(artifacts, 'trace.zip') }).catch(() => {});
    await app.close().catch(() => {});
  }

  return { app, page, control, step, close, artifacts, issues };
}

/** Replace native dialogs (they can't be clicked via the DOM). */
async function stubOpenDialog(app, filePaths) {
  await app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths });
  }, filePaths);
}
async function stubSaveDialog(app, filePath) {
  await app.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, filePath);
}

module.exports = { launchApp, stubOpenDialog, stubSaveDialog };
```

`e2e/smoke.spec.js` (template - adapt testids to the real app)
```js
const { test, expect } = require('@playwright/test');
const { launchApp } = require('./helpers/app');

test('app launches and core flow works with zero errors', async () => {
  const h = await launchApp();
  try {
    await h.step('app shows main screen', async (page) => {
      await expect(page.getByTestId('main-screen')).toBeVisible();
    });
    await h.step('create project', async (page) => {
      await page.getByTestId('new-project-button').click();
      await page.getByTestId('project-name-input').fill('Test Project');
      await page.getByTestId('save-button').click();
      await expect(page.getByText('Test Project')).toBeVisible();
    });
    await h.step('main-process state matches UI', async () => {
      const s = await h.control.get('/state');
      expect(s.errorCount).toBe(0);
    });
  } finally {
    await h.close();
  }
});
```
Run: `npx playwright test e2e/smoke.spec.js`. On failure read, in this order:
`e2e-artifacts/<run>/report.json` -> latest `.png` + `.aria.yml` -> `trace.zip`
(`npx playwright show-trace <trace.zip>`).

---

## 5. Layer C2 - Step-by-step exploration (like a human at the keyboard)

For aggressive, unscripted testing: start the app once, then issue one command at a time and
look at the result of each - exactly like a person clicking around.

Start (background, keep the log):
```bash
npm run app:test > /tmp/app-test.log 2>&1 &
sleep 5 && node e2e/cdp.js state
```
Stop: `pkill -f "remote-debugging-port=9222"`.

`e2e/cdp.js`
```js
#!/usr/bin/env node
const { chromium } = require('playwright');
const fs = require('fs');
const { controlClient } = require('./helpers/control');

const PORT = process.env.CDP_PORT || 9222;
const CURSOR = '.cdp-cursor';
const control = controlClient();

function loc(page, sel) {
  if (sel.startsWith('testid:')) return page.getByTestId(sel.slice(7));
  if (sel.startsWith('text:')) return page.getByText(sel.slice(5));
  if (sel.startsWith('role:')) { const [, role, ...name] = sel.split(':'); return page.getByRole(role, name.length ? { name: name.join(':') } : {}); }
  return page.locator(sel); // raw CSS
}

async function newErrors() {
  const after = fs.existsSync(CURSOR) ? Number(fs.readFileSync(CURSOR, 'utf8')) : 0;
  const r = await control.get(`/logs?level=error&after=${after}`);
  fs.writeFileSync(CURSOR, String(r.lastSeq));
  return r.logs;
}

(async () => {
  const [cmd, a, b] = process.argv.slice(2);
  if (!cmd) {
    console.log(`commands:
  state | errors | snapshot | url | shot <path> | text <sel>
  click <sel> | dblclick <sel> | hover <sel> | fill <sel> <text> | press <key> | wait <sel>
  action <name> [jsonArgs] | eval <js>
selectors: testid:save-button | role:button:Save | text:Hello | any CSS`);
    return;
  }
  if (cmd === 'state') { console.log(JSON.stringify(await control.get('/state'), null, 2)); return; }
  if (cmd === 'errors') { console.log(JSON.stringify(await newErrors(), null, 2)); return; }
  if (cmd === 'action') { console.log(JSON.stringify(await control.post('/action', { name: a, args: b ? JSON.parse(b) : {} }), null, 2)); return; }

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const pages = browser.contexts().flatMap((c) => c.pages()).filter((p) => !p.url().startsWith('devtools://'));
  const page = pages[Number(process.env.PAGE || 0)];
  if (!page) { console.error('no page found'); process.exit(2); }

  let failed = false;
  try {
    switch (cmd) {
      case 'snapshot': console.log(await page.locator('body').ariaSnapshot()); break;
      case 'url': console.log(page.url(), '|', await page.title()); break;
      case 'shot': await page.screenshot({ path: a || 'shot.png' }); console.log('saved', a || 'shot.png'); break;
      case 'text': console.log(await loc(page, a).innerText({ timeout: 5000 })); break;
      case 'click': await loc(page, a).click({ timeout: 5000 }); break;
      case 'dblclick': await loc(page, a).dblclick({ timeout: 5000 }); break;
      case 'hover': await loc(page, a).hover({ timeout: 5000 }); break;
      case 'fill': await loc(page, a).fill(b ?? '', { timeout: 5000 }); break;
      case 'press': await page.keyboard.press(a); break;
      case 'wait': await loc(page, a).waitFor({ timeout: 10000 }); break;
      case 'eval': console.log(JSON.stringify(await page.evaluate(a))); break;
      default: console.error('unknown command'); failed = true;
    }
    if (['click', 'dblclick', 'fill', 'press', 'hover'].includes(cmd)) console.log(`ok: ${cmd} ${a || ''}`);
  } catch (e) {
    failed = true;
    console.error(`FAILED: ${cmd} ${a || ''}\n${String(e.message).split('\n').slice(0, 4).join('\n')}`);
  }

  await new Promise((r) => setTimeout(r, 200));
  const errs = await newErrors();
  if (errs.length) { failed = true; console.error(`NEW ERRORS (${errs.length}):`); errs.forEach((l) => console.error(`  [${l.source}] ${l.message}`)); }
  await browser.close(); // disconnects only; the app keeps running
  process.exit(failed ? 1 : 0);
})();
```
Note: `e2e/cdp.js` uses the default control file `os.tmpdir()/app-test-control.json`, which is
what `npm run app:test` writes (no `APP_TEST_INFO_FILE` set).

Every action prints `ok` or `FAILED`, then automatically prints any NEW errors from
both the renderer and the main process. If nothing extra prints, no new errors occurred.

### Exploration loop (repeat)
```bash
node e2e/cdp.js snapshot                   # what's on screen, as roles/names
node e2e/cdp.js click testid:new-project-button
node e2e/cdp.js fill testid:project-name-input "Test"
node e2e/cdp.js click testid:save-button
node e2e/cdp.js snapshot                   # verify expected result appeared
node e2e/cdp.js shot /tmp/after-save.png   # then LOOK at the image
node e2e/cdp.js state                      # internal state matches the UI?
```

---

## 6. Things the DOM can't reach

- **Native file/save dialogs**: stub them with `stubOpenDialog` / `stubSaveDialog` (section 4) or add an app action via `registerAction`.
- **Menu bar, tray, OS permission prompts**: trigger the underlying handler via `registerAction`, or `app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('id').click())`.
- **True OS-level clicking (last resort)**: macOS `cliclick`, AppleScript/System Events, or Peekaboo. These take over the user's mouse, so ask first and prefer a VM for long runs.

---

## 7. Aggressive testing checklist (do not only test the happy path)

For each feature you touch, try at least these, checking errors after each:
- Empty input, whitespace only, very long text (10k chars), emoji/unicode, `<script>` and quotes.
- Double-click and rapid repeated clicks on every action button (duplicate submits).
- Click Save/Submit/Delete while a previous action is still in flight.
- Cancel and Escape out of every dialog; close a window mid-operation.
- Keyboard only: Tab through the form, Enter to submit, shortcuts.
- Reload the window (`action reload`) mid-flow; relaunch with the existing profile (persistence).
- Resize to small and large windows (`app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].setSize(600,400))`).
- Offline / failing backend responses if the app calls a network.
- Every button and menu item at least once ("click everything" pass).
- Disabled/enabled state of buttons given the current state.

---

## 8. Workflow for every task

1. Make the code change (add `data-testid`s for new UI).
2. Start the app in test mode (section 5) or run the Playwright spec (section 4).
3. Drive the real flow: happy path first, then section 7.
4. After EVERY action, check errors and UI state (the CLI and `step()` do this automatically).
5. Take at least one screenshot of the final state and actually view it for visual problems (overlap, clipping, wrong text).
6. On any failure: fix the root cause, relaunch, re-run the same steps.
7. For every bug found, add a permanent test to `e2e/` that fails before the fix and passes after.
8. Finish with the report below. Run `npx playwright test` once before saying you are done.

## 9. Report format

```
RESULT: PASS | FAIL
Flows tested: <list>
Bugs found/fixed: <title - cause - fix - regression test file>
Open issues: <repro steps, expected vs actual, log lines, screenshot path>
Evidence: e2e-artifacts/<run>/ (report.json, screenshots, trace.zip)
Not tested: <anything skipped and why>
```

## 10. Troubleshooting

| Symptom | Fix |
|---|---|
| `control server not ready` | `APP_TEST_MODE=1` not set, `init()` not called early enough, or app is packaged |
| `connectOverCDP` refused | App not started with `--remote-debugging-port=9222`, or already crashed - check `/tmp/app-test.log` |
| Stale/wrong control port | Delete `os.tmpdir()/app-test-control.json` and restart the app |
| `getByTestId` not found | Wrong testid or wrong window - run `snapshot`, or set `PAGE=1` for another window |
| Only a splash window is found | Wait for the main window: `await app.waitForEvent('window')` |
| `ariaSnapshot` is not a function | Upgrade Playwright, or fall back to `page.accessibility.snapshot()` / screenshots |
| App relaunch uses old data | Scripted tests use a fresh temp profile; the CLI uses `/tmp/app-test-profile` - delete it for a clean slate |
| Console messages missing in `/logs` | Check Electron's `console-message` signature changed; the code above handles both forms |