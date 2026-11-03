/**
 * Voice-only greeting and turn understanding.
 * The text chatbot and its business APIs are not used for greeting-only speech.
 */

export type VoiceAgentId = "mira" | "suhail";
export type VoiceLanguage = "en" | "ar";

export type VoiceIntent =
  | "GREETING_ONLY"
  | "GREETING_WITH_QUESTION"
  | "QUESTION_ONLY"
  | "MULTIPLE_QUESTIONS"
  | "THANK_YOU"
  | "FAREWELL"
  | "SMALL_TALK"
  | "CLARIFICATION"
  | "FOLLOW_UP"
  | "UNCERTAIN";

export type VoiceClassification = {
  intent: VoiceIntent;
  language: VoiceLanguage | "uncertain";
  greeting: boolean;
  actionable: boolean;
  requestCount: number;
  original: string;
  asksWellbeing: boolean;
  dayPart: "morning" | "afternoon" | "evening" | null;
  callBusiness: boolean;
};

export type VoiceReplyPlan = {
  speech: string;
  language: VoiceLanguage;
  callBusiness: boolean;
  keepListening: boolean;
  markIntroduced: boolean;
};

const ARABIZI = [
  "assalamu alaikum", "assalamu alaykum", "assalamo alaikum", "assalam alaikum", "asalam alaikum",
  "asalamu alaikum", "salamu alaikum", "salaam alaikum", "salam alaikum", "salam alaykum", "salamualaikum",
  "al salam alaikum", "wa alaikum assalam", "wa alaykum assalam", "wa alaikum salam", "alaikum salam",
  "sabah al khair", "sabah alkhair", "sabah el khair", "sabahalkhair", "sabah al noor", "sabah alnoor",
  "masa al khair", "masaa al khair", "masa alkhair", "masa el khair", "masa al noor", "masa alnoor",
  "ahlan wa sahlan", "ya hala", "hala wallah", "ya marhaba", "marhabtain", "marhabteen", "marhabah", "marhaba",
  "hayak allah", "hayyak allah", "hayyak", "hayak", "ahlan", "hala", "holla",
  "kaif halak", "kaifa haluk", "kayf halak", "kaif halik", "kif halak", "keef halak", "keef halik",
  "shlonich", "shlonik", "shlonkum", "shlonak", "shlonch", "shakhbarak", "shakhbarik", "shakhabarak",
  "shu akhbarak", "shu akhbarik", "shu halak", "keefak", "kifak", "kefak", "salam", "salaam",
];

// Single words an English recognizer often produces for Arabic greetings. Matched within one
// edit (two for longer words), also across two adjacent tokens ("mar haba", "sabah alkhair").
const ARABIZI_FUZZY = [
  "marhaba", "marhabtain", "alaikum", "alaykum", "assalamu", "salamalaikum", "shlonak", "shlonich", "shakhbarak",
  "keefak", "kifak", "hayyak", "akhbarak", "kaifhalak", "sabah", "alkhair", "ahlan", "shukran", "yahala",
];

// Function words the English recognizer also emits when it mishears Arabic ("a salami come",
// "my habit"). Hearing them does not show that the student spoke English.
const EN_FUNCTION_WORDS = new Set([
  "a", "an", "the", "i", "my", "me", "you", "it", "is", "am", "are", "to", "of", "in", "on", "at",
  "and", "or", "so", "do", "be", "we", "he", "oh", "um", "uh", "that", "this", "was",
]);

const EN_GREETINGS = [
  "good to see you again", "nice to meet you", "glad to meet you", "hope you're doing well",
  "hope you are doing well", "i hope you're having a good day", "i hope you are having a good day",
  "how's your day going", "how is your day going", "how are you doing", "how are you",
  "how's it going", "how is it going", "how have you been", "how's everything", "hows everything",
  "how are things", "what's going on", "whats going on", "what's new", "whats new", "what's up", "whats up",
  "are you doing well", "everything good", "is anyone there", "can you hear me", "are you available",
  "good morning", "good afternoon", "good evening", "good day", "hello again", "hello there",
  "hi there", "hey there", "hey buddy", "hi my friend", "good morning",
];

