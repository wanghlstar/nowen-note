# W7 验收用例清单（Lite 模式）

> 对齐 `docs/lite-mode-assessment.md` §5 验收标准 1-6 与决策 D1-D13；S2 产出。
> 执行时机：W1-W6 完成后、Lite 发布前，在 `feat/lite-trim` 产物上执行。
> 每条用例须记录：执行人 / 日期 / 结果（通过|失败|阻塞）/ 证据（截图、命令输出、构建报告路径）。
> 未执行的用例必须标「未运行」，不得填「通过」。

## 0. 基线数据（W0 实测，2026-10-26，用于 AC-3 对比）

| 指标 | 完整模式基线 |
|---|---|
| `frontend/dist` 总体积 | 23MB（assets 22MB / 338 文件） |
| 最大 chunk | `index-*.js` 2,284KB（gzip 659KB） |
| 次大 chunk | `App-*.js` 1,174KB（gzip 322KB） |
| P1 可归属 chunk | ≈3.8MB raw（TaskCenter / cynefin / flow / pdf / jspdf / typescript / babel；flow/cynefin 归属待确认） |

安装包体积与常驻内存基线**未测**（需 electron/tauri build + 运行测量），列为遗留，本文不设数字目标。

## 1. 用例总表

| # | 标题 | 对齐标准/决策 | 执行方式 |
|---|---|---|---|
| AC-1 | lite 被禁 API 返回明确禁用错误，ws 协作端点不启动 | 标准 1 | 自动化 + 人工 |
| AC-2 | lite 前端无 P1 导航与搜索入口 | 标准 1 | 人工 |
| AC-3 | `VITE_LITE=1` 产物不含 P1 chunk | 标准 2 | 自动化（构建分析） |
| AC-4 | Lite 与完整模式双向数据兼容 | 标准 3 | 人工 |
| AC-5 | 核心闭环回归（登录→编辑→离线→同步→第二设备→备份恢复） | 标准 4 | 人工 |
| AC-6 | CJK 边界：汉字后紧跟空格/逗号/单引号，编辑往返 + 同步后一致 | 标准 5 | 自动化 + 人工 |
| AC-7 | 前端 lint 与后端测试不劣于基线 | 标准 6 | 自动化 |
| AC-8 | MD/富文本双编辑器互转回归 | 标准 4 | 人工 |
| AC-9 | 加密笔记回归（D3） | 决策 D3 | 人工 |
| AC-10 | 脑图关闭后 MD 内 Mermaid 仍渲染（D13/D1 边界） | 决策 D13 | 人工 |
| AC-11 | 分享关闭后的错误语义与既有分享数据（D6） | 决策 D6 | 人工 |
| AC-12 | Leanote 真实导出 HTML 样本导入 smoke（D12 收尾） | 决策 D12 | 人工 |

---

## 2. 用例明细

### AC-1 被禁 API 明确禁用错误 + ws 不启动（标准 1）

前置：backend 以 `NOWEN_PROFILE=lite` 启动；有效登录 token。

步骤：
1. 对每个 P1 端点发起一个代表性请求（至少覆盖）：
   `POST /api/ai/chat`、`GET /api/tasks`、`GET /api/diary/notes`、`GET /api/mindmaps`、
   `POST /api/shares`、`GET /api/plugins`、`POST /api/automations`、`GET /api/sheets`、
   `POST /api/voice/transcribe`、`GET /api/tokens`、`POST /api/webhooks`
2. 尝试建立 WebSocket：`wscat -c ws://127.0.0.1:3001/ws`（或等价工具）
3. 对照 P0 端点仍正常：`GET /api/notes`、`POST /api/export/import`、`GET /api/search?q=test`

预期：
- P1 端点返回 **明确的禁用错误**（如 403 + `{ error: "...disabled in lite profile..." }`），
  **不是 500、不是误导性 404**；错误文案可指引用户"该功能在 Lite 模式已关闭"
- WS 连接被拒绝（服务端未注册 upgrade 监听，见 `backend/src/index.ts:983` 切点）
- P0 端点行为与完整模式一致（含 `/api/export/import` 基础导入，D12）

### AC-2 lite 前端无 P1 导航与搜索入口（标准 1）

前置：lite profile 前端产物已登录。

