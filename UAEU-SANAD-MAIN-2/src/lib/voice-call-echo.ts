const words = (text: string) => text.toLowerCase().replace(/[\u064b-\u065f\u0670]/g, "")
  .replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);

/** Reject recognizable loudspeaker echo; explicit stop commands always interrupt. */
export function isVoiceCallEcho(heard: string, spoken: string): boolean {
  const input = words(heard), output = words(spoken);
  if (!input.length || !output.length) return false;
  if (/^(stop|wait|pause|توقف|وقف|لحظة|لحظه)$/.test(input.join(" "))) return false;
  for (let start = 0; start < output.length; start++) {
    let matches = 0;
    for (let i = 0; i < input.length && start + i < output.length; i++)
      if (input[i] === output[start + i]) matches++;
    if (matches / input.length >= 0.75) return true;
  }
  return false;
}
