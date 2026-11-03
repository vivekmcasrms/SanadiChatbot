import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getMyCounsellingRequest, requestCareerCounsellor } from "./career.functions";

const request = {
  id: "test-request",
  reference: "CAR-TEST",
  status: "assigned",
  createdAt: "2026-11-01T00:00:00Z",
  firstResponseDueAt: null,
  resolutionDueAt: null,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Career counselling query", () => {
  it.each([204, 200])("treats an empty HTTP %s response as no open request, without a browser warning", async (status) => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status }));
    vi.stubGlobal("fetch", fetch);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    try {
      await expect(client.fetchQuery({ queryKey: ["counselling-request"], queryFn: getMyCounsellingRequest })).resolves.toBeNull();
      expect(client.getQueryState(["counselling-request"])?.status).toBe("success");
      expect(error).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledOnce();
      expect(fetch.mock.calls[0]?.[0]).toMatch(/\/api\/career\/counselling$/);
    } finally {
      client.clear();
    }
  });

  it("preserves an explicit null response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(null)));
    await expect(getMyCounsellingRequest()).resolves.toBeNull();
  });

  it("preserves the existing request and its status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(request)));
    await expect(getMyCounsellingRequest()).resolves.toEqual(request);
  });

  it("does not turn an API failure into a misleading empty result", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ message: "Service unavailable" }, { status: 503 })));
    await expect(getMyCounsellingRequest()).rejects.toMatchObject({ status: 503, message: "Service unavailable" });
  });

  it.each(["en", "ar"] as const)("keeps the existing %s counselling submission contract", async (lang) => {
    const result = { created: true, request, acknowledgement: "Received" };
    const fetch = vi.fn().mockResolvedValue(Response.json(result));
    vi.stubGlobal("fetch", fetch);
    await expect(requestCareerCounsellor({ data: { lang } })).resolves.toEqual(result);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: "POST", body: JSON.stringify({ lang }) });
  });
});
