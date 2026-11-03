import { describe, expect, it } from "vitest";
import { extractLibraryTopic, parseSearchIntent } from "./provider.server";

describe("library topic extraction", () => {
  it.each([
    ["machine learning", "machine learning"],
    ["find me books about machine learning", "machine learning"],
    ["Can you find me some recent articles on machine learning?", "machine learning"],
    ["Do you have any e-books about deep learning in the library", "deep learning"],
    ["I need books on climate change published after 2020", "climate change"],
    ["أبغي كتب عن تعلم الآلة", "machine learning"],
  ])("%s → %s", (input, topic) => {
    expect(parseSearchIntent(input).query).toBe(topic);
  });
  it("removes the author clause from the topic", () => {
    expect(extractLibraryTopic("books about operating systems by Andrew Tanenbaum", "Andrew Tanenbaum")).toBe("operating systems");
  });
});

describe("Arabic library query understanding", () => {
  it("full example request", () => {
    const p = parseSearchIntent("ابحث لي عن كتب متاحة عن تعلم الآلة وأظهر المؤلف ورابط الفهرس.");
    expect(p.query).toBe("machine learning");
    expect(p.types).toEqual(["book"]);
    expect(p.availableOnly).toBe(true);
    expect(p.requestedFields).toEqual(["author", "catalogue_link"]);
  });
  it.each([
    ["كتب عن الذكاء الاصطناعي", "artificial intelligence"],
    ["مقالات في علوم البيانات", "data science"],
    ["show me books about الذكاء الاصطناعي", "artificial intelligence"],
  ])("%s → %s", (input, topic) => {
    expect(parseSearchIntent(input).query).toBe(topic);
  });
  it("journal, article and e-copy types", () => {
    expect(parseSearchIntent("مجلة عن تعلم الآلة").types).toEqual(["journal"]);
    expect(parseSearchIntent("مقال عن الذكاء الاصطناعي").types).toEqual(["article"]);
    const e = parseSearchIntent("نسخة إلكترونية من كتاب عن علوم البيانات");
    expect(e.electronicOnly).toBe(true);
    expect(e.types).toEqual(["ebook"]);
  });
  it("title field request", () => {
    expect(parseSearchIntent("كتب عن تعلم الآلة مع العنوان والمؤلف").requestedFields).toEqual(["author", "title"]);
  });
});
