/**
 * 局域网服务发现（服务端侧）
 *
 * 两路来源：
 *   1. mDNS 浏览 `_nowen-note._tcp.local.`（bonjour-service，仅同一链路有效）
 *   2. 单播网段扫描：对私有网段逐个探测 `http://<ip>:<port>/api/health`，
 *      用于 mDNS 无法跨越的组网 / VPN / 跨网段场景（TCP 可达即可）。
 *
 * 约束：
 *   - 只允许私有 IPv4 网段，且前缀不小于 /24（最多 254 个地址）；
 *   - 单请求 600ms、并发 32，整体约 5 秒内完成；
 *   - 任何失败都降级为空结果，不影响主流程。
 */

import net from "node:net";
import os from "node:os";
import type Database from "better-sqlite3";

export interface LanDiscoveredService {
  name: string;
  host: string;
  port: number;
  addresses: string[];
  ipv4: string;
  txt: Record<string, string>;
  source: "mdns" | "scan" | "known";
  lastSeen: number;
}

const MDNS_SERVICE_TYPE = "nowen-note";
const MDNS_TTL_MS = 30_000;
const SCAN_TIMEOUT_MS = 600;
const SCAN_CONCURRENCY = 32;
const MAX_HOSTS = 254;

let bonjourInstance: any = null;
let mdnsBrowser: any = null;
const mdnsServices = new Map<string, LanDiscoveredService>();

function ensureMdnsBrowser(): boolean {
  if (mdnsBrowser) return true;
  try {
    // 延迟 require：该依赖可能被精简部署剔除
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Bonjour } = require("bonjour-service");
    bonjourInstance = new Bonjour();
    mdnsBrowser = bonjourInstance.find({ type: MDNS_SERVICE_TYPE, protocol: "tcp" });
    mdnsBrowser.on("up", (svc: any) => {
      const addresses: string[] = Array.isArray(svc?.addresses) ? svc.addresses : [];
      const ipv4 = addresses.find((a) => net.isIPv4(a)) || "";
      const name = String(svc?.name || svc?.host || "");
      if (!name) return;
      mdnsServices.set(name, {
        name,
        host: String(svc?.host || ""),
        port: Number(svc?.port) || 0,
        addresses,
        ipv4,
        txt: (svc?.txt || {}) as Record<string, string>,
        source: "mdns",
        lastSeen: Date.now(),
      });
    });
    mdnsBrowser.on("down", (svc: any) => {
      const name = String(svc?.name || svc?.host || "");
      if (name) mdnsServices.delete(name);
    });
    return true;
  } catch (error) {
    console.warn("[discovery] mdns browse unavailable:", (error as Error)?.message || error);
    mdnsBrowser = null;
    return false;
  }
}

export function listMdnsServices(): LanDiscoveredService[] {
  ensureMdnsBrowser();
  const now = Date.now();
  for (const [key, value] of mdnsServices) {
    if (now - value.lastSeen > MDNS_TTL_MS) mdnsServices.delete(key);
  }
  return [...mdnsServices.values()];
}

function isPrivateIPv4(octets: number[]): boolean {
  const [a, b] = octets;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  // 100.64/10（CGNAT / Tailscale 常用）
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

export function parsePrivateCidr(input: string): { base: number[]; prefix: number } | null {
  const match = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(input.trim());
  if (!match) return null;
  const octets = match[1].split(".").map(Number);
  const prefix = Number(match[2]);
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  if (!Number.isInteger(prefix) || prefix < 24 || prefix > 32) return null;
  if (!isPrivateIPv4(octets)) return null;
  return { base: octets, prefix };
}

export function localPrivateSubnets(): string[] {
  const result: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const info of list || []) {
      if (info.family !== "IPv4" || info.internal) continue;
      if (!isPrivateIPv4(info.address.split(".").map(Number))) continue;
      const octets = info.address.split(".").map(Number);
      result.push(`${octets[0]}.${octets[1]}.${octets[2]}.0/24`);
    }
  }
  return [...new Set(result)];
}

