import { describe, expect, it } from "vitest";
import { isConfirmationReply, isDeclineReply } from "./execute-action.server";

describe("isConfirmationReply", () => {
  it("accepts short English confirmations including 'submit it'", () => {
    for (const t of ["yes", "ok", "go ahead", "submit it", "please proceed", "confirm"]) {
      expect(isConfirmationReply(t), t).toBe(true);
    }
  });

  it("accepts Emirati Arabic confirmations used in voice turns", () => {
    for (const t of ["هيه", "تمام", "زين", "نعم", "موافق", "قدمه"]) {
      expect(isConfirmationReply(t), t).toBe(true);
    }
  });

  it("does not treat questions or long sentences as confirmations", () => {
    for (const t of ["what happens to my credits?", "can I submit it later?", "هل يمكنني التقديم؟"]) {
      expect(isConfirmationReply(t), t).toBe(false);
    }
  });
});

describe("isDeclineReply", () => {
  it("accepts short declines", () => {
    for (const t of ["no", "cancel", "لا", "إلغاء"]) {
      expect(isDeclineReply(t), t).toBe(true);
    }
  });
});
