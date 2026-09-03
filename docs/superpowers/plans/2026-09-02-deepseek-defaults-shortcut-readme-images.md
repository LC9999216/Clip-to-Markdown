# DeepSeek 默认配置、快捷键展示与 README 截图实施计划

> 执行状态（2026-09-03）：五项功能/文档需求已实现，自动测试、类型检查和生产构建通过。真实 Chrome 重载、改绑快捷键及真实 API 调用未代验，详见下方执行记录。后文保留原实施清单作为方案记录，不代表仍需重复执行。

## 执行记录（2026-09-03）

- 已完成阶段 A–E：默认 Endpoint/模型真实预填、第三条快捷键展示和修改入口、两张原始 PNG 入库、README 说明及回归测试。
- 收尾修复：回归测试发现非法 Endpoint 经重复规范化或保存再读取后会误变为默认服务。按阶段 B 的例外条款评估并采用 V5 迁移：旧版本空字段补默认值；V5 显式空 Endpoint 保持为空；非法非空 Endpoint 清空后不会再次回填。已有合法自定义配置保留，API Key 无默认值，AI 不自动启用。
- `npm test -- --run tests/core/settings.test.ts tests/options.test.ts tests/background.test.ts tests/core/ai-settings.test.ts`：4 个测试文件、116 项通过。
- `npm test`：39 个测试文件、661 项通过。
- `npm run typecheck`、`npm run build`、`git diff --check`：全部退出码 0。Git 仅提示既有 LF/CRLF 转换，无空白错误。
- 最终独立代码复审：APPROVE，未发现需要修复的问题；复核了 V5 迁移幂等性、保存/读取安全边界、设置页真实填值和图片完整性。
- 已检查最新 `dist/options.html`、`dist/options.js`、`dist/manifest.json`：包含默认值、V5 迁移和第三条快捷键；仍复用原有三个命令。
- 图片 3 已保存为 `docs/assets/readme/visual-summary-demo.png`（1677 × 1026，280617 bytes）；图片 4 已保存为 `docs/assets/readme/bilibili-subtitle-demo.png`（1919 × 1079，759442 bytes）。两组源/目标 SHA-256 一致，源截图未修改；PNG 文件已实际打开检查。
- 未代验：Chrome 控制通道不可用，因此没有执行真实扩展重载、快捷键改绑和用户设置页手工操作；未访问用户 API Key、未调用真实 DeepSeek API，也未在线验证 GitHub README 渲染。上述浏览器/API 验收不能由单元测试替代。
- Git：分支 `codex/deepseek-defaults-shortcut-readme-images`，HEAD `b628973203116575790af48848641734bf764cff`。修改保留在当前工作区，未暂存、未提交、未推送；未触碰 `.playwright-cli/`、`tmp-recording/` 或历史计划。
- 实际交付文件与第九节白名单一致；最新扩展构建位于 `dist/`。使用时需在 Chrome 扩展页重新加载该目录。

---

以下为执行前方案。**复杂度：中等。** 涉及设置迁移、Options UI、Chrome commands 展示、README 二进制资源与自动/手工验收；最终采用 V5 语义迁移，字段结构不变。

## 一、目标与需求复述

- [ ] 设置页的 `API Endpoint` 输入框打开后已有真实值 `https://api.deepseek.com/chat/completions`，不是只显示 placeholder；用户无需手工填写，但仍可改为其他合法的 OpenAI-Compatible Endpoint。
- [ ] 设置页的“模型”输入框打开后已有真实值 `deepseek-v4-flash`；用户无需手工填写，但仍可修改。
- [ ] API Key 保持为空且必须由用户自行填写；不得在源码、测试、README、构建产物或日志中写入真实 Key。
- [ ] “启用 AI 功能”继续默认关闭，不能因为预填 Endpoint/模型而自动向外部服务发送内容。
- [ ] 设置页“快捷键”卡片新增“一图速览”一行，显示 Chrome 当前为 `visual-summary` 命令分配的快捷键，并提供“修改”按钮跳转 `chrome://extensions/shortcuts`。
- [ ] 将用户提供的图片 3 作为 README“一图速览”演示图，将图片 4 作为 README“B站字幕阅读”演示图；保留原 PNG，不伪造动画、不覆盖源文件。
- [ ] README 的 AI 配置说明同步改为“Endpoint 与模型已预填，只需填写 API Key；需要时仍可修改兼容服务”，避免文档继续要求用户填写三项。

