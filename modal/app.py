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
from typing import Optional, Tuple, List
from dataclasses import dataclass
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
        "httpx",  # Required to download audio files from signed URLs
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


# ============================================================================
# Language Registry - Single source of truth for all language configurations
# ============================================================================

@dataclass
class LanguageConfig:
    """Complete configuration for a single language."""

    # Identity
    code: str                                  # 2-letter code: "ru", "ar", "zh", "es"
    name: str                                  # Display name: "Russian", "Arabic", etc.

    # OCR & Detection
    locale_variants: List[str]                 # Vision API locale variants: ["ru", "rus", "russian"]
    script_range: Optional[Tuple[int, int]]    # Unicode range: (0x0400, 0x04FF) for Cyrillic

    # TTS
    tts_code: str                              # Google TTS code: "ru-RU", "ar-XA"
    tts_voice_env_var: str                     # Env var for override: "GCP_TTS_RU_VOICE"

    # Whisper (Audio)
    whisper_names: List[str]                   # Whisper language variants: ["russian", "ru"]

    # LLM Instructions
    vocab_instructions: str                    # GPT prompt template for vocab breakdown


LANGUAGE_REGISTRY = {
    "ru": LanguageConfig(
        code="ru",
        name="Russian",
        locale_variants=["ru", "rus", "russian"],
        script_range=(0x0400, 0x04FF),  # Cyrillic
        tts_code="ru-RU",
        tts_voice_env_var="GCP_TTS_RU_VOICE",
        whisper_names=["russian", "ru"],
        vocab_instructions="""
For each significant word, provide:
- word: the word as it appears in the text
- root: base/infinitive form (for verbs) or nominative singular (for nouns/adjectives)
- meaning: English translation
- gender: m/f/n for nouns, or null for other parts of speech
- declension: grammatical form info (case, number, tense, aspect, etc.)
- notes: aspect for verbs (perfective/imperfective), any irregularities, or usage notes

Focus on content words. Include particles/prepositions only if they have special meaning in context.
""",
    ),
    "ar": LanguageConfig(
        code="ar",
        name="Arabic",
        locale_variants=["ar", "ara", "arabic"],
        script_range=(0x0600, 0x06FF),  # Arabic
        tts_code="ar-XA",
        tts_voice_env_var="GCP_TTS_AR_VOICE",
        whisper_names=["arabic", "ar"],
        vocab_instructions="""
For each significant word, provide:
- word: the word as it appears (with diacritics/harakat if helpful for pronunciation)
- root: the 3 or 4 letter root separated by dashes (e.g., ك-ت-ب)
- meaning: English translation
- gender: m/f for nouns, or null
- declension: grammatical state (definite/indefinite, case, number, verb form I-X)
- notes: verb pattern, any irregularities, or usage notes

Focus on content words. Include common particles if they affect meaning.
""",
    ),
    "zh": LanguageConfig(
        code="zh",
        name="Chinese",
        locale_variants=["zh", "zho", "chi", "chinese"],
        script_range=(0x4E00, 0x9FFF),  # CJK Unified Ideographs
        tts_code="zh-CN",
        tts_voice_env_var="GCP_TTS_ZH_VOICE",
        whisper_names=["chinese", "zh"],
        vocab_instructions="""
For each significant word or phrase, provide:
- word: the term as it appears (with characters)
- root: pinyin with tone marks
- meaning: English translation
- gender: null (not applicable)
- declension: part of speech and classifier info if relevant
- notes: measure words, aspect particles, classifier usage, or grammar patterns

Focus on content words and key particles that affect meaning.
""",
    ),
    "es": LanguageConfig(
        code="es",
        name="Spanish",
        locale_variants=["es", "spa", "spanish"],
        script_range=(0x0020, 0x024F),  # Latin (includes Spanish accents)
        tts_code="es-ES",
        tts_voice_env_var="GCP_TTS_ES_VOICE",
        whisper_names=["spanish", "es"],
        vocab_instructions="""
For each significant word, provide:
- word: the word as it appears
- root: lemma (infinitive for verbs, base for nouns/adjectives)
- meaning: English translation
- gender: m/f for nouns (or null)
- declension: conjugation or inflection (tense, person, number, mood) as applicable
- notes: irregularities or important usage notes

Focus on content words. Include pronouns/particles only when relevant.
""",
    ),
    "ka": LanguageConfig(
        code="ka",
        name="Georgian",
        locale_variants=["ka", "kat", "geo", "georgian"],
        script_range=(0x10A0, 0x10FF),  # Georgian
        tts_code="ka-GE",
        tts_voice_env_var="GCP_TTS_KA_VOICE",
        whisper_names=["georgian", "ka"],
        vocab_instructions="""
For each significant word, provide:
- word: the word as it appears
- root: base form (infinitive for verbs, nominative singular for nouns)
- meaning: English translation
- gender: null (Georgian has no grammatical gender)
- declension: case and number info (nominative, ergative, dative, genitive, etc.)
- notes: verb screeves (present, aorist, perfect), pluralization, or usage notes

Focus on content words. Include postpositions only when they affect meaning.
""",
    ),
}


