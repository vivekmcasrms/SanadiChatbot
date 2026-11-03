/**
 * Institutional PDF renderer for issued student documents. Server only.
 * Pure JavaScript (pdf-lib + fontkit + qrcode-generator) so it runs inside the
 * edge worker with no native binaries.
 */
import {
  PDFDocument,
  PDFName,
  PDFString,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import qrcode from "qrcode-generator";
import { arabicLine, shapeArabic } from "./arabic.server";
import { UAEU_LOGO_JPEG_BASE64 } from "./logo.server";
import { AMIRI_REGULAR_TTF_BASE64 } from "./fonts/amiri-regular.server";
import { AMIRI_BOLD_TTF_BASE64 } from "./fonts/amiri-bold.server";

const MAROON = rgb(0.42, 0.09, 0.19);
const INK = rgb(0.13, 0.13, 0.14);
const MUTED = rgb(0.42, 0.42, 0.46);
const RULE = rgb(0.82, 0.78, 0.74);
const HAIRLINE = rgb(0.87, 0.85, 0.83);
const PANEL = rgb(0.973, 0.965, 0.957);
const LINK = rgb(0.24, 0.16, 0.44);

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 56;

export type Fact = { label: string; value: string };

export type LetterSection = {
  language: "en" | "ar";
  header: string;
  subHeader: string;
  title: string;
  body: string;
  footer: string;
  signatory: string;
  disclaimer: string | null;
  issuedLabel: string;
  issuedValue: string;
  referenceLabel: string;
  referenceValue: string;
  verifyLabel: string;
  verifyHint: string;
  verifyUrl: string;
  retentionNote: string | null;
  demoBadge: string | null;
  pageLabel: string;
  /** Compact document metadata strip under the title. */
  metaFacts: Fact[];
  /** Verified student identity panel. */
  panelTitle: string;
  studentFacts: Fact[];
  /** Subtle trust badge, e.g. "Digitally verifiable". */
  trustBadge: string | null;
};


const logoBytes = () => decodeBase64(UAEU_LOGO_JPEG_BASE64);

/** Decodes a base64 asset that is bundled with the worker. */
function decodeBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * Arabic typeface. Embedded at build time (Amiri subset) so Arabic letters can
 * always be issued — no runtime font download, no network dependency.
 */
const arabicFontBytes = () => decodeBase64(AMIRI_REGULAR_TTF_BASE64);
const arabicBoldBytes = () => decodeBase64(AMIRI_BOLD_TTF_BASE64);

/** True when an Arabic-capable font can be embedded; always true now. */
export const arabicFontAvailable = async () => arabicFontBytes().length > 0;


type Ctx = {
  page: PDFPage;
  regular: PDFFont;
  bold: PDFFont;
  rtl: boolean;
  width: number;
};

// fontkit lays shaped Arabic out right-to-left itself, so the text only needs
// contextual presentation forms — never a manual visual reversal.
const prepare = (ctx: Ctx, text: string) => (ctx.rtl ? arabicLine(text) : text);
const measureText = (ctx: Ctx, text: string, font: PDFFont, size: number) =>
  font.widthOfTextAtSize(ctx.rtl ? shapeArabic(text) : text, size);

function wrap(ctx: Ctx, text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (measureText(ctx, candidate, font, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function drawLine(
  ctx: Ctx,
  text: string,
  y: number,
  opts: { font: PDFFont; size: number; color?: typeof INK; align?: "start" | "center" | "end" },
) {
  const { font, size, color = INK } = opts;
  const align = opts.align ?? "start";
  const w = measureText(ctx, text, font, size);
  let x = MARGIN;
  if (align === "center") x = (ctx.width - w) / 2;
  else if (align === "end") x = ctx.width - MARGIN - w;
  else if (ctx.rtl) x = ctx.width - MARGIN - w;
  ctx.page.drawText(prepare(ctx, text), { x, y, size, font, color });
}

function drawQr(page: PDFPage, data: string, x: number, y: number, size: number) {
  const qr = qrcode(0, "M");
  qr.addData(data);
  qr.make();
  const count = qr.getModuleCount();
  const cell = size / count;
  page.drawRectangle({ x: x - 4, y: y - 4, width: size + 8, height: size + 8, color: rgb(1, 1, 1) });
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (!qr.isDark(r, c)) continue;
      page.drawRectangle({
        x: x + c * cell,
        y: y + size - (r + 1) * cell,
        width: cell,
        height: cell,
        color: INK,
      });
    }
  }
}

/** Registers a clickable URI area so recipients can open the verification page. */
function addLinkAnnotation(doc: PDFDocument, page: PDFPage, url: string, rect: [number, number, number, number]) {
  const annot = doc.context.obj({
    Type: "Annot",
    Subtype: "Link",
    Rect: rect,
    Border: [0, 0, 0],
    A: { Type: "Action", S: "URI", URI: PDFString.of(url) },
  });
  const existing = page.node.lookup(PDFName.of("Annots"));
  if (existing && "push" in (existing as never)) {
    (existing as unknown as { push: (v: unknown) => void }).push(annot);
  } else {
    page.node.set(PDFName.of("Annots"), doc.context.obj([annot]));
  }
}

/**
 * Renders one letter page using a strict top-down flow.
 *
 * Every block advances a single cursor downwards and the cursor is NEVER moved
 * back up, which is what previously let the signatory and verification blocks
 * collide with the body. The verification block and footer occupy a reserved
 * band at the bottom of the page; if the flowing content would reach that band
 * it continues on a new page instead of overlapping.
 */
function renderSection(
  doc: PDFDocument,
  s: LetterSection,
  fonts: { regular: PDFFont; bold: PDFFont },
  logo: PDFImage,
) {
  const inner = A4[0] - MARGIN * 2;
  const rtl = s.language === "ar";
  const startX = MARGIN;
  const endX = A4[0] - MARGIN;

  // Reserved bottom band: footer + verification block. Kept deliberately tight
  // so an ordinary one-page letter never spills onto a second sheet.
  const FOOTER_RULE_Y = MARGIN + 22;
  const VERIFY_TOP = FOOTER_RULE_Y + 96;
  const CONTENT_FLOOR = VERIFY_TOP + 30;


  let page = doc.addPage(A4);
  let ctx: Ctx = { page, regular: fonts.regular, bold: fonts.bold, rtl, width: A4[0] };
  let y = 0;

  const chrome = (p: PDFPage) => {
    p.drawRectangle({ x: 0, y: A4[1] - 5, width: A4[0], height: 5, color: MAROON });
    p.drawRectangle({ x: 0, y: 0, width: 8, height: A4[1], color: rgb(0.976, 0.968, 0.96) });
    p.drawRectangle({ x: A4[0] - 8, y: 0, width: 8, height: A4[1], color: rgb(0.976, 0.968, 0.96) });
  };

  const startPage = (withHeader: boolean) => {
    chrome(page);
    y = A4[1] - MARGIN;
    if (!withHeader) {
      y -= 6;
      return;
    }
    // ---------------- Institutional header (logo only: the mark already
    // carries the university name, so it is never repeated on top of it) -----
    const maxLogoWidth = inner * 0.62;
    let logoHeight = 48;
    let logoWidth = (logo.width / logo.height) * logoHeight;
    if (logoWidth > maxLogoWidth) {
      logoWidth = maxLogoWidth;
      logoHeight = (logo.height / logo.width) * logoWidth;
    }
    page.drawImage(logo, { x: (A4[0] - logoWidth) / 2, y: y - logoHeight, width: logoWidth, height: logoHeight });
    y -= logoHeight + 16;

    drawLine(ctx, s.subHeader, y, { font: fonts.regular, size: 8.4, color: MUTED, align: "center" });
    y -= 12;
    page.drawLine({ start: { x: startX, y }, end: { x: endX, y }, thickness: 0.9, color: MAROON });
    y -= 26;
  };

  const nextPage = () => {
    page = doc.addPage(A4);
    ctx = { page, regular: fonts.regular, bold: fonts.bold, rtl, width: A4[0] };
    startPage(false);
  };

  /** Guarantees `needed` points of flow space above the reserved bottom band. */
  const ensure = (needed: number) => {
    if (y - needed < CONTENT_FLOOR) nextPage();
  };

  startPage(true);

  // ---------------- Document metadata --------------------------------------
  // One compact line: reference on the leading edge, issue date on the
  // trailing edge. Anything else (retention, "verifiable online") is already
  // stated in the verification block, so it is never repeated here.
  if (s.metaFacts.length) {
    const facts = s.metaFacts.slice(0, 2);
    const pair = (fact: Fact, side: "start" | "end") => {
      const label = `${fact.label}:`;
      const labelW = measureText(ctx, label, fonts.regular, 7.8);
      const valueW = measureText(ctx, fact.value, fonts.bold, 8.6);
      const total = labelW + valueW + 5;
      const leading = rtl ? side === "end" : side === "start";
      const x = leading ? startX : endX - total;
      // On the Arabic page the label reads right-to-left, so it sits on the
      // right of its value; the value itself keeps its own direction.
      const labelX = rtl ? x + valueW + 5 : x;
      const valueX = rtl ? x : x + labelW + 5;
      page.drawText(prepare(ctx, label), { x: labelX, y, size: 7.8, font: fonts.regular, color: MUTED });
      page.drawText(prepare(ctx, fact.value), { x: valueX, y, size: 8.6, font: fonts.bold, color: INK });
    };
    if (facts[0]) pair(facts[0], "start");
    if (facts[1]) pair(facts[1], "end");
    y -= 26;
  }


  // ---------------- Document title ----------------
  drawLine(ctx, s.title, y, { font: fonts.bold, size: 15.5, color: INK, align: "center" });
  y -= 8;
  const titleW = measureText(ctx, s.title, fonts.bold, 15.5);
  page.drawLine({
    start: { x: (A4[0] - titleW) / 2, y },
    end: { x: (A4[0] + titleW) / 2, y },
    thickness: 0.8,
    color: MAROON,
  });
  y -= 26;


  // ---------------- Verified student information panel ----------------
  if (s.studentFacts.length) {
    const labelW = 120;
    const valueW = inner - labelW - 36;
    const rows = s.studentFacts.map((f) => ({ ...f, lines: wrap(ctx, f.value, fonts.bold, 9.4, valueW) }));
    const rowLead = 14;
    const panelH = 26 + rows.reduce((sum, r) => sum + Math.max(1, r.lines.length) * rowLead, 0) + 6;

    ensure(panelH + 16);

    const panelTop = y;
    page.drawRectangle({
      x: startX,
      y: panelTop - panelH,
      width: inner,
      height: panelH,
      color: PANEL,
      borderColor: HAIRLINE,
      borderWidth: 0.6,
    });
    page.drawRectangle({
      x: rtl ? endX - 2.5 : startX,
      y: panelTop - panelH,
      width: 2.5,
      height: panelH,
      color: MAROON,
    });

    const titleWidth = measureText(ctx, s.panelTitle, fonts.bold, 9);
    page.drawText(prepare(ctx, s.panelTitle), {
      x: rtl ? endX - 16 - titleWidth : startX + 16,
      y: panelTop - 16,
      size: 9,
      font: fonts.bold,
      color: MAROON,
    });

    let ry = panelTop - 32;
    for (const r of rows) {
      const lw = measureText(ctx, r.label, fonts.regular, 8.4);
      page.drawText(prepare(ctx, r.label), {
        x: rtl ? endX - 16 - lw : startX + 16,
        y: ry,
        size: 8.4,
        font: fonts.regular,
        color: MUTED,
      });
      for (const line of r.lines) {
        const vw = measureText(ctx, line, fonts.bold, 9.4);
        page.drawText(prepare(ctx, line), {
          x: rtl ? endX - 16 - labelW - vw : startX + 16 + labelW,
          y: ry,
          size: 9.4,
          font: fonts.bold,
          color: INK,
        });
        ry -= rowLead;
      }
      if (!r.lines.length) ry -= rowLead;
    }
    y = panelTop - panelH - 20;

  }

  // ---------------- Letter body ----------------
  // A certificate that spills a handful of lines onto an otherwise empty
  // second page looks unofficial, so the body is gently compressed to fit the
  // remaining space first; paging is the last resort for genuinely long text.
  const paragraphs = s.body.split(/\n{2,}/).map((p) => p.split("\n"));
  const signatoryLines = s.signatory.split("\n").filter(Boolean);
  const signatoryHeight = signatoryLines.length ? 12 + signatoryLines.length * 14 : 0;
  const available = y - CONTENT_FLOOR - signatoryHeight;

  const steps: Array<[size: number, lead: number, gap: number]> = rtl
    ? [
        [11, 19, 9],
        [10.5, 18, 8],
        [10, 16.5, 7],
        [9.5, 15.5, 6],
        [9, 14.5, 5],
      ]
    : [
        [11, 16.5, 10],
        [10.5, 15.5, 9],
        [10, 14.5, 8],
        [9.5, 13.5, 7],
        [9, 12.5, 6],
      ];


  const heightAt = (size: number, lead: number, gap: number) => {
    let h = 0;
    for (const para of paragraphs) {
      for (const raw of para) h += wrap(ctx, raw, fonts.regular, size, inner).length * lead;
      h += gap;
    }
    return h;
  };

  let [bodySize, bodyLead, paraGap] = steps[0]!;
  for (const step of steps) {
    [bodySize, bodyLead, paraGap] = step;
    if (heightAt(bodySize, bodyLead, paraGap) <= available) break;
  }

  for (const para of paragraphs) {
    for (const raw of para) {
      for (const line of wrap(ctx, raw, fonts.regular, bodySize, inner)) {
        ensure(bodyLead);
        drawLine(ctx, line, y, { font: fonts.regular, size: bodySize });
        y -= bodyLead;
      }
    }
    y -= paraGap;
  }

  // ---------------- Signatory ----------------
  // The signature block belongs at the foot of the letter, so it is anchored
  // just above the verification band instead of trailing the body and leaving
  // a large void in the middle of the page.
  if (signatoryLines.length) {
    y -= 12;
    ensure(signatoryLines.length * 14);
    const anchored = CONTENT_FLOOR + signatoryLines.length * 14;
    if (anchored < y) y = anchored;
    for (const line of signatoryLines) {
      drawLine(ctx, line, y, { font: fonts.regular, size: 9.8, color: MUTED });
      y -= 14;
    }
  }


  // ---------------- Verification block (reserved band) ----------------
  page.drawLine({ start: { x: startX, y: VERIFY_TOP }, end: { x: endX, y: VERIFY_TOP }, thickness: 0.7, color: RULE });

  const qrSize = 72;
  const qrY = VERIFY_TOP - 14 - qrSize;
  const qrX = rtl ? endX - qrSize : startX;
  drawQr(page, s.verifyUrl, qrX, qrY, qrSize);
  page.drawRectangle({
    x: qrX - 5,
    y: qrY - 5,
    width: qrSize + 10,
    height: qrSize + 10,
    borderColor: HAIRLINE,
    borderWidth: 0.6,
  });

  const textX = rtl ? startX : startX + qrSize + 20;
  const textWidth = inner - qrSize - 20;
  let ty = VERIFY_TOP - 24;

  const put = (text: string, font: PDFFont, size: number, color: typeof INK) => {
    for (const part of wrap(ctx, text, font, size, textWidth)) {
      const w = measureText(ctx, part, font, size);
      page.drawText(prepare(ctx, part), { x: rtl ? textX + textWidth - w : textX, y: ty, size, font, color });
      ty -= size + 3.5;
    }
  };

  put(s.verifyLabel, fonts.bold, 9.6, MAROON);
  ty -= 1;
  put(s.verifyHint, fonts.regular, 8, MUTED);
  ty -= 3;


  // The URL always reads left-to-right, even on the Arabic page.
  const urlSize = 8.4;
  const urlWidth = fonts.regular.widthOfTextAtSize(s.verifyUrl, urlSize);
  const urlX = rtl ? textX + textWidth - urlWidth : textX;
  page.drawText(s.verifyUrl, { x: urlX, y: ty, size: urlSize, font: fonts.regular, color: LINK });
  page.drawLine({
    start: { x: urlX, y: ty - 2 },
    end: { x: urlX + urlWidth, y: ty - 2 },
    thickness: 0.5,
    color: LINK,
  });
  addLinkAnnotation(doc, page, s.verifyUrl, [urlX, ty - 3, urlX + urlWidth, ty + urlSize + 1]);
  ty -= urlSize + 8;

  if (s.retentionNote) put(s.retentionNote, fonts.regular, 7.4, MUTED);

  // Badges sit on their own row above the verification rule.
  let badgeEdge = rtl ? startX : endX;
  const drawBadge = (text: string, fill: typeof PANEL, textColor: typeof MAROON) => {
    const w = measureText(ctx, text, fonts.bold, 7.4) + 16;
    const x = rtl ? badgeEdge : badgeEdge - w;
    page.drawRectangle({
      x,
      y: VERIFY_TOP + 10,
      width: w,
      height: 16,
      color: fill,
      borderColor: HAIRLINE,
      borderWidth: 0.5,
    });
    page.drawText(prepare(ctx, text), { x: x + 8, y: VERIFY_TOP + 14.5, size: 7.4, font: fonts.bold, color: textColor });
    badgeEdge = rtl ? badgeEdge + w + 8 : badgeEdge - w - 8;
  };
  if (s.trustBadge) drawBadge(s.trustBadge, rgb(0.95, 0.96, 0.94), MAROON);
  if (s.demoBadge) drawBadge(s.demoBadge, rgb(0.98, 0.93, 0.85), MAROON);

  // ---------------- Footer ----------------
  page.drawLine({
    start: { x: startX, y: FOOTER_RULE_Y },
    end: { x: endX, y: FOOTER_RULE_Y },
    thickness: 0.7,
    color: RULE,
  });
  drawLine(ctx, s.header, FOOTER_RULE_Y - 12, { font: fonts.bold, size: 8.4, color: MAROON, align: "center" });
  if (s.footer) {
    drawLine(ctx, s.footer, FOOTER_RULE_Y - 23, { font: fonts.regular, size: 7.6, color: MUTED, align: "center" });
  }
  drawLine(ctx, s.pageLabel, FOOTER_RULE_Y - 34, { font: fonts.regular, size: 7, color: MUTED, align: "center" });
}



/** Renders one or more letter sections (English page, Arabic page or both). */
export async function renderLetterPdf(sections: LetterSection[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(sections[0]?.title ?? "UAEU document");
  doc.setProducer("Sanadi — UAEU Student Companion");
  doc.setCreator("Sanadi");

  const latinRegular = await doc.embedFont(StandardFonts.Helvetica);
  const latinBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const logo = await doc.embedJpg(logoBytes() as unknown as ArrayBuffer);

  let arabic: { regular: PDFFont; bold: PDFFont } | null = null;
  if (sections.some((s) => s.language === "ar")) {
    arabic = {
      regular: await doc.embedFont(arabicFontBytes(), { subset: true }),
      bold: await doc.embedFont(arabicBoldBytes(), { subset: true }),
    };
  }

  for (const section of sections) {
    const fonts =
      section.language === "ar" && arabic
        ? arabic
        : { regular: latinRegular, bold: latinBold };
    renderSection(doc, section, fonts, logo);
  }

  return doc.save();
}
