# Production Preparation Guide

This guide outlines the pragmatic path to prepare Anki Capture for 100k+ MAU. Focus areas: reliability, security, observability, storage lifecycle, costs, and UX.

## Architecture Shifts

- Event pipeline and jobs
  - Introduce a managed queue (Cloudflare Queues/Durable Object queue or SQS/PubSub).
  - Worker enqueues job records; stateless processors (Modal or self‑hosted GPU workers) pull and ack.
  - Maintain a jobs table for status/idempotency: queued → running → done/failed; keep phrase state separate.
- Scalable data
  - Move from D1 to managed Postgres/MySQL (e.g., Neon/Supabase/RDS or PlanetScale) for higher concurrency.
  - Optionally add KV/Redis (Upstash/KV) for hot status reads and rate limits.
- Signed media links
  - Serve `/api/files` via short‑lived signed URLs; enable CDN caching.
- Realtime at scale
  - Use managed pub/sub (Cloudflare Pub/Sub) or Workers + Durable Objects for WebSockets.
  - Workers publish job/phrase updates; clients subscribe per user. Keep polling as fallback.

## Processing Pipeline

- Autoscale compute
  - Define regional concurrency; autoscale Modal GPU pools or migrate to autoscaling GPU workers.
- Adaptive + caching
  - Whisper: choose model by duration; use faster‑whisper (CTranslate2) for bulk.
  - TTS: cache by `hash(text+language)`; dedupe across users.
  - Consider cheaper/structured models for grammar when acceptable.
- Idempotency + backpressure
  - Job IDs end‑to‑end; one current job per phrase; dedupe on `job_id`.
  - Per‑user concurrency caps; queue retries with exponential backoff; dead‑letter queue + alerts.

## API Layer (Workers)

- Stateless, multi‑region
  - Keep business logic stateless; per‑user rate limits via Durable Objects or KV counters.
  - Feature flags for safe rollouts; blue/green deploys for Worker/Modal.
- Environment config
  - Strict separation of dev/staging/prod; rotated secrets; production Clerk keys/issuer.

## Data & Storage Lifecycle

- Migrations + integrity
  - Versioned SQL migrations; verify in CI before deploy.
- R2 lifecycle policies
  - Lifecycle rules to transition/expire old originals; keep audio as needed.
- Orphan cleanup
  - Scheduled sweeps (already added); page through bucket listings and record metrics.
- Indexes & queries
  - Add indexes for `user_id`, `status`, `created_at`; keep queries simple and bounded.

## Observability & SRE

- Metrics + tracing
  - Structured logs with `request_id`, `user_id`, `phrase_id`, `job_id` and durations (enqueue → webhook → persisted).
- Centralized logs & alerts
  - Logpush (Workers) to Datadog/Splunk/S3; dashboards for p95 latency, error rates, queue depth, GPU utilization.
  - Alerts: 5xx spikes, webhook auth failures, enqueue errors, stuck processing count/age, queue backlog.
- Health & synthetics
  - `/api/health` (done) + external multi‑region checks; alert on non‑200.

## Security & Governance

- Clerk hardening
  - Set allowed origins/redirects; enforce production issuer; use `pk_live` in production.
- Signed URLs
  - Switch `/api/files` to signed URLs only; remove unauthenticated access; tighten CORS where possible.
- Quotas & abuse controls
  - Per‑user rate limits and soft/hard quotas for upload/regen/retry; feature gates as needed.
- Secrets
  - Rotate `MODAL_WEBHOOK_SECRET`; use environment store (Workers secrets/Modal secrets).

## Costs & Performance

- Caching
  - CDN cache for files with signed URLs and long `Cache-Control`.
  - TTS/Whisper output caching (when legal/consistent) to reduce compute.
- Model selection
  - Adaptive Whisper models; structured/cheaper LLMs where suitable.

## Frontend UX (Load‑Friendly)

- Realtime UI
  - Replace 10s polling with WS/DO or pub/sub when connected; reconnect/backoff indicator; fall back to polling.
- Review workflow
  - Inline Retry; show `last_error`/`job_attempts`; protect unsaved edits; keyboard shortcuts (Cmd/Ctrl+S);
  - Disable Approve while dirty; toasts for errors.
- Upload batch UX
  - Per‑file progress, error badges, thumbnails, better d&d cues; adjustable concurrency.
- Library
  - Filters/search/sort; multi‑select + batch actions (approve/delete/exclude).
- Export
  - Clear field mapping (now 6 fields, last is Transliteration); collapsible platform path help.

## Phased Plan

- Phase 1 (1–2 weeks)
  - Add queue + jobs table; signed URLs; per‑user rate limits.
  - Step‑timing logs; Logpush with basic alerts; versioned D1→Postgres migration plan.
- Phase 2
  - TTS/Whisper cache; adaptive models; move to Postgres; introduce pub/sub realtime.
- Phase 3
  - Deeper test/CI, feature flags, blue/green deploys, advanced alerts, usage quotas/tiers.

## Current Status Snapshot

- Implemented: idempotency (`current_job_id`), retry endpoint, cron timeout sweep, orphan sweeps, structured logging with `x-request-id`, `/api/health`, multi‑user scoping via Clerk, R2 cleanup on delete.
- In progress/next: signed URLs, job audit table & queue, rate limits, step duration metrics, language registry & transliteration flag, realtime pub/sub.