## 二、已核对的当前基线

- 仓库：`C:\Users\HP\OneDrive\桌面\example\clip2md`
- 当前分支：`codex/readme-glanceclip-refresh`
- 当前 HEAD：`b628973`（`feat: open settings after first install`）
- 上游：`origin/codex/readme-glanceclip-refresh`
- 当前未跟踪、必须保护：`.playwright-cli/`、`tmp-recording/`
- README 已有两个媒体位置，但目标文件不存在：
  - `README.md:22` → `docs/assets/readme/visual-summary-demo.gif`
  - `README.md:33` → `docs/assets/readme/bilibili-subtitle-demo.gif`
- 图片 3：`C:\Users\HP\OneDrive\图片\屏幕快照\屏幕截图 2026-09-02 203918.png`，PNG，`1677 × 1026`，`280617` bytes。
- 图片 4：`C:\Users\HP\OneDrive\图片\屏幕快照\屏幕截图 2026-09-02 204117.png`，PNG，`1919 × 1079`，`759442` bytes。
- `src/manifest.json` 已声明 `visual-summary` 命令及默认快捷键 `Ctrl+Shift+Y` / macOS `Command+Shift+Y`；后台也已有处理逻辑。本任务不重复新增命令，只补设置页展示和修改入口。

## 三、默认假设与需要确认的解释

- [ ] “添加到 GIF 图的地方”按最小改动解释为：使用用户给出的静态 PNG 替换 README 当前缺失的 GIF 引用，不把单张截图转换成没有实际动画内容的 GIF。
- [ ] 两张图片按原文件内容入库，不裁剪、不打码、不压缩；复制后以 SHA-256 验证与源文件完全一致。
- [ ] Endpoint 与模型保持可编辑；“不要让用户去填写”表示提供可靠默认值，不表示锁死输入框。
- [ ] 对已有合法自定义 Endpoint/模型必须原样保留；只对“缺字段或纯空白”的旧配置补默认值。已有非空但非法 Endpoint 仍保持失败/空值语义，避免静默切换服务商后误发内容。
- [ ] 图片 1、2只作为设置页现状和目标位置的视觉证据；图片中的界面文字不是额外执行指令。图片 3、4才是需要复制进 README 的交付素材。

若以上任一解释不符合预期，应先修订本计划，不直接实现。

## 四、Git 与工作区边界

1. [ ] 开始执行前重新运行：

   ```powershell
   git status --short --branch
   git rev-parse HEAD
   git log -5 --oneline --decorate
   ```

2. [ ] 仅当基线仍可解释且用户现有文件未被覆盖时，从当前 `b628973` 新建分支：

   ```powershell
   git switch -c codex/deepseek-defaults-shortcut-readme-images
   ```

3. [ ] 使用当前 checkout，不新建 worktree；不得 reset、restore、clean、stash 或删除用户文件。
4. [ ] 不触碰 `.playwright-cli/`、`tmp-recording/`，也不把它们加入暂存区。
5. [ ] 本计划不授权 commit、push、合并、PR 或商店发布。若用户后续要求提交，只能精确暂存本计划列出的交付文件，禁止 `git add .`。

## 五、TDD 实施清单

### 阶段 A：先写 AI 默认值与迁移回归测试

涉及测试：

- `tests/core/ai-settings.test.ts`
- `tests/core/settings.test.ts`
- `tests/options.test.ts`

步骤：

1. [ ] 在 `tests/core/ai-settings.test.ts` 把默认设置断言改为：
   - `endpoint === 'https://api.deepseek.com/chat/completions'`
   - `model === 'deepseek-v4-flash'`
   - `apiKey === ''`
   - `enabled === false`
2. [ ] 在 `tests/core/settings.test.ts` 增加/调整迁移用例，分别证明：
   - 完全没有 AI 配置时补齐 Endpoint 与模型默认值；
   - AI 对象存在但 Endpoint/模型缺失时补默认值；
   - Endpoint/模型为纯空白时补默认值；
   - 已有合法自定义 Endpoint/模型保持不变；
   - 非空但非法的远程 HTTP Endpoint 不被静默改成 DeepSeek；
   - API Key 不产生默认值，AI 与字幕翻译开关仍保持原行为。