const EN_TOKENS = ["hi", "hello", "hey", "heya", "yo", "hiya", "howdy", "greetings", "morning", "evening"];

const AR_GREETINGS = [
  "السلام عليكم ورحمة الله وبركاته", "السلام عليكم ورحمة الله", "وعليكم السلام ورحمة الله وبركاته",
  "وعليكم السلام ورحمة الله", "السلام عليكم", "وعليكم السلام", "سلام عليكم", "السلام", "سلام",
  "اهلا وسهلا", "اهلا بك", "اهلا بكم", "مرحبا بك", "مرحبا بكم", "يا هلا والله", "يا هلا", "يا مرحبا",
  "هلا والله", "هلا وغلا", "هلا بك", "اهلين", "حياك الله", "حياكم الله", "حياك", "حياكم", "تحية طيبة", "تحيه طيبه",
  "صباح الخير", "صباح النور", "صباح الورد", "صباح الفل", "صباحو", "مساء الخير", "مساء النور", "مساء الورد",
  "مسا الخير", "مسا النور", "مساء الفل",
  "كيف حالك", "كيف حالكم", "كيف الحال", "كيف حالج", "شو حالك", "شو حالج", "شو اخبارك", "شو اخبارج", "اخبارك", "اخبارج",
  "كيف الامور", "كيف الاحوال", "كيف يومك", "كيف صحتك", "كيف الصحة", "كيف الصحه", "انت بخير", "انتي بخير",
  "شو مسوية", "شو مسوي", "شو مسويه", "عساكم بخير", "عساك بخير", "عساج بخير", "طمني عنك", "طمنيني عنك",
  "شحالج", "شحالك", "شحالكم", "شخبارك", "شخبارج", "شعلومك", "شعلومج", "علومك", "علومج",
  "مرحبتين", "مرحبا", "اهلا", "هلا", "هاي", "هلو", "كيفك", "كيفج",
];

const VAGUE = [
  "i need some help", "i need help", "could you assist me", "can you assist me", "can you help me",
  "could you help me", "i have a question", "ممكن تساعدني", "ممكن اسألك", "عندي سؤال", "عندي استفسار",
];

const SERVICE_GROUPS = [
  ["enrolment letter", "enrollment letter", "enrolment", "enrollment", "افادة تسجيل", "افاده تسجيل", "افادة"],
  ["attendance", "حضور"],
  ["textbook", "كتاب"],
  ["class schedule", "my class", "schedule", "timetable", "جدول"],
  ["gpa", "grade", "درجات"],
  ["transcript", "registration", "register", "تسجيل"],
  ["library", "مكتبة"],
  ["appointment", "موعد"],
  ["complaint", "شكوى"],
  ["suggestion", "اقتراح"],
  ["housing", "سكن"],
  ["scholarship"],
  ["course", "مقرر", "مادة"],
  ["fees", "tuition", "رسوم"],
];

const THANKS = ["thank you very much", "thank you", "thanks", "شكرا لك", "شكرا", "مشكور", "تسلم", "يعطيك العافية"];
const FAREWELL = ["good night", "goodbye", "good bye", "see you", "that's all", "that is all", "bye", "مع السلامة", "الى اللقاء", "باي"];
const FOLLOW = ["i have another question", "another question", "one more thing", "سؤال ثاني", "سؤال اخر", "عندي سؤال ثاني"];

function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = i - 1;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const next = a[i - 1] === b[j - 1] ? prev : Math.min(prev, row[j - 1] ?? 0, row[j] ?? 0) + 1;
      prev = row[j] ?? 0;
      row[j] = next;
    }
  }
  return row[b.length] ?? 0;
}

