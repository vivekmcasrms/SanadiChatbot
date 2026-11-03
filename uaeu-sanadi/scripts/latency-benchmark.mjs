/**
 * Repeatable Assistant latency benchmark.
 *
 * Drives the real streaming endpoint with a real signed-in session, so every
 * number includes routing, record reads, retrieval, model time and streaming.
 * Nothing is mocked. Results are joined back to server telemetry by trace id.
 *
 *   bun scripts/latency-benchmark.mjs [--repeat 1] [--out /tmp/bench/run.json]
 */
const BASE = process.env.BENCH_BASE ?? "http://localhost:8080";
const TOKEN = process.env.LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN;
if (!TOKEN) {
  console.error("No session token available (LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN).");
  process.exit(1);
}

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const REPEAT = Number(arg("repeat", "1"));
const OUT = arg("out", "/tmp/bench/run.json");
/**
 * Optional A/B pin: run the identical scenario set on one named engine.
 * Accepted only for administrator sessions and never changes agents, tools
 * or retrieval — only which model writes the wording.
 */
const PROVIDER = arg("provider", null);
const MODEL = arg("model", null);

/** Scenario set: 10 per class per language = 60 turns per repetition. */
const SCENARIOS = [
  // --- fast path / deterministic student data -------------------------
  ["fast", "en", "Who am I?"],
  ["fast", "en", "How many credits have I completed?"],
  ["fast", "en", "What is my GPA?"],
  ["fast", "en", "What is my academic standing?"],
  ["fast", "en", "What courses am I taking this semester?"],
  ["fast", "en", "Do I have any holds on my record?"],
  ["fast", "en", "Can I register for next semester?"],
  ["fast", "en", "What is my ATS score?"],
  ["fast", "en", "Show me my open requests"],
  ["fast", "en", "What is my graduation progress?"],
  ["fast", "ar", "ما هو معدلي التراكمي؟"],
  ["fast", "ar", "كم عدد الساعات التي أنهيتها؟"],
  ["fast", "ar", "هل لدي أي قيود على سجلي؟"],
  ["fast", "ar", "هل يمكنني التسجيل للفصل القادم؟"],
  ["fast", "ar", "ما هي مقرراتي الحالية؟"],
  ["fast", "ar", "ما هو تقدمي نحو التخرج؟"],
  ["fast", "ar", "ما هي طلباتي المفتوحة؟"],
  ["fast", "ar", "ما هو وضعي الأكاديمي؟"],
  ["fast", "ar", "ما هي درجة توافق سيرتي الذاتية؟"],
  ["fast", "ar", "من أنا في سجل الجامعة؟"],
  // --- RAG / policy knowledge -----------------------------------------
  ["rag", "en", "What is the late withdrawal policy?"],
  ["rag", "en", "How many colleges does UAEU have?"],
  ["rag", "en", "What are the add and drop rules?"],
  ["rag", "en", "What is the maximum credit load per semester?"],
  ["rag", "en", "What is the policy on academic probation?"],
  ["rag", "en", "What are the requirements for an enrollment letter?"],
  ["rag", "en", "What is the attendance policy?"],
  ["rag", "en", "How does grade appeal work?"],
  ["rag", "en", "What are the library borrowing rules?"],
  ["rag", "en", "What is the policy on incomplete grades?"],
  ["rag", "ar", "ما هي سياسة الانسحاب المتأخر؟"],
  ["rag", "ar", "كم عدد كليات جامعة الإمارات؟"],
  ["rag", "ar", "ما هي قواعد الحذف والإضافة؟"],
  ["rag", "ar", "ما الحد الأقصى للساعات المعتمدة في الفصل؟"],
  ["rag", "ar", "ما هي سياسة الإنذار الأكاديمي؟"],
  ["rag", "ar", "ما هي شروط إصدار إفادة قيد؟"],
  ["rag", "ar", "ما هي سياسة الحضور والغياب؟"],
  ["rag", "ar", "كيف يتم التظلم على الدرجة؟"],
  ["rag", "ar", "ما هي قواعد الاستعارة من المكتبة؟"],
  ["rag", "ar", "ما هي سياسة الدرجات غير المكتملة؟"],
  // --- agentic workflows ----------------------------------------------
  ["agentic", "en", "I want to book a career counselling appointment"],
  ["agentic", "en", "Find me a good book on deep learning"],
  ["agentic", "en", "Where can I get the textbook for my course?"],
  ["agentic", "en", "I need an enrollment letter for my embassy"],
  ["agentic", "en", "I lost my wallet on campus"],
  ["agentic", "en", "Which jobs match my CV?"],
  ["agentic", "en", "What skills am I missing for a data scientist role?"],
  ["agentic", "en", "I can't register, can you find out why?"],
  ["agentic", "en", "It would be helpful if the library opened earlier"],
  ["agentic", "en", "The cafeteria queue is always too long, I want to complain"],
  ["agentic", "ar", "أريد حجز موعد مع مرشد أكاديمي"],
  ["agentic", "ar", "ابحث لي عن كتاب في الذكاء الاصطناعي"],
  ["agentic", "ar", "أين أجد الكتاب المقرر لمقرراتي؟"],
  ["agentic", "ar", "أحتاج إفادة قيد للسفارة"],
  ["agentic", "ar", "فقدت محفظتي في الحرم الجامعي"],
  ["agentic", "ar", "ما الوظائف التي تناسب سيرتي الذاتية؟"],
  ["agentic", "ar", "ما المهارات التي تنقصني؟"],
  ["agentic", "ar", "لا أستطيع التسجيل، ما السبب؟"],
  ["agentic", "ar", "أقترح تمديد ساعات عمل المكتبة"],
  ["agentic", "ar", "لدي شكوى بخصوص ازدحام المواصلات"],
];

