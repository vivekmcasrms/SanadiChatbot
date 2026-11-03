/** Only URL settings are loaded here; credentials keep their existing source. */
export type LibraryUrls = { baseUrl: string; catalogueUrlTemplate: string | null };

let cached: { value: LibraryUrls; expiresAt: number } | undefined;
let pending: Promise<LibraryUrls> | undefined;

export async function loadLibraryUrls(): Promise<LibraryUrls> {
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (pending) return pending;
  pending = (async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("library_provider_settings")
      .select("base_url,catalogue_url_template")
      .eq("provider_key", "library_search")
      .maybeSingle();
    if (error || !data?.base_url?.trim()) throw new Error("Library catalogue URL is not configured");
    const value = {
      baseUrl: data.base_url.trim().replace(/\/+$/, ""),
      catalogueUrlTemplate: data.catalogue_url_template?.trim() || null,
    };
    cached = { value, expiresAt: Date.now() + 60_000 };
    return value;
  })();
  try {
    return await pending;
  } finally {
    pending = undefined;
  }
}
