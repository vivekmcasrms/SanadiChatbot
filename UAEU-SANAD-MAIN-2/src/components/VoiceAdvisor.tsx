import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Captions, Mic, PhoneOff, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionConfirmDialog } from "@/components/ActionConfirmDialog";
import { AssistantMarkdown } from "@/components/AssistantMarkdown";
import { IssuedDocumentCard } from "@/components/IssuedDocumentCard";
import { CareerInsightCard } from "@/components/CareerInsightCard";
import { LibraryResultsCard } from "@/components/LibraryResultsCard";
import { CaseResultCard } from "@/components/CaseResultCard";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { voiceRoom } from "@/lib/advisor-room";
import { recordQuestion, VoiceTurns } from "@/lib/advisor-audio";
import { advisorAvailability, introduction, synthesizeReply,
  type AdvisorAvailability, type AdvisorIdentity, type AdvisorLanguage } from "@/lib/advisor-client";
import type { AgentResponse, ProposedAction, ActionReceipt, IssuedDocumentCard as DocumentData } from "@/lib/agent-types";

type State = "ready" | "permission" | "listening" | "transcribing" | "thinking" | "synthesizing" | "speaking";
type ServiceTurn = { response: AgentResponse; language: AdvisorLanguage; showAnswer: boolean };
const labels: Record<State, [string, string]> = {
  ready: ["Ready when you are", "جاهز لسماعك"],
  permission: ["Opening microphone…", "جارٍ فتح الميكروفون…"],
  listening: ["Listening — pause when finished", "أسمعك — توقف قليلاً عند الانتهاء"],
  transcribing: ["Understanding your question…", "جارٍ فهم سؤالك…"],
  thinking: ["Checking your university information…", "جارٍ مراجعة معلومات الجامعة…"],
  synthesizing: ["Preparing your reply…", "جارٍ تجهيز الرد…"],
  speaking: ["Speaking — press the mic to interrupt", "أتحدث — اضغط الميكروفون للمقاطعة"],
};

