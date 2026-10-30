# Nowen Note Lite 交接文档（会话 handover）

> 生成时间：2026-10-30。供新会话直接接手，不需要回看历史。
> worktree：`/Users/wanghlstar/Mytools/aiwork/nowen-wt-tauri`
> 分支：`feat/lite-tauri`，remote `mine` = git@github.com:wanghlstar/nowen-note.git

---

## 0. 一句话现状

产品形态已定型：**Lite = 本地优先 + 后台同步**，Mac/安卓/NAS 三端一致；登录页只保留「进入本地笔记」，服务器通过「设置 → 同步」添加。
**当前有一个 P0 故障未修：添加同步服务器后登出，应用陷入"重载↔认证"循环疯狂闪屏**（见 §3）。
另有 7 个已提交未发布的修复（§4），下一个 tag 应为 `v1.5.3-lite.11`。

---

## 1. 环境与验证手段（重要，能省大量时间）

| 事项 | 命令 / 位置 |
|---|---|
| 跑本地后端 | **必须**用 `tauri/src-tauri/binaries/node-aarch64-apple-darwin backend/dist/index.js`（系统 node24 ABI137 与 better-sqlite3 ABI127 不兼容） |
| 隔离数据库 | `DB_PATH=/tmp/xxx/test.db`（**不要**用 `NOWEN_DATA_DIR`，它只影响 folder-sync，不影响 SQLite 路径——我曾因此写进用户开发库） |
| 后端单测 | `cd backend && ../tauri/src-tauri/binaries/node-aarch64-apple-darwin --import tsx --import ./tests/setup-db-isolation.ts --test tests/<file>.test.ts` |
| 前端测试 | `cd frontend && npx vitest run [file]`；基线 **22 failed / 695 passed**（预存在失败，改动前后必须一致） |
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

- 最新 release：**v1.5.3-lite.10**，7 资产齐全（macOS arm64/x64 dmg、win exe/msi、linux deb、安卓 apk、fpk 130MB）。
- **lite.10 之后有 7 个提交未发布**（`git log --oneline v1.5.3-lite.10..HEAD`）：
  1. `f4f0e7f9` 连点退出账号导致闪屏/白屏（NavRail 加 `logoutInflightRef` 守卫）
  2. `dd54aac3` CI 改由最快的 fpk-native 创建 release（不再被 macOS 构建堵住）
  3. `b460ca51` 添加服务器后立即对账 + 刷新列表（桌面 `invalidateNotebooks()`；安卓 `engine.requestSync(0)`）
  4. `4b3405e2` 启动后的渲染异常给出可恢复界面，不再整屏白（边界抽成 `AppBootErrorBoundary`）
  5. `ecec0f07` 远端不存在时「保留服务器版本」不再报 400，冲突可结清
  6. `4e08d169` 首次对账因子笔记本先返回失败（NOTEBOOK_PARENT_NOT_FOUND）→ `orderNotebooksParentsFirst`
  7. `c53390d4` 安卓设备本地模式补示例笔记（`mobileOnboardingGuide.ts`，三端一致）

---

## 3. 🔴 P0 未修：登出后无限闪屏（用户报告"快瞎了"）

**现象**：新版本添加同步服务器 → 退出账号 → 应用疯狂闪屏，只看到「正在验证身份…」（`auth.verifying`，即 `App.tsx` 的 `isAuthenticated === null` 加载态）。

**已确认的机制**：
- 「正在验证身份」是 App.tsx:1788 的**认证加载态**，不是登录页。
- 闪屏 = `window.location.reload()` 被反复调用：某处 401 → `broadcastLogout()` + `reload()` → 重进认证 → 再 401 → 再 reload。
- 最可能的触发点：`frontend/src/lib/api.impl.ts:974-993`（401/`sessionRevoked` → `await broadcastLogout("session_revoked"); window.location.reload();`）。登出后 zero-login 会重新签发本地 token，但**带着同步档案时**某个请求仍 401（怀疑 base URL / scope 不一致），于是循环。
- 用户操作路径：清库 → 零登录 → 添加服务器 → 登出。**只在添加了同步服务器后出现**。

**我已试过且失败的做法（不要重复）**：
- 在 `frontend/index.html` 里覆盖 `window.location.reload` 做循环护栏 → **不可行**：`Object.getOwnPropertyDescriptor(window.location,'reload').writable === false`，赋值静默失败。该未提交改动已 `git checkout` 撤掉，工作区干净。

