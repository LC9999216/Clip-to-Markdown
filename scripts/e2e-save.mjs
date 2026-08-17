/**
 * 端到端保存流程 E2E：在真实浏览器中验证「内容脚本 → Popup → Background → 落盘」全链路。
 *
 * 流程：
 * 1. 加载 dist/ 扩展（Google Chrome 官方版禁用 --load-extension，需 Edge 或 Chromium 系浏览器）
 * 2. 打开 https://x.com/deepseek_ai/status/8888（真实 x.com 域名，content script 注入点）
 * 3. 把 X 长文章 fixture 的 DOM 注入页面（X 对无登录态客户端只返回无 JS 降级页，故以 fixture 代替真实文章 DOM）
 * 4. 以弹窗页打开 popup.html（stub chrome.tabs.query 指向 x.com 标签页）
 * 5. 校验 GET_STATUS 识别「平台：X / Twitter · 文章」与标题 → 点击保存
 * 6. 等待浏览器把 .md 文件下载到 profile 的 Downloads，校验内容与 fixture 期望一致
 *
 * 用法：node scripts/e2e-save.mjs [dist路径] [fixture名]（默认 article）
 * 环境：CHROME_PATH 指向 Edge/Chromium；Node 22+。
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHROME =
  process.env.CHROME_PATH ??
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const DIST = resolve(process.argv[2] ?? join(HERE, '..', 'dist'));
const FIXTURE = process.argv[3] ?? 'article';
const FIXTURE_HTML = join(HERE, '..', 'tests', 'fixtures', 'x', FIXTURE, 'index.html');
const FIXTURE_MD = join(HERE, '..', 'tests', 'fixtures', 'x', FIXTURE, 'expected.md');
const X_URL = 'https://x.com/deepseek_ai/status/8888';
const PORT = 9224;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 给 Promise 加超时：渲染进程繁忙时快速失败，避免无限挂起 */
function withTimeout(p, ms, label) {
  return Promise.race([
    p,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} 超时（${ms}ms）`)), ms)),
  ]);
}

async function getJson(path) {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`);
  if (!r.ok) throw new Error(`CDP ${path} → ${r.status}`);
  return r.json();
}

async function connectTo(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    ws.addEventListener('open', resolveOpen, { once: true });
    ws.addEventListener('error', () => rejectOpen(new Error('WS 连接失败')), { once: true });
  });
  let msgId = 0;
  const pending = new Map();
  const listeners = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve: r, reject: j } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) j(new Error(m.error.message));
      else r(m.result);
    } else {
      for (const l of listeners) l(m);
    }
  });
  return {
    send: (method, params = {}) =>
      withTimeout(
        new Promise((resolveSend, rejectSend) => {
          const id = ++msgId;
          pending.set(id, { resolve: resolveSend, reject: rejectSend });
          ws.send(JSON.stringify({ id, method, params }));
        }),
        15000,
        `CDP ${method}`,
      ),
    on: (fn) => listeners.push(fn),
    close: () => ws.close(),
  };
}

