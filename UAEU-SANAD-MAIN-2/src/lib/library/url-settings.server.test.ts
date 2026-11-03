import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.hoisted(() => ({
  from: vi.fn(), select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(),
}));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: query }));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  query.from.mockReturnValue(query);
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
});

describe("library URL settings", () => {
  it("reads only the two URL columns and shares a successful lookup", async () => {
    query.maybeSingle.mockResolvedValue({ data: {
      base_url: "https://library.test/search/v2/",
      catalogue_url_template: "https://catalogue.test/record/{id}",
    }, error: null });
    const { loadLibraryUrls } = await import("./url-settings.server");
    const [first, second] = await Promise.all([loadLibraryUrls(), loadLibraryUrls()]);
    expect(first).toEqual({ baseUrl: "https://library.test/search/v2", catalogueUrlTemplate: "https://catalogue.test/record/{id}" });
    expect(second).toEqual(first);
    expect(query.select).toHaveBeenCalledExactlyOnceWith("base_url,catalogue_url_template");
    expect(query.eq).toHaveBeenCalledWith("provider_key", "library_search");
    await loadLibraryUrls();
    expect(query.maybeSingle).toHaveBeenCalledTimes(1);
  });

  it("does not invent a URL or cache a failed lookup", async () => {
    query.maybeSingle.mockResolvedValueOnce({ data: null, error: { message: "Unavailable" } });
    const { loadLibraryUrls } = await import("./url-settings.server");
    await expect(loadLibraryUrls()).rejects.toThrow("Library catalogue URL is not configured");
    query.maybeSingle.mockResolvedValueOnce({ data: { base_url: "https://library.test/v2", catalogue_url_template: null }, error: null });
    await expect(loadLibraryUrls()).resolves.toEqual({ baseUrl: "https://library.test/v2", catalogueUrlTemplate: null });
  });
});
