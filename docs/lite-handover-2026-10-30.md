# Nowen Note Lite 交接文档（会话 handover）

> 生成时间：2026-10-30。供新会话直接接手，不需要回看历史。
> worktree：`/Users/wanghlstar/Mytools/aiwork/nowen-wt-tauri`
> 分支：`feat/lite-tauri`，remote `mine` = git@github.com:wanghlstar/nowen-note.git

---

## 0. 一句话现状

产品形态已定型：**Lite = 本地优先 + 后台同步**，Mac/安卓/NAS 三端一致。登录页默认显示远端登录（服务器地址 + 账号 + 密码），表单下方保留「继续使用仅此设备」；远端登录成功后进入本地库并启动后台同步，也可以先本地离线、之后在「设置 → 同步」添加服务器。
**P0「登出后无限闪屏」已修复并验证**（根因与修复见 §3）。
最新 release：**v1.5.3-lite.14**（tag 指向 `58fc851d`），7 个资产齐全。
lite.14 之后有 6 个代码提交（前后端测试全绿 + 编码/密码校验修复，另有本次文档更新），下一个 tag 应为 `v1.5.3-lite.15`。

---

## 1. 环境与验证手段（重要，能省大量时间）

| 事项 | 命令 / 位置 |
|---|---|
| 跑本地后端 | **必须**用 `tauri/src-tauri/binaries/node-aarch64-apple-darwin backend/dist/index.js`（系统 node24 ABI137 与 better-sqlite3 ABI127 不兼容） |
| 隔离数据库 | `DB_PATH=/tmp/xxx/test.db`（**不要**用 `NOWEN_DATA_DIR`，它只影响 folder-sync，不影响 SQLite 路径——我曾因此写进用户开发库） |
| 后端单测 | `cd backend && ../tauri/src-tauri/binaries/node-aarch64-apple-darwin --import tsx --import ./tests/setup-db-isolation.ts --test tests/<file>.test.ts` |
| 后端全量测试 | `cd backend && node scripts/run-tests-serial.mjs`；基线 **376/376 文件全绿**（2026-11-01）。若依赖用 `--ignore-scripts` 安装过，先补 `node node_modules/ffmpeg-static/install.js`，否则媒体测试会因缺少 ffmpeg 二进制失败 |
| 前端测试 | `cd frontend && npx vitest run`；基线 **720 文件 / 4105 用例全绿**（2026-11-01） |
| 前端类型 | `cd frontend && npx tsc -b`（含测试文件，`vi.fn()` 需显式泛型） |
| 构建 Mac 包 | `cd backend && npx tsc && cd ../tauri && VITE_LITE=1 npx tauri build` |
| 打包 fpk（本地可验！） | `curl -fsSL https://static2.fnnas.com/fnpack/fnpack-1.2.3-darwin-arm64 -o /tmp/fnpack-mac && chmod +x /tmp/fnpack-mac`，然后 `FNPACK_BIN=/tmp/fnpack-mac FPK_VERSION=1.5.3.11 node scripts/fpk-native/build-fpk-native.mjs` |
| 浏览器驱动真实 App | Playwright + `add_init_script` 注入假 `window.nowenDesktop`（`isDesktop:true` + `getLocalAuth` 返回真 token），配 `vite preview`  serving `frontend/dist`。**别用 dev server 复现打包版问题** |
| Playwright | 本机无 playwright 浏览器，用 `executable_path="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"` + `args=["--no-sandbox"]` |
| DMG 打包失败 | `hdiutil: couldn't unmount diskN - 资源忙` → 找 `diskimages-helper` 的 PID 杀掉再 detach |

**发布流程**：commit（中文 message，type 英文）→ `git push mine feat/lite-tauri` → `git tag -a v1.5.3-lite.N` → `git push mine v1.5.3-lite.N` → CI 三 workflow。
**重跑不重新读取 workflow 文件**（用触发时的 commit），改 workflow 后必须删 tag 重打。

---

## 2. 已发布 / 未发布

