import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getLanDiscovery, type DiscoveredService } from "../lanDiscovery";

const { httpMock, zeroconfWatch, zeroconfUnwatch } = vi.hoisted(() => ({
  httpMock: vi.fn<[options: { url: string }], Promise<{ status: number }>>(),
  zeroconfWatch: vi.fn<[request: unknown, callback: unknown], Promise<string>>(async () => "callback-id"),
  zeroconfUnwatch: vi.fn<[request: unknown], Promise<void>>(async () => undefined),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => "android" },
  CapacitorHttp: { request: (options: { url: string }) => httpMock(options) },
}));

vi.mock("@mhaberler/capacitor-zeroconf-nsd", () => ({
  ZeroConf: {
    watch: (request: unknown, callback: unknown) => zeroconfWatch(request, callback),
    unwatch: (request: unknown) => zeroconfUnwatch(request),
  },
}));

/** 只有一个服务器在 192.168.2.8:19010 上监听，其余全部拒绝连接。 */
const REACHABLE = "http://192.168.2.8:19010/api/health";

class FakeRtcPeerConnection {
  onicecandidate: ((event: { candidate: { candidate: string } | null }) => void) | null = null;
  createDataChannel() {
    return {};
  }
  async createOffer() {
    setTimeout(() => {
      this.onicecandidate?.({
        candidate: { candidate: "candidate:1 1 udp 2113937151 192.168.2.35 54321 typ host generation 0" },
      });
      this.onicecandidate?.({ candidate: null });
    }, 0);
    return { type: "offer", sdp: "" };
  }
  async setLocalDescription() {
    /* no-op */
  }
  close() {
    /* no-op */
  }
}

describe("安卓局域网发现：零输入单播扫描", () => {
  beforeEach(() => {
    vi.stubGlobal("RTCPeerConnection", FakeRtcPeerConnection);
    httpMock.mockReset();
    httpMock.mockImplementation(async (options: { url: string }) => {
      if (options.url === REACHABLE) return { status: 200 };
      throw new Error("ECONNREFUSED");
    });
    zeroconfWatch.mockClear();
    zeroconfUnwatch.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("mDNS 无结果时，从本机网段自动扫到服务器并推给订阅者", async () => {
    const discovery = getLanDiscovery();
    const seen: DiscoveredService[][] = [];
    const off = discovery.onUpdate((list) => seen.push(list));
    await discovery.start();

    await vi.waitFor(
      () => {
        const flat = seen.flat();
        expect(flat.some((item) => item.ipv4 === "192.168.2.8" && item.port === 19010)).toBe(true);
      },
      { timeout: 5000, interval: 20 },
    );

    // 只探测本机所在 /24，且不探测本机自己
    const urls = httpMock.mock.calls.map(([options]) => String(options.url));
    expect(urls.every((url) => url.startsWith("http://192.168.2."))).toBe(true);
    expect(urls.some((url) => url.startsWith("http://192.168.2.35:"))).toBe(false);
    // 端口候选包含自托管常见端口
    expect(urls.some((url) => url === REACHABLE)).toBe(true);

    const hit = seen.flat().find((item) => item.ipv4 === "192.168.2.8");
    expect(hit?.port).toBe(19010);
    expect(hit?.host).toBe("192.168.2.8");

    off();
    await discovery.stop();
  });

  it("手动扫描指定网段返回命中数量", async () => {
    const discovery = getLanDiscovery();
    const hits = await discovery.scanSubnet!("192.168.2.0/24", 19010);
    expect(hits).toBe(1);
    await discovery.stop();
  });
});
