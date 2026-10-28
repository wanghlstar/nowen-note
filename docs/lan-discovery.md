> **Nowen Note Lite（弄文笔记 Lite）**
>
> 本文档属于 **Nowen Note Lite**（基于开源项目 **Nowen Note（弄文笔记）** 的修改版）。
> 原项目名称与仓库：[cropflre/nowen-note](https://github.com/cropflre/nowen-note)，遵循 **GPL-3.0** 许可。

# 局域网发现（含组网 / 跨网段）

## 协议

服务端通过 mDNS 广播 `_nowen-note._tcp.local.`（`backend/src/services/discovery.ts`），
TXT 字段：`v`（版本）、`path`、`https`、`name`、`port`。

## 客户端能力矩阵

| 环境 | 发现方式 | 说明 |
| --- | --- | --- |
| Electron 桌面端 | 主进程 bonjour-service | 已验证 |
| Android / iOS | `@mhaberler/capacitor-zeroconf-nsd` | 需要 multicast lock |
| Tauri 桌面端 | **本机 backend 代理**（`GET /api/discovery/lan`） | 新增，WKWebView 无 mDNS API |
| 浏览器 / Web | 同源 backend 代理 | 同上 |

## 组网 / 跨网段（重要）

mDNS 是**链路本地多播**，通常不跨越 VPN / 组网隧道（ZeroTier 需显式开启
multicast，Tailscale、路由器组网基本不通）。这类场景用**单播扫描**：

```
GET /api/discovery/lan?subnet=192.168.2.0/24&port=19010
```

- 只接受私有 IPv4 网段：`10/8`、`172.16/12`、`192.168/16`、`100.64/10`
- 前缀不小于 `/24`（最多 254 个地址），单请求 600ms、并发 32，整体约 5 秒
- 判定依据：`GET /api/health` 返回 `{"service":"nowen-note"}`

登录页「局域网发现」面板在有后端代理时会显示「网段 + 端口 → 扫描」输入框。

## 最近服务器

连接成功后会记录最近使用的服务器 URL（localStorage，最多 5 条），在发现面板
底部展示，一键回填。用于组网下无法自动发现、且用户不想每次手敲地址的场景。

## 安全边界

- 扫描只允许私有网段，不接受公网/任意目标，避免成为 SSRF 扫描器
- 该接口与 `/api/health` 一样无需登录（登录前就要用）；若将后端暴露到公网，
  建议通过反代限制来源网段
