/** Server-side text extraction for uploaded knowledge files. */
import { unzipSync, strFromU8 } from "fflate";

export type Extraction = { text: string; pages: number | null; error: string | null };

function xmlToText(xml: string, blockTags: string[], textTag: string): string {
  const out: string[] = [];
  const re = new RegExp(`<${textTag}[^>]*>([\\s\\S]*?)</${textTag}>`, "g");
  let body = xml;
  for (const tag of blockTags) body = body.replace(new RegExp(`</${tag}>`, "g"), `</${tag}>\n\u0000`);
  for (const part of body.split("\u0000")) {
    let m: RegExpExecArray | null;
    const buf: string[] = [];
    re.lastIndex = 0;
    while ((m = re.exec(part))) buf.push(m[1] ?? "");
    const line = buf.join("").replace(/<[^>]+>/g, "");
    if (line.trim()) out.push(decodeEntities(line));
  }
  return out.join("\n");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
}

async function extractPdf(bytes: Uint8Array): Promise<Extraction> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  // Per-page extraction keeps page boundaries (\f) so chunks can record the
  // page a passage came from.
  const { text, totalPages } = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(text) ? text : [String(text ?? "")];
  return { text: pages.map((p) => String(p).trim()).join("\n\f\n").trim(), pages: totalPages ?? pages.length, error: null };
}

function extractDocx(bytes: Uint8Array): Extraction {
  const files = unzipSync(bytes);
  const doc = files["word/document.xml"];
  if (!doc) return { text: "", pages: null, error: "The Word file does not contain a readable document part." };
  return { text: xmlToText(strFromU8(doc), ["w:p"], "w:t").trim(), pages: null, error: null };
}

function extractPptx(bytes: Uint8Array): Extraction {
  const files = unzipSync(bytes);
  const slides = Object.keys(files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  const parts = slides.map((name, i) => {
    const body = xmlToText(strFromU8(files[name]!), ["a:p"], "a:t").trim();
    return body ? `## Slide ${i + 1}\n\n${body}` : "";
  });
  return { text: parts.filter(Boolean).join("\n\n"), pages: slides.length || null, error: null };
}

function extractXlsx(bytes: Uint8Array): Extraction {
  const files = unzipSync(bytes);
  const sharedRaw = files["xl/sharedStrings.xml"];
  const shared: string[] = [];
  if (sharedRaw) {
    const xml = strFromU8(sharedRaw);
    for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      const texts = [...(m[1] ?? "").matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1] ?? "");
      shared.push(decodeEntities(texts.join("")));
    }
  }
  const sheets = Object.keys(files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort();
  const lines: string[] = [];
  for (const [i, name] of sheets.entries()) {
    lines.push(`## Sheet ${i + 1}`);
    const xml = strFromU8(files[name]!);
    for (const row of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const cell of (row[1] ?? "").matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
        const type = (cell[1] ?? "").match(/\bt="([^"]+)"/)?.[1];
        const inner = cell[2] ?? "";
        const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "";
        const inlineStr = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1] ?? "").join("");
        cells.push(type === "s" ? (shared[Number(v)] ?? "") : inlineStr || decodeEntities(v));
      }
      if (cells.some((c) => c.trim())) lines.push(cells.join(" | "));
    }
  }
  return { text: lines.join("\n"), pages: sheets.length || null, error: null };
}

/** Extract plain text from an uploaded file's bytes. Never throws. */
export async function extractDocumentText(bytes: ArrayBuffer, mimeType: string): Promise<Extraction> {
  const u8 = new Uint8Array(bytes);
  try {
    switch (mimeType) {
      case "application/pdf":
        return await extractPdf(u8);
      case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        return extractDocx(u8);
      case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
        return extractPptx(u8);
      case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
        return extractXlsx(u8);
      case "text/plain":
      case "text/markdown":
      case "text/csv":
        return { text: new TextDecoder().decode(u8), pages: null, error: null };
      default:
        return { text: "", pages: null, error: `Text extraction is not supported for ${mimeType}.` };
    }
  } catch (e) {
    return { text: "", pages: null, error: e instanceof Error ? e.message : "Text extraction failed." };
  }
}