def get_language_config(code: str) -> Optional[LanguageConfig]:
    """Get language config by code."""
    return LANGUAGE_REGISTRY.get(code)


def get_supported_languages() -> List[str]:
    """Get list of supported language codes."""
    return list(LANGUAGE_REGISTRY.keys())


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
    # Use webhook secret for authentication
    webhook_secret = os.environ.get("WEBHOOK_SECRET", "")
    headers = {"X-Modal-Secret": webhook_secret} if webhook_secret else {}

    for attempt in range(3):
        try:
            response = httpx.get(audio_url, headers=headers, timeout=60, follow_redirects=True)
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


# ============================================================================
# OCR Text Filtering Functions
# ============================================================================

def map_locale_to_language(locale: str) -> Optional[str]:
    """Map Vision API locale to language code using registry."""
    if not locale:
        return None

    locale_lower = locale.lower()

    # Search all languages for matching locale variant
    for code, config in LANGUAGE_REGISTRY.items():
        if locale_lower in [v.lower() for v in config.locale_variants]:
            return code
        # Try prefix match (e.g., "ru" matches "rus")
        if locale_lower[:2] in [v[:2].lower() for v in config.locale_variants]:
            return code

    return None


def detect_script(text: str, target_lang: str) -> bool:
    """Check if text contains target language characters using registry."""
    if not text.strip():
        return False

    config = get_language_config(target_lang)
    if not config or not config.script_range:
        return False

    target_range = config.script_range
    target_chars = sum(1 for c in text if target_range[0] <= ord(c) <= target_range[1])

    # Keep if >50% target script
    total_chars = len([c for c in text if not c.isspace()])
    if total_chars == 0:
        return False

    return (target_chars / total_chars) > 0.5


def is_ui_noise(text: str) -> bool:
    """Check if segment is common English UI element."""
    ENGLISH_UI_PATTERNS = {
        'menu', 'back', 'home', 'login', 'logout', 'next', 'prev',
        'share', 'save', 'cancel', 'ok', 'yes', 'no', 'settings',
        'help', 'about', 'close', 'exit', 'more', 'less', 'view',
        'edit', 'delete', 'add', 'search', 'filter', 'sort',
    }
    return text.strip().lower() in ENGLISH_UI_PATTERNS