步骤：逐项检查并截图——
1. 左侧导航栏（NavRail）：无 日记/任务/脑图/AI/分享 条目
2. 设置弹窗：无 AI / 插件 / 自动化 / 令牌 tab；「数据」tab 内无多源迁移导入
   （siyuan/obsidian/yuque/微信收藏/有道/小米云/OPPO/icloud/url），**保留** generic（MD/TXT/HTML）与 nowen 包恢复
3. 全局搜索 / 命令面板：搜"任务/日记/脑图/AI"无模块入口；sheet/脑图类结果不出现
4. 知识树「+」菜单：无 思维导图 / 轻量表格 / Word / 公众号 导入；**保留** Markdown/Markdown ZIP
5. 编辑器：无 AI 写作助手、AI 摘要、插入语音、插入脑图、分享按钮、评论按钮、PresenceBar
6. 直接访问 URL：`/mindmaps`、`/sheets/<uuid>`、`/public`、`/share/<token>` 不渲染 P1 界面（明确提示或回退笔记列表）
7. 导航显隐设置（`SettingsModal` navigationVisibility）：P1 模块项不出现

预期：全部无入口；直接访问 URL 无白屏或无控制台报错崩溃。

### AC-3 `VITE_LITE=1` 产物不含 P1 chunk（标准 2）

步骤：
```bash
cd frontend && VITE_LITE=1 npm run build
# 对 dist/assets 做构建分析（rollup-plugin-visualizer 或既有的分析脚本），与 §0 基线对比
```

预期：
- 产物中不存在 P1 专属 chunk（TaskCenter / DiaryCenter / MindMapEditor / AI / SheetEditor / jspdf / typescript / babel 等）
- dist 总体积、最大 chunk 相对基线有可量化下降；数据记入发布说明
- P0 chunk（index / App / 编辑器 / mermaid / katex / pdfjs）仍在
- 若 Sheet 仍留在 App chunk（已知无懒加载壳，见关闭面清单 §2.10），需在报告显式说明并评估

### AC-4 Lite 与完整模式双向数据兼容（标准 3）

前置：一套 lite 客户端 + 一套完整模式客户端，同一自托管服务器（同 schema）。

步骤：
1. lite 客户端建笔记本/笔记（MD + 富文本各一篇，含附件、标签、加密笔记）
2. 完整模式客户端登录同一账号，读取上述内容，核对无损
3. 完整模式客户端修改并保存，lite 客户端联网后同步，核对一致
4. 完整模式客户端创建一条 P1 数据（如一条任务），lite 客户端读取不崩溃（允许不显示）

预期：双向读写无损；P1 数据对 lite 不可见但不引发同步错误（schema 不变，协议不变）。

### AC-5 核心闭环回归（标准 4）

步骤（macOS Tauri 客户端 + Android）：
1. 登录（账号/本地模式按 D10）
2. 建笔记本 → 建 MD 笔记 → 建富文本笔记 → 插入图片附件
3. MD/富文本互转（见 AC-8）
4. 飞行模式编辑（新增、修改、删除各一次）
5. 恢复网络，确认自动增量同步（同步状态徽标正常，无冲突弹窗——冲突治理见 W0.5，未修复前本项记阻塞）
6. 第二设备（macOS ↔ Android）读取并核对
7. 备份恢复：整库备份 → 修改数据 → 恢复 → 核对

预期：全链路通过；同步不产生伪冲突（W0.5 修复后）；备份恢复无损。

### AC-6 CJK 边界（标准 5）

前置：第二设备就绪；同步链路可用。

样本正文（**必须逐字使用**，不得改写）：
```
汉字后紧跟空格 这里继续
逗号，后面还有文字
单引号'后面还有文字
双引号"后面还有文字
分号；后面还有文字
中文与English混排 and 数字 123 混排
```

步骤：
1. 在两台设备的编辑器各录入上述样本（MD 与富文本各一遍）
2. 编辑器内往返：保存 → 刷新 → 重新打开，逐字比对
3. MD ↔ 富文本互转一次，逐字比对
4. 同步到第二设备，逐字比对
5. 导出为 Markdown / HTML / PDF 各一次，逐字比对

预期：任何环节不丢字符、不多字符（回归 Joplin 类"汉字后丢空格/逗号"问题）；
自动化部分见 `frontend/src/lib/__tests__/leanoteHtmlImportCompat.test.ts`（覆盖导入链路 CJK），
编辑器/同步链路的 CJK 回归由 W0.5 测试承接。