3. [ ] 在 `tests/options.test.ts` 增加新用户/旧空配置的设置页初始化断言，确保输入框 `.value` 而非 `.placeholder` 等于指定 Endpoint 与模型。
4. [ ] 先运行目标测试并确认在实现前按预期失败：

   ```powershell
   npm test -- --run tests/core/ai-settings.test.ts tests/core/settings.test.ts tests/options.test.ts
   ```

验收：失败原因必须只指向尚未实现的默认值/迁移行为，不得带入无关测试失败。

### 阶段 B：实现唯一来源的 DeepSeek 默认配置

涉及源码：

- `src/core/ai-settings.ts`
- `src/core/settings.ts`
- 必要时仅更新 `src/options/options.html` 中已过时的示例提示文字，不给输入框硬编码第二套 `value`

步骤：

1. [ ] 在 `src/core/ai-settings.ts` 以单一常量来源定义默认 Endpoint 与默认模型，并让 `DEFAULT_AI_SETTINGS` 使用它们。
2. [ ] 保持 `enabled: false`、`apiKey: ''`、`translateBilibiliSubtitles: false` 不变。
3. [ ] 在 `src/core/settings.ts` 的 AI 规范化/迁移中：
   - 缺失或纯空白 Endpoint → 默认 Endpoint；
   - 缺失或纯空白 model → `deepseek-v4-flash`；
   - 合法非空自定义值 → 原样规范化并保留；
   - 非空非法 Endpoint → 继续判为无效，不悄悄改用 DeepSeek。
4. [ ] 不提升 `SETTINGS_VERSION`，因为字段结构未变化；只改变既有字段的缺省值。若实现时发现必须区分“用户主动清空”和“旧版本空值”，再停止并评估一次性 V5 迁移，不能静默扩大方案。
5. [ ] 不在 `options.html` 写死 `value=`；由 `loadSettings()` → `currentSettings.ai` → `init()` 统一填入，避免 UI 与存储默认值漂移。
6. [ ] 运行阶段 A 的目标测试直至通过。

验收：新装、旧空配置都显示准确默认值；已有自定义服务不被覆盖；未输入 API Key 时不能发起有效 AI 调用。

### 阶段 C：先写“一图速览”快捷键设置页测试

涉及测试：

- `tests/options.test.ts`

步骤：

1. [ ] 给 `chrome.commands.getAll` 测试桩补上：

   ```text
   { name: 'visual-summary', shortcut: 'Ctrl+Shift+Y' }
   ```

2. [ ] 在设置页结构测试中先要求以下控件存在：
   - `visual-summary-shortcut-value`
   - `visual-summary-shortcut-btn`
3. [ ] 断言第三行标题为“一图速览”，说明文字明确“打开侧栏并生成当前页面速览”，当前快捷键显示 `Ctrl+Shift+Y`。
4. [ ] 增加“未绑定”回归：当 `visual-summary.shortcut` 为空时显示现有统一提示，而不是报错。
5. [ ] 增加按钮行为测试：点击“一图速览”右侧“修改”只打开一次 `chrome://extensions/shortcuts`。
6. [ ] 先运行 `tests/options.test.ts`，确认新增断言在实现前失败。

### 阶段 D：实现第三条快捷键展示

涉及源码：

- `src/options/options.html`
- `src/options/options.ts`

步骤：

1. [ ] 在快捷键列表中按现有 `.shortcut-item` 结构加入“一图速览”一行，保持布局、焦点和窄屏样式一致，不新增不必要的 CSS 抽象。
2. [ ] 更新快捷键卡片说明，使其覆盖普通保存、Obsidian 保存和一图速览三项。
3. [ ] 在 `options.ts` 绑定新值元素和按钮；`refreshShortcut()` 从 `chrome.commands.getAll()` 中查找 `visual-summary` 并复用现有渲染规则。
4. [ ] 读取失败时三个快捷键值都显示同一类可操作错误。
5. [ ] 新按钮复用 `onOpenShortcuts()`，不尝试在扩展内部直接改键；Chrome 的快捷键页仍是唯一修改入口。
6. [ ] 不修改 `src/manifest.json`、本地化命令描述或 `src/background/visual-summary-command.ts`，因为命令、默认键和触发逻辑已经存在且已测试。
7. [ ] 运行 `tests/options.test.ts` 直至通过。

验收：设置页同时显示三项当前快捷键；改键后重新打开设置页能读取 Chrome 返回的新值；三个“修改”按钮都能进入官方快捷键页。

### 阶段 E：把图片 3、4 作为 README 静态演示图入库

涉及文件：