def reconstruct_with_lines(segments: list, filtered_indices: set) -> str:
    """
    Reconstruct text from filtered segments, preserving line structure.

    Args:
        segments: List of Vision API text segments (texts[1:])
        filtered_indices: Set of indices to keep

    Returns:
        Reconstructed text with line breaks
    """
    if not segments or not filtered_indices:
        return ""

    # Helper to get average Y coordinate from bounding box
    def avg_y(segment):
        if not segment.bounding_poly or not segment.bounding_poly.vertices:
            return 0
        return sum(v.y for v in segment.bounding_poly.vertices) / len(segment.bounding_poly.vertices)

    # Helper to get average X coordinate
    def avg_x(segment):
        if not segment.bounding_poly or not segment.bounding_poly.vertices:
            return 0
        return sum(v.x for v in segment.bounding_poly.vertices) / len(segment.bounding_poly.vertices)

    # Get filtered segments with their positions
    kept_segments = [(i, segments[i], avg_y(segments[i]), avg_x(segments[i]))
                     for i in filtered_indices]

    # Sort by Y (vertical position), then X (horizontal position)
    kept_segments.sort(key=lambda x: (x[2], x[3]))

    # Group into lines based on Y proximity
    lines = []
    current_line = []
    prev_y = None

    for idx, seg, y, x in kept_segments:
        if prev_y is None or abs(y - prev_y) < 20:  # Same line (within 20 pixels)
            current_line.append(seg.description)
        else:  # New line
            if current_line:
                lines.append(' '.join(current_line))
            current_line = [seg.description]
        prev_y = y

    # Add last line
    if current_line:
        lines.append(' '.join(current_line))

    return '\n'.join(lines)


def calculate_confidence(
    total_segments: int,
    kept_segments: int,
    original_locale: str,
    target_lang: str
) -> float:
    """
    Calculate confidence based on filtering results.

    Args:
        total_segments: Total number of segments from OCR
        kept_segments: Number of segments kept after filtering
        original_locale: Original locale from Vision API
        target_lang: Target language code

    Returns:
        Confidence score between 0.5 and 0.99
    """
    if total_segments == 0:
        return 0.5

    match_ratio = kept_segments / total_segments

    # Boost confidence if Vision detected target language
    locale_match = map_locale_to_language(original_locale) == target_lang
    confidence = match_ratio * 0.8 + (0.2 if locale_match else 0.0)

    # Clamp to [0.5, 0.99]
    return max(0.5, min(0.99, confidence))


