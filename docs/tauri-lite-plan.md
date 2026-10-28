# Nowen Note Lite · Tauri 客户端落地计划（S4 / W4）

> **Nowen Note Lite（弄文笔记 Lite）**
>
> 本项目基于开源项目 **Nowen Note（弄文笔记）** 修改而来，原项目名称与仓库：
> [cropflre/nowen-note](https://github.com/cropflre/nowen-note)，遵循 **GPL-3.0** 许可。
> 本仓库为 **Lite** 版本：按 `docs/lite-mode-design.md` 的决策关闭 P1 功能
> （AI、任务、日记、脑图、实时协作、分享、插件、开放 API、多源导入、表格、语音、自动化），
> 并新增 Tauri 桌面客户端与飞牛 fnOS 直装包；其余能力来自原项目。
> 需要完整功能请使用原仓库发布版本。


> 本文档记录 Tauri 客户端（Phase A）的架构决策、插件映射、Electron 能力重建计划、
> 构建运行步骤与已知缺口。对应分支 `feat/lite-tauri`，工程目录 `tauri/`。
> 设计依据：`docs/lite-mode-design.md` D4/D5/D7/D8/D10/D11。

## 1. Phase A 已落地内容

| 能力 | 实现 | 状态 |
| --- | --- | --- |
| Tauri 2 工程骨架 | `tauri/src-tauri/`（Cargo.toml / tauri.conf.json / capabilities / icons） | 已完成 |
| 复用前端产物 | `frontendDist=../../frontend/dist`，Tauri 嵌入二进制；同时作为 resource 落盘供 backend 静态服务 | 已完成 |
| 本地 backend sidecar | `sidecar.rs`：spawn `node backend/dist/index.js`，env 契约复刻 electron/main.js:582-591 | 已完成 |
| 端口探测 | 首选 57892，探测 `::` 通配地址（与 backend listen 地址一致），被占用则回退随机端口 | 已完成 |
| 健康检查 | `GET /api/health`，300ms 轮询 / 单请求 1s / 总超时 30s | 已完成 |
| 零登录（local-first） | `get_local_auth` 命令 → `/api/auth/desktop/bootstrap-local`（X-Nowen-Desktop-Secret + Allow-Create） | 已完成 |
| 前端桥接 | `initialization_script` 注入最小 `window.nowenDesktop` shim（isDesktop/getLocalAuth/getAppInfo/on） | 已完成 |
| 后端地址注入 | 窗口 URL 带 `?serverUrl=http://127.0.0.1:{port}`（复刻 Electron loadFile query 方式） | 已完成 |
| 前端平台识别 | `frontend/src/lib/serverUrl.ts` `isNativeClientRuntime()` 增加 `__TAURI__` 判定 | 已完成 |
| 退出清理 | RunEvent::Exit / 窗口 Destroyed / Drop 杀子进程；SIGTERM/SIGINT/SIGHUP 信号处理器兜底 | 已完成 |
| 三平台 bundle 配置 | targets: dmg+app（macOS）/ msi+nsis（Windows）/ deb+appimage（Linux） | 配置完成，仅 macOS 实测 |
| 数据目录 | `~/Library/Application Support/com.nowen.note.lite.tauri/`（identifier 独立，D4） | 已完成 |

## 2. 架构与 Electron 的对应关系

```
Nowen Note Lite.app
├── Contents/MacOS/nowen-note-lite     # Tauri shell（Rust）
├── Contents/MacOS/node                # 外部 sidecar 二进制（externalBin）
└── Contents/Resources/
    ├── （前端由 Tauri 嵌入主二进制，非落盘）
    ├── backend/dist/                   # esbuild bundle（npm run build:backend）
    ├── backend/node_modules/           # runtime externals（better-sqlite3 等）
    ├── backend/package.json
    ├── backend/templates/
    └── frontend/dist/                  # 供 backend 生产模式静态服务（LAN 访问）
```

与 Electron 的关键差异：

| 维度 | Electron | Tauri（本工程） |
| --- | --- | --- |
| node 运行时 | ELECTRON_RUN_AS_NODE 复用 Electron 内置 node | externalBin 真实 node 二进制（`binaries/node-<triple>`） |
| 前端加载 | loadFile + `?serverUrl=` query | WebviewUrl::App + `?serverUrl=` query（语义一致） |
| 后端静态服务 | FRONTEND_DIST=resourcesPath/frontend/dist | 同名 resource 映射，路径一致 |
| 原生模块 ABI | electron ABI（rebuild:native） | node ABI，**sidecar node 大版本必须与 better-sqlite3 编译目标一致**（当前 node 22 / NODE_MODULE_VERSION 127） |

## 3. 插件映射决策（Capacitor → Tauri）

结论先行：**Phase A 不需要 tauri-plugin-sql，也不需要前端 IndexedDB 回退分支。**

- `frontend/src/lib/nativeDatabase.ts:1017` 的 `openNativeDatabase()` 以
  `Capacitor.isNativePlatform()` 为门禁，Tauri 下恒为 false，移动端本地 SQLite 链路
  （mobileLocalFirstRuntime 等）在桌面 Tauri 上本就不会激活。
- Lite 桌面版的 local-first 由 **backend sidecar + better-sqlite3（nowen-note.db）**
  承载，与 Electron 完整版同构，不依赖 Capacitor SQLite。
- 加密笔记等依赖本地数据库的能力走 backend 链路即可，前端无需平台分支。

| Capacitor 插件 | 用途 | Tauri 决策 |
| --- | --- | --- |
| @capacitor-community/sqlite | 移动端本地 SQLite（nativeDatabase.ts） | **不迁移**。桌面 local-first 由 backend sidecar 承担；web 分支不存在，无需回退代码 |
| biometric / secure-storage | 移动端生物识别 / 密钥存储 | **不迁移（Phase A）**。桌面无同等敏感面；后续如需加密笔记应用锁再评估 tauri-plugin-stronghold/biometric |
| local-notifications | 本地通知 | **不迁移**（brief 明确） |
| clipper-host | 剪藏宿主 | **不迁移**（brief 明确） |

## 4. Electron 能力重建映射表

| Electron 能力 | 参考实现 | Tauri 状态 |
| --- | --- | --- |
| 本地 backend 启停 + 健康检查 | main.js:552-657 / :382-411 | ✅ 已重建（sidecar.rs） |
| 零登录本地账号 | localAccountBootstrap.js + main.js:840-856 | ✅ 已重建（get_local_auth） |
| JWT / 本地账号 secret 管理 | main.js:225-263 / :765-784 | ✅ 已重建（read_or_create_secret，0600） |
| 前端地址注入 | main.js:1140/1192 loadFile query | ✅ 已重建（WebviewUrl::App query） |
| macOS 交通灯/透明标题栏 | patches/macos-sidebar-trafficlight-fix.patch | ✅ set_title_bar_style(Transparent)（D11 风格由前端既有样式承接） |
| 退出杀 backend | main.js RunEvent/exit | ✅ 已重建（含信号处理器） |
| 自动更新 | electron-updater | ⬜ 后续：tauri-plugin-updater（需用户提供更新端点，见缺口） |
| 应用菜单 / 托盘 | main.js menu/tray | ⬜ 后续会话（前端 D11 全宽标题栏方案下菜单从简） |
| md/txt 文件关联 | builder fileAssociations | ⬜ 后续会话（tauri.conf.json bundle.fileAssociations） |
| 加密笔记自动锁定 | encrypted-notes-auto-lock.js（blur→security:auto-lock） | ⬜ 后续会话（Tauri window blur 事件 → emit 同名事件） |
| 附件打开 / 打印桥 | main.js shell/dialog/print | ⬜ 后续会话（tauri-plugin-dialog / opener；打印走 webview 自带） |
| 数据目录迁移/选择 | dataDir.js | ⬜ 后续会话（liteOnly 不弹选择，直接 app_data_dir） |

## 5. 构建与运行

前置：Rust 1.77+（实测 1.98.1）、Node 22（与 better-sqlite3 ABI 匹配）。

### 开发模式

```bash
# 1) 首次需先构建 backend 与前端（sidecar 与 dev 都要求产物存在）
npm run build:backend
npm run build:frontend

# 2) 放置当前平台的 node sidecar（externalBin 命名规则：node-<target-triple>）
#    macOS arm64 示例：从 https://nodejs.org 下载官方静态 tar.xz
cp <官方node解压目录>/bin/node tauri/src-tauri/binaries/node-aarch64-apple-darwin

# 3) 启动（beforeDevCommand 会自动跑 vite dev server）
cd tauri && npx tauri dev
```

开发态 node 解析顺序：`NOWEN_TAURI_NODE` 环境变量 → 可执行文件旁 sidecar → PATH。

### 打包

```bash
npm run build:backend   # backend/dist/index.js
cd tauri && VITE_LITE=1 npx tauri build
```

前端 Lite 开关 `VITE_LITE=1` 由**调用方注入**（`beforeBuildCommand` 只执行
`npm --prefix .. run build:frontend`，因为 Windows cmd 不支持 `VAR=val cmd` 语法）；
CI 里统一在 job 级 `env` 设置。sidecar 固定以 `NOWEN_PROFILE=lite` 启动 backend
（W2 运行开关）——**Lite 包永远是裁剪版**，完整版请用 Electron。

### 三平台 CI 构建（`.github/workflows/tauri-release.yml`）

| 平台 | runner | target | 产物 |
| --- | --- | --- | --- |
| macOS arm64 + x64 | macos-14（同一 job 顺序构建，按目标重装后端依赖） | aarch64 / x86_64-apple-darwin | dmg + app |
| Windows x64 | windows-latest | x86_64-pc-windows-msvc | msi + nsis exe |
| Linux x64 | ubuntu-22.04 | x86_64-unknown-linux-gnu | deb + AppImage |

触发：`workflow_dispatch`（一次构建四个目标）或推送 `v*` 标签
（标签会额外创建 draft GitHub Release）。每个平台都会下载对应版本的官方
Node 22 静态二进制放到 `src-tauri/binaries/node-<target>` 作为 sidecar；
macOS 产物未签名/未公证，首次打开需右键「打开」。

macOS 产物（实测）：`target/release/bundle/macos/Nowen Note Lite.app`（约 329 MiB）、
`target/release/bundle/dmg/Nowen Note Lite_1.5.1_aarch64.dmg`（约 113 MiB）。
Windows/Linux 需在对应平台执行同一命令（targets 已配置 msi/nsis/deb/appimage）。

### Android（Capacitor，`.github/workflows/android-lite.yml`）

Android 不是 Tauri 客户端，而是原有的 Capacitor 工程（`frontend/android`）。
Lite 版把 `applicationId` 改为 `com.nowen.note.lite`，避免与官方安卓包互相覆盖；
CI 用 `VITE_LITE=1 npm run build` → `npx cap sync android` → `./gradlew assembleDebug`
产出可直接安装的 debug APK（alpha 阶段用 debug 签名，后续正式签名需固定 keystore）。

### 三平台构建矩阵（D8）

| 平台 | 目标 | node sidecar 命名 | 状态 |
| --- | --- | --- | --- |
| macOS arm64 | dmg + app | node-aarch64-apple-darwin | ✅ 已实测 |
| macOS x64 | dmg + app | node-x86_64-apple-darwin | ⬜ 待 CI/用户机器验证 |
| Windows x64 | msi + nsis | node-x86_64-pc-windows-msvc.exe | ⬜ 待验证 |
| Linux x64 | deb + appimage | node-x86_64-unknown-linux-gnu | ⬜ 待验证 |

## 6. 验证记录（Phase A，本会话实测）

环境：macOS arm64，宿主同时运行 Electron 完整版（占用 57892）。

- `cargo check` 零告警；`npx tauri build` 产出 .app + .dmg。
- app 启动：backend sidecar 正常 spawn，28+ 条 migration 全部应用，
  数据目录生成 `nowen-note.db` / `.jwt_secret`(0600) / `.local_account_secret`(0600) /
  attachments / backups / jobs。
- 端口回退：57892 被 Electron 占用时探测失败，自动回退随机端口（实测 55949/56274），
  `/api/health` 返回 ok。
- 零登录：`bootstrap-local` Allow-Create=1 创建本地 admin（username=desktop）并签发
  token/refreshToken；Allow-Create=0 复登成功；token 访问 `/api/notebooks` 返回数据。
- 退出清理：SIGTERM 杀 app 后 node 子进程与端口同步释放（信号处理器兜底，
  RunEvent::Exit 不响应 SIGTERM）。
- 前端：`tsc -p tsconfig.app.json --noEmit` 零错误；
  `webServerConnection.test.ts` 7/7 通过。
- 未执行（brief 要求 --no-build 语义 + 平台限制）：Windows/Linux 构建、
  dmg 安装后完整 GUI 验收（登录→建/编笔记→断网编辑→联网同步→第二设备读取）
  需用户在真机执行。

## 7. Lite 接线与 GUI 集成修复（Phase A.5，本会话实测）

`feat/lite-trim`（W1-W3 裁剪）合入本分支后，GUI 实测暴露 4 个 Phase A 未覆盖的缺陷
（此前只验了 HTTP 层，没验 webview 内链路），全部已修复：

1. **`window.__TAURI__` 不存在导致零登录/获取应用信息直接抛错**：Tauri 2 只注入
   `__TAURI_INTERNALS__`，`__TAURI__` 对象由 npm 包 `@tauri-apps/api` 创建，而前端是
   预构建产物不装 JS 依赖。修复：`init_script.js` 模板在建窗时把 bootstrap 结果、
   app info、端口**嵌入 initialization script**（`build_init_script`），shim 优先走
   真实 invoke（未来接入 @tauri-apps/api 时自动生效），否则读嵌入值。嵌入 JSON 对
   `<`/`>`/`&` 做 `\uXXXX` 转义防 `</script>` 逃逸。
2. **node sidecar 解析错误**：`path().resolve("", Executable)` 不可靠地返回可执行目录，
   拼接 "node" 失败后静默回退 PATH（实测跑成了 homebrew node，仅因版本巧合未暴露）。
   修复：改用 `std::env::current_exe().parent()`；实测包内 `Contents/MacOS/node` 生效。
3. **bootstrap 响应解析按错误信封**：后端 `issueDesktopLocalAuth`（auth.ts:339）返回
   **扁平** `{token,refreshToken,user}`，无 `{data:...}` 信封；原解析器按信封读 →
   永远 account:null → 零登录静默回退登录页。修复：`parse_bootstrap_response` 按扁平
   结构解析（含 `{code}` 错误码 → reason），用实测响应 JSON 做回归测试。
   注意 `electron/localAccountBootstrap.js:11` 仍在读 `response.data?.token`——同样
   的首跑缺陷，因登录后 token 持久化而不可见；修 Electron 需单独评估（不在本 brief 范围）。
4. **CORS 白名单不含 Tauri origin，local-first 全量请求被拦**：后端生产模式
   （cors-policy.ts）默认只放行 `https/localhost、capacitor://、ionic://、null`。
   Electron 渲染进程 origin 是 `file://` → `Origin: null` 命中；Tauri 是
   `tauri://localhost`（Windows `http://tauri.localhost`）→ 不在名单 → 无
   `Access-Control-Allow-Origin` → WebKit "Load failed"。这不只影响连远程服务端，
   **local-first 模式（tauri://localhost → 127.0.0.1 backend）同样跨域被拦**。
   修复：白名单加入两个 tauri origin（`backend/src/lib/cors-policy.ts` +
   cors-policy.test.ts 回归）。

### 服务端兼容性

- Lite 客户端连**旧服务端**：功能可用（W1-W3 是加性门控；服务端不下发 profile 时
  前端按 full 运行）。
- 但旧服务端（含官方 v1.5.3）**CORS 白名单没有 tauri origin**，远程服务器模式会被拦。
  立即可用的解法：服务端设环境变量
  `CORS_ORIGINS=tauri://localhost,http://tauri.localhost` 重启；或升级到含本修复的
  服务端版本。local-first 模式不受影响（backend 随 app 打包，已含修复）。
- macOS 15+ 首次访问局域网 IP 可能弹"本地网络"权限，需允许。

### 验证记录（Phase A.5）

- `cargo test` 5/5（init script 嵌入/转义/null 回退、bootstrap 扁平解析/错误码）。
- `node --import tsx --test tests/cors-policy.test.ts` 3/3。
- init_script.js 同一份文件用 node 实测四种场景：无 `__TAURI__`（嵌入值生效）、
  有 `__TAURI__`（优先真实 invoke）、auth=null（回退登录页）、未实现能力
  （checkForUpdates/quitAndInstall/openLogDir 返回 not-supported）。
- 重新 `tauri build` 后启动实测：sidecar 用包内 node；端口回退正常；
  `Origin: tauri://localhost` → 200 + `access-control-allow-origin: tauri://localhost`；
  `http://tauri.localhost`、`capacitor://localhost`（回归）均放行；陌生 origin 无 ACAO；
  `/api/settings` 返回 `profile: lite`。
- 无头浏览器全流程验收（Chrome + 专用 backend 实例 + 同一份 init_script.js）：
  加载→零登录→建文件夹→建笔记全过；`__NOWEN_BOOT_DIAGNOSTICS__` 零错误、
  无 pageerror、API 请求 100% 落 backend origin。

### Phase A.5 第二轮：serverUrl 丢失根因（白屏/“内容暂时未加载”实测定性）

用户实测白屏与“内容暂时未加载 + Spread syntax requires ...iterable not be
null or undefined”。harness 插桩定性：

1. **前端路由导航丢 query**：桌面端地址 `index.html?serverUrl=http://127.0.0.1:<port>`
   注入后，前端 `history.pushState` 导航到 `/notes/...` 时 **query 被丢弃**
   （`window.location.search` 变空）。`initializeServerUrlFromRuntime()`
   （api.impl.ts:232，设计用途正是“query → localStorage 迁移”，文档注释称在
   App.tsx 顶层 useEffect 调用）**实际从未被调用**（仅测试引用）→ 导航后
   `getServerUrl()` 返回空 → 后续 API 全部打向页面 origin → 知识树 reload 失败
   → “内容暂时未加载”；`KnowledgeTreePanel.tsx` 合并 `[...owned.nodes, ...shared]`
   在响应缺 `nodes` 时抛出 “Spread syntax requires ...iterable not be null or
   undefined”（被 catch 成树面板错误详情，非白屏；白屏是旧构建 invoke 缺陷）。
   修复：`main.tsx` 在 `renderApplication()` 前同步调用
   `initializeServerUrlFromRuntime()`。
2. **知识树 spread 防御**：`KnowledgeTreePanel.tsx` / `MobileKnowledgeTreePanel.tsx`
   的 `[...owned.nodes, ...shared]` 改 `[...(owned.nodes ?? []), ...(shared ?? [])]`，
   消除“响应缺 nodes”崩溃类。
3. **NoteList 分享状态探测门控**：lite 下 `shares/status/batch` 必 403，
   `NoteList.tsx` 加 `isFeatureEnabled("sharing")` 跳过。

### 已知风险（Windows）

Tauri Windows 的 webview origin 是 `http://tauri.localhost`（http 开头），
`App.tsx` 零登录 effect 的 `setServerUrl(window.location.origin)` 兜底在
serverUrl 为空时会写入错误地址；本修复（迁移先于渲染）保证 serverUrl 不为空，
兜底不会被触发。若未来调整启动顺序需复查此耦合。

- `cargo test` 5/5（init script 嵌入/转义/null 回退、bootstrap 扁平解析/错误码）。
- `node --import tsx --test tests/cors-policy.test.ts` 3/3。
- init_script.js 同一份文件用 node 实测三种场景：无 `__TAURI__`（嵌入值生效）、
  有 `__TAURI__`（优先真实 invoke）、auth=null（回退登录页）。
- 重新 `tauri build` 后启动实测：sidecar 用包内 node；端口回退正常；
  `Origin: tauri://localhost` → 200 + `access-control-allow-origin: tauri://localhost`；
  `http://tauri.localhost`、`capacitor://localhost`（回归）均放行；陌生 origin 无 ACAO；
  `/api/settings` 返回 `profile: lite`。
- 未执行：GUI 肉眼验收（登录→笔记→断网→同步→第二设备）需用户真机操作；
  Windows/Linux 构建。

## 8. 已知缺口与后续会话

1. **node sidecar 二进制分发**：`src-tauri/binaries/` 已 gitignore，不入库。
   CI 需按平台放置对应 node（建议统一 node 22 LTS，保证 better-sqlite3 ABI 127）。
2. **bundle 体积**：backend/node_modules 整包带入（189MB）保证 runtime externals
   齐全；后续可仿 electron `buildBackendNodeModulesFilter()` 白名单裁剪
   （better-sqlite3/bindings/file-uri-to-path、sqlite-vec 全家、bonjour-service 链、
   quickjs-emscripten、libheif-js、ffmpeg-static、sharp/@img/*、detect-libc、semver、
   @aws-sdk/client-s3、unpdf）。
3. **签名/公证**：macOS codesign/notary 需用户 Apple 账号，未配置（unsigned 可本机运行）。
4. **自动更新**：tauri-plugin-updater + 更新端点（pub key/endpoint）待定。
5. **菜单/托盘、文件关联、加密笔记自动锁定、附件打开、打印桥**：见 §4 映射表 ⬜ 项。
6. **双 app 共存**：identifier `com.nowen.note.lite.tauri` 与 electron lite
   （com.nowen.note.lite）、full（com.nowen.note）均不冲突（D4）；两者同时运行
   时 backend 端口自动回退，已验证可共存。
7. **macOS 15+ 本地网络权限（已修复）**：访问自托管服务器（局域网 IP，
   如 192.168.x.x）被 macOS 本地网络隐私管控，缺失
   `NSLocalNetworkUsageDescription` 时系统静默阻断，表现为登录页探测
   "连接超时"（服务端 curl 实测可达、localhost 模式不受影响——回环豁免）。
   已通过 `src-tauri/Info.plist` + `tauri.conf.json` `bundle.macOS.infoPlist`
   合入声明；首次连接局域网服务器时 macOS 弹"允许发现并连接本地网络设备"，
   需点"允许"。若曾点"不允许"，需到 系统设置 → 隐私与安全性 → 本地网络
   重新启用。Windows/Linux 无此限制。
8. **同步授权 15 分钟过期（已修复）**：access token TTL 15 分钟
   （auth-security.ts 默认 "15m"），同步引擎此前只存 access token、
   无刷新逻辑，15 分钟后每次同步 401 → "同步授权已失效，请重新登录"
   （原版 v1.5.3 同款缺陷）。修复：凭据文件存 refreshToken，remote.ts
   遇 401/403 先 POST `/api/auth/refresh` 续期并以新 token 重试一次，
   成功后立刻落盘。**升级后需重新登录一次同步服务器**（旧凭据没有
   refreshToken，无法从 access token 推导）。
9. **服务端侧 applyTag 同型隐患（未修）**：`idx_tags_personal_name_unique`
   唯一索引下，服务端 applyTag（apply.ts）同样只按 id upsert。若另一台
   设备先推了同名标签，本机折叠后的推送仍可能在官方服务端撞唯一索引。
   本机侧已最大化规避；彻底修复需要服务端升级（官方 v1.5.3 同款缺陷，
   本次未改服务端代码）。
8. **首次同步同名标签折叠（已修复，`14188264` 之后）**：本机测试期建的个人标签
   （重要/技术/灵感）与服务器上真实账号同名标签 id 不同，快照重建拉取时
   `applyTagLocal` 只按 id upsert，撞 `idx_tags_personal_name_unique` 导致整轮
   同步永久失败（官方 v1.5.3 同款缺陷，`git diff macos-fix-v1.5.3` 为空）。
   修复：拉取侧同名折叠——本地重复行先改名腾出唯一位、远端 id 成为正式 id、
   note_tags 关系迁移后删重复行，并同步清理/改绑待推送条目（避免推送时在
   服务端撞同名索引或缺依赖）。测试：`sync-v2-personal-entities.test.ts`
   31/31（含个人/工作区 scope、改名更新路径、幂等回归、出队改绑）。
   注意：服务端侧 `applyTag`（fork 作服务端时）存在同型隐患，本次未改。
