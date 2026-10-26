import { afterEach, describe, expect, it, vi } from "vitest";

const importNotesMock = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    importNotes: importNotesMock,
  },
}));

// D12 验证：Leanote 风格 HTML 导出走现有「导入为富文本」链路。
// 样本为按 Leanote 导出特征重建的代表性样本（未获得真实 Leanote 导出文件），
// 验证的是该结构类别（完整 HTML 文档 + <title> + div/inline-style 正文）的兼容性；
// 真实样本的人工 smoke 列为 W7 验收用例（docs/w7-acceptance-cases.md AC-12）。
const LEANOTE_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Leanote 测试笔记</title>
<style>body { font-family: sans-serif; margin: 24px; }</style>
</head>
<body>
<div class="container" style="max-width: 800px; margin: 0 auto;">
  <h1 style="font-size: 20px;">Leanote 测试笔记</h1>
  <div class="content" style="font-size: 14px; color: #333333;">
    <p style="margin: 0 0 10px;">第一段正文，包含中文标点，以及'单引号'和"双引号"。</p>
    <p style="margin: 0 0 10px;">汉字后紧跟空格 保留，逗号，保留，分号；保留。</p>
    <p>链接：<a href="https://leanote.com" style="color: #337ab7;">Leanote 官网</a></p>
    <ul>
      <li>列表项一</li>
      <li>列表项二</li>
    </ul>
    <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==" alt="内嵌图片" style="max-width: 100%;" />
    <blockquote style="border-left: 3px solid #cccccc;">引用内容</blockquote>
  </div>
