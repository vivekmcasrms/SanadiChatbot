/**
 * Voice chat only: text-to-speech voice selection and echo detection.
 * Nothing in the text chat path imports this module.
 */

export type SpeechLanguage = "en" | "ar";
export type SpeechAgent = "mira" | "suhail";

/** True when the browser has at least one system voice that speaks `language`. */
export function hasSpeechVoiceFor(voices: SpeechSynthesisVoice[], language: SpeechLanguage): boolean {
  return voices.some((voice) => typeof voice?.lang === "string" && voice.lang.toLowerCase().startsWith(language));
}

/** Picks a browser voice whose gender matches the selected agent, preferring the UAE locale. */
export function preferredSpeechVoice(
  voices: SpeechSynthesisVoice[],
  language: SpeechLanguage,
  agent: SpeechAgent,
): SpeechSynthesisVoice | undefined {
  const usable = voices.filter(
    (voice) => Boolean(voice?.name) && typeof voice.lang === "string" && voice.lang.length > 0,
  );
  const locale = language === "ar" ? "ar-ae" : "en-ae";
  // Keep voice gender tied to the selected agent. In particular, do not use
  // /male/ because it also matches the word "female".
  const genderPattern = agent === "mira"
    ? /female|woman|zira|aria|jenny|samantha|ava|susan|sara|heera|natasha|sonia|fatima|hadeel|salama|salma|amany|amina|hoda|zariyah|laila|layla|noura|noora|reem|mariam|mary|victoria|karen|tessa/i
    : /(^|\b)(male|man|david|mark|daniel|george|alex|guy|ryan|james|liam|hamed|hamad|abdullah|omar|hamdan|naayf|shakir|bassel|taim|yusuf|youssef|kareem|khalid|ahmed|andrew)(\b|$)/i;
  // A voice for another language cannot speak the reply (an English voice given Arabic
  // text plays silence), so the language match always comes first. The agent's gender
  // is then matched only among the voices that speak that language.
  const sameLanguage = usable.filter((voice) => voice.lang.toLowerCase().startsWith(language));
  if (sameLanguage.length === 0) {
    // Leave the voice unset so the browser resolves it from utterance.lang.
    return undefined;
  }
  const matchingGender = sameLanguage.filter((voice) => genderPattern.test(voice.name));
  return matchingGender.find((voice) => voice.lang.toLowerCase() === locale)
    ?? matchingGender[0]
    ?? sameLanguage.find((voice) => voice.lang.toLowerCase() === locale)
    ?? sameLanguage[0];
}

export function speechWords(text: string): string[] {
  return text.toLocaleLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
}

/** How many leading words of the transcript are the assistant's own playback picked up by the microphone. */
export function assistantEchoWordCount(transcript: string, playback: string): number {
  const heard = speechWords(transcript);
  const said = speechWords(playback);
  let best = 0;
  for (let start = 0; start < said.length; start += 1) {
    let matched = 0;
    let examined = 0;
    let errors = 0;
    while (examined < heard.length && start + examined < said.length) {
      if (heard[examined] === said[start + examined]) matched += 1;
      else errors += 1;
      examined += 1;
      if (errors > 1) break;
      if (matched >= 1 && matched / examined >= 0.7) best = Math.max(best, matched);
    }
  }
  return best;
}