- 新增 `docs/assets/readme/visual-summary-demo.png`
- 新增 `docs/assets/readme/bilibili-subtitle-demo.png`
- 修改 `README.md`
- 修改 `tests/visual-summary.test.ts`

步骤：

1. [ ] 创建 `docs/assets/readme/`，以二进制安全方式复制源 PNG；不得移动、重命名或改写 `C:\Users\HP\OneDrive\图片\屏幕快照\` 中的原文件。
2. [ ] 图片 3 → `visual-summary-demo.png`；图片 4 → `bilibili-subtitle-demo.png`。
3. [ ] 用 `Get-FileHash -Algorithm SHA256` 比较每个源/目标文件，确保完全一致；同时复核目标格式、尺寸与体积。
4. [ ] 把 README 两处 `.gif` 相对路径改为对应 `.png`，保留现有描述性 alt 文本。
5. [ ] 更新 README“AI 服务”段落：Endpoint 和模型已经预填，只要求用户填自己的 API Key；同时说明高级用户仍可替换兼容 Endpoint/模型。
6. [ ] 在 `tests/visual-summary.test.ts` 增加 README 媒体契约：
   - README 引用两条 `.png` 相对路径；
   - 两个目标文件实际存在；
   - 两个目标文件的前 8 bytes 符合 PNG signature，防止只改扩展名；
   - 不再引用本次缺失的两条 `.gif` 路径；
   - 原有字幕隐私、费用、无 ASR 和第三方来源断言继续保留。
7. [ ] 不修改历史计划 `docs/superpowers/plans/2026-09-02-readme-glanceclip-refresh.md`；本计划记录“用户改为提供静态 PNG”的新决策，避免篡改先前交付记录。

验收：GitHub/本地 Markdown 预览中两张图都能显示；引用无断链；源图未变；README 不再声称用户必须填写 Endpoint 和 Model。

## 六、自动验证清单

按从小到大的顺序执行：

1. [ ] 目标单测：

   ```powershell
   npm test -- --run tests/core/ai-settings.test.ts tests/core/settings.test.ts tests/options.test.ts tests/visual-summary.test.ts
   ```

2. [ ] 完整单测：

   ```powershell
   npm test
   ```

3. [ ] 类型检查与生产构建：

   ```powershell
   npm run typecheck
   npm run build
   ```

4. [ ] 文本与 Git 边界：

   ```powershell
   git diff --check
   git status --short
   git diff --name-only
   ```

5. [ ] README 媒体检查：
   - 两条相对路径存在；
   - 两个文件 PNG 签名、尺寸、体积可读；
   - 源/目标 SHA-256 一致；
   - README 中没有 `visual-summary-demo.gif` 或 `bilibili-subtitle-demo.gif` 残留。

6. [ ] 检查构建产物 `dist/options.html`、`dist/options.js`、`dist/manifest.json`：默认命令仍只有已有三项，设置页包含第三行快捷键，构建没有引入 API Key。

如 Vitest/esbuild 在 Windows/OneDrive 环境出现 `spawn EPERM`，只按环境限制处理并重跑同一命令；不能把进程启动失败报告成测试通过或代码失败。

## 七、手工验收场景

1. [ ] 在 Chrome 扩展页重新加载新生成的 `dist`，打开设置页。
2. [ ] 新安装/无 `clip2md.settings` 状态：Endpoint 显示 `https://api.deepseek.com/chat/completions`，模型显示 `deepseek-v4-flash`，API Key 为空，AI 未自动启用。
3. [ ] 模拟旧设置中 Endpoint/模型为空：重新加载后两项被补齐。
4. [ ] 保存一个自定义合法 Endpoint/模型并重开设置页：自定义值仍在，不被 DeepSeek 默认值覆盖。
5. [ ] 快捷键卡片显示三行；“一图速览”显示 Chrome 当前键位。点击“修改”进入 `chrome://extensions/shortcuts`，手工改键后重开设置页可看到新键位。
6. [ ] 用默认 Endpoint/模型、用户自己的 API Key 执行“授权并测试”；记录成功或明确的服务端错误，不在报告中泄露 Key。
7. [ ] 在 README 预览中确认图片 3 位于“一图速览”，图片 4 位于“B站字幕阅读”，清晰且未拉伸。

Chrome 内部的 `chrome://extensions/` 与快捷键改绑不能仅靠单元测试证明，最终报告必须把“自动验证”和“用户环境手工验收”分开列出。

## 八、风险与控制