- 最新 release：**v1.5.3-lite.14**（`58fc851d`），7 资产齐全（macOS arm64/x64 dmg、win exe/msi、linux deb、安卓 apk、fpk 130MB）。
- **lite.14 之后有 6 个代码提交未发布**（另有本次文档更新；`git log --oneline v1.5.3-lite.14..HEAD`）：
  1. `075808b78` 修复编辑器与样式中文的 GBK 双重编码损坏
  2. `2dbdec7ef` 在线读取失败时不再降级放行笔记密码校验
  3. `037a9f80e` 补齐服务端发现面板缺失的 6 个文案键
  4. `282c469e8` 前端契约与同步用例对齐当前实现（全量 720/4105 全绿）
  5. `57852d040` 还原 `index.css` 中剩余的 GBK 损坏注释
  6. `c744ac541` 修正后端附件分享路由与过期契约用例（全量 376/376 全绿）
- 更早的发布记录见 git tag；lite.10 之前的细节保留在历史会话中。

---

## 3. ✅ P0 已修：登出后无限闪屏（原报告"快瞎了"）

**现象**：退出账号 → 应用疯狂闪屏，只看到「正在验证身份…」（`App.tsx` 的 `isAuthenticated === null` 加载态）。

**根因（已实测证实）**：
1. Tauri init script 在**窗口创建时**嵌入零登录 token，`nowenDesktop.getLocalAuth()` 之后永远返回这份**静态值**。
2. 后端 `issueLoginTokens` 给 access 与 refresh **同一个 jti**，所以 `/auth/logout` 吊销 session 时两张一起失效。
3. 登出 → 吊销 session → 清 localStorage → `window.location.reload()`；reload 后 init script 重新注入**同一个已吊销 token**。
4. 零登录 boot 路径（`App.tsx:1482` 附近）**不经验证**直接 `setIsAuthenticated(true)` → 所有请求 401 → `api.impl.ts:987` `broadcastLogout("session_revoked")` + `reload()` → 回到第 3 步。
   实测：15 秒内 **217~232 次 reload、4495~4630 个 401**（`/api/me`、`/api/user-preferences` 等全部 401）。

**纠正旧结论**：**不加同步服务器同样循环**（无服务器 217 次 / 有服务器 232 次），同步档案不是触发条件，桌面端任意登出都会触发。Electron 不循环，是因为它的 `clear-local-auth` 会清掉主进程缓存、之后不再交出旧 token。

**修复（根因，非护栏）**：
- `tauri/src-tauri/src/init_script.js`：`getLocalAuth` 每次调用都经 `window.__TAURI_INTERNALS__` 调 `get_local_auth` 命令（Tauri 内部脚本前置注入，见 `tauri::manager::webview`），主进程重新 `bootstrap-local` 签**新会话** token；解包 `{account}`；主进程明确无账号时返回 `null`（回登录页，绝不回落失效 token）；仅 IPC 传输失败（后端未就绪）才退回嵌入值——此时只有网络错误不会 401。
  与 Electron `clear-local-auth` 后重新登录的行为对齐，也符合 NavRail 注释「登出后重新零登录回到本地模式」。
- `tauri/src-tauri/src/main.rs`：同步更新过时注释（无逻辑改动）。
- 回归测试：`frontend/src/lib/__tests__/tauriInitScriptLocalAuth.test.ts` 直接执行**真实发货的** init script（5 用例：每次重签、解包、无账号返回 null、传输失败回落、其余命令）。

**验证**：Playwright + 真实后端 + 真实 init script（假 `__TAURI_INTERNALS__` 代理 Rust 命令）→ 修复后 **3 次导航 / 0 个 401**，登出后正常回到本地笔记（有无同步服务器均如此）。`tsc -b`、eslint、`cargo check/test`（5/5）、前端全量 vitest（22 个预存在失败文件不变、696 通过）均无劣化。

**已试过且失败的做法（不要重复）**：
- 在 `frontend/index.html` 覆盖 `window.location.reload` 做护栏 → 不可行：`Object.getOwnPropertyDescriptor(window.location,'reload').writable === false`，赋值静默失败。
- 只在 `api.impl.ts` 401 分支加 `sessionStorage` 一次性护栏：能断自动循环，但用户会被困在登录页且「进入本地笔记」拿到同一张失效 token，必须重启 App，不能作为唯一修复。

---

