import { describe, expect, it } from "vitest";
import { isHostelIntent } from "@/lib/hostel/rules";
import { isTransferIntent } from "@/lib/transfer/rules";
import { detectCaseReference } from "@/lib/agent/case-reference.server";
import { detectComplaintOpening } from "@/lib/agent/complaint-intake.server";
import { isSuggestionIntent } from "@/lib/agent/suggestion-intent.server";
import { detectAcademicProgressIntent } from "@/lib/agent/academic-progress.server";
import { detectCareerChatTopic } from "@/lib/career/chat.server";
import { isLibraryIntent } from "@/lib/agent/book-intent.server";
import { detectDomains } from "@/lib/agent/context.server";
import { readDialect, emiratiGloss, asArabicStyle } from "./emirati";

describe("UAEU Emirati phrases are understood without formal Arabic", () => {
  it("hostel", () => expect(isHostelIntent("أبغي أحجز سكن.")).toBe(true));
  it("transfer", () => expect(isTransferIntent("أقدر أحول تخصصي؟")).toBe(true));
  it("existing request", () => expect(detectCaseReference("شو صار على طلبي UAEU-2026-01063؟")).toBe("UAEU-2026-01063"));
  it("complaint", () => expect(detectComplaintOpening("عندي مشكلة مع باص المساء.")).not.toBeNull());
  it("complaint about the bus is not hostel", () => expect(isHostelIntent("عندي مشكلة مع باص المساء.")).toBe(false));
  it("suggestion", () => expect(isSuggestionIntent("أقترح الجامعة تتعاون أكثر مع شركات تقنية.")).toBe(true));
  it("academic", () => expect(detectAcademicProgressIntent("كم ساعة باقية لي؟")).toBe("credits_remaining"));
  it("career", () => expect(detectCareerChatTopic("شو الوظايف اللي تناسب تخصصي؟")).not.toBeNull());
  it("library", () => expect(isLibraryIntent("وين ألقى كتاب عن machine learning؟")).toBe(true));
  it("code-switched hostel", () => expect(isHostelIntent("أبغي book hostel room")).toBe(true));
  it("code-switched status", () => expect(detectDomains("شو status مال طلبي؟")).toContain("cases"));
  it("code-switched transfer", () => expect(isTransferIntent("أقدر transfer to Data Science?")).toBe(true));
});

describe("dialect reading", () => {
  it("detects Emirati markers", () => expect(readDialect("شو وضعي في التسجيل؟").dialect).toBe("emirati"));
  it("detects code-switching", () => expect(readDialect("شو status مال طلبي؟").language).toBe("mixed"));
  it("flags non-Emirati dialect", () => expect(readDialect("أنا عايز أحجز دلوقتي").dialect).toBe("other_dialect"));
  it("formal Arabic is MSA", () => expect(readDialect("أرغب في معرفة حالة طلبي").dialect).toBe("msa"));
  it("glosses Emirati words", () => expect(emiratiGloss("وين ألقى الباص")).toBe("أين أجد الحافلة"));
  it("defaults unknown style to UAE Professional", () => expect(asArabicStyle("x", "uae_professional")).toBe("uae_professional"));
});