### AC-7 lint 与后端测试不劣于基线（标准 6）

步骤：
```bash
cd frontend && npm run lint          # 区分既有债务（eslint-baseline.json）与本次问题
cd frontend && npm run test:run      # 含新增 D12 用例 leanoteHtmlImportCompat.test.ts
cd backend && npm test
```

预期：全部通过；新增失败用例数为 0；既有失败集合与基线一致（不大）。
若 `npm run lint` 有既有债务，以 `npm run lint:baseline` 门禁为准并附对比。

### AC-8 MD/富文本互转回归（标准 4）

样本须覆盖：六级标题、有序/无序/任务列表、表格、代码块（含语言标注）、引用、脚注、
行内/块级公式、Mermaid 代码块、图片（本地附件 + 外链）、视频/音频嵌入、双向链接、高亮、下划线。

步骤：MD 建笔记 → 转富文本 → 转回 MD → 逐项核对格式与内容；富文本同理反向一遍。

预期：格式无损或损失在已知清单内（已知损失须提前登记，不得现场发挥）。

### AC-9 加密笔记回归（D3）

步骤：创建加密笔记 → 编辑保存 → 刷新 → 解锁查看 → 同步到第二设备 → 备份恢复后解锁。

预期：加密内容不因普通保存/索引/同步变明文；解锁链路正常；Tauri 侧 SQLite 依赖
（`frontend/src/lib/nativeDatabase.ts`）迁移后仍可用（衔接 W4）。

### AC-10 脑图关闭后 Mermaid 仍渲染（D13/D1 边界）

步骤：lite 模式下打开含 ` ```mermaid ` 代码块的 MD 笔记；再打开含 LaTeX 公式的笔记。

预期：Mermaid 图表正常渲染（`mermaid` 依赖保留）；脑图编辑器入口不存在（AC-2）；
既有脑图笔记数据不被删除（仅无入口），完整模式可继续打开。

### AC-11 分享关闭后的错误语义与既有数据（D6）

步骤：
1. lite 模式访问一个既有分享链接（完整模式时期创建）：应返回明确"分享已关闭/不存在"提示，非 500、非白屏
2. lite 模式尝试创建分享：入口不存在（AC-2）；直接调 `POST /api/shares` 返回禁用错误（AC-1）
3. 分享表数据不被删除；完整模式恢复分享功能后链接仍可用

预期：错误语义明确；数据保留；功能可逆。

### AC-12 Leanote 真实导出 HTML 样本导入 smoke（D12 收尾）

前置：获得一份**真实 Leanote 导出 HTML**（Leanote 笔记 → 导出为 HTML；若 Leanote 同时导出 Markdown，
两种各取一份）。

步骤：
1. Lite 模式 → 设置 → 数据 → 导入 → generic → 选择 Leanote HTML
2. 核对：标题取自 `<title>`；正文段落/列表/链接/图片（base64 内嵌图转附件）完整；
   CJK 标点逐字一致（含汉字后空格/逗号/单引号）
3. 打开导入的笔记，编辑器无报错、无内容丢失、无 schema 修复警告
4. 若有远程图片（Leanote 服务器 URL）：确认已知限制（不自动本地化），记录丢失数量

预期：导入成功且内容忠实；已知限制（远程图片 404、checkbox 状态丢失、笔记元数据丢失）
按关闭面清单 §10 登记，不阻塞发布但须写入迁移 runbook。

参考：重建样本的自动化覆盖为 `frontend/src/lib/__tests__/leanoteHtmlImportCompat.test.ts`（6 用例）；
本 AC-12 是真实样本的人工收尾，通过后才可宣称 D12 完全关闭。

---

## 3. 执行记录模板

| 用例 | 结果 | 执行人 | 日期 | 证据链接 | 备注 |
|---|---|---|---|---|---|
| AC-1 | 未运行 | | | | |
| AC-2 | 未运行 | | | | |
| ... | | | | | |

## 4. 阻塞项依赖

- AC-5 的"无冲突"步骤依赖 **W0.5 同步冲突治理**完成；未完成则记阻塞并在结论中显式说明
- AC-3 依赖 W3 构建开关落地
- AC-12 依赖用户提供真实 Leanote 导出样本（当前仅有重建样本，见关闭面清单 §10）
- AC-9 的 Tauri 部分依赖 W4 完成；W4 前可在 Electron 完整模式先行验证加密链路