export function VoiceAdvisor() {
  const { user, loading } = useAuth();
  const { lang } = useI18n();
  const ar = lang === "ar";
  const [agent, setAgent] = useState<AdvisorIdentity>("mira");
  const [state, setState] = useState<State>("ready");
  const [availability, setAvailability] = useState<AdvisorAvailability | null>(null);
  const [error, setError] = useState("");
  const [active, setActive] = useState(false);
  const [muted, setMuted] = useState(false);
  const [captions, setCaptions] = useState(false);
  const [caption, setCaption] = useState("");
  const [captionLanguage, setCaptionLanguage] = useState<AdvisorLanguage>("en");
  const [level, setLevel] = useState(0);
  const [turns, setTurns] = useState<ServiceTurn[]>([]);
  const [proposal, setProposal] = useState<{ action: ProposedAction; turn: ServiceTurn } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [receipts, setReceipts] = useState<{ receipt: ActionReceipt | null; message: string; document?: DocumentData | null }[]>([]);
  const [draft, setDraft] = useState("");
  const audioContext = useRef<AudioContext | null>(null);
  const output = useRef<GainNode | null>(null);
  const source = useRef<AudioBufferSourceNode | null>(null);
  const capture = useRef<{ finish: () => void } | null>(null);
  const generation = useRef(new VoiceTurns());
  const conversation = useRef<string | null>(null);
  const questionLanguage = useRef<AdvisorLanguage>("en");
  const introduced = useRef(new Set<AdvisorIdentity>());
  const sessionStarted = useRef(0);
  const lastActivity = useRef(0);
  const activeRef = useRef(false);
  const actionBusyRef = useRef(false);
  const stateRef = useRef<State>("ready");
  const endRef = useRef<() => void>(() => {});

  function status(next: State) { stateRef.current = next; setState(next); }
  function interrupt() {
    generation.current.cancel();
    try { source.current?.stop(); } catch { /* already ended */ }
    source.current = null;
    capture.current = null;
    setLevel(0);
  }
  function endSession() {
    interrupt();
    activeRef.current = false;
    setActive(false);
    status("ready");
    setCaption("");
    setDraft("");
    conversation.current = null;
    introduced.current.clear();
    void audioContext.current?.close().catch(() => {});
    audioContext.current = null;
    output.current = null;
  }
  endRef.current = endSession;

  useEffect(() => {
    try { if (localStorage.getItem("sanadi-support-agent") === "suhail") setAgent("suhail"); } catch {}
    const hide = () => { if (document.hidden) endRef.current(); };
    const offline = () => {
      endRef.current();
      setError(ar ? "انقطع الاتصال. أعد المحاولة عند عودة الشبكة." : "Connection lost. Reconnect and try again.");
    };
    const leave = () => endRef.current();
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", leave);
    window.addEventListener("offline", offline);
    window.addEventListener("sanadi-signing-out", leave);
    return () => {
      endRef.current();
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", leave);
      window.removeEventListener("offline", offline);
      window.removeEventListener("sanadi-signing-out", leave);
    };
  }, []);

  async function checkAvailability() {
    setError("");
    try { setAvailability(await advisorAvailability()); }
    catch { setError(ar ? "تعذر الاتصال بخدمة الصوت." : "Could not reach the voice service."); }
  }
  useEffect(() => {
    if (user) void checkAvailability();
    else endRef.current();
  }, [user?.id]);
  useEffect(() => {
    if (!availability) return;
    const timer = setInterval(() => {
      if (!activeRef.current) return;
      const now = Date.now();
      if (now - sessionStarted.current > availability.sessionSeconds * 1000 ||
        (!actionBusyRef.current && stateRef.current === "ready" && now - lastActivity.current > availability.idleSeconds * 1000))
        endRef.current();
    }, 1000);
    return () => clearInterval(timer);
  }, [availability]);

  async function prepareAudio(turn: AbortController) {
    if (!audioContext.current || audioContext.current.state === "closed") {
      audioContext.current = new AudioContext();
      output.current = audioContext.current.createGain();
      output.current.gain.value = muted ? 0 : 1;
      output.current.connect(audioContext.current.destination);
    }
    const context = audioContext.current;
    await context.resume();
    if (!generation.current.isCurrent(turn)) throw new DOMException("Interrupted", "AbortError");
    if (!activeRef.current) {
      sessionStarted.current = Date.now();
      activeRef.current = true;
      setActive(true);
    }
    lastActivity.current = Date.now();
    return context;
  }

  async function playReply(text: string, language: AdvisorLanguage, identity: AdvisorIdentity,
    turn: AbortController, addIntroduction: boolean) {
    const spoken = (addIntroduction && !introduced.current.has(identity) ? introduction(identity, language) : "") + text;
    if (!spoken.trim()) return;
    setCaption(spoken); setCaptionLanguage(language);
    status("synthesizing");
    const bytes = await synthesizeReply(spoken, language, identity, turn.signal);
    await playAudio(bytes, spoken, language, identity, turn);
  }

  async function playAudio(bytes: ArrayBuffer, spoken: string, language: AdvisorLanguage,
    identity: AdvisorIdentity, turn: AbortController) {
    if (!generation.current.isCurrent(turn)) return;
    setCaption(spoken); setCaptionLanguage(language);
    const context = audioContext.current;
    if (!context || context.state === "closed") return;
    const buffer = await context.decodeAudioData(bytes);
    if (!generation.current.isCurrent(turn)) return;
    if (context.state !== "running") throw new Error("audio_paused");
    await new Promise<void>((resolve, reject) => {
      const node = context.createBufferSource();
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      const samples = new Float32Array(analyser.fftSize);
      node.buffer = buffer;
      node.connect(analyser); analyser.connect(output.current!);
      source.current = node;
      let frame = 0;
      const meter = () => {
        analyser.getFloatTimeDomainData(samples);
        setLevel(Math.min(1, Math.sqrt(samples.reduce((sum, n) => sum + n * n, 0) / samples.length) * 5));
        frame = requestAnimationFrame(meter);
      };
      const cleanup = () => {
        cancelAnimationFrame(frame);
        turn.signal.removeEventListener("abort", abort);
        node.disconnect(); analyser.disconnect();
        if (source.current === node) source.current = null;
      };
      const abort = () => {
        node.onended = null;
        try { node.stop(); } catch {}
        cleanup();
        reject(new DOMException("Interrupted", "AbortError"));
      };
      node.onended = () => { cleanup(); resolve(); };
      turn.signal.addEventListener("abort", abort, { once: true });
      if (turn.signal.aborted) { abort(); return; }
      node.start();
      introduced.current.add(identity);
      status("speaking");
      meter();
    });
  }

  function failure(error: unknown, turn: AbortController) {
    if (!generation.current.isCurrent(turn)) return;
    // A network/provider failure must also stop the sentence already playing.
    interrupt();
    status("ready");
    lastActivity.current = Date.now();
    const name = (error as Error)?.name;
    const code = (error as Error)?.message;
    setError(name === "NotAllowedError"
      ? (ar ? "اسمح بالميكروفون في إعدادات المتصفح ثم حاول مجدداً." : "Allow microphone access in your browser settings, then try again.")
      : code === "private_voice_not_configured"
        ? (ar ? "خدمة الصوت الخاصة غير مهيأة بعد." : "The private voice service is not configured yet.")
        : code === "stt_not_configured"
          ? (ar ? "خدمة التعرف على الكلام غير مهيأة على الخادم. يرجى التواصل مع المسؤول." : "Speech recognition is not configured on the server. Please contact the administrator.")
        : code === "speak_arabic_or_english"
          ? (ar ? "تحدث بالعربية أو الإنجليزية ثم حاول مجدداً." : "Please speak in Arabic or English and try again.")
        : code?.startsWith("voice_missing_")
          ? (ar ? `لا يوجد صوت ${agent === "mira" ? "نسائي" : "رجالي"} للغة المطلوبة على خادم الصوت. يرجى التواصل مع المسؤول لتوفير الصوت المناسب.`
            : `No matching ${agent === "mira" ? "female" : "male"} ${code.endsWith("_ar") ? "Arabic" : "English"} voice is available on the speech server. An administrator needs to provide that voice.`)
        : code === "audio_paused"
          ? (ar ? "أوقف المتصفح الصوت. اضغط الميكروفون للمتابعة." : "Your browser paused audio. Press the microphone to continue.")
          : (ar ? "تعذر إكمال الرد الصوتي. تحقق من الاتصال وحاول مجدداً." : "The voice turn could not finish. Check your connection and try again."));
  }
  function finish(turn: AbortController) {
    if (!generation.current.isCurrent(turn)) return;
    status("ready"); setLevel(0); lastActivity.current = Date.now();
  }

  async function ask(question: string | Blob, identity: AdvisorIdentity, turn: AbortController) {
    status("thinking");
    let transcript = typeof question === "string" ? question : "";
    await voiceRoom({
      agent: identity, conversationId: conversation.current, introduce: !introduced.current.has(identity),
      language: lang,
      ...(typeof question === "string" ? { message: question } : { audio: question }),
    }, {
      stage: next => { if (generation.current.isCurrent(turn)) status(next); },
      transcript: (text, language) => {
        if (!generation.current.isCurrent(turn)) return;
        questionLanguage.current = language;
        transcript = text; setCaption(text); setCaptionLanguage(language);
      },
      result: (response, language) => {
        if (!generation.current.isCurrent(turn)) return;
        conversation.current = response.conversationId;
        setTurns(previous => [...previous, {
          response, language, showAnswer: /\b(show|display|write)\b|اعرض|أظهر|اظهر|اكتب/i.test(transcript),
        }].slice(-20));
      },
      audio: (bytes, text, language) => playAudio(bytes, text, language, identity, turn),
    }, turn.signal);
  }

  async function microphone() {
    if (actionBusy || !availability?.available) return;
    if (stateRef.current === "listening") { capture.current?.finish(); return; }
    interrupt(); // Stop outgoing audio before acquiring any microphone stream.
    const turn = generation.current.begin();
    const identity = agent;
    setError(""); setCaption(""); status("permission");
    try {
      const context = await prepareAudio(turn);
      if (!generation.current.isCurrent(turn)) return;
      await new Promise(resolve => setTimeout(resolve, 180)); // Speaker echo tail.
      if (!generation.current.isCurrent(turn)) return;
      const recording = recordQuestion(context, turn.signal, setLevel, () => status("listening"));
      capture.current = recording;
      const audio = await recording.audio;
      if (!generation.current.isCurrent(turn)) return;
      capture.current = null;
      if (!audio) {
        setError(ar ? "لم أسمع سؤالاً واضحاً. اضغط الميكروفون وحاول مجدداً." : "I didn't hear a clear question. Press Speak and try again.");
        return;
      }
      status("transcribing");
      await ask(audio, identity, turn);
    } catch (error) { failure(error, turn); }
    finally { finish(turn); }
  }

  async function cardQuestion(question: string) {
    if (actionBusy) return;
    interrupt();
    const turn = generation.current.begin();
    setError("");
    try {
      await prepareAudio(turn);
      if (!generation.current.isCurrent(turn)) return;
      await ask(question, agent, turn);
    } catch (error) { failure(error, turn); }
    finally { finish(turn); }
  }

  async function confirmed(result: { receipt: ActionReceipt | null; message: string; document?: DocumentData | null }) {
    setReceipts(previous => [...previous, result]);
    // Called only by the existing dialog AFTER executeConfirmedAction resolves.
    if (!activeRef.current) return;
    interrupt();
    const turn = generation.current.begin();
    const language = proposal?.turn.language ?? questionLanguage.current;
    try { await playReply(result.message, language, agent, turn, false); }
    catch (error) { failure(error, turn); }
    finally { finish(turn); }
  }

  const visibleTurns = turns.filter(({ response: r, showAnswer }) =>
    showAnswer || r.proposedActions?.length || r.receipt || r.issuedDocument || r.careerInsight || r.libraryResults || r.caseResult);
  const name = agent === "mira" ? (ar ? "ميرا" : "Meera") : (ar ? "سهيل" : "Suhail");
  const portrait = agent === "mira" ? "/mira-support-agent.png" : "/suhail-support-agent.png";

  return <main dir={ar ? "rtl" : "ltr"} className="min-h-dvh bg-gradient-to-b from-primary/5 to-background px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-foreground">
    <header className="mx-auto flex max-w-5xl items-center justify-between gap-3 py-5 landscape:max-lg:py-3">
      <Link to="/assistant" className="inline-flex items-center gap-2 text-sm"><ArrowLeft size={17} />{ar ? "المحادثة" : "Chat"}</Link>
      <span className="text-xs text-muted-foreground">{state === "listening" ? (ar ? "الميكروفون مفتوح" : "Microphone on") : (ar ? "الميكروفون مغلق" : "Microphone off")}</span>
    </header>
    <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section className={`flex flex-col items-center rounded-3xl border bg-card p-5 text-center shadow-sm sm:p-8 landscape:max-lg:grid landscape:max-lg:grid-cols-2 landscape:max-lg:gap-x-4 landscape:max-lg:p-4 ${!visibleTurns.length && !receipts.length ? "lg:col-span-2" : ""}`}>
        <h1 className="text-xl font-semibold landscape:max-lg:col-span-2">{ar ? "مستشارك الجامعي" : "Your university advisor"}</h1>
        <p className="mt-1 text-sm text-muted-foreground landscape:max-lg:col-span-2">{ar ? "تحدث بالعربية أو الإنجليزية" : "Speak in Arabic or English"}</p>
        <div className="relative my-7 rounded-full border-4 border-primary/20 p-1 landscape:max-lg:col-start-1 landscape:max-lg:row-start-3 landscape:max-lg:row-span-4 landscape:max-lg:my-2 landscape:max-lg:justify-self-center"
          style={{ boxShadow: `0 0 0 ${Math.round(level * 16)}px hsl(var(--primary) / 0.12)` }}>
          <img src={portrait} alt={name} className="size-44 rounded-full object-cover sm:size-60 landscape:max-h-[38dvh] landscape:max-w-[38dvh]" />
        </div>
        <div className="flex rounded-full border p-1 landscape:max-lg:col-start-2 landscape:max-lg:mt-2 landscape:max-lg:justify-self-center" role="group" aria-label={ar ? "اختر المستشار" : "Choose advisor"}>
          {(["mira", "suhail"] as const).map(identity => <button type="button" key={identity} disabled={actionBusy}
            aria-pressed={identity === agent}
            onClick={() => {
              interrupt(); status("ready"); setCaption(""); setAgent(identity);
              try { localStorage.setItem("sanadi-support-agent", identity); } catch {}
            }}
            className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm ${identity === agent ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
            <img src={identity === "mira" ? "/mira-support-agent.png" : "/suhail-support-agent.png"} alt="" className="size-8 rounded-full" />
            {identity === "mira" ? (ar ? "ميرا" : "Meera") : (ar ? "سهيل" : "Suhail")}
          </button>)}
        </div>
        <p role="status" aria-live="polite" className="mt-5 min-h-6 text-sm landscape:max-lg:col-start-2 landscape:max-lg:mt-2">{labels[state][ar ? 1 : 0]}</p>
        <div className="mt-5 flex flex-wrap justify-center gap-3 landscape:max-lg:col-start-2 landscape:max-lg:mt-2">
          <Button type="button" disabled={!user || !availability?.available || actionBusy || state === "permission"}
            onClick={() => void microphone()} className="h-14 gap-2 rounded-full px-6">
            <Mic size={21} />{state === "listening" ? (ar ? "انتهيت" : "Done") : (ar ? "تحدث" : "Speak")}
          </Button>
          <Button type="button" variant="outline" className="size-14 rounded-full" aria-pressed={muted}
            aria-label={muted ? (ar ? "تشغيل الصوت" : "Unmute reply") : (ar ? "كتم الصوت" : "Mute reply")}
            onClick={() => {
              const next = !muted; setMuted(next);
              if (output.current) output.current.gain.value = next ? 0 : 1;
            }}>
            {muted ? <VolumeX /> : <Volume2 />}
          </Button>
          <Button type="button" variant={captions ? "secondary" : "outline"} className="size-14 rounded-full"
            aria-label={ar ? "النص المصاحب" : "Captions"} aria-pressed={captions} onClick={() => setCaptions(!captions)}><Captions /></Button>
          {active && <Button type="button" variant="destructive" className="size-14 rounded-full" onClick={endSession}
            aria-label={ar ? "إنهاء المحادثة" : "End conversation"}><PhoneOff /></Button>}
        </div>
        <p className="mt-4 max-w-sm text-xs leading-5 text-muted-foreground landscape:max-lg:col-start-2 landscape:max-lg:mt-2">{ar
          ? "اضغط الميكروفون لكل سؤال. يمكنك مقاطعة الرد بالضغط عليه مجدداً. لا يتم الاستماع في الخلفية."
          : "Press the microphone for each question. Press it during a reply to interrupt. No background listening."}</p>
        {captions && caption && <p dir={captionLanguage === "ar" ? "rtl" : "ltr"} className="mt-5 w-full rounded-xl border bg-background p-4 text-start text-sm landscape:max-lg:col-span-2" aria-live="polite">{caption}</p>}
        {!loading && !user && <Link to="/auth" className="mt-4 font-medium text-primary">{ar ? "سجّل الدخول للمتابعة" : "Sign in to continue"}</Link>}
        {user && availability && !availability.available && <p role="status" className="mt-4 max-w-md text-sm text-muted-foreground">{ar
          ? "المحادثة الصوتية معطلة حالياً. يمكنك متابعة استخدام المحادثة النصية."
          : "Voice conversation is currently disabled. Text chat is still available."}</p>}
        {error && <div role="alert" className="mt-4 max-w-md rounded-xl border border-destructive/30 p-4 text-sm text-destructive">
          {error}<Button type="button" variant="link" onClick={() => void checkAvailability()}>{ar ? "إعادة المحاولة" : "Retry connection"}</Button>
        </div>}
      </section>
      {(visibleTurns.length > 0 || receipts.length > 0) && <section className="min-w-0 space-y-4" aria-label={ar ? "الطلبات والمستندات" : "Requests and documents"}>
        <h2 className="text-lg font-semibold">{ar ? "خدماتك" : "Your services"}</h2>
        {visibleTurns.map((turn, index) => <div key={turn.response.messageId ?? index} dir={turn.language === "ar" ? "rtl" : "ltr"} className="space-y-3">
          {turn.showAnswer && <div className="rounded-xl border bg-card p-4"><AssistantMarkdown>{turn.response.answer}</AssistantMarkdown></div>}
          {turn.response.proposedActions?.map(action => <div key={action.key} className="rounded-xl border bg-card p-4">
            <h3 className="font-medium">{turn.language === "ar" ? action.labelAr : action.labelEn}</h3>
            {Boolean(action.args?.["title"]) && <p className="mt-2 text-sm">{String(action.args?.["title"])}</p>}
            {Boolean(action.args?.["description"]) && <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{String(action.args?.["description"])}</p>}
            <Button type="button" variant="outline" className="mt-3" disabled={actionBusy} onClick={() => {
              interrupt(); status("ready"); lastActivity.current = Date.now(); setProposal({ action, turn });
            }}>{ar ? "مراجعة وموافقة" : "Review and approve"}</Button>
          </div>)}
          {turn.response.receipt && <div className="rounded-xl border bg-card p-4 text-sm">
            {ar ? "مرجع الطلب: " : "Request reference: "}{turn.response.receipt.referenceNumber ?? turn.response.receipt.receiptNumber}
          </div>}
          {turn.response.issuedDocument && <IssuedDocumentCard document={turn.response.issuedDocument} />}
          {turn.response.careerInsight && <CareerInsightCard insight={turn.response.careerInsight} onAsk={q => void cardQuestion(q)} />}
          {turn.response.libraryResults && <LibraryResultsCard card={turn.response.libraryResults} lang={turn.language} onAsk={q => void cardQuestion(q)} />}
          {turn.response.caseResult && <CaseResultCard card={turn.response.caseResult} lang={turn.language} onDraft={setDraft} />}
        </div>)}
        {draft && <form className="rounded-xl border bg-card p-4" onSubmit={e => { e.preventDefault(); void cardQuestion(draft); setDraft(""); }}>
          <label className="text-sm">{ar ? "تفاصيل المتابعة" : "Follow-up details"}<textarea value={draft} onChange={e => setDraft(e.target.value)} className="mt-2 min-h-24 w-full rounded border p-2" /></label>
          <Button disabled={actionBusy} type="submit">{ar ? "إرسال" : "Send"}</Button>
        </form>}
        {receipts.map((result, index) => <div key={index} className="rounded-xl border bg-card p-4">
          <p className="text-sm">{result.message}</p>
          {result.receipt && <p className="mt-2 font-medium">{result.receipt.referenceNumber ?? result.receipt.receiptNumber}</p>}
          {result.document && <IssuedDocumentCard document={result.document} />}
        </div>)}
      </section>}
    </div>
    <ActionConfirmDialog action={proposal?.action ?? null} open={proposal !== null}
      language={proposal?.turn.language ?? questionLanguage.current}
      conversationId={proposal?.turn.response.conversationId ?? null} messageId={proposal?.turn.response.messageId ?? null}
      onBusyChange={busy => { actionBusyRef.current = busy; setActionBusy(busy); lastActivity.current = Date.now(); }}
      onOpenChange={open => { if (!open) setProposal(null); }}
      onConfirmed={(_action, result) => { void confirmed(result); }} />
  </main>;
}
