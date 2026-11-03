import fs from "fs";
import path from "path";

const out = path.resolve("Sanadi.Infrastructure/Documents/Assets");
fs.mkdirSync(out, { recursive: true });

function extractArrayJoin(file) {
  const s = fs.readFileSync(file, "utf8");
  const m = s.match(/=\s*\[([\s\S]*?)\]\.join\(""\)/);
  if (!m) throw new Error("no array join in " + file);
  const parts = [...m[1].matchAll(/"([^"]*)"/g)].map((x) => x[1]);
  return Buffer.from(parts.join(""), "base64");
}

function extractTemplate(file) {
  const s = fs.readFileSync(file, "utf8");
  const m = s.match(/=\s*`([\s\S]*?)`\.replace/);
  if (!m) throw new Error("no template in " + file);
  return Buffer.from(m[1].replace(/\s+/g, ""), "base64");
}

const root = path.resolve("../UAEU-SANAD-MAIN-2/src/lib/documents");
const logo = extractArrayJoin(path.join(root, "logo.server.ts"));
fs.writeFileSync(path.join(out, "uaeu-logo.jpg"), logo);
console.log("logo", logo.length);

const reg = extractTemplate(path.join(root, "fonts/amiri-regular.server.ts"));
fs.writeFileSync(path.join(out, "amiri-regular.ttf"), reg);
console.log("amiri-regular", reg.length);

const bold = extractTemplate(path.join(root, "fonts/amiri-bold.server.ts"));
fs.writeFileSync(path.join(out, "amiri-bold.ttf"), bold);
console.log("amiri-bold", bold.length);
