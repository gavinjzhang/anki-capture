"""
Anki Capture - Modal Processing App

Handles:
- Whisper transcription (audio)
- Google Vision OCR (images)  
- LLM translation + grammar breakdown
- Google Cloud TTS audio generation
"""

import modal
import httpx
import json
import os
from typing import Optional
import base64

app = modal.App("anki-capture")

# Images with dependencies
whisper_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install(
        "openai-whisper",
        "torch",
        "torchaudio",
    )
)

processing_image = modal.Image.debian_slim(python_version="3.11").pip_install(
    "httpx",
    "google-cloud-vision",
    "google-cloud-texttospeech",
    "openai",
    # Required for @modal.web_endpoint functions
    "fastapi",
)


@app.function(
    image=whisper_image,
    gpu="T4",
    timeout=300,
    retries=2,
    secrets=[modal.Secret.from_name("anki-capture-secrets")],
)
def transcribe_audio(audio_url: str) -> dict:
    """Transcribe audio using Whisper."""
    import whisper
    import tempfile
    
    # Download audio file with retries
    for attempt in range(3):
        try:
            response = httpx.get(audio_url, timeout=60, follow_redirects=True)
            response.raise_for_status()
            break
        except Exception as e:
            if attempt == 2:
                raise Exception(f"Failed to download audio after 3 attempts: {e}")
    
    # Determine file extension from content type
    content_type = response.headers.get('content-type', 'audio/mpeg')
    ext_map = {
        'audio/mpeg': '.mp3',
        'audio/mp3': '.mp3',
        'audio/wav': '.wav',
        'audio/webm': '.webm',
        'audio/ogg': '.ogg',
        'audio/m4a': '.m4a',
        'audio/mp4': '.m4a',
    }
    ext = ext_map.get(content_type, '.mp3')
    
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as f:
        f.write(response.content)
        audio_path = f.name
    
    try:
        # Load model and transcribe
        model = whisper.load_model("medium")
        result = model.transcribe(audio_path, task="transcribe")
        
        return {
            "text": result["text"].strip(),
            "language": result["language"],
            "confidence": result.get("language_probability", 0.9),
        }
    finally:
        os.unlink(audio_path)


@app.function(
    image=processing_image,
    timeout=120,
    retries=2,
    secrets=[modal.Secret.from_name("anki-capture-secrets")],
)
def ocr_image(image_url: str) -> dict:
    """Extract text from image using Google Vision."""
    from google.cloud import vision
    from google.oauth2 import service_account
    
    # Download image with retries
    for attempt in range(3):
        try:
            response = httpx.get(image_url, timeout=60, follow_redirects=True)
            response.raise_for_status()
            break
        except Exception as e:
            if attempt == 2:
                raise Exception(f"Failed to download image after 3 attempts: {e}")
    
    image_content = response.content
    
    # Setup Vision client
    credentials_json = os.environ.get("GOOGLE_CREDENTIALS_JSON")
    if not credentials_json:
        raise Exception("GOOGLE_CREDENTIALS_JSON not configured")
    
    credentials = service_account.Credentials.from_service_account_info(
        json.loads(credentials_json)
    )
    client = vision.ImageAnnotatorClient(credentials=credentials)
    
    image = vision.Image(content=image_content)
    response = client.text_detection(image=image)
    
    if response.error.message:
        raise Exception(f"Vision API error: {response.error.message}")
    
    texts = response.text_annotations
    if not texts:
        return {"text": "", "language": None, "confidence": 0}
    
    full_text = texts[0].description.strip()
    
    # Detect language from the response
    detected_lang = None
    if texts[0].locale:
        lang_map = {
            "ru": "ru", "ar": "ar", 
            "rus": "ru", "ara": "ar",
            "russian": "ru", "arabic": "ar"
        }
        locale_lower = texts[0].locale.lower()
        detected_lang = lang_map.get(locale_lower[:2]) or lang_map.get(locale_lower)
    
    return {
        "text": full_text,
        "language": detected_lang,
        "confidence": 0.85,
    }


