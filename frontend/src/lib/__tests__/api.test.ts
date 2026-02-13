import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as api from "../api";
import * as auth from "../auth";

// Mock auth module
vi.mock("../auth", () => ({
  getAuthToken: vi.fn(),
}));

describe("API Client", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock;
    vi.mocked(auth.getAuthToken).mockResolvedValue("test-token");
  });

  // Helper to check if URL ends with expected path (handles both relative and absolute URLs)
  const expectUrlEndsWith = (url: string, path: string) => {
    expect(url.endsWith(path)).toBe(true);
  };

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("uploadFile", () => {
    it("uploads a file with FormData", async () => {
      const mockFile = new File(["content"], "test.png", { type: "image/png" });
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ id: "phrase-123", status: "processing" }),
      });

      const result = await api.uploadFile(mockFile);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expectUrlEndsWith(url, "/api/upload");
      expect(options.method).toBe("POST");
      expect(options.headers.Authorization).toBe("Bearer test-token");
      expect(options.body).toBeInstanceOf(FormData);
      expect(result).toEqual({ id: "phrase-123", status: "processing" });
    });

    it("throws error on failed upload", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        json: async () => ({ error: "File too large" }),
      });

      await expect(api.uploadFile(new File([], "test.png"))).rejects.toThrow(
        "File too large"
      );
    });
  });

  describe("uploadText", () => {
    it("uploads text with language", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ id: "phrase-456", status: "processing" }),
      });

      const result = await api.uploadText("Привет", "ru");

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expectUrlEndsWith(url, "/api/upload/text");
      expect(options.method).toBe("POST");
      expect(options.headers["Content-Type"]).toBe("application/json");
      expect(options.headers.Authorization).toBe("Bearer test-token");
      expect(options.body).toBe(JSON.stringify({ text: "Привет", language: "ru" }));
      expect(result).toEqual({ id: "phrase-456", status: "processing" });
    });

    it("handles validation errors", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        json: async () => ({ error: "Text is required" }),
      });

      await expect(api.uploadText("", "ru")).rejects.toThrow("Text is required");
    });
  });

  describe("listPhrases", () => {
    it("lists all phrases without filter", async () => {
      const mockPhrases = [
        { id: "1", source_text: "Hello", status: "approved" },
        { id: "2", source_text: "World", status: "pending_review" },
      ];
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ phrases: mockPhrases }),
      });

      const result = await api.listPhrases();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expectUrlEndsWith(url, "/api/phrases");
      expect(options.headers.Authorization).toBe("Bearer test-token");
      expect(result.phrases).toEqual(mockPhrases);
    });

    it("lists phrases filtered by status", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ phrases: [] }),
      });

      await api.listPhrases("approved");

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url] = fetchMock.mock.calls[0];
      expectUrlEndsWith(url, "/api/phrases?status=approved");
    });
  });

  describe("getPhrase", () => {
    it("fetches a single phrase by ID", async () => {
      const mockPhrase = { id: "phrase-1", source_text: "Test", status: "approved" };
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ phrase: mockPhrase }),
      });

      const result = await api.getPhrase("phrase-1");

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expectUrlEndsWith(url, "/api/phrases/phrase-1");
      expect(options.headers.Authorization).toBe("Bearer test-token");
      expect(result.phrase).toEqual(mockPhrase);
    });

    it("throws error when phrase not found", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        json: async () => ({ error: "Phrase not found" }),
      });

      await expect(api.getPhrase("nonexistent")).rejects.toThrow("Phrase not found");
    });
  });

  describe("updatePhrase", () => {
    it("updates phrase fields", async () => {
      const updates = { translation: "Updated translation" };
      const mockPhrase = { id: "phrase-1", ...updates };
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ phrase: mockPhrase }),
      });

      const result = await api.updatePhrase("phrase-1", updates);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expectUrlEndsWith(url, "/api/phrases/phrase-1");
      expect(options.method).toBe("PATCH");
      expect(options.headers["Content-Type"]).toBe("application/json");
      expect(options.headers.Authorization).toBe("Bearer test-token");
      expect(options.body).toBe(JSON.stringify(updates));
      expect(result.phrase).toEqual(mockPhrase);
    });
  });

  describe("approvePhrase", () => {
    it("approves a phrase", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });

      await api.approvePhrase("phrase-1");

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expectUrlEndsWith(url, "/api/phrases/phrase-1/approve");
      expect(options.method).toBe("POST");
      expect(options.headers.Authorization).toBe("Bearer test-token");
    });
  });

  describe("deletePhrase", () => {
    it("deletes a phrase", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });

      await api.deletePhrase("phrase-1");

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expectUrlEndsWith(url, "/api/phrases/phrase-1");
      expect(options.method).toBe("DELETE");
      expect(options.headers.Authorization).toBe("Bearer test-token");
    });
  });

  describe("regenerateAudio", () => {
    it("regenerates audio without options", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });

      await api.regenerateAudio("phrase-1");

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expectUrlEndsWith(url, "/api/phrases/phrase-1/regenerate-audio");
      expect(options.method).toBe("POST");
      expect(options.headers.Authorization).toBe("Bearer test-token");
    });

    it("regenerates audio with custom text", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });

      await api.regenerateAudio("phrase-1", { source_text: "New text" });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expectUrlEndsWith(url, "/api/phrases/phrase-1/regenerate-audio");
      expect(options.method).toBe("POST");
      expect(options.headers["Content-Type"]).toBe("application/json");
      expect(options.body).toBe(JSON.stringify({ source_text: "New text" }));
    });

    it("regenerates audio with custom language", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });

      await api.regenerateAudio("phrase-1", { language: "ar" });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expectUrlEndsWith(url, "/api/phrases/phrase-1/regenerate-audio");
      expect(options.body).toBe(JSON.stringify({ language: "ar" }));
    });

    it("regenerates audio with both text and language", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });

      await api.regenerateAudio("phrase-1", {
        source_text: "مرحبا",
        language: "ar",
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expectUrlEndsWith(url, "/api/phrases/phrase-1/regenerate-audio");
      expect(options.body).toBe(JSON.stringify({ source_text: "مرحبا", language: "ar" }));
    });
  });

  describe("getExportData", () => {
    it("fetches export data", async () => {
      const mockData = {
        phrases: [
          { id: "1", line: "Hello\tBonjour", audio_url: "/audio/1.mp3" },
        ],
        txt_content: "Hello\tBonjour",
      };
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => mockData,
      });

      const result = await api.getExportData();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expectUrlEndsWith(url, "/api/export");
      expect(options.headers.Authorization).toBe("Bearer test-token");
      expect(result).toEqual(mockData);
    });
  });

  describe("getExportPreview", () => {
    it("fetches export preview", async () => {
      const mockPreview = {
        count: 5,
        preview: [{ id: "1", source_text: "Test", status: "approved" }],
      };
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => mockPreview,
      });

      const result = await api.getExportPreview();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url] = fetchMock.mock.calls[0];
      expectUrlEndsWith(url, "/api/export/preview");
      expect(result).toEqual(mockPreview);
    });
  });

  describe("markExported", () => {
    it("marks phrases as exported", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });

      await api.markExported(["phrase-1", "phrase-2", "phrase-3"]);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expectUrlEndsWith(url, "/api/export/complete");
      expect(options.method).toBe("POST");
      expect(options.headers["Content-Type"]).toBe("application/json");
      expect(options.headers.Authorization).toBe("Bearer test-token");
      expect(options.body).toBe(JSON.stringify({ phrase_ids: ["phrase-1", "phrase-2", "phrase-3"] }));
    });
  });

  describe("getFileUrl", () => {
    it("returns empty string for empty path", () => {
      expect(api.getFileUrl("")).toBe("");
    });

    it("returns absolute URLs unchanged", () => {
      const url = "https://example.com/file.mp3";
      expect(api.getFileUrl(url)).toBe(url);
    });

    it("converts absolute paths to API base", () => {
      const result = api.getFileUrl("/api/files/test.mp3");
      expect(result.endsWith("/api/files/test.mp3")).toBe(true);
    });

    it("converts key paths to API endpoint", () => {
      const result = api.getFileUrl("user-123/audio/phrase-456.mp3");
      expect(result.endsWith("/api/files/user-123%2Faudio%2Fphrase-456.mp3")).toBe(true);
    });
  });

  describe("error handling", () => {
    it("handles network errors", async () => {
      fetchMock.mockRejectedValue(new Error("Network error"));

      await expect(api.listPhrases()).rejects.toThrow("Network error");
    });

    it("handles malformed error responses", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        json: async () => {
          throw new Error("Invalid JSON");
        },
      });

      await expect(api.listPhrases()).rejects.toThrow("Request failed");
    });
  });

  describe("authentication", () => {
    it("includes auth token when available", async () => {
      vi.mocked(auth.getAuthToken).mockResolvedValue("my-token");
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ phrases: [] }),
      });

      await api.listPhrases();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, options] = fetchMock.mock.calls[0];
      expect(options.headers.Authorization).toBe("Bearer my-token");
    });

    it("omits auth header when token is null", async () => {
      vi.mocked(auth.getAuthToken).mockResolvedValue(null);
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ phrases: [] }),
      });

      await api.listPhrases();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, options] = fetchMock.mock.calls[0];
      expect(options.headers.Authorization).toBeUndefined();
    });
  });
});