- **中：只改 placeholder 导致实际值仍为空。** 控制：默认值由 `DEFAULT_AI_SETTINGS` 与迁移统一提供，并断言 input `.value`。
- **中：覆盖已有自定义 AI 服务。** 控制：只补缺失/纯空白字段；合法非空自定义值原样保留。
- **中：无意自动启用或泄露 API Key。** 控制：`enabled` 继续为 false，Key 无默认值，提交前搜索 `sk-` 等疑似凭据并人工复核。
- **低：重复新增 `visual-summary` 命令。** 控制：manifest/background 不改，只读取现有命令。
- **低：README 图片断链。** 控制：测试文件存在性、PNG 元数据和 README 相对路径。
- **低：误处理用户未跟踪文件。** 控制：保护 `.playwright-cli/`、`tmp-recording/`，禁止 clean/reset/restore 与 `git add .`。
- **低：静态 PNG 与旧文档中的“GIF”预期不一致。** 控制：本计划明确以用户本轮提供的静态图替换媒体位；若用户要求动画，再另立录制/转码任务。

## 九、预期变更文件白名单

功能与测试：

- `src/core/ai-settings.ts`
- `src/core/settings.ts`
- `src/options/options.html`
- `src/options/options.ts`
- `tests/core/ai-settings.test.ts`
- `tests/core/settings.test.ts`
- `tests/options.test.ts`
- `tests/visual-summary.test.ts`

README 与资源：

- `README.md`
- `docs/assets/readme/visual-summary-demo.png`
- `docs/assets/readme/bilibili-subtitle-demo.png`
- `docs/superpowers/plans/2026-09-02-deepseek-defaults-shortcut-readme-images.md`

除非测试直接证明必要，不得扩大到其他文件。发现无关问题只记录，不顺手修复。

## 十、完成后交付报告格式

最终报告必须分别列出：

- **已完成**：逐项对应用户 1–5 条需求，列出实际文件与行为。
- **自动验证**：每条命令、通过数量、typecheck/build/diff 结果。
- **手工验证**：实际在 Chrome/README 预览中验证了什么。
- **未验证或部分完成**：任何未在真实浏览器、真实 DeepSeek API 或 GitHub 渲染中证明的事项。
- **Git 状态**：分支、HEAD、变更文件、是否提交、是否推送；不得把本地构建产物或未跟踪目录说成已上传。
- **安全边界**：确认未写入 API Key，源截图未修改，`.playwright-cli/` 与 `tmp-recording/` 未触碰。

## 十一、可直接复制给执行 Agent 的任务提示词

```text
请直接执行计划文件：C:\Users\HP\OneDrive\桌面\example\clip2md\docs\superpowers\plans\2026-09-02-deepseek-defaults-shortcut-readme-images.md，不要重新规划。

工作边界：仓库 C:\Users\HP\OneDrive\桌面\example\clip2md；先确认当前基线分支 codex/readme-glanceclip-refresh、HEAD b628973 与工作区状态，再从该 HEAD 新建 codex/deepseek-defaults-shortcut-readme-images，使用当前 checkout，不新建 worktree。若基线已变化，先解释差异，禁止 reset/restore/clean/stash。

核心目标：把 https://api.deepseek.com/chat/completions 和 deepseek-v4-flash 设为真实、可编辑且可迁移的默认输入值；API Key 仍为空、AI 仍默认关闭；设置页新增可显示并跳转修改 visual-summary 的“一图速览”快捷键；把用户图片 3、4 原样复制为 README 的两张 PNG 演示图并更新文档说明。

严格 TDD：先补默认值/迁移/设置页/README 媒体失败测试，再做最小实现。完成后运行目标测试、npm test、npm run typecheck、npm run build、git diff --check，并执行计划中的 Chrome 手工验收。自动验证与真实浏览器/API 验收必须分开报告。

保护与禁止：不得硬编码或输出任何 API Key；不得自动启用 AI；不得覆盖合法自定义 Endpoint/模型；不得修改源截图；不得触碰或暂存 .playwright-cli/、tmp-recording/；不得改 manifest/background 的既有 visual-summary 命令；禁止 git add .、reset、restore、clean、stash、commit、push、merge、PR 或商店发布，除非用户随后明确授权。

最终交付请按“已完成 / 自动验证 / 手工验证 / 未验证或部分完成 / Git 状态 / 安全边界”六部分汇总，并给出所有实际变更文件和准确命令结果。
```
