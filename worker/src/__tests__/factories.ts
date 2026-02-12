import type { Env, Phrase, VocabItem } from "../types";

/**
 * Generate a random ID for testing
 */
export function randomId(prefix = "test"): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Create a mock phrase with sensible defaults
 */
export function createMockPhrase(overrides: Partial<Phrase> = {}): Phrase {
  const id = overrides.id || randomId("phrase");
  const now = Date.now();

  return {
    id,
    source_text: "Привет, как дела?",
    transliteration: "Privet, kak dela?",
    translation: "Hello, how are you?",
    grammar_notes:
      "Informal greeting. 'Привет' is casual hello, 'как дела' means 'how are things'.",
    vocab_breakdown: [
      {
        word: "Привет",
        root: null,
        meaning: "Hello",
        gender: null,
        declension: null,
        notes: "Informal greeting",
      },
      {
        word: "как",
        root: null,
        meaning: "how",
        gender: null,
        declension: null,
        notes: "Interrogative adverb",
      },
      {
        word: "дела",
        root: "дело",
        meaning: "things/affairs",
        gender: "n",
        declension: "nom pl",
        notes: "Plural of дело",
      },
    ],
    detected_language: "ru",
    language_confidence: 0.99,
    source_type: "text",
    audio_url: `audio/${id}.mp3`,
    original_file_url: null,
    status: "pending_review",
    exclude_from_export: false,
    job_started_at: null,
    job_attempts: 0,
    last_error: null,
    current_job_id: null,
    created_at: now,
    reviewed_at: null,
    exported_at: null,
    ...overrides,
  };
}

/**
 * Create a mock vocab item
 */
export function createMockVocabItem(
  overrides: Partial<VocabItem> = {}
): VocabItem {
  return {
    word: "тест",
    root: "тест",
    meaning: "test",
    gender: "m",
    declension: "nom sg",
    notes: "Test word",
    ...overrides,
  };
}

/**
 * Create a mock request helper
 */
export function createMockRequest(
  url: string,
  options: RequestInit = {}
): Request {
  return new Request(url, options);
}

/**
 * Create a mock authenticated request with Clerk JWT simulation
 */
export function createAuthRequest(
  url: string,
  userId = "test-user-123",
  options: RequestInit = {}
): Request {
  return new Request(url, {
    ...options,
    headers: {
      ...options.headers,
      // In real environment, this would be a valid JWT
      // For tests, we'll use a simple header (auth.ts should handle test mode)
      "x-user-id": userId,
    },
  });
}

/**
 * Create mock Modal webhook payload (success)
 */
export function createMockWebhookPayload(phraseId: string, overrides = {}) {
  return {
    phrase_id: phraseId,
    success: true,
    result: {
      source_text: "Привет",
      transliteration: "Privet",
      translation: "Hello",
      grammar_notes: "Informal greeting",
      vocab_breakdown: [
        {
          word: "Привет",
          root: null,
          meaning: "Hello",
          gender: null,
          declension: null,
          notes: null,
        },
      ],
      detected_language: "ru",
      language_confidence: 0.99,
      audio_url: `audio/${phraseId}.mp3`,
    },
    job_id: randomId("job"),
    ...overrides,
  };
}

/**
 * Create mock Modal webhook payload (failure)
 */
export function createMockWebhookError(phraseId: string, error: string) {
  return {
    phrase_id: phraseId,
    success: false,
    error,
    job_id: randomId("job"),
  };
}
