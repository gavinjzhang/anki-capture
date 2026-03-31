-- Migration: daily LLM usage tracking for free-tier users
-- Run: wrangler d1 execute anki-capture --file=migrations/0002_daily_llm_usage.sql --remote

CREATE TABLE IF NOT EXISTS daily_llm_usage (
  user_id TEXT NOT NULL,
  date    TEXT NOT NULL,   -- UTC date: 'YYYY-MM-DD'
  count   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date)
);
