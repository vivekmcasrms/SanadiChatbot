import { expect, test } from "vitest";
import { isVoiceCallEcho } from "./voice-call-echo";

test.each([
  ["your UAEU support advisor", "Hi, I'm Meera, your UAEU support advisor."],
  ["يمكنني مساعدتك في التسجيل", "مرحباً، يمكنني مساعدتك في التسجيل وخدمات الجامعة."],
  ["your GPA is three point", "Your GPA is three point five."],
])("filters recognized speaker echo: %s", (heard, spoken) => {
  expect(isVoiceCallEcho(heard, spoken)).toBe(true);
});
test.each([
  ["What about my courses?", "Your GPA is three point five."],
  ["ما هي المواد المتاحة؟", "معدلك ثلاثة فاصلة خمسة."],
  ["stop", "You can stop the call."],
  ["توقف", "يمكنك قول توقف."],
])("accepts a new question or explicit interruption: %s", (heard, spoken) => {
  expect(isVoiceCallEcho(heard, spoken)).toBe(false);
});
