import { Env, ModalWebhookPayload } from '../types';
import { updatePhraseFromProcessing, updatePhrase, getPhrase } from '../lib/db';
import { uploadFile, generateFileKey } from '../lib/r2';

// POST /api/webhook/modal
export async function handleModalWebhook(
  request: Request,
  env: Env
): Promise<Response> {
  // Verify webhook secret
  const authHeader = request.headers.get('Authorization');
  const expectedAuth = `Bearer ${env.MODAL_WEBHOOK_SECRET}`;
  
  if (authHeader !== expectedAuth) {
    console.error('Webhook auth failed');
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  const payload = await request.json() as ModalWebhookPayload & {
    result?: { audio_data?: string };
    audio_only?: boolean;
  };
  
  if (!payload.phrase_id) {
    return Response.json({ error: 'Missing phrase_id' }, { status: 400 });
  }
  
  // Check phrase exists
  const phrase = await getPhrase(env, payload.phrase_id);
  if (!phrase) {
    console.error('Phrase not found', { phrase_id: payload.phrase_id, request_id: request.headers.get('x-request-id') || undefined });
    return Response.json({ error: 'Phrase not found' }, { status: 404 });
  }
  
  // Idempotency: ignore stale/duplicate webhooks if job_id doesn't match current
  if (phrase.current_job_id && payload.job_id && payload.job_id !== phrase.current_job_id) {
    console.warn('Ignoring stale webhook', { request_id: request.headers.get('x-request-id') || undefined, phrase_id: payload.phrase_id, job_id: payload.job_id, current_job_id: phrase.current_job_id });
    return Response.json({ received: true, ignored: true });
  }

  // Handle progress updates (non-final)
  if (payload.type === 'progress' && payload.step) {
    const STEP_ORDER = ['extracting', 'analyzing', 'generating_audio'];
    const newIdx = STEP_ORDER.indexOf(payload.step);
    const curIdx = phrase.processing_step ? STEP_ORDER.indexOf(phrase.processing_step) : -1;
    // Only advance forward (guard against out-of-order delivery)
    if (newIdx > curIdx) {
      await updatePhrase(env, payload.phrase_id, { processing_step: payload.step });
    }
    return Response.json({ received: true });
  }

  if (payload.success && payload.result) {
    try {
      // If audio data was included (base64), save it to R2
      let audioUrl = payload.result.audio_url;
      
      if (payload.result.audio_data) {
        const audioBuffer = Uint8Array.from(
          atob(payload.result.audio_data), 
          c => c.charCodeAt(0)
        );
        // We don't know the user here; look up phrase to get its original file key and derive the user prefix.
        let userPrefix = 'anonymous';
        if (phrase.original_file_url) {
          const parts = phrase.original_file_url.split('/');
          // userId is the first segment of the key: <userId>/type/id.ext
          if (parts.length > 0) userPrefix = parts[0];
        }
        const audioKey = generateFileKey(userPrefix, payload.phrase_id, 'audio', 'mp3');
        await uploadFile(env, audioKey, audioBuffer.buffer, 'audio/mpeg');
        audioUrl = audioKey;
      }
      
      // Update phrase with processing results
      if (payload.audio_only) {
        // Audio-only regeneration: only update audio and source_text
        // Keep existing translation, grammar, vocab breakdown
        await updatePhrase(env, payload.phrase_id, {
          source_text: payload.result.source_text,
          audio_url: audioUrl,
          processing_step: null,
        });
      } else {
        // Full processing: update all fields
        await updatePhraseFromProcessing(env, payload.phrase_id, {
          source_text: payload.result.source_text,
          transliteration: payload.result.transliteration,
          translation: payload.result.translation,
          grammar_notes: payload.result.grammar_notes,
          vocab_breakdown: payload.result.vocab_breakdown,
          detected_language: payload.result.detected_language,
          language_confidence: payload.result.language_confidence,
          audio_url: audioUrl,
        });
      }
      
      console.log('Processed phrase', { request_id: request.headers.get('x-request-id') || undefined, phrase_id: payload.phrase_id, job_id: payload.job_id || null });
      
    } catch (err) {
      console.error('Failed to save results', { request_id: request.headers.get('x-request-id') || undefined, phrase_id: payload.phrase_id, error: err instanceof Error ? err.message : String(err) });
      return Response.json({ error: 'Failed to save results' }, { status: 500 });
    }
  } else {
    // Processing failed - move to review with error message
    console.error('Processing failed', { request_id: request.headers.get('x-request-id') || undefined, phrase_id: payload.phrase_id, error: payload.error });
    
    await updatePhrase(env, payload.phrase_id, {
      status: 'pending_review',
      grammar_notes: `⚠️ Processing error: ${payload.error}`,
      last_error: payload.error || 'Processing failed',
      processing_step: null,
    });
  }
  
  return Response.json({ received: true });
}