const profile = mkdtempSync(join(tmpdir(), 'clip2md-e2e-save-'));
const downloadsDir = join(profile, 'Default', 'Downloads');
const chrome = spawn(
  CHROME,
  [
    `--user-data-dir=${profile}`,
    `--load-extension=${DIST}`,
    `--remote-debugging-port=${PORT}`,
    '--no-first-run',
    '--disable-default-apps',
    '--disable-gpu',
    '--no-sandbox',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.error(`✗ ${msg}`);
};
const ok = (msg) => console.log(`✓ ${msg}`);

try {
  // 0. CDP 就绪
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    try {
      const v = await getJson('/json/version');
      console.log(`Browser: ${v.Browser}`);
      ready = true;
    } catch {
      await sleep(500);
    }
  }
  if (!ready) throw new Error('CDP 未就绪');

  // 1. 控制页 + 扩展 ID
  let ctl = null;
  for (let i = 0; i < 30 && !ctl; i++) {
    const list = await getJson('/json/list');
    ctl = list.find((t) => t.type === 'page');
    if (!ctl) await sleep(500);
  }
  if (!ctl) throw new Error('未找到控制页 target');

  const ctlWs = await connectTo(ctl.webSocketDebuggerUrl);
  await ctlWs.send('Page.enable');
  await ctlWs.send('Runtime.enable');

  await ctlWs.send('Page.navigate', { url: 'chrome://extensions-internals' });
  await sleep(3500);
  const internals = await ctlWs.send('Runtime.evaluate', {
    expression: 'document.body.innerText',
    returnByValue: true,
  });
  const info = String(internals?.result?.value ?? '');
  const nameIdx = info.indexOf('Clip2MD');
  if (nameIdx === -1) throw new Error('Clip2MD 未加载（extensions-internals 无记录）');
  const ids = [...info.slice(0, nameIdx).matchAll(/"id"\s*:\s*"([a-p]{32})"/g)];
  const extId = ids.at(-1)?.[1];
  if (!extId) throw new Error('无法解析扩展 ID');
  ok(`扩展已加载（ID: ${extId}）`);

  // 2. 打开 x.com 页面并注入文章 fixture DOM
  await ctlWs.send('Page.navigate', { url: X_URL });
  // 等待页面可交互（readyState=complete 或超时），X 对无登录态客户端可能加载较慢
  let pageReady = false;
  for (let i = 0; i < 20 && !pageReady; i++) {
    await sleep(1000);
    try {
      const r = await ctlWs.send('Runtime.evaluate', {
        expression: 'document.readyState',
        returnByValue: true,
        timeout: 3000,
      });
      pageReady = r?.result?.value === 'complete';
    } catch {
      /* 渲染进程忙，重试 */
    }
  }
  console.log(`    x.com 页面 readyState=complete: ${pageReady}`);
  const fixtureBody = readFileSync(FIXTURE_HTML, 'utf-8').match(/<body>([\s\S]*)<\/body>/)?.[1] ?? '';
  if (!fixtureBody) throw new Error('fixture 无 body 内容');
  const injected = await ctlWs.send('Runtime.evaluate', {
    expression: `(() => {
      document.body.innerHTML = ${JSON.stringify(fixtureBody)};
      const has = (s) => !!document.querySelector(s);
      return {
        articleTitle: has('[data-testid="twitter-article-title"]'),
        richView: has('[data-testid="twitterArticleRichTextView"]'),
        contents: has('[data-contents="true"]'),
        url: location.href,
      };
    })()`,
    returnByValue: true,
  });
  const inj = injected?.result?.value;
  if (!inj?.articleTitle || !inj?.richView || !inj?.contents) {
    throw new Error(`fixture 注入失败: ${JSON.stringify(inj)}`);
  }
  ok(`x.com 页面已注入文章 fixture（${inj.url}）`);

  // 3. 打开 popup：先建空白页，注入 tabs.query 重定向 stub，再导航到 popup.html
  const browserWs = await connectTo((await getJson('/json/version')).webSocketDebuggerUrl);
  // 注意：不设置 Browser.setDownloadBehavior —— 它会让浏览器忽略 chrome.downloads 指定的
  // 文件名（data URL 无文件名提示，落盘成通用 download.md），破坏「标题文件名」验证。
  const downloadEvents = [];
  browserWs.on?.((m) => {
    if (m.method === 'Browser.downloadWillBegin' || m.method === 'Browser.downloadProgress') {
      downloadEvents.push(m);
    }
  });
  const created = await browserWs.send('Target.createTarget', { url: 'about:blank' });
  const newTargetId = created.targetId;
  const popupTarget = await new Promise((resolveTarget) => {
    const poll = async () => {
      const list = await getJson('/json/list');
      const t = list.find((x) => x.type === 'page' && x.id === newTargetId);
      if (t) resolveTarget(t);
      else setTimeout(poll, 300);
    };
    poll();
  });
  const popupWs = await connectTo(popupTarget.webSocketDebuggerUrl);
  await popupWs.send('Page.enable');
  await popupWs.send('Runtime.enable');
  await popupWs.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      const orig = chrome.tabs.query.bind(chrome.tabs);
      chrome.tabs.query = (opts, cb) => {
        if (opts && opts.active === true && opts.currentWindow === true) {
          return orig({}, (tabs) => {
            const target = tabs.find((t) => /x\\.com|twitter\\.com/.test(t.url || ''));
            cb(target ? [target] : []);
          });
        }
        return orig(opts, cb);
      };
    })();`,
  });
  await popupWs.send('Page.navigate', { url: `chrome-extension://${extId}/popup.html` });

  // 4. 校验 popup 状态
  let statusText = '';
  let docTitle = '';
  let saveEnabled = false;
  for (let i = 0; i < 30 && !saveEnabled; i++) {
    await sleep(500);
    const r = await popupWs.send('Runtime.evaluate', {
      expression: `(() => {
        const st = document.getElementById('status-text');
        const dt = document.getElementById('doc-title');
        const sb = document.getElementById('save-btn');
        return {
          status: st ? st.textContent : '',
          title: dt ? dt.textContent : '',
          saveEnabled: sb ? !sb.disabled : false,
          panelHidden: document.getElementById('action-panel')?.classList.contains('hidden') ?? true,
        };
      })()`,
      returnByValue: true,
    });
    const v = r?.result?.value;
    if (v) {
      statusText = v.status;
      docTitle = v.title;
      saveEnabled = v.saveEnabled;
      if (v.panelHidden && v.status) break;
    }
  }
  console.log(`    popup 状态: "${statusText}" 标题: "${docTitle}"`);
  if (!statusText.includes('X / Twitter') || !statusText.includes('文章')) {
    fail(`GET_STATUS 未识别为 X 长文章: "${statusText}"`);
  } else {
    ok('GET_STATUS 识别为「X / Twitter · 文章」');
  }
  if (docTitle !== '从0到1带你速通DeepSeek-Harness') {
    fail(`标题不符: "${docTitle}"`);
  } else {
    ok(`detectTitle 返回正式标题: ${docTitle}`);
  }

  // 5. 点击保存前重新注入 fixture（X 页面脚本可能覆盖 body），确保 EXTRACT 读到文章 DOM
  const recheck = await ctlWs.send('Runtime.evaluate', {
    expression: `!!document.querySelector('[data-testid="twitter-article-title"]')`,
    returnByValue: true,
  });
  if (recheck?.result?.value !== true) {
    await ctlWs.send('Runtime.evaluate', {
      expression: `document.body.innerHTML = ${JSON.stringify(fixtureBody)}`,
      returnByValue: true,
    });
    console.log('    已重新注入 fixture（原 DOM 被页面脚本覆盖）');
  }
  await popupWs.send('Runtime.evaluate', {
    expression: `document.getElementById('save-btn').click()`,
  });
  let finalStatus = '';
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const r = await popupWs.send('Runtime.evaluate', {
      expression: `document.getElementById('status-text')?.textContent ?? ''`,
      returnByValue: true,
    });
    const s = String(r?.result?.value ?? '');
    if (s && s !== statusText) {
      finalStatus = s;
      break;
    }
    if (downloadEvents.length > 0) break;
  }
  console.log(`    popup 最终状态: "${finalStatus}"`);
  if (finalStatus && !finalStatus.includes('已保存')) {
    fail(`保存流程失败: "${finalStatus}"`);
  } else if (finalStatus) {
    ok(`保存成功: ${finalStatus}`);
  }

  // 6. 等待下载落盘（Edge 默认落系统下载目录，Chrome 落 profile Downloads；都查）
  const expectedName = '从0到1带你速通DeepSeek-Harness.md';
  const candidates = [
    join(process.env.USERPROFILE ?? '', 'Downloads', expectedName),
    join(downloadsDir, expectedName),
  ];
  let filePath = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 30000 && !filePath) {
    await sleep(500);
    for (const p of candidates) {
      if (existsSync(p)) {
        filePath = p;
        break;
      }
    }
  }
  if (downloadEvents.length > 0) {
    const last = downloadEvents.at(-1);
    console.log(
      `    下载事件: ${last.method} state=${last.params?.state ?? ''} suggestedFilename=${last.params?.suggestedFilename ?? ''}`,
    );
  }
  if (!filePath) {
    fail(`下载文件未出现（查找 ${candidates.join(' 或 ')}）`);
  } else {
    ok(`文件已下载: ${filePath}`);
    const actual = readFileSync(filePath, 'utf-8').replace(/\r\n/g, '\n').trim();
    const expected = readFileSync(FIXTURE_MD, 'utf-8').replace(/\r\n/g, '\n').trim();
    if (actual === expected) {
      ok('下载内容与 fixture 期望 Markdown 完全一致');
    } else {
      fail('下载内容与期望不一致');
      const a = actual.split('\n');
      const e = expected.split('\n');
      for (let i = 0; i < Math.max(a.length, e.length); i++) {
        if (a[i] !== e[i]) {
          console.error(`  第 ${i + 1} 行 → 期望: ${JSON.stringify(e[i])}`);
          console.error(`           实际: ${JSON.stringify(a[i])}`);
          break;
        }
      }
    }
  }

  popupWs.close();
  ctlWs.close();
  browserWs.close();
} catch (e) {
  failures += 1;
  console.error(`✗ E2E 失败: ${e.message}`);
} finally {
  chrome.kill();
  setTimeout(() => {
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      /* Chrome 可能仍占用 profile，忽略 */
    }
  }, 1500);
}

process.exit(failures === 0 ? 0 : 1);
