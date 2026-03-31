-- Migration: add provider-agnostic LLM key columns
-- Run: wrangler d1 execute anki-capture --file=migrations/0001_llm_provider.sql

ALTER TABLE user_settings ADD COLUMN llm_provider TEXT;
ALTER TABLE user_settings ADD COLUMN llm_model TEXT;
ALTER TABLE user_settings ADD COLUMN llm_api_key_encrypted TEXT;
ALTER TABLE user_settings ADD COLUMN llm_api_key_iv TEXT;
ALTER TABLE user_settings ADD COLUMN llm_api_key_mask TEXT;

-- Migrate existing OpenAI keys into new columns
UPDATE user_settings
SET
  llm_provider = 'openai',
  llm_model = 'gpt-4o',
  llm_api_key_encrypted = openai_api_key_encrypted,
  llm_api_key_iv = openai_api_key_iv,
  llm_api_key_mask = openai_api_key_mask
WHERE openai_api_key_encrypted IS NOT NULL;
