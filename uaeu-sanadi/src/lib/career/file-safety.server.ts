/**
 * Static malware and safety screening for student-uploaded CV files. Server only.
 *
 * The stack has no antivirus daemon (the Worker runtime cannot spawn processes),
 * so this performs the checks that are possible in-process: content-type
 * confirmation against magic bytes, executable and EICAR detection, Office macro
 * and OLE-object inspection, archive-bomb limits, and PDF active-content
 * detection. Outcome drives the upload flow:
 *
 *   clean       → stored and parsed normally
 *   quarantined → stored in an isolated prefix, never parsed, flagged for staff
 *   rejected    → never written to storage at all
 */
import { unzipSync } from "fflate";

export type SafetyFinding = { code: string; severity: "info" | "suspicious" | "malicious"; detail: string };

export type SafetyReport = {
  status: "clean" | "quarantined" | "rejected";
  verdict: string;
  findings: SafetyFinding[];
  sha256: string;
};

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_UNCOMPRESSED = 60 * 1024 * 1024;
const MAX_ENTRIES = 2000;
const MAX_RATIO = 200;

const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR";

const ZIP_MIMES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const startsWith = (b: Uint8Array, sig: number[]) => sig.every((v, i) => b[i] === v);

function asciiHead(bytes: Uint8Array, length = 4096): string {
  return new TextDecoder("latin1").decode(bytes.subarray(0, length));
}

function detectExecutable(bytes: Uint8Array): SafetyFinding | null {
  if (startsWith(bytes, [0x4d, 0x5a])) return { code: "pe_executable", severity: "malicious", detail: "Windows executable (MZ) header." };
  if (startsWith(bytes, [0x7f, 0x45, 0x4c, 0x46])) return { code: "elf_executable", severity: "malicious", detail: "Linux executable (ELF) header." };
  if (startsWith(bytes, [0xcf, 0xfa, 0xed, 0xfe]) || startsWith(bytes, [0xfe, 0xed, 0xfa, 0xce]))
    return { code: "macho_executable", severity: "malicious", detail: "macOS executable (Mach-O) header." };
  if (startsWith(bytes, [0xca, 0xfe, 0xba, 0xbe])) return { code: "java_class", severity: "malicious", detail: "Compiled Java class file." };
  if (startsWith(bytes, [0x23, 0x21])) return { code: "shell_script", severity: "malicious", detail: "Shell script shebang." };
  return null;
}

function inspectZip(bytes: Uint8Array): SafetyFinding[] {
  const findings: SafetyFinding[] = [];
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    return [{ code: "corrupt_container", severity: "suspicious", detail: "The Office container could not be opened." }];
  }

  const names = Object.keys(files);
  if (names.length > MAX_ENTRIES)
    findings.push({ code: "archive_entry_flood", severity: "malicious", detail: `${names.length} entries inside the document.` });

  let total = 0;
  for (const name of names) total += files[name]!.byteLength;
  if (total > MAX_UNCOMPRESSED || total > bytes.byteLength * MAX_RATIO)
    findings.push({
      code: "archive_bomb",
      severity: "malicious",
      detail: `Expands to ${Math.round(total / 1024 / 1024)} MB from ${Math.round(bytes.byteLength / 1024)} KB.`,
    });

  for (const name of names) {
    const lower = name.toLowerCase();
    if (lower.includes("vbaproject.bin") || lower.endsWith(".bin") && lower.includes("macro"))
      findings.push({ code: "office_macro", severity: "suspicious", detail: `Macro project found: ${name}` });
    if (/\.(exe|dll|scr|bat|cmd|js|jse|vbs|ps1|hta|jar)$/.test(lower))
      findings.push({ code: "embedded_executable", severity: "malicious", detail: `Executable payload embedded: ${name}` });
    if (lower.startsWith("word/embeddings/") || lower.includes("oleobject"))
      findings.push({ code: "ole_object", severity: "suspicious", detail: `Embedded OLE object: ${name}` });
  }

  const rels = names.filter((n) => n.toLowerCase().endsWith(".rels"));
  for (const rel of rels) {
    const xml = new TextDecoder().decode(files[rel]!);
    if (/TargetMode="External"[^>]*/.test(xml) && /(dde|mhtml|file:|smb:)/i.test(xml))
      findings.push({ code: "remote_template", severity: "suspicious", detail: `External/remote reference in ${rel}.` });
  }
  return findings;
}

