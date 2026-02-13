import { Env, PhraseStatus, Phrase, VocabItem } from '../types';
import { 
  getPhraseForUser, 
  listPhrasesForUser, 
  updatePhraseForUser, 
  deletePhraseForUser, 
  getPhrase 
} from '../lib/db';
import { deleteFile } from '../lib/r2';
import { triggerProcessing, buildFileUrl } from '../lib/modal';
import { getUserId } from '../lib/auth';
import { setCurrentJobForUser } from '../lib/db';
import { buildAbsoluteSignedUrl } from '../lib/signing';

// GET /api/phrases
export async function handleListPhrases(
  request: Request,
  env: Env
): Promise<Response> {
  const userId = await getUserId(request, env);
  const url = new URL(request.url);
  const status = url.searchParams.get('status') as PhraseStatus | null;
  const limit = parseInt(url.searchParams.get('limit') || '100', 10);
  
  const phrases = await listPhrasesForUser(env, userId, status || undefined, limit);
  // Attach short-lived signed URLs for any file fields
  const origin = new URL(request.url).origin;
  const ttl = 10 * 60; // 10 minutes
  const signed = await Promise.all(phrases.map(async (p) => ({
    ...p,
    audio_url: p.audio_url ? (await buildAbsoluteSignedUrl(env, origin, p.audio_url, ttl)) || p.audio_url : null,
    original_file_url: p.original_file_url ? (await buildAbsoluteSignedUrl(env, origin, p.original_file_url, ttl)) || p.original_file_url : null,
  })));
  return Response.json({ phrases: signed });
}

// GET /api/phrases/:id
export async function handleGetPhrase(
  request: Request,
  env: Env,
  id: string
): Promise<Response> {
  const userId = await getUserId(request, env);
  const phrase = await getPhraseForUser(env, userId, id);
  
  if (!phrase) {
    return Response.json({ error: 'Phrase not found' }, { status: 404 });
  }
  // Sign file URLs for direct use by client
  const origin = new URL(request.url).origin;
  const ttl = 10 * 60; // 10 minutes
  const signedPhrase = {
    ...phrase,
    audio_url: phrase.audio_url ? (await buildAbsoluteSignedUrl(env, origin, phrase.audio_url, ttl)) || phrase.audio_url : null,
    original_file_url: phrase.original_file_url ? (await buildAbsoluteSignedUrl(env, origin, phrase.original_file_url, ttl)) || phrase.original_file_url : null,
  };
  return Response.json({ phrase: signedPhrase });
}

// PATCH /api/phrases/:id
export async function handleUpdatePhrase(
  request: Request,
  env: Env,
  id: string
): Promise<Response> {
  const userId = await getUserId(request, env);
  const phrase = await getPhraseForUser(env, userId, id);
  
  if (!phrase) {
    return Response.json({ error: 'Phrase not found' }, { status: 404 });
  }
  
  const body = await request.json() as Partial<{
    source_text: string;
    transliteration: string;
    translation: string;
    grammar_notes: string;
    vocab_breakdown: VocabItem[];
    detected_language: 'ru' | 'ar';
    status: PhraseStatus;
    exclude_from_export: boolean;
  }>;
  
  // If language changed, trigger reprocessing
  if (body.detected_language && body.detected_language !== phrase.detected_language) {
    const requestUrl = new URL(request.url);
    
    await updatePhraseForUser(env, userId, id, { detected_language: body.detected_language });
    const jobId = crypto.randomUUID();
    await setCurrentJobForUser(env, userId, id, jobId, true);
    console.log('Enqueue reprocess', { request_id: request.headers.get('x-request-id') || undefined, phrase_id: id, job_id: jobId, new_language: body.detected_language });
    
    await triggerProcessing(env, {
      phrase_id: id,
      source_type: phrase.source_type,
      file_url: phrase.original_file_url 
        ? await buildFileUrl(env, requestUrl, phrase.original_file_url) 
        : null,
      source_text: phrase.source_text,
      language: body.detected_language,
      webhook_url: '',
      job_id: jobId,
    }, requestUrl);
    
    return Response.json({ 
      message: 'Reprocessing triggered',
      status: 'processing' 
    });
  }
  
  await updatePhraseForUser(env, userId, id, body);
  
  const updated = await getPhraseForUser(env, userId, id);
  // Sign file URLs in the response
  const origin = new URL(request.url).origin;
  const ttl = 10 * 60;
  const signedUpdated = updated ? {
    ...updated,
    audio_url: updated.audio_url ? (await buildAbsoluteSignedUrl(env, origin, updated.audio_url, ttl)) || updated.audio_url : null,
    original_file_url: updated.original_file_url ? (await buildAbsoluteSignedUrl(env, origin, updated.original_file_url, ttl)) || updated.original_file_url : null,
  } : null;
  return Response.json({ phrase: signedUpdated });
}

