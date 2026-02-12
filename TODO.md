# Project TODOs

## Core Reliability
- Modal retries/backoff: configure Modal to retry non-2xx with exponential backoff.
- Optional: job audit table for history and metrics (beyond current per-phrase `current_job_id`).
 - Per-user backpressure: cap concurrent jobs, queue retries.

## Security / Auth
- Secrets: move `MODAL_WEBHOOK_SECRET` to Worker secret; rotate.
 - Signed URLs: serve `/api/files` via short-lived signed URLs; remove unauthenticated access.
 - Clerk hardening: configure allowed origins/redirects; ensure prod issuer/keys.
 - Rate limits: per-user limits for upload/regen/retry to curb abuse.

## DX / Config
- (Done) Env-based Modal endpoint
- (Done) Upload size/type validation
 - Language registry: centralize language-specific config (name/flag/dir, OCR locale aliases, prompt guidance, TTS codes/voices) in a single JSON/module used by Modal, Worker, and Frontend; optionally generate TS types from it.
 - Transliteration flag: add per-language and/or per-user setting to control whether transliteration is generated and shown (UI toggle + export include/exclude); default on only where useful.
 - Versioned D1 migrations: maintain SQL migrations and wrangler scripts.

## Observability
- Add step duration metrics to logs (enqueue → webhook received → saved).
- (Done) `/api/health`
 - (Done) Adaptive polling: Smart polling intervals (3s when processing, 30s idle) with tab visibility handling
 - Event-driven updates (Future): WebSocket + Durable Object per user; broadcast on upload/webhook/approve/delete (deferred - polling is sufficient)
 - Logpush + alerts: 5xx spikes, webhook auth failures, enqueue errors, stuck processing counts.
 - Synthetics: external ping checks for `/api/health`.

## Storage Lifecycle
- R2 lifecycle rules for old originals.
- Orphan sweep: scheduled clean-up for R2 keys not referenced in D1.
 - Paged sweeps: iterate bucket pages over time; record metrics.

## Frontend UX
- (Done) Adaptive polling replaces fixed intervals; immediate updates after user actions
- Processing status: show job age, Retry button for failed/timeouts, hide stale.
- Batch polish: per-file progress/errors; configurable concurrency.
- Review: filters (language/date), search, bulk exclude/reject.
- Approve All: add "Approve Selected" with checkboxes.
 - Review: toast notifications on save/regen errors; keyboard shortcuts (Ctrl/Cmd+S); unsaved badge; disable Approve while dirty.
 - Review: show job_attempts and last_error; inline Retry button for failed/timeouts.
 - Library: quick filters (status/language), search by text, sortable columns.
 - Library: multi-select and batch actions (approve/delete/exclude) with progress and confirmation.
 - Upload: per-file progress bars and error badges; drag-and-drop hover; image thumbnails.
 - Audio: playback speed control; small waveform; auto cache-bust on updates (done in Review).
 - Navigation: persist filters/search in URL; pagination or infinite scroll.

## Costs & Performance
- Adaptive Whisper: choose model by duration; optional CPU path for small clips.
- TTS cache: reuse audio by `hash(text+language)`.
 - Caching/CDN: leverage long Cache-Control for files; CDN cache with signed URLs.

## Testing
- ✅ Worker tests: signing (18 tests), webhook (8 tests) - ALL PASSING
- ✅ Frontend tests: adaptive polling hook (5 tests, 3 skipped) - PASSING
- ✅ E2E smoke tests: Playwright specs (6 scenarios) - ALL PASSING
- ✅ CI pipeline: typecheck, test, build, E2E on every PR - CONFIGURED
- Additional route tests: upload, export, phrases CRUD
- Modal stub roundtrip test
- Full E2E flow: upload → processing → approve → export (with actual Modal)
- Staging environment + deployment guards

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

# Realtime (Deferred)
- Event-driven UI (WebSocket/DO): Evaluated and deferred in favor of adaptive polling (industry standard per AWS/Vercel).
- Adaptive polling implemented following production best practices (AWS CloudFormation: 30s intervals, smart backoff).
- Future: Consider SSE for webhook events only if adaptive polling proves insufficient.