## 4. 冲突/同步相关背景（用户实测数据）

用户本地库（`~/Library/Application Support/com.nowen.note.lite.tauri/nowen-note.db`）曾积 **74 个未解决冲突**：34 note + 40 knowledge_tree_node，几乎全是 `onboarding-v1-*` 种子向导（localVersion=1 vs remoteVersion=2）。
根因：机器账号 `desktop` 首次登录会种子 16 篇确定性 ID 的向导笔记，与云端同名实体对不上。
用户选择**清库重同步**（本地无数据），随后撞到 `NOTEBOOK_PARENT_NOT_FOUND`（已修，§2.6）。

**已修（2026-10-31，未发布）**：

1. **示例笔记 = 普通笔记，按「服务器优先」收敛**：不再永久停留在设备本地。
   - 首次连接对账时，服务端已有指南 → 丢弃本机种子（ID 前缀 `onboarding-v1-`），改用服务端那份（`backend/src/sync/onboardingAdoption.ts`，Bootstrap / Lite 迁移 / 安卓 Bootstrap 三处接入）。
   - 服务端没有指南 → 本机那份正常推上去。
   - 之后它就是普通笔记：编辑、移动、删除都会同步。服务端种子触发器加了保护（账号已有 `onboarding-v1-*` 笔记本时不再重复创建）。
   - 已连接过的旧测试安装不会自动重跑对账；重新连接（或重置同步）后才会采纳新规则。
   - 注意：桌面端连接服务器时，服务器会在账号首次登录时种下它自己版本的指南；若服务器仍停留在旧版本（v68 旧模板），桌面端会采纳旧模板。发布时建议服务器与桌面一起升级。
2. **根因纠正**：不只是向导 ID 对不上——同步引擎的 `resolveLocalUserId` 取"最早创建的用户"，新库的 `admin` 比 `desktop` 早，引擎于是挂到 admin 上，知识树基线拿 admin 的演示数据（工作笔记 / 个人日记 / 技术学习）与云端同名笔记配对 → 冲突并进入 `SERVER_ERROR`。空本地首次同步也能复现（实测 37 个冲突）。现在优先取 `username='desktop'`。
3. **模板**：`中文指南`（1 篇 `欢迎使用 Nowen Note`）+ `工作笔记` / `个人日记` / `技术学习` 三个空白笔记本。后端新增 v136 迁移重建首次登录触发器（内容在 `backend/src/db/onboardingGuideTemplate.ts`，published migration 不改）；安卓 `mobileOnboardingGuide.ts` 用同一份内容；`seed.ts` 不再预置演示笔记本/演示笔记。已有账号不会自动换模板：需要新库或重置种子。
4. **安卓种子修复**：原来走知识树 API，device-only 模式下必然 `NATIVE_TREE_WRITE_UNAVAILABLE` → 静默失败（其实一直没有示例笔记）。现改为直接走本地 repository；凭据迁移时保留 `onboarding-v1-` 前缀，供首次连接识别本机种子。
5. `bootstrap-local` 新建 desktop 时补 `lastLoginAt`，示例笔记首次启动即出现。
6. **安卓「添加服务器」改为就地登录**：此前「设置 → 同步 → 我的 Nowen Server」会调用 `requestMobileAccountLogin()` 并整页跳到远端登录页，与 Mac 的「添加服务器」不一致。现在 `MobileSyncSettings` 内直接填服务器地址 + 账号密码，支持 2FA；成功后写 token / server URL，面板只重载自己。`LoginPage` 的账号登录请求现在只服务账号入口（切换 / 添加账号）。本地库仍是权威源，登录后由 `mobileLocalFirstRuntime` 按账号重建本地库、幂等迁移设备本地笔记并启动同步；不切换远端直连模式。
7. **删除同步验证**：服务端种下的 4 本经同步落到本机后，在本机删除 `工作笔记` → `sync-now` → 云端 notebook `isDeleted=1`、知识树节点 `isDeleted=1`、pending=0、0 冲突（两个隔离后端实测）。若旧测试安装仍复现，先看诊断里的 pending/conflicts 与引擎状态。