function hostList({ base, prefix }: { base: number[]; prefix: number }): string[] {
  const hostBits = 32 - prefix;
  const size = Math.min(2 ** hostBits, MAX_HOSTS + 2);
  const startIp =
    ((base[0] << 24) >>> 0) + ((base[1] & 0xff) << 16) + ((base[2] & 0xff) << 8) + (base[3] & 0xff);
  const network = hostBits >= 8 ? startIp & (0xffffffff << hostBits) >>> 0 : startIp;
  const hosts: string[] = [];
  for (let i = 1; i < size - 1 && hosts.length < MAX_HOSTS; i += 1) {
    const value = (network + i) >>> 0;
    hosts.push(
      `${(value >>> 24) & 0xff}.${(value >>> 16) & 0xff}.${(value >>> 8) & 0xff}.${value & 0xff}`,
    );
  }
  return hosts;
}

function probeHost(ip: string, port: number): Promise<LanDiscoveredService | null> {
  return new Promise((resolve) => {
    const request = net.connect({ host: ip, port });
    let settled = false;
    const finish = (value: LanDiscoveredService | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request.destroy();
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), SCAN_TIMEOUT_MS);

    request.on("connect", () => {
      request.write(
        `GET /api/health HTTP/1.1\r\nHost: ${ip}:${port}\r\nConnection: close\r\nAccept: application/json\r\n\r\n`,
      );
    });
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk.toString("utf8");
    });
    request.on("end", () => {
      if (!/^HTTP\/1\.[01] 200/.test(raw)) return finish(null);
      const body = raw.slice(raw.indexOf("\r\n\r\n") + 4);
      try {
        const parsed = JSON.parse(body) as { service?: unknown; version?: unknown };
        if (parsed?.service !== "nowen-note") return finish(null);
        finish({
          name: `nowen-note@${ip}:${port}`,
          host: ip,
          port,
          addresses: [ip],
          ipv4: ip,
          txt: { v: typeof parsed.version === "string" ? parsed.version : "", https: "0" },
          source: "scan",
          lastSeen: Date.now(),
        });
      } catch {
        finish(null);
      }
    });
    request.on("error", () => finish(null));
  });
}

/**
 * 已知同步服务器（sync_profiles.serverUrl）。
 *
 * 组网 / 跨网段下 mDNS 不通，但用户既然配置过同步服务器，后端就知道它的
 * 地址与端口——直接探测它、并扫描它所在的 /24，就能做到零输入自动发现。
 */
