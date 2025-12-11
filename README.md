# Anki Capture

A serverless app for capturing Russian and Arabic phrases from screenshots, audio recordings, or text input, processing them with OCR/transcription and AI-powered grammar breakdowns, and exporting to Anki.

## Architecture

```
┌─────────────────┐
│  Frontend       │  Cloudflare Pages (React + Vite)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  API Worker     │  Cloudflare Workers
│  - Upload to R2 │
│  - CRUD phrases │
│  - Trigger jobs │
└────────┬────────┘
         │
    ┌────┴────┬──────────┐
    ▼         ▼          ▼
┌──────┐  ┌──────┐  ┌─────────┐
│  R2  │  │  D1  │  │  Modal  │
│files │  │SQLite│  │processing│
└──────┘  └──────┘  └─────────┘
```

## Features

- **Three input modes**: Screenshot (OCR), Audio (Whisper), Text
- **Auto language detection** for Russian and Arabic
- **AI-powered breakdown**: Translation, transliteration, grammar notes, vocabulary with roots/declensions
- **TTS generation** using Edge TTS for image/text inputs
- **Review UI**: Edit all fields before approving
- **Anki export**: ZIP with txt + audio files

## Setup

### Prerequisites

- Node.js 18+
- Python 3.11+
- Cloudflare account
- Modal account
- Google Cloud account (for Vision API)
- OpenAI API key

### 1. Cloudflare Setup

```bash
cd worker

# Install dependencies
npm install

# Ensure Wrangler v4 is installed in devDependencies
npm install --save-dev wrangler@4

# Login to Cloudflare
npx wrangler login

# Create D1 database
npx wrangler d1 create anki-capture
# Copy the database_id to wrangler.toml

# Create R2 buckets (prod and dev)
npx wrangler r2 bucket create anki-capture-files
npx wrangler r2 bucket create anki-capture-files-dev

# Initialize database
npm run db:init

# Deploy worker
npm run deploy

### Scheduled sweeps (timeouts)

The Worker includes a cron that runs every 15 minutes to move stuck jobs from `processing` to `pending_review` and record a timeout error. The schedule is defined in `wrangler.toml` under `[triggers] crons`.

## Auth: Clerk (recommended)
Adds multi-user accounts with hosted auth UI. The frontend sends a Clerk JWT; the Worker verifies it and scopes all data by `user_id` (Clerk user `sub`). R2 keys are namespaced by `user_id`.

Setup

- Create a Clerk application at clerk.com
- Get keys and issuer:
  - Publishable Key (frontend) → `VITE_CLERK_PUBLISHABLE_KEY`
  - Secret Key (backend) → not required here; we verify via JWKS
  - JWT Issuer URL → `CLERK_JWT_ISSUER` (e.g., `https://your-app.clerk.accounts.dev`)

Frontend

1) Configure env in Pages or `.env.local`:
   - `VITE_CLERK_PUBLISHABLE_KEY=pk_test_...`
   - `VITE_API_BASE=https://anki-capture-api.<account>.workers.dev` (or leave empty to same-origin)
2) App is already wrapped in `ClerkProvider`, with SignIn and User buttons in the navbar. Tokens are sent automatically on API requests.

Worker

1) Set environment variables in `wrangler.toml` or via dashboard:
   - `CLERK_JWT_ISSUER="https://your-app.clerk.accounts.dev"`
   - (optional) `CLERK_JWKS_URL` if you use a custom JWKS location
2) Deploy: `cd worker && npx wrangler deploy -e production`

Notes

- Webhook `/api/webhook/modal` and unauthenticated asset fetches by Modal remain open. To fully lock down `/api/files`, switch to signed URLs.
- For local dev without Clerk, the app falls back to `x-user` header or `dev@local`.

### Multi-user Deployment Guide (Backfill + Migration)

This guide assumes you previously ran single-user (no `user_id`) and want to migrate.

1) Deploy updated Worker
- `cd worker && npx wrangler deploy -e production`
- Optionally set `ADMIN_EMAILS` (comma-separated) in Worker vars to restrict admin endpoints.

2) Enable Cloudflare Access
- Protect both your Worker route and your Pages domain with Access.
- After enabling, requests include `Cf-Access-Authenticated-User-Email` which the Worker uses as `user_id`.

3) Backfill `user_id` for legacy rows (via D1)
- Decide your `user_id` convention. With Clerk we use the user `sub` (stable). Copy your id from the Clerk Dashboard → Users.
- Run these against production D1:
  - `npx wrangler d1 execute anki-capture --remote --command "ALTER TABLE phrases ADD COLUMN user_id TEXT;"` (ignore error if column exists)
  - `npx wrangler d1 execute anki-capture --remote --command "CREATE INDEX IF NOT EXISTS idx_phrases_user ON phrases(user_id);"`
  - `npx wrangler d1 execute anki-capture --remote --command "UPDATE phrases SET user_id = '<your-clerk-user-id>' WHERE user_id IS NULL;"`

4) Legacy R2 keys (optional)
- The Worker temporarily allows fetching legacy keys (`original/...`, `audio/...`) even when authenticated, so you can skip immediate R2 migration.
- New uploads will be saved under `<user_id>/original/...` and `<user_id>/audio/...`.

5) Verify
- Open Library/Review; audio and originals should load under your namespace.
- New uploads will be automatically namespaced.

