/**
 * Recovers the app when the browser fails to fetch a JavaScript module.
 *
 * If the client entry or a lazy route chunk 404s (stale deploy, interrupted
 * network, dev-server rebuild) React never hydrates: the page still shows the
 * server-rendered markup, but buttons and forms — including Sign In — do
 * nothing. A single guarded reload fetches the current asset manifest and
 * restores interactivity instead of leaving the user stuck.
 */
const FLAG = "sanadi_chunk_reload_at";
const COOLDOWN_MS = 20_000;

const PATTERN =
  /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|unable to preload css|chunkloaderror/i;

function shouldReload(): boolean {
  try {
    const previous = Number(window.sessionStorage.getItem(FLAG) ?? "0");
    if (Number.isFinite(previous) && Date.now() - previous < COOLDOWN_MS) return false;
    window.sessionStorage.setItem(FLAG, String(Date.now()));
    return true;
  } catch {
    return false;
  }
}

function handle(message: string) {
  if (!PATTERN.test(message)) return;
  console.warn("[sanadi] module load failed, reloading once to recover", { message: message.slice(0, 160) });
  if (shouldReload()) window.location.reload();
}

export function installChunkRecovery() {
  if (typeof window === "undefined") return () => {};
  const onError = (event: ErrorEvent) => handle(String(event.message ?? event.error ?? ""));
  const onRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason as { message?: unknown } | string | undefined;
    handle(typeof reason === "string" ? reason : String((reason as { message?: unknown })?.message ?? ""));
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
