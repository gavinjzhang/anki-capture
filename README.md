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

## Optional: Protect with Cloudflare Access (multi-user)
To enable multi-user isolation, put the Worker and Pages behind Cloudflare Access. The Worker will derive a user ID from the `Cf-Access-Authenticated-User-Email` header and scope all data to that user. R2 object keys are namespaced by user.

Steps:

1) Create an Access application for your Worker route and Pages domain.
2) Add an Access policy (One-time PIN, Google, GitHub, etc.).
3) No code changes required; the Worker reads the Access header automatically.

Notes:
- For local development, you can simulate users by sending `x-user: alice@example.com` or rely on a default `dev@local` user.
- The `/api/webhook/modal` and file fetches used by Modal are not Access-protected; if you want to lock down `/api/files`, switch to signed URLs.
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