@app.function(
    image=processing_image,
    timeout=180,
    retries=2,
    secrets=[modal.Secret.from_name("anki-capture-secrets")],
)
def generate_breakdown(
    source_text: str,
    language: str,
) -> dict:
    """Generate translation, transliteration, and grammar/vocab breakdown."""
    from openai import OpenAI
    
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise Exception("OPENAI_API_KEY not configured")
    
    client = OpenAI(api_key=api_key)
    
    lang_name = "Russian" if language == "ru" else "Arabic"
    
    # Language-specific prompt adjustments
    if language == "ru":
        vocab_instructions = """
For each significant word, provide:
- word: the word as it appears in the text
- root: base/infinitive form (for verbs) or nominative singular (for nouns/adjectives)
- meaning: English translation
- gender: m/f/n for nouns, or null for other parts of speech
- declension: grammatical form info (case, number, tense, aspect, etc.)
- notes: aspect for verbs (perfective/imperfective), any irregularities, or usage notes

Focus on content words. Include particles/prepositions only if they have special meaning in context.
"""
    else:  # Arabic
        vocab_instructions = """
For each significant word, provide:
- word: the word as it appears (with diacritics/harakat if helpful for pronunciation)
- root: the 3 or 4 letter root separated by dashes (e.g., ك-ت-ب)
- meaning: English translation
- gender: m/f for nouns, or null
- declension: grammatical state (definite/indefinite, case, number, verb form I-X)
- notes: verb pattern, any irregularities, or usage notes

Focus on content words. Include common particles if they affect meaning.
"""
    
    prompt = f"""Analyze this {lang_name} text and provide a complete breakdown for language learning.

Text: {source_text}

Provide your response as JSON with these exact fields:
{{
  "transliteration": "Romanized/phonetic version of the text (use standard transliteration system)",
  "translation": "Natural, idiomatic English translation",
  "grammar_notes": "Explain key grammatical structures at the sentence level. Note word order, case usage, verb aspects, agreement patterns, etc.",
  "vocab_breakdown": [
    {{"word": "...", "root": "...", "meaning": "...", "gender": "...", "declension": "...", "notes": "..."}}
  ]
}}

{vocab_instructions}

Be thorough but concise. This is for an intermediate language learner who wants to understand both the meaning and the grammar.

Respond ONLY with valid JSON. No markdown, no code blocks, no extra text."""

    for attempt in range(3):
        try:
            response = client.chat.completions.create(
                model="gpt-4o",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.3,
                response_format={"type": "json_object"},
            )
            
            result = json.loads(response.choices[0].message.content)
            
            # Validate required fields
            if not all(k in result for k in ["transliteration", "translation", "grammar_notes", "vocab_breakdown"]):
                raise ValueError("Missing required fields in response")
            
            return result
            
        except json.JSONDecodeError as e:
            if attempt == 2:
                raise Exception(f"Failed to parse LLM response as JSON: {e}")
        except Exception as e:
            if attempt == 2:
                raise


@app.function(
    image=processing_image,
    timeout=60,
    retries=2,
    secrets=[modal.Secret.from_name("anki-capture-secrets")],
)
async def generate_tts(text: str, language: str) -> bytes:
    """Generate TTS audio using Google Cloud Text-to-Speech (Standard voices)."""
    from google.cloud import texttospeech
    from google.oauth2 import service_account
    
    credentials_json = os.environ.get("GOOGLE_CREDENTIALS_JSON")
    if not credentials_json:
        raise Exception("GOOGLE_CREDENTIALS_JSON not configured")
    credentials = service_account.Credentials.from_service_account_info(
        json.loads(credentials_json)
    )
    client = texttospeech.TextToSpeechClient(credentials=credentials)

    # Determine language code
    lang_code = "ru-RU" if language == "ru" else "ar-XA"

    # Optional overrides via secrets
    override_name = None
    if language == "ru":
        override_name = os.environ.get("GCP_TTS_RU_VOICE")
    elif language == "ar":
        override_name = os.environ.get("GCP_TTS_AR_VOICE")

    # List voices and filter by language
    voices = client.list_voices().voices
    candidates = [v for v in voices if any(lang_code in lc for lc in v.language_codes)]

    def pick_voice() -> texttospeech.VoiceSelectionParams:
        if override_name and any(v.name == override_name for v in candidates):
            chosen = next(v for v in candidates if v.name == override_name)
            return texttospeech.VoiceSelectionParams(language_code=chosen.language_codes[0], name=chosen.name)
        # Prefer higher quality voices first (Wavenet/Neural), else fallback to Standard
        premium = [v for v in candidates if "Wavenet" in v.name or "Neural" in v.name]
        chosen = (premium[0] if premium else (candidates[0] if candidates else None))
        if chosen:
            return texttospeech.VoiceSelectionParams(language_code=chosen.language_codes[0], name=chosen.name)
        # Fallback generic without specifying name
        return texttospeech.VoiceSelectionParams(language_code=lang_code)

    voice = pick_voice()
    synthesis_input = texttospeech.SynthesisInput(text=text)
    audio_config = texttospeech.AudioConfig(audio_encoding=texttospeech.AudioEncoding.MP3)
    response = client.synthesize_speech(input=synthesis_input, voice=voice, audio_config=audio_config)
    audio_data = response.audio_content
    if not audio_data or len(audio_data) < 100:
        raise Exception("TTS returned empty audio")
    return audio_data


