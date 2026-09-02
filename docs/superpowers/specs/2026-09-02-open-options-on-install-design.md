# Clip2MD 首次安装后自动打开设置页设计

日期：2026-09-02  
状态：设计已确认

## 目标

用户首次安装 Clip2MD 后，Chrome 自动在新标签页打开现有设置页，便于立即完成保存位置和 AI/Obsidian 配置。

## 行为设计

- 在 Manifest V3 后台 Service Worker 中监听 `chrome.runtime.onInstalled`。
- 仅当 `details.reason === chrome.runtime.OnInstalledReason.INSTALL` 时调用 `chrome.runtime.openOptionsPage()`。
- 扩展更新、Chrome 更新、共享模块更新和未打包扩展重载不打开设置页。
- 复用 `src/manifest.json` 现有 `options_ui.page = "options.html"` 与 `open_in_tab = true`，不新增权限、设置字段或数据迁移。
- 如 Chrome 无法打开设置页，本功能不阻断扩展安装，不额外弹通知。

## 代码边界

- 生产代码只在后台入口增加安装事件注册。
- 测试基建补充可触发的 `runtime.onInstalled` mock。
- 后台测试覆盖首次安装与非首次安装两类事件。
- 不修改设置页 UI、保存逻辑、现有设置状态或弹窗/侧边栏行为。

## 验收标准

1. 模拟 `reason: "install"` 时，设置页恰好打开一次。
2. 模拟 `reason: "update"` 时，设置页不打开。
3. 后台相关定向测试、全量测试、类型检查与构建全部通过。
4. 构建后的 `dist/manifest.json` 仍正确声明独立标签页设置页。
5. 真实 Chrome 验证时：首次“加载已解压的扩展程序”会打开设置页；随后点击“重新加载”不会再打开。

## 风险控制

- `onInstalled` 不只在首次安装时触发，因此必须显式判断 `INSTALL`，避免升级打扰既有用户。
- Chrome 将未打包扩展重载视为 `update`，所以开发调试的“重新加载”不应重复弹页。
- 实施时不触碰当前未跟踪的 `.playwright-cli/` 与 `tmp-recording/`。
