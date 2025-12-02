-- Anki Capture D1 Schema

CREATE TABLE IF NOT EXISTS phrases (
  id TEXT PRIMARY KEY,
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
  created_at INTEGER,
  reviewed_at INTEGER,
  exported_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_phrases_status ON phrases(status);
CREATE INDEX IF NOT EXISTS idx_phrases_created ON phrases(created_at);
CREATE INDEX IF NOT EXISTS idx_phrases_export ON phrases(status, exclude_from_export);
