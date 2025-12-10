# Project TODOs

## Core Reliability
- Job timeouts + retries: cron marks `processing` > N min to `pending_review (timed out)`; add `/api/phrases/:id/retry` to requeue.
- Idempotent webhooks: include `request_id`, dedupe on D1; Modal retries on non-2xx with backoff.
- Persist processing metadata: `job_started_at`, `job_attempts`, `last_error` columns.

## Security / Auth
- Cloudflare Access SSO: verify Access JWT in Worker; bypass `/api/webhook/modal`.
- Multi-user scoping: add `user_id` to D1 `phrases`; scope all queries by `user_id`.
- R2 namespacing: prefix object keys with `user_id/`.
- Secrets: move `MODAL_WEBHOOK_SECRET` to Worker secret; rotate.

## DX / Config
- Env-based Modal endpoint: read `MODAL_ENDPOINT` from Worker vars for dev/prod.
- Enforce file size/type limits at Worker (image/audio).

## Observability
- Structured logs with `phrase_id`/`request_id`; step durations.
- `/api/health`: quick DB + R2 checks.

## Storage Lifecycle
- R2 lifecycle rules for old originals; delete media on phrase delete.
- Orphan sweep: scheduled clean-up for R2 keys not referenced in D1.

## Frontend UX
- Processing status: show job age, retry button, hide stale.
- Batch polish: per-file progress/errors; configurable concurrency.
- Review: filters (language/date), search, bulk exclude/reject.
- Approve All: add “Approve Selected” with checkboxes.

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

