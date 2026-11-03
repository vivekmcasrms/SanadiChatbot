import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadIssuedDocument } from "./download";

const getUrl = vi.hoisted(() => vi.fn());
vi.mock("@/lib/documents.functions", () => ({ getDocumentDownloadUrl: getUrl }));
vi.mock("@/lib/auth-token", () => ({ apiUrl: (path: string) => `https://api.test${path}` }));

const fetchPdf = vi.fn();
const link = { href: "", download: "", hidden: false, click: vi.fn(), remove: vi.fn() };
const createElement = vi.fn(() => link);
const appendChild = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.stubGlobal("fetch", fetchPdf);
  vi.stubGlobal("document", { createElement, body: { appendChild } });
  // A blocked popup must not prevent the file download.
  vi.stubGlobal("window", { open: vi.fn(() => null) });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test-download");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  getUrl.mockResolvedValue({ url: "/object/sign/student-letters/file.pdf?token=test", fileName: "issued-reference.pdf" });
  fetchPdf.mockResolvedValue(new Response("%PDF-stored-original", { headers: { "content-type": "application/pdf" } }));
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("issued document downloads", () => {
  it("saves the original PDF with the returned filename without opening a popup", async () => {
    await downloadIssuedDocument("issued-document-id");
    expect(getUrl).toHaveBeenCalledWith({ data: { documentId: "issued-document-id", mode: "download" } });
    expect(fetchPdf).toHaveBeenCalledWith("https://api.test/storage/v1/object/sign/student-letters/file.pdf?token=test", {
      credentials: "omit", referrerPolicy: "no-referrer",
    });
    const savedBlob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
    expect(await savedBlob.text()).toBe("%PDF-stored-original");
    expect(link.href).toBe("blob:test-download");
    expect(link.download).toBe("issued-reference.pdf");
    expect(appendChild).toHaveBeenCalledWith(link);
    expect(link.click).toHaveBeenCalledOnce();
    expect(link.remove).toHaveBeenCalledOnce();
    expect(window.open).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test-download");
  });

  it.each([
    ["https://api.test/storage/v1/object/sign/file.pdf?token=a%2Fb", "https://api.test/storage/v1/object/sign/file.pdf?token=a%2Fb"],
    ["/storage/v1/object/sign/file.pdf?token=a%2Fb", "https://api.test/storage/v1/object/sign/file.pdf?token=a%2Fb"],
    ["http://api.test/storage/v1/object/sign/file.pdf?token=a%2Fb%3D%3D", "https://api.test/storage/v1/object/sign/file.pdf?token=a%2Fb%3D%3D"],
    ["http://api.test:80/api/v1/storage/object/sign/file.pdf?token=a%2Fb", "https://api.test/api/v1/storage/object/sign/file.pdf?token=a%2Fb"],
    ["https://external.test/storage/v1/object/sign/file.pdf?token=a%2Fb", "https://external.test/storage/v1/object/sign/file.pdf?token=a%2Fb"],
  ])("preserves the signed URL %s", async (url, expected) => {
    getUrl.mockResolvedValue({ url, fileName: "letter.pdf" });
    await downloadIssuedDocument("issued-document-id");
    expect(fetchPdf).toHaveBeenCalledWith(expected, expect.any(Object));
  });

  it("surfaces a storage failure instead of downloading the error response", async () => {
    fetchPdf.mockResolvedValue(new Response("Not found", { status: 404 }));
    await expect(downloadIssuedDocument("issued-document-id")).rejects.toThrow("HTTP 404");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(link.click).not.toHaveBeenCalled();
  });

  it("does not attempt a file download when document authorization fails", async () => {
    getUrl.mockRejectedValue(new Error("Document unavailable"));
    await expect(downloadIssuedDocument("issued-document-id")).rejects.toThrow("Document unavailable");
    expect(fetchPdf).not.toHaveBeenCalled();
    expect(link.click).not.toHaveBeenCalled();
  });

  it("surfaces a network failure without creating a download", async () => {
    fetchPdf.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(downloadIssuedDocument("issued-document-id")).rejects.toThrow("Failed to fetch");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(link.click).not.toHaveBeenCalled();
  });
});
