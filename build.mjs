/**
 * esbuild 构建脚本。
 *
 * 三种产物格式：
 *  - content / popup   → IIFE（content script 不能使用 ES module，popup 用 <script src> 引入）
 *  - background        → ESM（MV3 service worker，manifest 里 type: "module"）
 */
import { build, context } from 'esbuild';
import { copyFileSync, readdirSync, statSync, rmSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, 'dist');
const watch = process.argv.includes('--watch');

// 手动递归拷贝目录（Windows/OneDrive 环境下 node:fs cpSync 的 recursive 模式会异常退出）
function copyDir(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(src)) {
    const s = join(src, name);
    const d = join(dest, name);
    if (statSync(s).isDirectory()) {
      copyDir(s, d);
    } else {
      copyFileSync(s, d);
    }
  }
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const common = {
  bundle: true,
  target: 'chrome120',
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
  logLevel: 'info',
};

const entryPoints = [
  { entryPoints: ['src/content/content-script.ts'], outfile: 'dist/content.js', format: 'iife' },
  { entryPoints: ['src/popup/popup.ts'], outfile: 'dist/popup.js', format: 'iife' },
  { entryPoints: ['src/background/background.ts'], outfile: 'dist/background.js', format: 'esm' },
];

// 静态资源拷贝
for (const [from, to] of [
  ['src/manifest.json', 'dist/manifest.json'],
  ['src/popup/popup.html', 'dist/popup.html'],
  ['src/popup/popup.css', 'dist/popup.css'],
]) {
  copyFileSync(join(root, from), join(root, to));
}
copyDir(join(root, 'src/icons'), join(dist, 'icons'));

async function main() {
  if (watch) {
    const ctxs = [];
    for (const e of entryPoints) {
      const ctx = await context({ ...common, ...e });
      await ctx.watch();
      ctxs.push(ctx);
    }
    console.log('Watch 模式已启动，等待文件变更…');
  } else {
    for (const e of entryPoints) {
      await build({ ...common, ...e });
    }
    console.log('构建完成 → dist/');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