async function runTurn(message, lang) {
  const started = Date.now();
  let firstVisibleMs = null;
  let traceId = null;
  let chunks = 0;
  let ok = true;
  let errorText = null;
  let answer = "";
  let citations = 0;
  let tools = [];
  try {
    const res = await fetch(`${BASE}/api/chat/stream`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({
        message,
        lang,
        conversationId: null,
        ...(PROVIDER && MODEL ? { benchmarkProvider: PROVIDER, benchmarkModel: MODEL } : {}),
      }),
    });
    if (!res.ok || !res.body) {
      return { ok: false, totalMs: Date.now() - started, firstVisibleMs, traceId, chunks, errorText: `http_${res.status}` };
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const raw = buffer.slice(0, idx).replace(/^data: /, "");
        buffer = buffer.slice(idx + 2);
        if (!raw.trim()) continue;
        let event;
        try {
          event = JSON.parse(raw);
        } catch {
          continue;
        }
        if (event.type === "accepted") traceId = event.traceId;
        if (event.type === "token") {
          chunks += 1;
          if (firstVisibleMs == null) firstVisibleMs = Date.now() - started;
        }
        if (event.type === "final") {
          if (firstVisibleMs == null) firstVisibleMs = Date.now() - started;
          // Kept so the answers of two engines can be compared for
          // correctness and grounding, not only for speed.
          answer = String(event.response?.answer ?? "").slice(0, 1200);
          citations = (event.response?.citations ?? []).length;
          tools = event.response?.toolsUsed ?? [];
        }
        if (event.type === "error") {
          ok = false;
          errorText = event.message;
        }
      }
    }
  } catch (e) {
    ok = false;
    errorText = e instanceof Error ? e.message : "network_error";
  }
  return { ok, totalMs: Date.now() - started, firstVisibleMs, traceId, chunks, errorText, answer, citations, tools };
}

/**
 * The production rate limiter allows 15 turns/minute and 5 per 10s. The
 * benchmark paces itself under that ceiling and waits out any 429 so the
 * limiter never contaminates a latency sample.
 */
const PACE_MS = 4200;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
for (let pass = 1; pass <= REPEAT; pass += 1) {
  for (const [cls, lang, message] of SCENARIOS) {
    let r = await runTurn(message, lang);
    let guard = 0;
    while (!r.ok && r.errorText === "http_429" && guard < 5) {
      guard += 1;
      await sleep(15_000);
      r = await runTurn(message, lang);
    }
    results.push({ pass, cls, lang, message, warm: pass > 1, ...r });
    process.stdout.write(
      `${pass}/${REPEAT} ${cls}/${lang} ${String(r.totalMs).padStart(6)}ms first=${r.firstVisibleMs ?? "-"} ${r.ok ? "ok" : `ERR ${r.errorText}`} :: ${message.slice(0, 40)}\n`,
    );
    await sleep(PACE_MS);
  }
}

const pct = (list, p) => {
  if (!list.length) return null;
  const sorted = [...list].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
};
const summary = {};
for (const cls of ["fast", "rag", "agentic"]) {
  const rows = results.filter((r) => r.cls === cls);
  const totals = rows.filter((r) => r.ok).map((r) => r.totalMs);
  const firsts = rows.map((r) => r.firstVisibleMs).filter((v) => typeof v === "number");
  summary[cls] = {
    n: rows.length,
    errors: rows.filter((r) => !r.ok).length,
    p50: pct(totals, 50),
    p95: pct(totals, 95),
    firstVisibleP50: pct(firsts, 50),
    firstVisibleP95: pct(firsts, 95),
  };
}
const all = results.filter((r) => r.ok).map((r) => r.totalMs);
summary.overall = {
  n: results.length,
  errors: results.filter((r) => !r.ok).length,
  p50: pct(all, 50),
  p95: pct(all, 95),
};
await (await import("node:fs/promises")).writeFile(
  OUT,
  JSON.stringify(
    {
      startedAt: new Date().toISOString(),
      engine: PROVIDER && MODEL ? { provider: PROVIDER, model: MODEL } : "configured default",
      summary,
      results,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify(summary, null, 2));
console.log(`\nTrace ids written to ${OUT}`);
