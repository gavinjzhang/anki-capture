export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  MODAL_WEBHOOK_SECRET: string;
  MODAL_ENDPOINT?: string;
  MODAL_GENERATE_ENDPOINT?: string;
  ENVIRONMENT: string;
  CLERK_JWT_ISSUER?: string;
  CLERK_JWKS_URL?: string; // optional override for JWKS
  MAX_UPLOAD_MB?: string; // optional, default 20
  MAX_ORPHAN_SWEEP?: string; // optional, default 50 per run
  MIN_ORPHAN_AGE_MS?: string; // optional, default 24h
  FILE_URL_SIGNING_SECRET?: string; // HMAC secret for signed /api/files URLs
  ALLOWED_ORIGINS?: string; // Comma-separated list of allowed CORS origins
}

export type SourceType = 'image' | 'audio' | 'text';
export type PhraseStatus = 'processing' | 'pending_review' | 'approved' | 'exported';
export type Language = 'ru' | 'ar' | 'zh' | 'es' | 'ka';

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
  current_job_id: string | null;
  processing_step: string | null;
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
  current_job_id: string | null;
  processing_step: string | null;
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
  job_id?: string;
  type?: 'progress';
  step?: string;
}
