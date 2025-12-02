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
    result?: { audio_data?: string } 
  };
  
  if (!payload.phrase_id) {
    return Response.json({ error: 'Missing phrase_id' }, { status: 400 });
  }
  
  // Check phrase exists
  const phrase = await getPhrase(env, payload.phrase_id);
  if (!phrase) {
    console.error(`Phrase not found: ${payload.phrase_id}`);
    return Response.json({ error: 'Phrase not found' }, { status: 404 });
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
        const audioKey = generateFileKey(payload.phrase_id, 'audio', 'mp3');
        await uploadFile(env, audioKey, audioBuffer.buffer, 'audio/mpeg');
        audioUrl = audioKey;
      }
      
      // Update phrase with processing results
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
      
      console.log(`Successfully processed phrase: ${payload.phrase_id}`);
      
    } catch (err) {
      console.error(`Failed to save results for ${payload.phrase_id}:`, err);
      return Response.json({ error: 'Failed to save results' }, { status: 500 });
    }
  } else {
    // Processing failed - move to review with error message
    console.error(`Processing failed for ${payload.phrase_id}: ${payload.error}`);
    
    await updatePhrase(env, payload.phrase_id, { 
      status: 'pending_review',
      grammar_notes: `⚠️ Processing error: ${payload.error}`,
    });
  }
  
  return Response.json({ received: true });
}
