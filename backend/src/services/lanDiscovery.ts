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

export interface LanDiscoveredService {
  name: string;
  host: string;
  port: number;
  addresses: string[];
  ipv4: string;
  txt: Record<string, string>;
  source: "mdns" | "scan";
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
