import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { scheduleInteractionPreview } from "./live-preview";

const preview = vi.hoisted(() => vi.fn());
vi.mock("../interactions.functions", () => ({ previewInteractionFn: preview }));
beforeEach(() => { vi.useFakeTimers(); preview.mockReset(); });
afterEach(() => vi.useRealTimers());

it("debounces edits and discards an older route arriving after the new details", async () => {
  let oldReply!: (r: unknown) => void;
  preview.mockImplementationOnce(() => new Promise((resolve) => { oldReply = resolve; }))
    .mockResolvedValueOnce({ serviceLabel: { en: "Student Housing" } });
  const result = vi.fn(); const error = vi.fn(); const complete = vi.fn();
  const cancel = scheduleInteractionPreview({ title: "Problem", description: "I have a problem" }, result, error, complete);
  await vi.advanceTimersByTimeAsync(300);
  cancel();
  const cleanup = scheduleInteractionPreview({ title: "Problem", description: "My room AC is not working" }, result, error, complete);
  await vi.advanceTimersByTimeAsync(300);
  oldReply({ serviceLabel: { en: "Student Services" } });
  await vi.runAllTimersAsync();
  expect(result).toHaveBeenCalledExactlyOnceWith({ serviceLabel: { en: "Student Housing" } });
  expect(error).not.toHaveBeenCalled(); expect(complete).toHaveBeenCalledTimes(1);
  expect(preview.mock.calls[0][0].signal.aborted).toBe(true);
  cleanup();
});

it("does not send cancelled keystrokes and reports current classification failures", async () => {
  const result = vi.fn(); const error = vi.fn(); const complete = vi.fn();
  const cancel = scheduleInteractionPreview({ title: "", description: "I have" }, result, error, complete);
  cancel(); await vi.advanceTimersByTimeAsync(300); expect(preview).not.toHaveBeenCalled();
  preview.mockRejectedValueOnce(new Error("unavailable"));
  scheduleInteractionPreview({ title: "", description: "I have a problem" }, result, error, complete);
  await vi.advanceTimersByTimeAsync(300);
  expect(error).toHaveBeenCalledTimes(1); expect(complete).toHaveBeenCalledTimes(1);
});