**下一步建议（按优先级）**：
1. 在 `api.impl.ts` 的 401 分支加**会话级**守卫：`sessionStorage` 记一次 `nowen:auth-reload-once`，同一会话内第二次 401 触发登出时**只清 token 不 reload**（让用户停在登录页/本地入口，循环即断）。
2. 若仍循环，查登出后 zero-login 签发的 token 与 `getServerUrl()` 指向是否一致（Lite 应指向本地后端 `127.0.0.1:<port>`；若被同步档案改成云端地址，所有请求都会 401）。
3. 复现手段：Playwright + 假 `nowenDesktop` 桥（§1），登出后观察 `framenavigated` 次数与 console 里的 401  URL。

---

## 4. 冲突/同步相关背景（用户实测数据）

用户本地库（`~/Library/Application Support/com.nowen.note.lite.tauri/nowen-note.db`）曾积 **74 个未解决冲突**：34 note + 40 knowledge_tree_node，几乎全是 `onboarding-v1-*` 种子向导（localVersion=1 vs remoteVersion=2）。
根因：机器账号 `desktop` 首次登录会种子 16 篇确定性 ID 的向导笔记，与云端同名实体对不上。
用户选择**清库重同步**（本地无数据），随后撞到 `NOTEBOOK_PARENT_NOT_FOUND`（已修，§2.6）。

**仍未做的根治**：向导种子与同步的关系——机器账号每次新建都会种子向导，可能再次与云端相撞。建议给"有同步档案的账号关掉向导种子"，或把向导移出同步范围。等用户裁剪出样板后，把后端种子（`backend/src/db/newUserOnboardingFirstLoginMigration.ts`，SQL 触发器，**published migration 不可改**）与 `frontend/src/lib/mobileOnboardingGuide.ts` 合并成单一来源。

---

## 5. 其他已知问题（未修）

1. **富文本编辑器代码块渲染抖动**：新建笔记（默认 tiptap-json）里输 ` ```sql ` + 回车 → 代码块出现 → 打 `select` → 代码块视觉消失、文字变普通样式。**数据是好的**（重开正常），只是编辑器那一帧渲染掉。与 Markdown 后端的 `^blk_` 标记问题是两条路，我之前的修复（`noteBlocks.ts` 未闭合围栏不插标记）对这条无效。
2. **安卓组网/VPN 下局域网发现仍失败**：WebRTC 只能拿本机网卡 IP，拿不到真实路由网段。需原生 Capacitor 插件读 `ConnectivityManager.getLinkProperties`。
3. macOS 签名公证、Linux AppImage、Windows/Linux 真机验收未做。
4. 前端 P1 静态 import 瘦身未做；`docs/lite-mode-*.md` 来源声明待补。

---

## 6. 关键文件索引

- 桌面零登录 / 登录页门禁：`frontend/src/App.tsx`（约 1450-1540 零登录、1762-1810 本地入口与加载态）、`frontend/src/components/LoginPage.tsx`（Lite 单入口面板在组件主 return 之前）
- 机器账号：`tauri/src-tauri/src/sidecar.rs`（`bootstrap_local_account`，Always Allow-Create=1）、`backend/src/routes/auth.ts`（`/desktop/bootstrap-local`）
- 同步：`backend/src/sync/{applyLocal.ts,resolve.ts,bootstrap.ts,engine.ts}`、`backend/src/routes/sync-local.ts`
- 同步设置 UI：`frontend/src/components/settings/SyncSettingsPanel.tsx`
- 移动本地优先：`frontend/src/lib/{mobileLocalFirstRuntime,mobileSyncEngine,mobileOnboardingGuide}.ts`
- 顶层错误边界：`frontend/src/components/AppBootErrorBoundary.tsx`
- fpk：`scripts/fpk-native/{build-fpk-native.mjs,template/**}`（`wizard/uninstall` 的 `initValue` 必须是**字符串** `"true"`，布尔会让 fnpack 拒包）
- CI：`.github/workflows/{tauri-release,android-lite,fpk-native}.yml`

---

## 7. 给新会话的第一件事

1. 读 §3，先修登出闪屏循环（P0，用户已被闪到）。
2. 修完打 `v1.5.3-lite.11` 发布（会用上新的发布逻辑：fpk-native 3 分钟建 release，其余上传，不再被 macOS 堵）。
3. 发布后逐个数资产（fpk / apk / 两个 macOS dmg / exe / msi / deb = 7 个），**不要只看 workflow 绿勾**——lite.7/lite.8 都出过"全绿但产物缺失"。
