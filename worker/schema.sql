-- Anki Capture D1 Schema

CREATE TABLE IF NOT EXISTS phrases (
  id TEXT PRIMARY KEY,
  user_id TEXT,               -- Owner (from Access email or subject)
  source_text TEXT,
  transliteration TEXT,
  translation TEXT,
  grammar_notes TEXT,
  vocab_breakdown TEXT,        -- JSON array: [{word, root, meaning, gender, declension, notes}]
  detected_language TEXT,      -- 'ru' | 'ar'
  language_confidence REAL,
  source_type TEXT,            -- 'image' | 'audio' | 'text'
  audio_url TEXT,              -- R2 path to audio file
  original_file_url TEXT,      -- R2 path to original upload (null for text input)
  status TEXT DEFAULT 'processing',  -- processing | pending_review | approved | exported
  exclude_from_export INTEGER DEFAULT 0,
  job_started_at INTEGER,
  job_attempts INTEGER DEFAULT 0,
  last_error TEXT,
  current_job_id TEXT,
  processing_step TEXT,           -- Current processing step: extracting | analyzing | generating_audio
  created_at INTEGER,
  reviewed_at INTEGER,
  exported_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_phrases_status ON phrases(status);
CREATE INDEX IF NOT EXISTS idx_phrases_created ON phrases(created_at);
CREATE INDEX IF NOT EXISTS idx_phrases_export ON phrases(status, exclude_from_export);
CREATE INDEX IF NOT EXISTS idx_phrases_user ON phrases(user_id);

-- User settings (API keys, preferences)
CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT PRIMARY KEY,
  openai_api_key_encrypted TEXT,    -- AES-256-GCM ciphertext, base64-encoded
  openai_api_key_iv TEXT,           -- 12-byte IV, base64-encoded
  openai_api_key_mask TEXT,         -- Last 4 chars for display: "sk-...aBcD"
  created_at INTEGER,
  updated_at INTEGER
);
