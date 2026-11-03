import { auditInsert } from "@/lib/exceptions/handle.server";
import { getActiveRoles } from "@/lib/authz/roles.server";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { Db } from "@/lib/agent/tools.server";
import { ARABIC_STYLES, asArabicStyle, DEFAULT_TEXT_STYLE, DEFAULT_VOICE_STYLE } from "./emirati";

async function requireAdmin(db: Db, userId: string) {
  if (!(await getActiveRoles(db, userId)).includes("system_admin")) throw new Error("Administrator access is required.");
}

export const REVIEW_PHRASES: { input: string; expected: string }[] = [
  { input: "أبغي أحجز سكن.", expected: "hostel" },
  { input: "أقدر أحول تخصصي؟", expected: "transfer" },
  { input: "شو صار على طلبي UAEU-2026-01063؟", expected: "case_status" },
  { input: "عندي مشكلة مع باص المساء.", expected: "complaint" },
  { input: "أقترح الجامعة تتعاون أكثر مع شركات تقنية.", expected: "suggestion" },
  { input: "كم ساعة باقية لي؟", expected: "academic" },
  { input: "شو الوظايف اللي تناسب تخصصي؟", expected: "career" },
  { input: "وين ألقى كتاب عن machine learning؟", expected: "library" },
  { input: "أبغي book hostel room", expected: "hostel" },
  { input: "شو status مال طلبي؟", expected: "case_status" },
  { input: "أقدر transfer to Data Science?", expected: "transfer" },
  { input: "شو وضعي في التسجيل؟", expected: "academic" },
];

export const getArabicLanguageConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase as Db;
    await requireAdmin(db, context.userId);
    const { data } = await db.from("ai_settings").select("arabic_style, voice_arabic_style").limit(1).maybeSingle();
    return {
      arabicStyle: asArabicStyle(data?.arabic_style, DEFAULT_TEXT_STYLE),
      voiceArabicStyle: asArabicStyle(data?.voice_arabic_style, DEFAULT_VOICE_STYLE),
    };
  });

export const updateArabicLanguageConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ arabicStyle: z.enum(ARABIC_STYLES), voiceArabicStyle: z.enum(ARABIC_STYLES) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase as Db;
    await requireAdmin(db, context.userId);
    const { data: row } = await db.from("ai_settings").select("id").limit(1).maybeSingle();
    if (!row) throw new Error("AI settings row is missing.");
    const { error } = await db
      .from("ai_settings")
      .update({ arabic_style: data.arabicStyle, voice_arabic_style: data.voiceArabicStyle, updated_by: context.userId })
      .eq("id", row.id);
    if (error) throw new Error(error.message);
    await auditInsert(db, {
      actor_id: context.userId,
      action: "ai.arabic_style_updated",
      entity_type: "ai_settings",
      entity_id: row.id,
      metadata: data,
    });
    const { invalidateCache } = await import("@/lib/quality/cache.server");
    await invalidateCache(db, "ai_settings", "arabic_style_updated").catch(() => 0);
    return { ok: true };
  });

export type ArabicReviewRow = {
  input: string;
  language: string;
  dialect: string;
  markers: string[];
  gloss: string;
  intent: string;
  expected: string;
  display: string;
  spoken: string;
  english: string;
  status: "pass" | "needs_review";
};

export const runArabicReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ extra: z.string().max(300).optional() }).parse(i ?? {}))
  .handler(async ({ data, context }): Promise<{ rows: ArabicReviewRow[] }> => {
    const db = context.supabase as Db;
    await requireAdmin(db, context.userId);
    const { readDialect, emiratiGloss, arabicStyleBlock, voiceStyleBlock } = await import("./emirati");
    const { classifyStudentIntent } = await import("./intent.server");
    const { loadAiSettings } = await import("@/lib/agent/settings.server");
    const { llmChat } = await import("@/lib/agent/provider.server");
    const settings = await loadAiSettings(db);
    const phrases = [...REVIEW_PHRASES];
    if (data.extra?.trim()) phrases.unshift({ input: data.extra.trim(), expected: "" });

    const rows = await Promise.all(
      phrases.map(async ({ input, expected }) => {
        const d = readDialect(input);
        const intent = classifyStudentIntent(input);
        let display = "";
        let spoken = "";
        let english = "";
        try {
          const r = await llmChat(
            { provider: settings.provider, model: settings.modelName, temperature: 0.3, maxOutputTokens: 600, timeoutMs: settings.requestTimeoutMs },
            {
              reasoningEffort: "none",
              messages: [
                {
                  role: "system",
                  content: `You are Sanadi, the UAEU student-services assistant. This is a language-quality sample: you have no student records, so never state facts about the student; describe what you would check or do next. The detected intent is "${intent}".
On-screen reply rules:${arabicStyleBlock(settings.arabicStyle)}
Spoken reply rules: ${voiceStyleBlock(settings.voiceArabicStyle)}
Return JSON only: {"display": "on-screen Arabic reply, 1-3 sentences", "spoken": "shorter spoken Arabic reply, 1-2 sentences", "english": "English equivalent of the on-screen reply"}`,
                },
                { role: "user", content: input },
              ],
            },
          );
          const raw = r.text.slice(r.text.indexOf("{"), r.text.lastIndexOf("}") + 1);
          const j = JSON.parse(raw) as { display?: string; spoken?: string; english?: string };
          display = j.display ?? "";
          spoken = j.spoken ?? "";
          english = j.english ?? "";
        } catch {
          display = "—";
        }
        const otherDialectOut = /(عايز|دلوقتي|كده|إزيك|بتاع|هلأ|كتير|منيح|مرحبا الساع|لا تشيل هم)/.test(display + spoken);
        const ok = (!expected || expected === intent) && !otherDialectOut && display !== "—";
        return {
          input,
          language: d.language,
          dialect: d.dialect,
          markers: d.markers,
          gloss: emiratiGloss(input),
          intent,
          expected,
          display,
          spoken,
          english,
          status: ok ? "pass" : "needs_review",
        } satisfies ArabicReviewRow;
      }),
    );
    return { rows };
  });