def filter_target_language_segments(texts: list, target_lang: str) -> tuple:
    """
    Extract only target language segments from Vision API OCR results.

    Strategy:
    1. Use segment-level locale detection if available
    2. Fallback to script detection (Cyrillic, Arabic, Chinese, Latin)
    3. Filter common English UI patterns
    4. Reconstruct text preserving line structure

    Args:
        texts: Vision API text_annotations array
               texts[0] = full text, texts[1..N] = segments
        target_lang: Desired language ('ru', 'ar', 'zh', 'es')

    Returns:
        (filtered_text, confidence_score)
    """
    from google.cloud import vision

    # Need at least the full text annotation
    if not texts or len(texts) < 1:
        return ("", 0.5)

    # If no segments, return full text
    if len(texts) == 1:
        return (texts[0].description.strip(), 0.5)

    segments = texts[1:]  # Individual word/phrase segments
    total_segments = len(segments)
    filtered_indices = set()

    # Filter each segment
    for i, segment in enumerate(segments):
        text = segment.description.strip()

        if not text:
            continue

        # Stage 1: Check segment-level locale if available
        segment_locale = getattr(segment, 'locale', None)
        if segment_locale:
            segment_lang = map_locale_to_language(segment_locale)
            if segment_lang == target_lang:
                filtered_indices.add(i)
                continue

        # Stage 2: Script detection fallback
        if detect_script(text, target_lang):
            filtered_indices.add(i)
            continue

        # Stage 3: Filter out UI noise (don't add to filtered_indices)
        # This is implicit - if it's UI noise, we don't add it

    # Reconstruct text from filtered segments
    filtered_text = reconstruct_with_lines(segments, filtered_indices)

    # Calculate confidence
    original_locale = texts[0].locale or ""
    confidence = calculate_confidence(
        total_segments,
        len(filtered_indices),
        original_locale,
        target_lang
    )

    # Log filtering results
    print(f"OCR filtering: {total_segments} segments → {len(filtered_indices)} kept ({confidence:.2f} confidence)")
    if len(filtered_text) < len(texts[0].description) * 0.3:
        print(f"Warning: Aggressive filtering detected (kept {len(filtered_text)}/{len(texts[0].description)} chars)")

    return (filtered_text, confidence)


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
    # Use webhook secret for authentication
    webhook_secret = os.environ.get("WEBHOOK_SECRET", "")
    headers = {"X-Modal-Secret": webhook_secret} if webhook_secret else {}

    for attempt in range(3):
        try:
            response = httpx.get(image_url, headers=headers, timeout=60, follow_redirects=True)
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
    
    # Detect language from the response
    original_locale = texts[0].locale or ""
    detected_lang = map_locale_to_language(original_locale)

    # If language detected, apply filtering to extract only target language segments
    if detected_lang:
        filtered_text, confidence = filter_target_language_segments(texts, detected_lang)

        # Fallback to full text if filtering returns nothing or very short result
        if not filtered_text or len(filtered_text) < 5:
            print(f"Warning: Filtering returned empty/short result, falling back to full text")
            filtered_text = texts[0].description.strip()
            confidence = 0.50  # Low confidence for unfiltered fallback
    else:
        # No language detected, use full text
        filtered_text = texts[0].description.strip()
        confidence = 0.50

    return {
        "text": filtered_text,
        "language": detected_lang,
        "confidence": confidence,
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

    # Get language config from registry
    config = get_language_config(language)
    if not config:
        raise ValueError(f"Unsupported language: {language}")

    lang_name = config.name
    vocab_instructions = config.vocab_instructions

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
    """Generate TTS audio using Google Cloud Text-to-Speech."""
    from google.cloud import texttospeech
    from google.oauth2 import service_account

    credentials_json = os.environ.get("GOOGLE_CREDENTIALS_JSON")
    if not credentials_json:
        raise Exception("GOOGLE_CREDENTIALS_JSON not configured")
    credentials = service_account.Credentials.from_service_account_info(
        json.loads(credentials_json)
    )
    client = texttospeech.TextToSpeechClient(credentials=credentials)

    # Get language config from registry
    config = get_language_config(language)
    if not config:
        raise ValueError(f"Unsupported language for TTS: {language}")

    lang_code = config.tts_code
    override_name = os.environ.get(config.tts_voice_env_var, "").strip() or None

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
    audio_only: bool = False,
) -> None:
    """Main processing pipeline - orchestrates all steps.

    If audio_only is True, only regenerates audio (skips breakdown generation).
    """
    
    try:
        print(f"Processing {phrase_id}: type={source_type}, lang={language}")
        
        # Step 1: Extract text
        if source_type == "audio":
            print(f"Transcribing audio from {file_url}")
            result = transcribe_audio.remote(file_url)
            extracted_text = result["text"]
            detected_language = language or result["language"]
            # Map whisper language codes using registry
            if detected_language:
                for code, config in LANGUAGE_REGISTRY.items():
                    if detected_language.lower() in [w.lower() for w in config.whisper_names]:
                        detected_language = code
                        break
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

        # Step 2: Generate breakdown (skip if audio_only)
        breakdown = None
        if not audio_only:
            print(f"Generating breakdown for {detected_language}")
            breakdown = generate_breakdown.remote(extracted_text, detected_language)

        # Step 3: Generate TTS (for images and text; audio input already has audio)
        audio_b64 = None
        if source_type in ("image", "text"):
            print("Generating TTS audio")
            audio_data = await generate_tts.remote.aio(extracted_text, detected_language)
            audio_b64 = base64.b64encode(audio_data).decode()
        
        # Step 4: Send results back via webhook
        result_data = {
            "phrase_id": phrase_id,
            "source_text": extracted_text,
            "detected_language": detected_language,
            "language_confidence": confidence,
            "audio_url": file_url if source_type == "audio" else None,
            "audio_data": audio_b64,
        }

        # Only include breakdown fields if they were generated
        if breakdown:
            result_data.update({
                "transliteration": breakdown["transliteration"],
                "translation": breakdown["translation"],
                "grammar_notes": breakdown["grammar_notes"],
                "vocab_breakdown": breakdown["vocab_breakdown"],
            })

        payload = {
            "phrase_id": phrase_id,
            "success": True,
            "result": result_data,
            "audio_only": audio_only,  # Flag to tell webhook handler
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
        audio_only=data.get("audio_only", False),
    )
    
    return {"status": "processing", "phrase_id": phrase_id}
