const SIGNED_OUT = "sanadi-signed-out";
const GENERATION = "sanadi-logout-generation";

export function isSignedOut(): boolean {
  if (typeof window === "undefined") return false;
  return window.sessionStorage.getItem(SIGNED_OUT) === "1" || window.localStorage?.getItem(SIGNED_OUT) === "1";
}

export function logoutGeneration(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage?.getItem(GENERATION) ?? window.sessionStorage.getItem(GENERATION);
}

export function markSignedOut() {
  const generation = `${Date.now()}-${Math.random()}`;
  for (const storage of [window.sessionStorage, window.localStorage]) {
    storage?.setItem(SIGNED_OUT, "1");
    storage?.setItem(GENERATION, generation);
  }
  for (const key of ["sanadi-sso-verifier", "sanadi-sso-generation", "sanadi-sso-restarted", "sanadi-force-sso"]) window.sessionStorage.removeItem(key);
}

export function clearSignedOut() {
  window.sessionStorage.removeItem(SIGNED_OUT);
  window.localStorage?.removeItem(SIGNED_OUT);
}