export function listKnownServerUrls(db: Database.Database, limit = 5): string[] {
  try {
    const rows = db
      .prepare("SELECT serverUrl FROM sync_profiles WHERE serverUrl IS NOT NULL ORDER BY updatedAt DESC LIMIT ?")
      .all(limit) as Array<{ serverUrl: string }>;
    return rows.map((row) => String(row.serverUrl || "").trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function subnetOf(ip: string): string | null {
  const octets = ip.split(".").map(Number);
  if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  if (!isPrivateIPv4(octets)) return null;
  return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
}

function parseKnownServer(url: string): { host: string; port: number; https: boolean } | null {
  try {
    const parsed = new URL(url);
    const https = parsed.protocol === "https:";
    const port = Number(parsed.port) || (https ? 443 : 80);
    return { host: parsed.hostname, port, https };
  } catch {
    return null;
  }
}

const AUTO_TTL_MS = 20_000;
let autoCache: { at: number; services: LanDiscoveredService[] } | null = null;

/** 常见自托管端口：用户无需知道端口也能自动扫描。 */
const DEFAULT_SCAN_PORTS = [19010, 3001, 57892, 8080, 80];
const AUTO_SCAN_TTL_MS = 60_000;
const AUTO_SCAN_CONCURRENCY = 128;

interface AutoScanState {
  startedAt: number;
  done: boolean;
  results: Map<string, LanDiscoveredService>;
  subnets: string[];
  ports: number[];
}

let autoScan: AutoScanState | null = null;

/**
 * 从系统路由表推导私有网段（组网场景的关键：服务器网段可能是 utun 路由，
 * 不是本机网卡地址）。macOS 用 netstat，Linux 用 ip route。
 */
export function derivePrivateSubnets(): string[] {
  const entries = new Map<string, number>();
  const add = (subnet: string | null, weight: number) => {
    if (!subnet) return;
    const prev = entries.get(subnet);
    if (prev === undefined || weight < prev) entries.set(subnet, weight);
  };
  const isContainerRange = (subnet: string) => /^172\.(1[7-9]|2\d|3[01])\./.test(subnet);
  // macOS 的 netstat 会省略末尾的 .0（如 192.168.2 / 10.28/24），必须按 1~4 段解析
  const normalize = (dest: string): { ip: string; prefix: number } | null => {
    const [addr, prefixRaw] = dest.split("/");
    const octets = addr.split(".");
    if (octets.length < 2 || octets.length > 4) return null;
    const prefix = prefixRaw ? Number(prefixRaw) : 24;
    if (!Number.isInteger(prefix) || prefix >= 31 || prefix < 22) return null;
    const padded = [...octets, "0", "0", "0"].slice(0, 4).map(Number);
    if (padded.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    return { ip: padded.join("."), prefix };
  };
  try {
    const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
    const raw = process.platform === "win32"
      ? ""
      : execFileSync("sh", ["-c", process.platform === "darwin"
        ? "netstat -rn -f inet 2>/dev/null"
        : "ip -4 route 2>/dev/null"], { encoding: "utf8", timeout: 2000 });
    for (const line of raw.split("\n").slice(1)) {
      const match = /^(\d{1,3}(?:\.\d{1,3}){0,3}(?:\/\d{1,2})?)\s+(\S+)/.exec(line);
      if (!match) continue;
      const parsed = normalize(match[1]);
      if (!parsed) continue;
      const subnet = subnetOf(parsed.ip);
      const overlay = /utun|tun|tap|\bwg|ppp/i.test(line);
      // 网关是 IP 的路由 = 企业 VPN/隧道中转，服务器一般不在这类网段；
      // 网关是设备名（utun4 / link#..）的 = 直连组网网段，例如 192.168.2/24。
      const viaGatewayIp = net.isIPv4(match[2]);
      const weight = subnet && isContainerRange(subnet) ? 4
        : parsed.prefix > 24 ? 3
        : viaGatewayIp ? 2
        : overlay ? 0
        : 1;
      add(subnet, weight);
    }
  } catch {
    /* 路由表不可用则退化为网卡地址 */
  }
  for (const subnet of localPrivateSubnets()) add(subnet, isContainerRange(subnet) ? 3 : 1);
  return [...entries.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([subnet]) => subnet)
    .slice(0, 4);
}

function runAutoScan(subnets: string[], ports: number[]) {
  const state: AutoScanState = {
    startedAt: Date.now(),
    done: false,
    results: new Map(),
    subnets,
    ports,
  };
  autoScan = state;

  const jobs: Array<{ ip: string; port: number }> = [];
  for (const cidr of subnets) {
    const parsed = parsePrivateCidr(cidr);
    if (!parsed) continue;
    for (const ip of hostList(parsed)) {
      for (const port of ports) jobs.push({ ip, port });
    }
  }

  let cursor = 0;
  const worker = async () => {
    while (cursor < jobs.length) {
      const job = jobs[cursor];
      cursor += 1;
      const hit = await probeHost(job.ip, job.port);
      if (hit) state.results.set(`${job.ip}:${job.port}`, hit);
    }
  };

  void Promise.all(
    Array.from({ length: Math.min(AUTO_SCAN_CONCURRENCY, Math.max(jobs.length, 1)) }, () => worker()),
  ).then(() => {
    state.done = true;
  });
}

function ensureAutoScan(knownUrls: string[]): { services: LanDiscoveredService[]; scanning: boolean } {
  const stale = !autoScan || (autoScan.done && Date.now() - autoScan.startedAt > AUTO_SCAN_TTL_MS);
  if (stale) {
    const knownSubnets: string[] = [];
    const knownPorts: number[] = [];
    for (const url of knownUrls) {
      const target = parseKnownServer(url);
      if (!target) continue;
      if (net.isIPv4(target.host)) {
        const subnet = subnetOf(target.host);
        if (subnet) knownSubnets.push(subnet);
      }
      knownPorts.push(target.port);
    }
    const subnets = [...new Set([...knownSubnets, ...derivePrivateSubnets()])].slice(0, 3);
    const ports = [...new Set([...knownPorts, ...DEFAULT_SCAN_PORTS])].slice(0, 5);
    if (subnets.length > 0) runAutoScan(subnets, ports);
  }
  return {
    services: autoScan ? [...autoScan.results.values()] : [],
    scanning: Boolean(autoScan && !autoScan.done),
  };
}

/**
 * 零输入自动发现：mDNS + 已知服务器直连探测 + 已知服务器所在 /24 扫描。
 * 结果缓存 20s，前端每 3s 轮询不会反复触发 5 秒级扫描。
 */
export async function discoverAuto(knownUrls: string[]): Promise<{ services: LanDiscoveredService[]; scanning: boolean }> {
  const mdns = listMdnsServices();
  const auto = ensureAutoScan(knownUrls);
  if (autoCache && Date.now() - autoCache.at < AUTO_TTL_MS) {
    return { services: mergeServices(mdns, autoCache.services, auto.services), scanning: auto.scanning || !autoCache };
  }

  const found: LanDiscoveredService[] = [];
  const scanTargets = new Map<string, number>();

  for (const url of knownUrls) {
    const target = parseKnownServer(url);
    if (!target) continue;
    if (net.isIPv4(target.host)) {
      const hit = await probeHost(target.host, target.port);
      if (hit) found.push({ ...hit, source: "known", name: `nowen-note@${target.host}:${target.port}` });
      const subnet = subnetOf(target.host);
      if (subnet) scanTargets.set(subnet, target.port);
    } else {
      // 域名指向的服务器无法直接按 IP 扫描，但仍可作为“已知服务器”展示。
      found.push({
        name: `nowen-note@${target.host}`,
        host: target.host,
        port: target.port,
        addresses: [],
        ipv4: "",
        txt: { https: target.https ? "1" : "0" },
        source: "known",
        lastSeen: Date.now(),
      });
    }
  }

  // 已知服务器所在网段由后台扫描覆盖，这里只做直连探测。
  void scanTargets;

  autoCache = { at: Date.now(), services: found };
  return { services: mergeServices(mdns, found, auto.services), scanning: auto.scanning };
}

function mergeServices(...groups: LanDiscoveredService[][]): LanDiscoveredService[] {
  const byKey = new Map<string, LanDiscoveredService>();
  for (const group of groups) {
    for (const item of group) {
      if (!item?.port) continue;
      const key = `${item.ipv4 || item.host}:${item.port}`;
      const prev = byKey.get(key);
      // 已探测到的优先保留（known/scan 有 ipv4），mDNS 仅补名称
      byKey.set(key, prev ? { ...item, ...prev, name: prev.name || item.name } : item);
    }
  }
  return [...byKey.values()];
}

export async function scanSubnet(cidr: string, port: number): Promise<LanDiscoveredService[]> {
  const parsed = parsePrivateCidr(cidr);
  if (!parsed) return [];
  const hosts = hostList(parsed);
  const results: LanDiscoveredService[] = [];
  let index = 0;

  async function worker(): Promise<void> {
    while (index < hosts.length) {
      const ip = hosts[index];
      index += 1;
      const found = await probeHost(ip, port);
      if (found) results.push(found);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(SCAN_CONCURRENCY, hosts.length) }, () => worker()),
  );
  return results;
}
