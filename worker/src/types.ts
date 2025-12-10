export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  MODAL_WEBHOOK_SECRET: string;
  ENVIRONMENT: string;
  CLERK_JWT_ISSUER?: string;
  CLERK_JWKS_URL?: string; // optional override for JWKS
  MAX_UPLOAD_MB?: string; // optional, default 20
}

export type SourceType = 'image' | 'audio' | 'text';
export type PhraseStatus = 'processing' | 'pending_review' | 'approved' | 'exported';
export type Language = 'ru' | 'ar';

export interface VocabItem {
  word: string;
  root: string | null;
  meaning: string;
  gender: string | null;
  declension: string | null;
  notes: string | null;
}

export interface Phrase {
  id: string;
  // user_id is stored in DB but not exposed to clients
  source_text: string | null;
  transliteration: string | null;
  translation: string | null;
  grammar_notes: string | null;
  vocab_breakdown: VocabItem[] | null;
  detected_language: Language | null;
  language_confidence: number | null;
  source_type: SourceType;
  audio_url: string | null;
  original_file_url: string | null;
  status: PhraseStatus;
  exclude_from_export: boolean;
  job_started_at: number | null;
  job_attempts: number;
  last_error: string | null;
  created_at: number;
  reviewed_at: number | null;
  exported_at: number | null;
}

export interface PhraseRow {
  id: string;
  user_id: string | null;
  source_text: string | null;
  transliteration: string | null;
  translation: string | null;
  grammar_notes: string | null;
  vocab_breakdown: string | null;  // JSON string in DB
  detected_language: string | null;
  language_confidence: number | null;
  source_type: string;
  audio_url: string | null;
  original_file_url: string | null;
  status: string;
  exclude_from_export: number;
  job_started_at: number | null;
  job_attempts: number | null;
  last_error: string | null;
  created_at: number;
  reviewed_at: number | null;
  exported_at: number | null;
}

export interface UploadRequest {
  type: SourceType;
  language?: Language;  // Required for text input, optional for image/audio
  text?: string;        // For text input only
}

export interface ProcessingResult {
  phrase_id: string;
  source_text: string;
  transliteration: string;
  translation: string;
  grammar_notes: string;
  vocab_breakdown: VocabItem[];
  detected_language: Language;
  language_confidence: number;
  audio_url: string;
}

export interface ModalWebhookPayload {
  phrase_id: string;
  success: boolean;
  result?: ProcessingResult;
  error?: string;
}
