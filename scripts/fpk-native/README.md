# 飞牛 fpk 直装版制作（原生应用，不经过 Docker）

与 `scripts/fpk/`（docker-project 类型）并列的另一种打包方式：**应用进程直接跑在
fnOS 上**，不依赖 Docker。产物自带 Node 22 运行时、backend（tsc 产物 + 生产
node_modules）与 frontend/dist，由 `cmd/main` 拉起并管理生命周期。

## 为什么要有直装版

- 飞牛部分设备/用户不想启用 Docker，或希望应用占用更接近原生应用；
- 少一层容器，启动链路更短，日志和数据目录直接落在 NAS 文件系统上；
- 安装时不需要拉取任何镜像（弱网/无 Docker Hub 访问也能装）。

代价：包体积更大（Node 运行时 + 完整生产 node_modules），且只能按目标平台
（当前 x86_64）打包，没有 Docker 镜像"一次构建多架构"的便利。

## 构建（GitHub Actions，无需本地环境）

推送到仓库后在 Actions 页面手动运行 **`fpk-native`** 工作流：

1. Actions → fpk-native → Run workflow
2. 可填版本号（留空取 `package.json` 的 version）
3. 运行结束后在页面底部 **Artifacts** 下载 `nowen-note-fpk-native`
   （内含 `nowen-note-<version>.fpk`），保留 30 天

推送 `v*` tag 也会自动触发。工作流在 ubuntu-latest 上完成：
backend `npm ci` + `tsc` + 原生模块冒烟 + `npm prune --omit=dev`、
frontend `build:web`、下载 Node 22 linux-x64 与 fnpack、组装并打包。

> 本地直接跑 `node scripts/fpk-native/build-fpk-native.mjs` 只能做**结构验证**
> （本机 node 与 macOS 产物打出来的包不能用在飞牛上）。真实产物一律走 CI。

## 安装到飞牛 NAS

1. 把 `.fpk` 上传到飞牛 NAS 任意目录
2. 飞牛桌面 → 「应用中心」→ 右上角「设置」→「手动安装应用」
3. 选择文件，确认安装；桌面出现「弄文笔记」图标，点击在浏览器打开
   （地址为 `http://<NAS IP>:3001`）

## 包结构与运行方式

```
nowen-note-<version>.fpk（tar.gz）
├── manifest / config/ / cmd/ / ICON*.PNG / wizard/   # fnpack 元数据与生命周期
└── app.tgz                                          # 应用负载
    ├── node/bin/node                # Node 22 静态运行时
    ├── backend/dist                 # tsc 产物（入口 index.hardened.js）
    ├── backend/node_modules         # 生产依赖（原生模块按 linux-x64 + ABI 127 安装）
    ├── backend/templates
    ├── frontend/dist                # 前端构建产物（含 .br/.gz 预压缩）
    └── package.json
```

app.tgz 的内容会直接解到 `target/`（即 `/vol{n}/@appcenter/nowen-note/`），
因此 `cmd/main` 的 `APP_HOME` 取 `TRIM_APPDEST` 本身，而不是 `TRIM_APPDEST/app`。

`cmd/main` 的职责（复刻 `docker-entrypoint.sh` 的密钥逻辑）：

- `start`：建数据目录（`TRIM_PKGVAR`）→ 生成/复用 `.jwt_secret`（首次随机生成，重启不失效）
  → 以 `NODE_ENV=production`、`PORT=3001`、`DB_PATH=<数据目录>/nowen-note.db`
  后台拉起 Node → 轮询 `/api/health` 最多 60s
- `stop`：按 PID 文件停止进程
- `status`：进程存活且健康检查通过返回 0，否则 3

## 数据、日志与端口

| 项 | 位置 |
| --- | --- |
| 数据目录 | `$TRIM_PKGVAR`（默认 `/var/apps/nowen-note/var`，系统托管、属主为应用用户） |
| 数据库 | 数据目录下 `nowen-note.db` |
| JWT 密钥 | 数据目录下 `.jwt_secret`（0600，勿泄漏） |
| 运行日志 | 数据目录下 `nowen-note.log` |
| PID 文件 | 数据目录下 `nowen-note.pid` |
| 端口 | 3001（应用中心内改端口需同步改 `cmd/main` 的 `NOWEN_PORT`） |

升级（覆盖安装）不会动数据目录；卸载按飞牛流程执行，数据目录是否保留以
飞牛卸载选项为准——**卸载前请自行备份数据库与附件**。

## 已知限制

- 仅 x86_64（fnOS 第三方应用当前限制，与 docker 版一致）
- 应用随 fnOS 启停，不运行时其他设备无法通过本机访问服务
- 未做签名/公证（飞牛手动安装不需要）
- `ffmpeg-static`/`sharp` 等原生模块使用 npm 预编译包；更换 Node 大版本时
  必须同步工作流里的 `NODE_VERSION`，否则 ABI 不匹配
- 运行时不需要 `node_modules/.bin`：打包时已删除该目录并实体化所有符号链接
  （npm 生成的 .bin 是指向构建机绝对路径的符号链接，跨机器无效而且会让
  飞牛解包失败）

## 从 docker 版切换

两个包的 `appname` 都是 `nowen-note`，同一时刻只能装一个。已装 docker 版的
用户先卸载再装直装版；数据不会自动迁移，需要手动拷贝数据库与附件目录。
注意 docker 版的数据卷布局与直装版不同（直装版数据在 `$TRIM_PKGVAR`）。