// POST /api/phrases/:id/approve
export async function handleApprovePhrase(
  request: Request,
  env: Env,
  id: string
): Promise<Response> {
  const userId = await getUserId(request, env);
  const phrase = await getPhraseForUser(env, userId, id);
  
  if (!phrase) {
    return Response.json({ error: 'Phrase not found' }, { status: 404 });
  }
  
  if (phrase.status !== 'pending_review') {
    return Response.json(
      { error: 'Can only approve phrases in pending_review status' },
      { status: 400 }
    );
  }
  
  await updatePhraseForUser(env, userId, id, { status: 'approved' });
  
  return Response.json({ message: 'Phrase approved' });
}

// POST /api/phrases/:id/regenerate-audio
export async function handleRegenerateAudio(
  request: Request,
  env: Env,
  id: string
): Promise<Response> {
  const userId = await getUserId(request, env);
  const phrase = await getPhraseForUser(env, userId, id);
  
  if (!phrase) {
    return Response.json({ error: 'Phrase not found' }, { status: 404 });
  }
  
  // Optional text/language overrides from JSON body
  let overrideText: string | null = null;
  let overrideLang: 'ru' | 'ar' | null = null;
  const ct = request.headers.get('Content-Type') || '';
  if (ct.includes('application/json')) {
    try {
      const body = await request.json() as { source_text?: string; language?: 'ru' | 'ar' };
      overrideText = body.source_text?.trim() || null;
      overrideLang = body.language || null;
    } catch {}
  }

  const sourceText = overrideText || phrase.source_text;
  const language = (overrideLang || phrase.detected_language) as 'ru' | 'ar' | null;
  if (!sourceText) {
    return Response.json(
      { error: 'No source text to generate audio from' },
      { status: 400 }
    );
  }
  
  // This will trigger just TTS regeneration in Modal
  const requestUrl = new URL(request.url);
  
  // We'll handle this as a special "regenerate_audio" job type
  const jobId = crypto.randomUUID();
  await setCurrentJobForUser(env, userId, id, jobId, false);
  console.log('Enqueue regen-audio', { request_id: request.headers.get('x-request-id') || undefined, phrase_id: id, job_id: jobId });
  await triggerProcessing(env, {
    phrase_id: id,
    source_type: 'text',  // Treat as text since we just need TTS
    file_url: null,
    source_text: sourceText,
    language,
    webhook_url: '',
    job_id: jobId,
    audio_only: true,  // Only regenerate audio, don't overwrite other fields
  }, requestUrl);
  
  return Response.json({ message: 'Audio regeneration triggered' });
}

// POST /api/phrases/:id/retry
export async function handleRetryPhrase(
  request: Request,
  env: Env,
  id: string
): Promise<Response> {
  const userId = await getUserId(request, env);
  const phrase = await getPhraseForUser(env, userId, id);
  if (!phrase) {
    return Response.json({ error: 'Phrase not found' }, { status: 404 });
  }
  const requestUrl = new URL(request.url);
  const jobId = crypto.randomUUID();
  await setCurrentJobForUser(env, userId, id, jobId, true);
  console.log('Enqueue retry', { request_id: request.headers.get('x-request-id') || undefined, phrase_id: id, job_id: jobId });
  await triggerProcessing(env, {
    phrase_id: id,
    source_type: phrase.source_type,
    file_url: phrase.original_file_url ? await buildFileUrl(env, requestUrl, phrase.original_file_url) : null,
    source_text: phrase.source_text,
    language: phrase.detected_language,
    webhook_url: '',
    job_id: jobId,
  }, requestUrl);
  return Response.json({ message: 'Retry queued', status: 'processing' });
}

// DELETE /api/phrases/:id
export async function handleDeletePhrase(
  request: Request,
  env: Env,
  id: string
): Promise<Response> {
  const userId = await getUserId(request, env);
  const phrase = await getPhraseForUser(env, userId, id);
  
  if (!phrase) {
    return Response.json({ error: 'Phrase not found' }, { status: 404 });
  }
  
  // Capture keys for best-effort cleanup after DB delete
  const keysToDelete: string[] = [];
  if (phrase.original_file_url) keysToDelete.push(phrase.original_file_url);
  if (phrase.audio_url) keysToDelete.push(phrase.audio_url);

  // Delete DB record first; do not block on storage cleanup
  await deletePhraseForUser(env, userId, id);

  // Best-effort deletion of associated R2 objects
  await Promise.allSettled(
    keysToDelete.map(async (key) => {
      try {
        await deleteFile(env, key);
        console.log('Deleted R2 object', { request_id: request.headers.get('x-request-id') || undefined, phrase_id: id, key });
      } catch (err) {
        console.error('Failed to delete R2 object', { request_id: request.headers.get('x-request-id') || undefined, phrase_id: id, key, error: err instanceof Error ? err.message : String(err) });
      }
    })
  );

  return Response.json({ message: 'Phrase deleted' });
}
