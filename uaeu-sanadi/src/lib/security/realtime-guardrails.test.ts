import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Case data (cases, case_comments, case_status_history) is replicated over
 * realtime. Postgres Changes enforces the same RLS policies as a normal read,
 * so a student only ever sees their own cases and staff only their unit's.
 *
 * Broadcast and Presence do NOT enforce RLS: any client that knows a topic name
 * can listen. This regression test fails if such a channel is introduced
 * without an explicit authorization check, which would allow cross-student or
 * cross-unit leakage of case data.
 */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

describe("realtime case security", () => {
  const files = sourceFiles("src");

  it("uses no unauthenticated realtime broadcast or presence channels", () => {
    const offenders = files.filter((file) => {
      const src = readFileSync(file, "utf8");
      if (!/\.channel\(/.test(src)) return false;
      return /\.on\(\s*["'](broadcast|presence)["']/.test(src) || /\.send\(\s*\{\s*type:\s*["']broadcast/.test(src);
    });
    expect(offenders).toEqual([]);
  });

  it("never subscribes to case tables with the service-role client", () => {
    const offenders = files.filter((file) => {
      const src = readFileSync(file, "utf8");
      return /supabaseAdmin[\s\S]{0,200}\.channel\(/.test(src);
    });
    expect(offenders).toEqual([]);
  });
});