@app.function(
    image=processing_image,
    timeout=600,
    secrets=[modal.Secret.from_name("anki-capture-secrets")],
)
async def process_upload(
    phrase_id: str,
    source_type: str,  # 'image' | 'audio' | 'text'
    file_url: Optional[str],
    source_text: Optional[str],
    language: Optional[str],
    webhook_url: str,
    webhook_secret: str,
) -> None:
    """Main processing pipeline - orchestrates all steps."""
    
    try:
        print(f"Processing {phrase_id}: type={source_type}, lang={language}")
        
        # Step 1: Extract text
        if source_type == "audio":
            print(f"Transcribing audio from {file_url}")
            result = transcribe_audio.remote(file_url)
            extracted_text = result["text"]
            detected_language = language or result["language"]
            # Map whisper language codes
            lang_map = {"russian": "ru", "arabic": "ar"}
            if detected_language in lang_map:
                detected_language = lang_map[detected_language]
            confidence = result["confidence"]
            
        elif source_type == "image":
            print(f"Running OCR on {file_url}")
            result = ocr_image.remote(file_url)
            extracted_text = result["text"]
            detected_language = language or result["language"] or "ru"
            confidence = result["confidence"]
            
        else:  # text
            extracted_text = source_text
            detected_language = language or "ru"
            confidence = 1.0
        
        if not extracted_text or not extracted_text.strip():
            raise ValueError("No text extracted from input")
        
        extracted_text = extracted_text.strip()
        print(f"Extracted text: {extracted_text[:100]}...")
        
        # Step 2: Generate breakdown
        print(f"Generating breakdown for {detected_language}")
        breakdown = generate_breakdown.remote(extracted_text, detected_language)
        
        # Step 3: Generate TTS (for images and text; audio input already has audio)
        audio_b64 = None
        if source_type in ("image", "text"):
            print("Generating TTS audio")
            audio_data = await generate_tts.remote.aio(extracted_text, detected_language)
            audio_b64 = base64.b64encode(audio_data).decode()
        
        # Step 4: Send results back via webhook
        payload = {
            "phrase_id": phrase_id,
            "success": True,
            "result": {
                "phrase_id": phrase_id,
                "source_text": extracted_text,
                "transliteration": breakdown["transliteration"],
                "translation": breakdown["translation"],
                "grammar_notes": breakdown["grammar_notes"],
                "vocab_breakdown": breakdown["vocab_breakdown"],
                "detected_language": detected_language,
                "language_confidence": confidence,
                "audio_url": file_url if source_type == "audio" else None,
                "audio_data": audio_b64,
            },
        }
        
        print(f"Sending results to webhook for {phrase_id}")
        response = httpx.post(
            webhook_url,
            json=payload,
            headers={"Authorization": f"Bearer {webhook_secret}"},
            timeout=30,
        )
        response.raise_for_status()
        print(f"Successfully processed {phrase_id}")
        
    except Exception as e:
        print(f"Error processing {phrase_id}: {e}")
        
        # Report error
        error_payload = {
            "phrase_id": phrase_id,
            "success": False,
            "error": str(e),
        }
        
        try:
            httpx.post(
                webhook_url,
                json=error_payload,
                headers={"Authorization": f"Bearer {webhook_secret}"},
                timeout=30,
            )
        except Exception as webhook_err:
            print(f"Failed to send error webhook: {webhook_err}")
        
        raise


# Web endpoint for triggering processing
@app.function(
    image=processing_image,
    secrets=[modal.Secret.from_name("anki-capture-secrets")],
)
@modal.fastapi_endpoint(method="POST")
async def trigger(data: dict) -> dict:
    """HTTP endpoint called by the Worker to start processing."""
    
    phrase_id = data.get("phrase_id")
    if not phrase_id:
        return {"error": "Missing phrase_id", "status": "error"}
    
    print(f"Received trigger for {phrase_id}")
    
    await process_upload.spawn.aio(
        phrase_id=phrase_id,
        source_type=data.get("source_type", "text"),
        file_url=data.get("file_url"),
        source_text=data.get("source_text"),
        language=data.get("language"),
        webhook_url=data["webhook_url"],
        webhook_secret=data["webhook_secret"],
    )
    
    return {"status": "processing", "phrase_id": phrase_id}