验证（两个隔离后端 + 真实 API）：本机种子 → 连接后云端账号首次登录即种下服务端指南 → 首次对账 `status=ready`、`conflicts=0`、本地只剩 1 本且 ID 为服务端那份、本机种子行与 outbox 条目清空；编辑指南笔记标题后 `sync-now`，云端标题与 version 同步为 2；软删除指南笔记后云端 `isTrashed=1`；pending=0。后端 tsc + 371 个 sync/onboarding 用例通过；前端 tsc + eslint 通过，全量 vitest 失败文件数与基线一致（mobileSyncRealtime / mobileSyncSwitch / mobileNativeTreeSubscription 已用 git stash 验证为改动前既有失败）。

---

## 5. 其他已知问题（未修）

1. **富文本编辑器代码块渲染抖动**：新建笔记（默认 tiptap-json）里输 ` ```sql ` + 回车 → 代码块出现 → 打 `select` → 代码块视觉消失、文字变普通样式。**数据是好的**（重开正常），只是编辑器那一帧渲染掉。与 Markdown 后端的 `^blk_` 标记问题是两条路，我之前的修复（`noteBlocks.ts` 未闭合围栏不插标记）对这条无效。
2. **安卓组网/VPN 下局域网发现仍失败**：WebRTC 只能拿本机网卡 IP，拿不到真实路由网段。需原生 Capacitor 插件读 `ConnectivityManager.getLinkProperties`。
3. macOS 签名公证、Linux AppImage、Windows/Linux 真机验收未做。
4. 前端 P1 静态 import 瘦身未做。
5. **示例指南待补回教程**：1.5.3.13 起「中文指南」只有「欢迎使用 Nowen Note」一篇（三本空白笔记本照旧）。用户确认先这样，后续迭代把另外 7 篇教程补回来（5 分钟快速上手 / 富文本与 Markdown / 知识树、双链与标签 / 图片、附件与文件管理 / AI 知识问答 / 任务、协作与多端访问 / 数据安全、备份与自托管）。正文可从 `688d537e` 的 `onboardingGuideTemplate.ts` 与 `mobileOnboardingGuide.ts` 取回，两端内容需保持一致。

---

## 6. 关键文件索引

- 桌面零登录 / 登录页门禁：`frontend/src/App.tsx`（`AuthGate.checkAuth`、`handleContinueLocal` / `handleEnterLocalNotes`）、`frontend/src/components/LoginPage.tsx`（远端登录表单 + 底部「继续使用仅此设备」）、`frontend/src/lib/mobileLocalMode.ts`（`nowen-mobile-force-local-mode` 是唯一本机模式开关）
- 机器账号：`tauri/src-tauri/src/sidecar.rs`（`bootstrap_local_account`，Always Allow-Create=1）、`backend/src/routes/auth.ts`（`/desktop/bootstrap-local`）
- 同步：`backend/src/sync/{applyLocal.ts,resolve.ts,bootstrap.ts,engine.ts}`、`backend/src/routes/sync-local.ts`
- 同步设置 UI：`frontend/src/components/settings/SyncSettingsPanel.tsx`
- 移动本地优先：`frontend/src/lib/{mobileLocalFirstRuntime,mobileSyncEngine,mobileOnboardingGuide}.ts`
- 顶层错误边界：`frontend/src/components/AppBootErrorBoundary.tsx`
- fpk：`scripts/fpk-native/{build-fpk-native.mjs,template/**}`（`wizard/uninstall` 的 `initValue` 必须是**字符串** `"true"`，布尔会让 fnpack 拒包）
- CI：`.github/workflows/{tauri-release,android-lite,fpk-native}.yml`

---

## 7. 下一步

1. 打 `v1.5.3-lite.15` 发布 lite.14 之后的 7 个提交（6 个代码 + 文档；新发布逻辑：fpk-native 3 分钟建 release，其余上传，不再被 macOS 堵）。
2. 发布后逐个数资产（fpk / apk / 两个 macOS dmg / exe / msi / deb = 7 个），**不要只看 workflow 绿勾**——lite.7/lite.8 都出过"全绿但产物缺失"。
3. 真机再走一遍用户路径：清库 → 零登录 → 添加同步服务器 → 登出，确认回到本地笔记且不闪屏。