6) Add more users
- No extra setup needed; Access email becomes their `user_id`. Their uploads and DB rows are isolated by namespace.
```

### 2. Modal Setup

```bash
cd modal

# Install Modal
pip install modal

# Login
modal setup

# Create secrets
# Note: You can optionally customize Google Cloud TTS voices via env vars below.
modal secret create anki-capture-secrets \
  OPENAI_API_KEY=sk-... \
  GOOGLE_CREDENTIALS_JSON='{"type": "service_account", ...}' \
  MODAL_WEBHOOK_SECRET=your-random-secret \
  GCP_TTS_AR_VOICE=ar-XA-Wavenet-B \
  GCP_TTS_RU_VOICE=ru-RU-Wavenet-C

# Deploy
modal deploy app.py
```

After deployment, copy the Modal endpoint URL (something like `https://your-username--anki-capture-trigger.modal.run`) and update it in `worker/src/lib/modal.ts`.

Tip: To see available Google Cloud TTS voices:

```bash
python - <<'PY'
from google.cloud import texttospeech
from google.oauth2 import service_account
import os, json
creds = json.loads(os.environ['GOOGLE_CREDENTIALS_JSON'])
client = texttospeech.TextToSpeechClient(credentials=service_account.Credentials.from_service_account_info(creds))
voices = client.list_voices().voices
for v in voices:
    if any(x in v.name for x in ('ru-RU','ar-XA')):
        print(v.name, v.language_codes, v.ssml_gender)
PY
```

### 3. Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# For local development
# Option A: Point frontend to deployed Worker
echo 'VITE_API_BASE=https://anki-capture-api.<your-account>.workers.dev' > .env.local
npm run dev  # Starts on http://localhost:5173

# Option B: Use local Worker with Vite proxy (defaults to http://localhost:8787)
# Make sure the Worker is running locally before this: (cd worker && npm run dev)
# Then run:
# npm run dev

# Build for production
npm run build
```

### 4. Deploy Frontend to Cloudflare Pages

```bash
cd frontend
npm run build

# Connect to Pages via Cloudflare dashboard, or:
npx wrangler pages deploy dist --project-name=anki-capture
```

### 5. Update Worker Config

Update `worker/wrangler.toml`:
- Set `MODAL_WEBHOOK_SECRET` to match the Modal secret
- Verify D1 database_id is correct
- Ensure R2 uses a separate dev bucket by having:
  - `bucket_name = "anki-capture-files"`
  - `preview_bucket_name = "anki-capture-files-dev"`

Redeploy worker:
```bash
cd worker
npm run deploy
```

## Local Development

### Run Worker locally
```bash
cd worker
npm run db:init:local  # Initialize local D1
npm run dev            # Starts on localhost:8787
```

### Run Frontend locally
```bash
cd frontend
npm run dev  # Starts on localhost:5173, proxies /api to :8787
```

## Usage

1. **Upload**: Open the app, choose input mode (image/audio/text), upload or type
2. **Wait**: Modal processes the file (10-60 seconds)
3. **Review**: Check the Review page, edit any incorrect fields, approve
4. **Export**: Go to Export page, download ZIP
5. **Import to Anki**:
   - Extract ZIP
   - Copy `media/*` to Anki's `collection.media` folder
   - File → Import → select `phrases.txt`
   - Map fields: Front, Back, Grammar, Vocab, Audio

## Cost Estimates

For personal use (~50 phrases/month):

| Service | Cost |
|---------|------|
| Cloudflare (Workers, D1, R2, Pages) | Free tier |
| Modal (Whisper, processing) | ~$5-10/month |
| OpenAI API (GPT-4 for breakdowns) | ~$2-5/month |
| Google Vision API | Free tier (1000 images/month) |

Total: ~$10-15/month for moderate use

## Customization

### Adding Languages

1. Update types in `worker/src/types.ts` to include new language code
2. Add voice mapping in `modal/app.py` `generate_tts()` function
3. Add language-specific prompt in `modal/app.py` `generate_breakdown()`
4. Update frontend language selector in `Upload.tsx`

### Changing TTS Voices

Edit `modal/app.py`:
```python
voices = {
    "ru": "ru-RU-DmitryNeural",  # or ru-RU-SvetlanaNeural
    "ar": "ar-SA-HamedNeural",   # or ar-EG-SalmaNeural for Egyptian
}
```

See [Edge TTS voices](https://github.com/rany2/edge-tts) for full list.

## Troubleshooting

### Phrases stuck in "processing"
- Check Modal logs: `modal app logs anki-capture`
- Verify webhook URL is correct in worker
- Check webhook secret matches

### OCR quality issues
- Google Vision works best with clear, high-contrast text
- For handwriting, results may vary

### Audio transcription issues
- Whisper medium model is used; for better Arabic, try `large`
- Background noise affects quality

## License

MIT
### Upload Limits

You can cap upload size in the Worker:

- Set `MAX_UPLOAD_MB` in `wrangler.toml` (or dashboard). Default: 20
### Modal endpoint configuration

Set the Modal trigger URL via the Worker env var `MODAL_ENDPOINT` (in `wrangler.toml` or dashboard). The Worker no longer uses a hardcoded URL.

Example:

```
[vars]
MODAL_ENDPOINT = "https://<your-username>--anki-capture-trigger.modal.run"
```
