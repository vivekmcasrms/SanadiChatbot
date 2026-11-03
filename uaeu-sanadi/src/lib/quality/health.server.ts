/** Degraded-mode state for AI, knowledge, student data, cases and maintenance. */
import type { Db } from "../agent/tools.server";
import { getCached } from "./cache.server";

export type Component = "ai_provider" | "knowledge_retrieval" | "student_information" | "case_management" | "maintenance";
export type HealthMap = Record<Component, { state: string; messageEn: string | null; messageAr: string | null }>;

const DEFAULT: HealthMap = {
  ai_provider: { state: "operational", messageEn: null, messageAr: null },
  knowledge_retrieval: { state: "operational", messageEn: null, messageAr: null },
  student_information: { state: "operational", messageEn: null, messageAr: null },
  case_management: { state: "operational", messageEn: null, messageAr: null },
  maintenance: { state: "operational", messageEn: null, messageAr: null },
};

export async function loadHealth(db: Db): Promise<HealthMap> {
  return getCached(db, {
    key: "service_health:v1",
    category: "service_health",
    ttlSeconds: 30,
    load: async () => {
      const { data } = await db.from("service_degradation_state").select("component, state, message_en, message_ar");
      const map: HealthMap = { ...DEFAULT };
      for (const row of data ?? []) {
        const key = row.component as Component;
        if (key in map) map[key] = { state: row.state, messageEn: row.message_en, messageAr: row.message_ar };
      }
      return map;
    },
  });
}

export function degradedNotice(health: HealthMap, lang: "en" | "ar"): string | null {
  const notes: string[] = [];
  if (health.maintenance.state !== "operational") {
    notes.push(
      lang === "ar"
        ? "النظام في وضع الصيانة؛ تظل خيارات التواصل البشري متاحة."
        : "The system is in maintenance mode; human contact options remain available.",
    );
  }
  if (health.ai_provider.state !== "operational") {
    notes.push(
      lang === "ar"
        ? "خدمة الذكاء الاصطناعي محدودة مؤقتاً، وأرد عليك باستخدام القواعد والسجلات المعتمدة فقط."
        : "AI assistance is temporarily limited, so I am answering from approved rules and records only.",
    );
  }
  if (health.knowledge_retrieval.state !== "operational") {
    notes.push(
      lang === "ar"
        ? "لا يمكنني حالياً التحقق من الأدلة والسياسات، لذلك لن أجيب على أسئلة اللوائح."
        : "I cannot verify policy documents right now, so I will not answer regulation questions.",
    );
  }
  if (health.student_information.state !== "operational") {
    notes.push(
      lang === "ar"
        ? "تعذر التحقق من بياناتك الأكاديمية حالياً، لذلك سأقدم إرشاداً عاماً فقط."
        : "Your academic records could not be verified right now, so I can give general guidance only.",
    );
  }
  if (health.case_management.state !== "operational") {
    notes.push(
      lang === "ar"
        ? "خدمة الحالات غير متاحة؛ سيتم حفظ مسودتك ولن يتم تأكيد أي إرسال."
        : "Case services are unavailable; your draft is kept and no submission will be confirmed.",
    );
  }
  return notes.length ? notes.join(" ") : null;
}
