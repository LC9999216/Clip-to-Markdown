/**
 * E2E 冒烟：在真实 Chrome 中加载 dist/ 扩展并验证：
 * 1. 扩展成功加载（chrome://extensions-internals 无加载错误）
 * 2. 扩展就绪后导航到 x.com 页面，内容脚本注入（隔离世界 chrome.runtime 可用）
 * 3. 页面 DOM 具备 X 登录墙/推文/文章标记（GET_STATUS 可作出有效判定）
 *
 * 用法：node scripts/e2e-smoke.mjs [dist路径] [x.com URL]
 * 依赖：本机 Chrome + Node 22+（内置 fetch/WebSocket）。
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CHROME =
  process.env.CHROME_PATH ??
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DIST = resolve(process.argv[2] ?? 'dist');
const TARGET_URL =
  process.argv[3] ?? 'https://x.com/dotey/status/2087948481721962669';
const PORT = 9223;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(path) {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`);
  if (!r.ok) throw new Error(`CDP ${path} → ${r.status}`);
  return r.json();
}

const profile = mkdtempSync(join(tmpdir(), 'clip2md-e2e-'));
const chrome = spawn(
  CHROME,
  [
    `--user-data-dir=${profile}`,
    `--load-extension=${DIST}`,
    `--disable-extensions-except=${DIST}`,
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

async function connectTo(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
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
      new Promise((resolveSend, rejectSend) => {
        const id = ++msgId;
        pending.set(id, { resolve: resolveSend, reject: rejectSend });
        ws.send(JSON.stringify({ id, method, params }));
      }),
    on: (fn) => listeners.push(fn),
    close: () => ws.close(),
  };
}

try {
  // 1. 等待 CDP 就绪
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    try {
      const v = await getJson('/json/version');
      console.log(`Chrome: ${v.Browser}`);
      ready = true;
    } catch {
      await sleep(500);
    }
  }
  if (!ready) throw new Error('Chrome CDP 未就绪');

  // 2. 等一个空白页 target 作为控制页
  let ctl = null;
  for (let i = 0; i < 30 && !ctl; i++) {
    const list = await getJson('/json/list');
    ctl = list.find((t) => t.type === 'page');
    if (!ctl) await sleep(500);
  }
  if (!ctl) throw new Error('未找到控制页 target');

  // 3. 打开 chrome://extensions-internals 确认扩展加载状态（含错误信息）
  const ctlWs = await connectTo(ctl);
  await ctlWs.send('Page.enable');
  await ctlWs.send('Runtime.enable');
  await ctlWs.send('Page.navigate', { url: 'chrome://extensions-internals' });
  await sleep(4000);
  const internals = await ctlWs.send('Runtime.evaluate', {
    expression: `document.body.innerText`,
    returnByValue: true,
  });
  const info = String(internals?.result?.value ?? '');
  const m = info.match(/"id"\s*:\s*"[^"]+"[\s\S]{0,1200}/);
  const clip2md = /Clip2MD/.test(info);
  const loadError = (info.match(/"error"\s*:\s*"[^"]*"/) ?? [])[0];
  if (clip2md) ok('扩展已加载（extensions-internals 存在 Clip2MD）');
  else fail(`扩展未出现在 extensions-internals${loadError ? `，错误：${loadError}` : ''}`);
  if (loadError && loadError !== '"error": ""') fail(`扩展加载错误: ${loadError}`);
  if (m) console.log(`    扩展记录片段: ${m[0].slice(0, 200)}...`);

  // 4. 先注册上下文/异常监听，再导航到目标 x.com 页面（确保不遗漏隔离世界创建事件）
  const contexts = [];
  const exceptions = [];
  ctlWs.on((msg) => {
    if (msg.method === 'Runtime.executionContextCreated') contexts.push(msg.params.context);
    else if (msg.method === 'Runtime.exceptionThrown') {
      exceptions.push(msg.params.exceptionDetails.text);
    }
  });
  await ctlWs.send('Page.navigate', { url: TARGET_URL });
  await sleep(10000);

  const evaluate = async (expression, contextId) => {
    const r = await ctlWs.send('Runtime.evaluate', {
      expression,
      contextId,
      returnByValue: true,
      awaitPromise: true,
    });
    return r?.result?.value;
  };

  // 5. 默认世界：页面 DOM 标记与加载状态
  const dom = await evaluate(
    `(() => {
      const has = (s) => !!document.querySelector(s);
      return {
        title: document.title,
        readyState: document.readyState,
        reactRoot: has('#react-root'),
        loginWall: has('[data-testid="loginButton"], [href="/login"], [data-testid="signupButton"]'),
        articleTitle: has('[data-testid="twitter-article-title"]'),
        articleRichView: has('[data-testid="twitterArticleRichTextView"]'),
        longform: has('[data-testid="longformRichTextComponent"]'),
        tweetText: has('[data-testid="tweetText"]'),
        bodyText: (document.body?.innerText ?? '').slice(0, 120).replace(/\\s+/g, ' '),
      };
    })()`,
  );
  if (!dom) fail('页面 DOM 评估失败');
  else {
    ok(`页面已打开: ${dom.title || '(无标题)'}（readyState=${dom.readyState}）`);
    console.log(
      `    登录墙=${dom.loginWall} 文章标题=${dom.articleTitle} 富文本=${dom.articleRichView} 推文正文=${dom.tweetText}`,
    );
    if (dom.bodyText) console.log(`    正文片段: ${dom.bodyText}`);
    if (!dom.loginWall && !dom.articleTitle && !dom.tweetText) {
      fail('页面既无登录墙也无推文/文章标记（结构异常）');
    }
  }

  // 7. 隔离世界：内容脚本注入检查
  const isolated = contexts.filter((c) => c.auxData && c.auxData.isDefault === false);
  if (isolated.length === 0) fail('未发现隔离世界执行上下文');
  let injected = false;
  for (const ctx of isolated) {
    const v = await evaluate(
      `typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.runtime.id`,
      ctx.id,
    );
    if (v === true) {
      injected = true;
      break;
    }
  }
  if (injected) ok('内容脚本已注入（隔离世界内 chrome.runtime 可用）');
  else fail('内容脚本未注入到 x.com 页面');

  // 8. 页面异常汇总
  if (exceptions.length > 0) {
    fail(`页面执行异常 ${exceptions.length} 条：${exceptions.slice(0, 3).join(' | ')}`);
  } else {
    ok('未捕获页面执行异常');
  }

  ctlWs.close();
} catch (e) {
  failures += 1;
  console.error(`✗ 冒烟测试失败: ${e.message}`);
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
