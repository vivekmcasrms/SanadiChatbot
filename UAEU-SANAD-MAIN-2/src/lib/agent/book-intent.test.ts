import { describe, expect, it } from "vitest";
import { classifyBookSense } from "./book-intent.server";
import { detectAppointmentIntent } from "./appointment.server";
import { detectDomains, detectDomainsWithContext } from "./context.server";

describe("library vs appointment routing", () => {
  const libraryQueries = [
    "Find me a good book on deep learning.",
    "Find an e-book on electrical engineering.",
    "Do you have Introduction to Algorithms?",
    "Can I borrow this book?",
    "What are the library opening hours?",
    "ابحث لي عن كتاب في التعلم العميق",
  ];

  const appointmentQueries = [
    "Book me a career counselling appointment.",
    "Can you book me for 3 PM?",
    "I want to meet an academic advisor tomorrow",
    "أريد حجز موعد مع المرشد المهني",
  ];

  it.each(libraryQueries)("routes %s to the library", (q) => {
    expect(detectAppointmentIntent(q)).toBeNull();
    const domains = detectDomains(q);
    expect(domains[0]).toBe("library");
    expect(domains).not.toContain("appointments");
  });

  it.each(appointmentQueries)("routes %s to appointments", (q) => {
    const domains = detectDomains(q);
    expect(domains).toContain("appointments");
    expect(domains).not.toContain("library");
  });

  it("keeps 'Do you have Introduction to Algorithms?' out of the appointment agent", () => {
    expect(classifyBookSense("Do you have Introduction to Algorithms?")).not.toBe("appointment");
  });

  it("stays in library context for follow-ups", () => {
    for (const q of ["Is the first book available online?", "Where can I find it?", "Is the first one available online?"]) {
      const { domains } = detectDomainsWithContext(q, "library");
      expect(domains[0]).toBe("library");
    }
  });

  it("asks once when the sense is genuinely ambiguous", () => {
    expect(classifyBookSense("book, please")).toBe("ambiguous");
  });
});
