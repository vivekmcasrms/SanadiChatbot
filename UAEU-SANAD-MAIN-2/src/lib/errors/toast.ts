import { toast } from "sonner";
import { userErrorMessage, type Lang } from "./user-message";

/**
 * Shows a user-safe bilingual error toast and keeps the technical cause in the
 * console for debugging. Never pass a raw provider/database message to
 * `toast.error` directly.
 */
export function toastError(error: unknown, lang: Lang = "en") {
  if (typeof console !== "undefined") console.error("[sanadi]", error);
  toast.error(userErrorMessage(error, lang));
}