function inspectPdf(bytes: Uint8Array): SafetyFinding[] {
  const findings: SafetyFinding[] = [];
  const text = new TextDecoder("latin1").decode(bytes);
  const rules: [RegExp, string, SafetyFinding["severity"], string][] = [
    [/\/JavaScript\b|\/JS\b/, "pdf_javascript", "suspicious", "The PDF contains embedded JavaScript."],
    [/\/Launch\b/, "pdf_launch_action", "malicious", "The PDF contains a launch action."],
    [/\/EmbeddedFile\b/, "pdf_embedded_file", "suspicious", "The PDF contains an embedded file attachment."],
    [/\/RichMedia\b|\/Movie\b/, "pdf_rich_media", "suspicious", "The PDF contains rich media."],
    [/\/AA\b/, "pdf_auto_action", "suspicious", "The PDF contains automatic actions."],
    [/\/SubmitForm\b/, "pdf_submit_form", "suspicious", "The PDF submits form data to a remote address."],
  ];
  for (const [re, code, severity, detail] of rules) if (re.test(text)) findings.push({ code, severity, detail });
  return findings;
}

function inspectText(bytes: Uint8Array): SafetyFinding[] {
  const head = asciiHead(bytes, 20000);
  const findings: SafetyFinding[] = [];
  if (/<script\b|javascript:|\beval\s*\(|powershell\s+-enc/i.test(head))
    findings.push({ code: "active_content_in_text", severity: "suspicious", detail: "Script-like content inside a plain-text CV." });
  return findings;
}

/** Screens an uploaded CV. Never throws. */
export async function scanUploadedCv(
  bytes: Uint8Array,
  mimeType: string,
  fileName: string,
): Promise<SafetyReport> {
  const findings: SafetyFinding[] = [];
  const sha256 = await sha256Hex(bytes);

  if (bytes.byteLength === 0) findings.push({ code: "empty_file", severity: "malicious", detail: "The file is empty." });
  if (bytes.byteLength > MAX_BYTES)
    findings.push({ code: "oversized_file", severity: "malicious", detail: "The file exceeds the 5 MB limit." });

  if (/\.(exe|dll|scr|bat|cmd|com|js|vbs|ps1|hta|jar|apk|msi)$/i.test(fileName))
    findings.push({ code: "executable_extension", severity: "malicious", detail: "Executable file extension." });
  if (/\.[a-z0-9]{2,4}\.(pdf|docx?|txt)$/i.test(fileName))
    findings.push({ code: "double_extension", severity: "suspicious", detail: "Misleading double file extension." });

  const exe = detectExecutable(bytes);
  if (exe) findings.push(exe);

  if (asciiHead(bytes, 8192).includes(EICAR))
    findings.push({ code: "eicar_test_file", severity: "malicious", detail: "EICAR antivirus test signature." });

  // Declared type must match the real container.
  if (mimeType === "application/pdf" && !asciiHead(bytes, 1024).startsWith("%PDF"))
    findings.push({ code: "type_mismatch", severity: "malicious", detail: "Declared as PDF but the content is not a PDF." });
  if (ZIP_MIMES.has(mimeType) && !startsWith(bytes, [0x50, 0x4b]))
    findings.push({ code: "type_mismatch", severity: "malicious", detail: "Declared as a Word document but the content is not." });
  if (mimeType === "application/msword" && !startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0]) && !startsWith(bytes, [0x50, 0x4b]))
    findings.push({ code: "type_mismatch", severity: "malicious", detail: "Declared as a Word document but the content is not." });

  if (mimeType === "application/pdf") findings.push(...inspectPdf(bytes));
  else if (ZIP_MIMES.has(mimeType) || startsWith(bytes, [0x50, 0x4b])) findings.push(...inspectZip(bytes));
  else if (mimeType === "text/plain") findings.push(...inspectText(bytes));

  const malicious = findings.filter((f) => f.severity === "malicious");
  const suspicious = findings.filter((f) => f.severity === "suspicious");

  const status: SafetyReport["status"] = malicious.length ? "rejected" : suspicious.length ? "quarantined" : "clean";
  const verdict = malicious.length
    ? `Rejected: ${malicious[0]!.detail}`
    : suspicious.length
      ? `Quarantined for review: ${suspicious[0]!.detail}`
      : "No malicious or active content detected.";

  return { status, verdict, findings, sha256 };
}

/** Student-facing explanation of a blocked or quarantined upload. */
export function safetyMessage(report: SafetyReport, ar: boolean): string {
  if (report.status === "rejected") {
    return ar
      ? "تم رفض الملف لأسباب أمنية. يرجى رفع سيرة ذاتية بصيغة PDF أو Word خالية من أي محتوى تنفيذي."
      : "This file was blocked by our security checks. Please upload a plain PDF or Word CV with no embedded or executable content.";
  }
  if (report.status === "quarantined") {
    return ar
      ? "تم عزل الملف مؤقتاً للمراجعة الأمنية لاحتوائه على محتوى نشط. يرجى إعادة الحفظ كملف PDF بسيط وإعادة الرفع."
      : "This file was quarantined for a safety review because it contains active content. Please re-save it as a simple PDF and upload it again.";
  }
  return "";
}
