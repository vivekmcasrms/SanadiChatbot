import { previewInteractionFn } from "../interactions.functions";

/** Only the latest text may update the displayed routing decision. */
export function scheduleInteractionPreview(
  data: Parameters<typeof previewInteractionFn>[0]["data"],
  onResult: (result: Awaited<ReturnType<typeof previewInteractionFn>>) => void,
  onError: () => void,
  onComplete: () => void,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    void previewInteractionFn({ data, signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) onResult(result); })
      .catch(() => { if (!controller.signal.aborted) onError(); })
      .finally(() => { if (!controller.signal.aborted) onComplete(); });
  }, 300);
  return () => { clearTimeout(timer); controller.abort(); };
}
