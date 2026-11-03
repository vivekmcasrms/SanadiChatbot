import {describe, expect, it} from "vitest";
import {matchesProgramme} from "./programme-matching";

const cs = {code: "BSCS", name_en: "Bachelor of Science in Computer Science", name_ar: "بكالوريوس العلوم في علوم الحاسوب"};
const biology = {code: "BSBIO", name_en: "Bachelor of Science in Biology", name_ar: "بكالوريوس العلوم في علم الأحياء"};
const ds = {code: "BSDSAI", name_en: "BSc Data Science and Artificial Intelligence", name_ar: "بكالوريوس العلوم في علم البيانات والذكاء الاصطناعي"};
describe("requested sample programme targets", () => {
  it("recognises Computer Science without confusing it with Data Science", () => {
    expect(matchesProgramme("transfer to Computer Science", cs)).toBe(true);
    expect(matchesProgramme("transfer to Computer Science", ds)).toBe(false);
  });
  it("recognises Biology in English and Arabic", () => {
    expect(matchesProgramme("transfer to Biology", biology)).toBe(true);
    expect(matchesProgramme("أبغي أحول إلى علم الأحياء", biology)).toBe(true);
    expect(matchesProgramme("transfer to Biology", cs)).toBe(false);
  });
  it("recognises the existing Data Science and AI programme", () => {
    expect(matchesProgramme("transfer to Data Science and AI", ds)).toBe(true);
    expect(matchesProgramme("أبغي أحول إلى علم البيانات", ds)).toBe(true);
  });
});