export function normalizeVoiceText(text: string): string {
  let value = text.trim().toLowerCase();
  value = value.replace(/[\u064B-\u0652\u0640]/g, "");
  value = value.replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه");
  value = value.replace(/[’']/g, "");
  value = value.replace(/[^\p{L}\p{N}\s]/gu, " ");
  return value.replace(/\s+/g, " ").trim();
}

function fuzzyArabizi(text: string): boolean {
  const tokens = text.split(" ").filter(Boolean);
  const joined = tokens.slice(1).map((token, index) => `${tokens[index]}${token}`);
  return [...tokens, ...joined].some((token) =>
    token.length >= 5 && ARABIZI_FUZZY.some((known) =>
      Math.abs(known.length - token.length) <= 1 && levenshtein(token, known) <= (known.length >= 7 ? 2 : 1)),
  );
}

function hasArabizi(text: string): boolean {
  return ARABIZI.some((phrase) => text.includes(phrase)) || fuzzyArabizi(text);
}

export function detectVoiceLanguage(text: string, previous: VoiceLanguage | null): VoiceLanguage | "uncertain" {
  const arabic = (text.match(/[\u0600-\u06FF]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  const normalized = normalizeVoiceText(text);
  const arabizi = hasArabizi(normalized);
  if (arabic > 0 && latin === 0) return "ar";
  if (arabizi && arabic >= latin) return "ar";
  if (arabizi && arabic === 0) return "ar";
  if (arabic > 0 && latin > 0) return arabic >= latin || arabizi ? "ar" : "en";
  if (latin > 0) return "en";
  return previous ?? "uncertain";
}

function stripPhrases(text: string, phrases: string[]): { text: string; hit: boolean } {
  let value = ` ${text} `;
  let hit = false;
  const ordered = phrases.map((phrase) => normalizeVoiceText(phrase)).sort((a, b) => b.length - a.length);
  for (const phrase of ordered) {
    if (!phrase) continue;
    const pattern = new RegExp(` ${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} `, "g");
    if (pattern.test(value)) {
      hit = true;
      value = value.replace(pattern, " ");
    }
  }
  return { text: value.replace(/\s+/g, " ").trim(), hit };
}

function fuzzyGreeting(text: string): boolean {
  return text.split(" ").some((token) => {
    if (token.length < 4 || token.length > 12) return false;
    return EN_TOKENS.some((known) => known.length >= 4 && levenshtein(token, known) === 1);
  });
}

const WELLBEING = [
  "how are you doing today", "how are you doing", "how are you", "how are u", "how r you", "how r u",
  "howre you", "how you doing", "hows it going", "how is it going", "how have you been",
  "hows everything", "how is everything", "how are things", "whats up", "whats new", "whats going on",
  "hows your day going", "how is your day going", "are you doing well", "are you ok", "are you okay",
  "you good", "everything good",
];

const AGENT_IDENTITY = [
  "who are you", "who re you", "what is your name", "whats your name", "what do you do",
  "are you a robot", "are you a bot", "are you an ai", "are you ai", "are you human",
  "من انت", "مين انت", "ما اسمك", "شو اسمك",
];

const SOCIAL_FILLER = [
  "today", "doing", "well", "there", "friend", "buddy", "very", "much", "now", "just", "really",
  "good", "fine", "ok", "okay", "alright", "too", "please", "mira", "meera", "suhail", "sanadi",
  "ميرا", "سهيل", "سندي", "ya", "يا", "اليوم", "الحين", "والله", "طيب", "تمام", "زين", "عزيزي", "عزيزتي", "صديقي",
];

function serviceHits(text: string): number {
  return SERVICE_GROUPS.filter((group) => group.some((phrase) => text.includes(phrase))).length;
}

/** Greeting and wellbeing only. Student-record questions such as "what is my name" stay actionable. */
export function isVoiceSmallTalk(text: string): boolean {
  const normalized = normalizeVoiceText(text);
  if (!normalized) return false;
  if (/\b(my name|my gpa|my grade|my profile|my details|my information|who am i|who i am|student id|student number|اسمي|من انا)\b/.test(normalized))
    return false;
  if (serviceHits(normalized) > 0) return false;
  let working = normalized;
  for (const phrases of [AR_GREETINGS, EN_GREETINGS, EN_TOKENS, ARABIZI, WELLBEING, AGENT_IDENTITY, SOCIAL_FILLER]) {
    working = stripPhrases(working, phrases).text;
  }
  return working.length === 0;
}

function containsAny(text: string, phrases: string[]): boolean {
  return phrases.some((phrase) => {
    const normalized = normalizeVoiceText(phrase);
    return normalized.length > 0 && (text === normalized || text.includes(normalized));
  });
}

export function studentGivenName(fullName: string | null | undefined): string | null {
  const trimmed = fullName?.trim() ?? "";
  if (!trimmed || trimmed.includes("@")) return null;
  const first = trimmed.split(/\s+/)[0] ?? "";
  if (first.length < 2 || /\d/.test(first)) return null;
  return first;
}

export function classifyVoiceTurn(text: string, previous: VoiceLanguage | null = null): VoiceClassification {
  const original = text.trim();
  const language = detectVoiceLanguage(original, previous);
  const normalized = normalizeVoiceText(original);
  const base = {
    language,
    original,
    asksWellbeing: /how are you|how are u|how r you|howre you|hows it going|كيف حال|كيف الحال|كيف الامور|كيف الاحوال|كيف يومك|كيف صحتك|كيفك|كيفج|شحال|شخبار|اخبارك|اخبارج|علومك|علومج|شو حالك|شو حالج|عساك|عساج|عساكم|طمني|انت بخير|انتي بخير|shlon|shakhbar|akhbar|keefak|kifak|kefak|kaif|kayf|keef/.test(normalized),
    dayPart: /good morning|صباح|sabah/.test(normalized)
      ? "morning" as const
      : /good afternoon/.test(normalized)
        ? "afternoon" as const
        : /good evening|مساء|masa|masaa/.test(normalized)
          ? "evening" as const
          : null,
  };
  if (!normalized || language === "uncertain") {
    return { ...base, intent: "UNCERTAIN", greeting: false, actionable: false, requestCount: 0, callBusiness: false };
  }

  // Pure greetings and "how are you" never become a student-record search.
  if (isVoiceSmallTalk(original)) {
    return {
      ...base,
      intent: "GREETING_ONLY",
      greeting: true,
      actionable: false,
      requestCount: 0,
      callBusiness: false,
    };
  }

  const thanks = containsAny(normalized, THANKS);
  const farewell = containsAny(normalized, FAREWELL);
  const follow = containsAny(normalized, FOLLOW);
  let working = normalized;
  const arabic = stripPhrases(working, AR_GREETINGS);
  working = arabic.text;
  const english = stripPhrases(working, EN_GREETINGS);
  working = english.text;
  const tokens = stripPhrases(working, EN_TOKENS);
  working = tokens.text;
  const arabizi = stripPhrases(working, ARABIZI);
  working = arabizi.text;
  const agents = stripPhrases(working, ["mira", "meera", "suhail", "sanadi", "ميرا", "سهيل", "سندي", "ya", "يا"]);
  working = agents.text;
  const greeting = arabic.hit || english.hit || tokens.hit || arabizi.hit || fuzzyGreeting(normalized) || hasArabizi(normalized) || base.asksWellbeing;
  const vague = stripPhrases(working, VAGUE);
  const withoutSocial = stripPhrases(vague.text, [
    "how are you doing today", "how are you doing", "how are you", "how are u", "how r you", "how r u",
    "howre you", "how you doing", "hows it going", "how is it going", "how have you been",
    "hows everything", "how is everything", "how are things", "whats up", "whats new", "whats going on",
    "hows your day going", "how is your day going", "are you doing well", "are you ok", "are you okay",
    "you good", "everything good", "today", "doing", "well", "there", "friend", "buddy", "very", "much",
    "now", "just", "really", "good", "fine", "ok", "okay", "alright", "too",
  ]).text;
  const residue = withoutSocial;
  const requests = serviceHits(normalized);
  const asksAction = requests > 0 || /\b(what|when|where|which|why|who|can you|could you|tell me|show me|find|create|book|i need|i want)\b/.test(residue)
    || /وين|كم|ابغى|أبي|اريد|طلع|ساعديني|ساعدني/.test(residue);
  // "How are you?" is conversation, not a student-service request.
  const socialOnly = (greeting || base.asksWellbeing || thanks) && requests === 0 && !asksAction;
  const actionable = !socialOnly && (asksAction && !vague.hit || requests > 0);
  const requestCount = Math.max(requests, actionable ? 1 : 0);

  let intent: VoiceIntent = "QUESTION_ONLY";
  if (farewell && !actionable) intent = "FAREWELL";
  else if (thanks && !actionable) intent = "THANK_YOU";
  else if (follow && !actionable) intent = "FOLLOW_UP";
  else if (greeting && !actionable && /anyone there|hear me|available|everything good/.test(normalized)) intent = "SMALL_TALK";
  else if (greeting && actionable && requestCount > 1) intent = "MULTIPLE_QUESTIONS";
  else if (!greeting && actionable && requestCount > 1) intent = "MULTIPLE_QUESTIONS";
  else if (greeting && actionable) intent = "GREETING_WITH_QUESTION";
  else if (greeting) intent = "GREETING_ONLY";
  else if (!actionable && vague.hit) intent = "FOLLOW_UP";
  else if (!actionable) intent = greeting ? "GREETING_ONLY" : "SMALL_TALK";

  return {
    ...base,
    intent,
    greeting,
    actionable,
    requestCount,
    callBusiness: intent === "GREETING_WITH_QUESTION" || intent === "QUESTION_ONLY" || intent === "MULTIPLE_QUESTIONS",
  };
}

function agentName(agent: VoiceAgentId, language: VoiceLanguage): string {
  if (language === "ar") return agent === "mira" ? "ميرا" : "سهيل";
  return agent === "mira" ? "Mira" : "Suhail";
}

function named(language: VoiceLanguage, studentName: string | null, introduced: boolean): string {
  if (!studentName || introduced) return "";
  return language === "ar" ? ` يا ${studentName}` : ` ${studentName}`;
}

function topicHint(original: string, language: VoiceLanguage, count: number): string {
  if (count > 1) return language === "ar" ? "الطلبين" : "both of those";
  const text = normalizeVoiceText(original);
  if (/letter|enrol|افاد/.test(text)) return language === "ar" ? "إفادة التسجيل" : "your enrolment letter";
  if (/attend|حضور/.test(text)) return language === "ar" ? "حضورك" : "your attendance";
  if (/textbook|كتاب/.test(text)) return language === "ar" ? "الكتاب" : "your textbook";
  if (/schedule|جدول|class/.test(text)) return language === "ar" ? "جدولك" : "your class schedule";
  return language === "ar" ? "طلبك" : "that";
}

const EN_ACK = [
  "I'll check that for you.",
  "Let me look into that.",
  "I'll look into your request now.",
  "I'll check the available information.",
];
const AR_ACK = [
  "خليني أتحقق لك.",
  "بشوف لك المعلومات المتوفرة.",
  "خليني أراجع طلبك.",
  "خليني أتأكد من التفاصيل.",
];

export function planVoiceReply(
  turn: VoiceClassification,
  options: { agent: VoiceAgentId; studentName: string | null; introduced: boolean; ackVariant: number },
): VoiceReplyPlan {
  const language: VoiceLanguage = turn.language === "ar" ? "ar" : "en";
  const who = agentName(options.agent, language);
  const person = named(language, options.studentName, options.introduced);
  const hello = turn.dayPart === "morning"
    ? (language === "ar" ? "صباح الخير" : "Good morning")
    : turn.dayPart === "afternoon"
      ? "Good afternoon"
      : turn.dayPart === "evening"
        ? (language === "ar" ? "مساء الخير" : "Good evening")
        : /السلام|salam|salaam/.test(normalizeVoiceText(turn.original))
          ? (language === "ar" ? "وعليكم السلام" : "Wa alaykum assalam")
          : (language === "ar" ? "أهلاً" : "Hello");

  if (turn.intent === "UNCERTAIN") {
    return {
      speech: language === "ar"
        ? "تبي نكمل بالعربي أو بالإنجليزي؟"
        : "Would you like to continue in English or Arabic?",
      language,
      callBusiness: false,
      keepListening: true,
      markIntroduced: false,
    };
  }
  if (turn.intent === "FAREWELL") {
    return {
      speech: language === "ar" ? `مع السلامة${person}. أنا هنا متى ما احتجتني.` : `Goodbye${person}. I'm here whenever you need me.`,
      language,
      callBusiness: false,
      keepListening: false,
      markIntroduced: options.introduced,
    };
  }
  if (turn.intent === "THANK_YOU") {
    return {
      speech: language === "ar" ? `على الرحب والسعة${person}.` : `You're welcome${person}!`,
      language,
      callBusiness: false,
      keepListening: true,
      markIntroduced: options.introduced,
    };
  }
  if (turn.intent === "SMALL_TALK") {
    return {
      speech: language === "ar" ? "أنا معك. كيف أقدر أساعدك اليوم؟" : "Yes, I'm here. How can I help you today?",
      language,
      callBusiness: false,
      keepListening: true,
      markIntroduced: options.introduced,
    };
  }
  if (turn.intent === "FOLLOW_UP") {
    return {
      speech: language === "ar" ? "طبعاً. تفضل." : "Of course. Go ahead.",
      language,
      callBusiness: false,
      keepListening: true,
      markIntroduced: options.introduced,
    };
  }
  if (turn.intent === "GREETING_ONLY") {
    const aboutAgent = AGENT_IDENTITY.some((phrase) => normalizeVoiceText(turn.original).includes(normalizeVoiceText(phrase)));
    const wellbeing = aboutAgent
      ? ""
      : turn.asksWellbeing
        ? (language === "ar" ? " بخير الحمد لله." : " I'm doing well, thank you.")
        : "";
    const intro = aboutAgent
      ? (language === "ar" ? ` أنا ${who}، وكيل دعم سندي.` : ` I'm ${who}, Sanadi's support agent.`)
      : options.introduced ? "" : (language === "ar" ? ` أنا ${who}.` : ` I'm ${who}.`);
    return {
      speech: `${hello}${person}!${intro}${wellbeing} ${language === "ar" ? "كيف أقدر أساعدك اليوم؟" : "How can I help you today?"}`.replace(/\s+/g, " ").trim(),
      language,
      callBusiness: false,
      keepListening: true,
      markIntroduced: true,
    };
  }

  const topic = topicHint(turn.original, language, turn.requestCount);
  const ack = language === "ar"
    ? AR_ACK[options.ackVariant % AR_ACK.length]!.replace(/\.$/, "")
    : EN_ACK[options.ackVariant % EN_ACK.length]!.replace(/\.$/, "");
  const lead = turn.greeting
    ? `${hello}${person}!${turn.asksWellbeing ? (language === "ar" ? " الحمد لله بخير." : " I'm doing well, thank you.") : ""}`
    : (language === "ar" ? "أكيد." : "Certainly.");
  const check = topic === "that" || topic === "طلبك"
    ? `${ack}.`
    : (language === "ar" ? `${ack} من ${topic}.` : `${ack}, and I'll look at ${topic}.`);
  return {
    speech: `${lead} ${check}`.replace(/\s+/g, " ").trim(),
    language,
    callBusiness: true,
    keepListening: true,
    markIntroduced: options.introduced || turn.greeting,
  };
}

const EN_COMMON = new Set([
  "the", "is", "are", "am", "was", "be", "my", "me", "i", "you", "your", "we", "it", "this", "that", "these", "a", "an",
  "and", "or", "to", "of", "in", "on", "at", "for", "with", "about", "from", "by", "do", "does", "did", "have", "has",
  "can", "could", "would", "should", "will", "want", "need", "please", "help", "what", "where", "when", "how", "who",
  "which", "why", "whats", "wheres", "hows", "hello", "hi", "hey", "good", "morning", "afternoon", "evening", "thank",
  "thanks", "yes", "no", "ok", "okay", "bye", "goodbye", "sorry", "tell", "show", "give", "get", "find", "check", "know",
  "letter", "course", "courses", "class", "classes", "textbook", "book", "books", "library", "gpa", "grade", "grades",
  "schedule", "timetable", "attendance", "register", "registration", "fees", "fee", "exam", "exams", "appointment",
  "complaint", "suggestion", "housing", "campus", "enrol", "enroll", "enrolment", "enrollment", "certificate",
  "transcript", "name", "email", "id", "card", "student", "university", "semester", "today", "tomorrow", "time",
  "date", "status", "request", "apply", "application", "scholarship", "parking", "permit", "gate", "entry", "wifi",
  "password", "account", "advisor", "teacher", "professor", "doctor", "office", "hours", "open", "close", "mira", "suhail", "sanadi",
]);

const AR_COMMON = [
  "كيف", "وين", "متي", "ممكن", "ابغي", "ابي", "اريد", "احتاج", "شو", "ما", "هل", "انا", "انت", "انتي", "لو", "سمحت",
  "من", "في", "علي", "عن", "الي", "هذا", "هذه", "افاده", "تسجيل", "مقرر", "ماده", "كتاب", "مكتبه", "موعد", "شكوي",
  "اقتراح", "سكن", "رسوم", "جدول", "حضور", "درجات", "معدل", "نعم", "لا", "شكرا", "مرحبا", "السلام", "صباح", "مساء",
  "هلا", "اهلا", "تمام", "طيب", "كم", "ليش", "ليه", "ايش", "وش", "عندي", "عندك", "ساعد", "ساعدني", "ساعديني",
  "طلب", "الجامعه", "الطالب", "فصل", "امتحان", "شهاده", "اسم", "اسمي", "ايميل", "بطاقه", "رقم", "حساب", "مشرف",
  "دكتور", "مكتب", "دوام", "اليوم", "بكره", "وقت", "تاريخ", "حاله", "منحه", "مواقف", "تصريح", "بوابه", "دخول",
  "باسورد", "كلمه", "سر", "محاضره", "محاضرات", "مواد", "ميرا", "سهيل", "سندي", "يا", "او", "بس", "الحين",
];

/** True when Latin text contains an Arabizi greeting. */
export function looksArabizi(text: string): boolean {
  return hasArabizi(normalizeVoiceText(text));
}

/**
 * The browser recognizer is fixed to one language. When it hears the other language it
 * returns low-confidence filler with none of that language's everyday words. Returns the
 * language the recognizer should switch to, or null when the transcript fits the active one.
 */
export function recognizerLanguageMismatch(
  spoken: string,
  activeLanguage: VoiceLanguage,
  confidence: number | null,
): VoiceLanguage | null {
  const normalized = normalizeVoiceText(spoken);
  if (!normalized) return null;
  const arabicLetters = (spoken.match(/[\u0600-\u06FF]/g) ?? []).length;
  const latinLetters = (spoken.match(/[A-Za-z]/g) ?? []).length;
  const tokens = normalized.split(" ").filter(Boolean);
  const uncertain = confidence === null || Number.isNaN(confidence) || confidence < 0.6;
  if (activeLanguage === "en") {
    if (arabicLetters > 0 || latinLetters === 0) return null;
    if (hasArabizi(normalized)) return null;
    // Only everyday English content words show that English was spoken; "a", "my", "the"
    // appear just as often when the recognizer turns Arabic into English-looking filler.
    const known = tokens.filter((token) => EN_COMMON.has(token) && !EN_FUNCTION_WORDS.has(token)).length;
    if (known > 0 || fuzzyGreeting(normalized)) return null;
    return uncertain || tokens.length >= 2 ? "ar" : null;
  }
  if (latinLetters > 0 || arabicLetters === 0) return null;
  const known = tokens.filter((token) => AR_COMMON.includes(token)).length;
  if (known > 0) return null;
  return uncertain || tokens.length >= 2 ? "en" : null;
}

/** The chatbot sometimes refuses small talk. Voice keeps that reply off the microphone. */
export function isPersonalChatRefusal(answer: string): boolean {
  return /personal question|cannot verify your personal|can(?:not|'t|not) (?:answer|verify).{0,40}personal|questions about (?:my|your) personal|لا يمكنني التحقق من بياناتك|أسئلة شخصية|سؤال شخصي/i.test(answer);
}

/** Label/value lines the voice agent should read; longer instructions stay on screen. */
export function extractSpokenFacts(answer: string): { label: string; value: string }[] {
  const facts: { label: string; value: string }[] = [];
  for (const raw of answer.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.replace(/^\s*[-*•]\s+/, "").replace(/\*\*|__/g, "").trim();
    const matched = line.match(/^(.{2,40}?)\s*[:：]\s+(.{1,80})$/);
    if (!matched) continue;
    const label = (matched[1] ?? "").replace(/[*_`#]/g, "").trim();
    const value = (matched[2] ?? "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_`#]/g, "").trim();
    if (!label || !value) continue;
    if (value.split(/\s+/).length > 12) continue;
    if (/\b(how to|open|select|click|visit|راجع|افتح)\b/i.test(label)) continue;
    facts.push({ label, value });
    if (facts.length === 5) break;
  }
  return facts;
}

/**
 * Voice chat only: reads key values from a long answer. The full layout is shown
 * on screen and is not spoken. Short replies are read as they are.
 */
export function forSpeakingHighlights(answer: string, lang: VoiceLanguage): string {
  const facts = extractSpokenFacts(answer);
  const compact = answer.replace(/\s+/g, " ").trim();
  const long = compact.length > 280 || (answer.match(/\n/g)?.length ?? 0) > 3;
  const screen = lang === "ar" ? " التفاصيل على الشاشة." : " The full details are on the screen.";
  if (facts.length >= 2) {
    const spoken = facts
      .map((fact) => (lang === "ar" ? `${fact.label}: ${fact.value}.` : `${fact.label} is ${fact.value}.`))
      .join(" ");
    return `${spoken}${long ? screen : ""}`.replace(/\s+/g, " ").trim();
  }
  return `${forSpeaking(answer, true, 2)}${long ? screen : ""}`.replace(/\s+/g, " ").trim();
}

/** Spoken playback only. Does not change the chatbot answer. */
export function forSpeaking(answer: string, dropLeadingGreeting = false, maxSentences = 2): string {
  const plain = answer
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  let sentences = plain.split(/(?<=[.!?؟])\s+/).filter(Boolean);
  if (dropLeadingGreeting && sentences[0] && /^(hello|hi|hey|good morning|good afternoon|good evening|أهلا|مرحبا|السلام)/i.test(sentences[0])) {
    sentences = sentences.slice(1);
  }
  const spoken = (sentences.slice(0, maxSentences).join(" ") || plain).trim();
  const limit = maxSentences > 2 ? 700 : 320;
  if (spoken.length <= limit) return spoken;
  return `${spoken.slice(0, limit - 20).replace(/\s+\S*$/, "")}.`;
}