</div>
<script>window.leanoteTracker = true;</script>
</body>
</html>`;

type JsonNode = { type: string; content?: JsonNode[]; text?: string; attrs?: Record<string, unknown>; marks?: Array<{ type: string; attrs?: Record<string, unknown> }> };

// vitest jsdom 环境的 File 未实现 Blob.text()；按仓库既有模式（obsidianImportFormat.test.ts）
// 用 duck-typed 桩提供导入链路依赖的最小接口。
function makeHtmlFile(name: string, content: string): File {
  return {
    name,
    size: new TextEncoder().encode(content).byteLength,
    type: "text/html",
    text: async () => content,
  } as unknown as File;
}

function collectText(node: JsonNode | undefined, acc: string[] = []): string[] {
  if (!node) return acc;
  if (typeof node.text === "string") acc.push(node.text);
  node.content?.forEach((child) => collectText(child, acc));
  return acc;
}

function collectMarks(node: JsonNode | undefined, acc: Array<{ type: string; attrs?: Record<string, unknown> }> = []): Array<{ type: string; attrs?: Record<string, unknown> }> {
  if (!node) return acc;
  if (Array.isArray(node.marks)) {
    acc.push(...node.marks);
  }
  node.content?.forEach((child) => collectMarks(child, acc));
  return acc;
}

function findByType(node: JsonNode | undefined, type: string, acc: JsonNode[] = []): JsonNode[] {
  if (!node) return acc;
  if (node.type === type) acc.push(node);
  node.content?.forEach((child) => findByType(child, type, acc));
  return acc;
}

describe("D12 Leanote HTML 导入兼容性（重建样本实测）", () => {
  afterEach(() => {
    importNotesMock.mockReset();
  });

  it("识别为 html 来源并从 <title> 提取标题", async () => {
    const { readMarkdownFiles } = await import("@/lib/importService");
    const files = [makeHtmlFile("leanote-note.html", LEANOTE_HTML)];

    const infos = await readMarkdownFiles(files);

    expect(infos).toHaveLength(1);
    expect(infos[0].source).toBe("html");
    expect(infos[0].title).toBe("Leanote 测试笔记");
  });

  it("转换为合法 tiptap-json，保留标题/段落/列表/链接/图片/引用", async () => {
    const { readMarkdownFiles, convertToTiptapJson } = await import("@/lib/importService");
    const files = [makeHtmlFile("leanote-note.html", LEANOTE_HTML)];
    const infos = await readMarkdownFiles(files);

    const json = JSON.parse(convertToTiptapJson(infos[0])) as JsonNode;
    const text = collectText(json).join("");

    expect(json.type).toBe("doc");
    expect(findByType(json, "heading").length).toBeGreaterThan(0);
    expect(findByType(json, "bulletList").length).toBeGreaterThan(0);
    expect(findByType(json, "blockquote").length).toBeGreaterThan(0);
    expect(text).toContain("Leanote 测试笔记");
    expect(text).toContain("第一段正文，包含中文标点，以及'单引号'和\"双引号\"。");
    expect(text).toContain("列表项一");
    expect(text).toContain("引用内容");

    const links = collectMarks(json).filter((mark) => mark.type === "link");
    expect(links.length).toBeGreaterThan(0);
    expect(links[0].attrs?.href).toBe("https://leanote.com");

    const images = findByType(json, "image");
    expect(images.length).toBeGreaterThan(0);
    expect(String(images[0].attrs?.src)).toContain("data:image/png;base64,");
  });

  it("CJK 边界：汉字后紧跟空格/逗号/单引号内容逐字保留", async () => {
    const { readMarkdownFiles, convertToTiptapJson } = await import("@/lib/importService");
    const files = [makeHtmlFile("leanote-note.html", LEANOTE_HTML)];
    const infos = await readMarkdownFiles(files);

    const json = JSON.parse(convertToTiptapJson(infos[0])) as JsonNode;
    const text = collectText(json).join("");

    expect(text).toContain("汉字后紧跟空格 保留");
    expect(text).toContain("逗号，保留");
    expect(text).toContain("分号；保留");
    expect(text).toContain("'单引号'");
  });

  it("剥离脚本与内联样式，不把跟踪代码带入笔记", async () => {
    const { readMarkdownFiles, convertToTiptapJson } = await import("@/lib/importService");
    const files = [makeHtmlFile("leanote-note.html", LEANOTE_HTML)];
    const infos = await readMarkdownFiles(files);

    const content = convertToTiptapJson(infos[0]);
    expect(content).not.toContain("leanoteTracker");
    expect(content).not.toContain("font-family");
    expect(content).not.toContain("max-width");
  });

  it("importNotes 以 tiptap-json contentFormat 提交（后端 /api/export/import 接受的载荷）", async () => {
    importNotesMock.mockResolvedValue({ success: true, count: 1 });
    const { readMarkdownFiles, importNotes } = await import("@/lib/importService");
    const files = [makeHtmlFile("leanote-note.html", LEANOTE_HTML)];
    const infos = await readMarkdownFiles(files);

    const result = await importNotes(infos);

    expect(result).toEqual({ success: true, count: 1 });
    const [[notes]] = importNotesMock.mock.calls;
    expect(notes[0].contentFormat).toBe("tiptap-json");
    expect(notes[0].title).toBe("Leanote 测试笔记");
    const payload = JSON.parse(notes[0].content) as JsonNode;
    expect(payload.type).toBe("doc");
    expect(collectText(payload).join("")).toContain("汉字后紧跟空格 保留");
  });

  it("远程图片 src 原样保留（已知限制：导入后不会自动本地化，需人工跟进）", async () => {
    const remote = `<!DOCTYPE html><html><head><title>远程图片</title></head><body><p>正文</p><img src="http://leanote.example.com/file/getImage?fileId=abc123" alt="图" /></body></html>`;
    const { readMarkdownFiles, convertToTiptapJson } = await import("@/lib/importService");
    const files = [makeHtmlFile("remote-image.html", remote)];
    const infos = await readMarkdownFiles(files);

    const json = JSON.parse(convertToTiptapJson(infos[0])) as JsonNode;
    const images = findByType(json, "image");
    expect(images.length).toBeGreaterThan(0);
    expect(String(images[0].attrs?.src)).toBe("http://leanote.example.com/file/getImage?fileId=abc123");
  });
});
