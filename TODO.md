# Project TODOs

## Core Reliability
- Modal retries/backoff: configure Modal to retry non-2xx with exponential backoff.
- Optional: job audit table for history and metrics (beyond current per-phrase `current_job_id`).

## Security / Auth
- Secrets: move `MODAL_WEBHOOK_SECRET` to Worker secret; rotate.

## DX / Config
- (Done) Env-based Modal endpoint
- (Done) Upload size/type validation

## Observability
- Add step duration metrics to logs (enqueue → webhook received → saved).
- (Done) `/api/health`
 - Event-driven updates: WebSocket + Durable Object per user; broadcast on upload/webhook/approve/delete; keep polling as fallback.

## Storage Lifecycle
- R2 lifecycle rules for old originals.
- Orphan sweep: scheduled clean-up for R2 keys not referenced in D1.

## Frontend UX
- Processing status: show job age, Retry button for failed/timeouts, hide stale.
- Batch polish: per-file progress/errors; configurable concurrency.
- Review: filters (language/date), search, bulk exclude/reject.
- Approve All: add “Approve Selected” with checkboxes.
 - Realtime: use WebSocket channel to update UI live; reconnect/backoff indicator.
 - Review: toast notifications on save/regen errors; keyboard shortcuts (Ctrl/Cmd+S); unsaved badge; disable Approve while dirty.
 - Review: show job_attempts and last_error; inline Retry button for failed/timeouts.
 - Library: quick filters (status/language), search by text, sortable columns.
 - Upload: per-file progress bars and error badges; drag-and-drop hover; image thumbnails.
 - Audio: playback speed control; small waveform; auto cache-bust on updates (done in Review).
 - Navigation: persist filters/search in URL; pagination or infinite scroll.

## Costs & Performance
- Adaptive Whisper: choose model by duration; optional CPU path for small clips.
- TTS cache: reuse audio by `hash(text+language)`.

## Testing
- Miniflare route tests (upload/text/webhook/export).
- Modal stub roundtrip test.
- Playwright smoke flow: upload → review → approve → export.

## Prompt Engineering (Grammar)
- Refine `generate_breakdown` prompts per language (system + user messages).
- Enforce JSON schema strictly (tooling or function calling) to reduce parse errors.
- Improve grammar guidance: examples, style constraints (concise vs. detailed), terminology consistency.
- Add evaluation set (gold examples) to iterate prompts safely.

## Anki Ingestion Format
- Define canonical export format: field order and delimiter.
  - Suggested fields: Front (source_text + transliteration), Back (translation), Grammar, Vocab JSON, Audio.
  - Use TSV with tab delimiter; escape newlines and tabs.
- Audio conventions: `[sound:<filename>.mp3]` and ensure filenames are unique and stable.
- Update export builder to guarantee ordering and escaping; include media folder in ZIP.
- Provide an `.apkg` option later via AnkiConnect or genanki (optional).

# Realtime
- Event-driven UI (WebSocket/DO): plan and implement; remove polling where possible.
