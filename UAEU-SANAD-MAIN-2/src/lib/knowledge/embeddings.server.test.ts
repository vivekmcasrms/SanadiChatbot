import { beforeEach, describe, expect, it, vi } from "vitest";
import { embedQuery, embedTexts } from "./embeddings.server";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { functions: { invoke } } }));
beforeEach(() => vi.resetAllMocks());
describe("API-owned embeddings", () => {
  it("delegates to the API without provider settings or credentials", async () => {
    invoke.mockResolvedValue({ data: { embeddings: ["[0.250000,0.500000]"] }, error: null });
    expect(await embedQuery("registration")).toBe("[0.250000,0.500000]");
    expect(invoke).toHaveBeenCalledWith("knowledge-embeddings", { body: { texts: ["registration"] } });
  });
  it("keeps text-search fallback when embeddings are unavailable", async () => {
    invoke.mockResolvedValue({ data: null, error: { message: "Unavailable" } });
    expect(await embedQuery("registration")).toBeNull();
    expect(await embedTexts(["housing", "registration"])).toEqual([null, null]);
  });
  it("bounds batch size and preserves response ordering", async () => {
    invoke.mockImplementation(async (_name, { body }) => ({ data: { embeddings: body.texts.map((text: string) => `[${text.length}]`) } }));
    const result = await embedTexts([...Array(64).fill("a"), "x".repeat(9000)]);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(result[0]).toBe("[1]");
    expect(result[64]).toBe("[8000]");
  });
  it("rejects incomplete responses", async () => {
    invoke.mockResolvedValue({ data: { embeddings: [] } });
    expect(await embedQuery("registration")).toBeNull();
  });
});
