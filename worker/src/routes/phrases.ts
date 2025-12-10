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
import { beginProcessingForUser } from '../lib/db';

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
  return Response.json({ phrases });
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
  
  return Response.json({ phrase });
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
    await beginProcessingForUser(env, userId, id);
    
    await triggerProcessing(env, {
      phrase_id: id,
      source_type: phrase.source_type,
      file_url: phrase.original_file_url 
        ? buildFileUrl(requestUrl, phrase.original_file_url) 
        : null,
      source_text: phrase.source_text,
      language: body.detected_language,
      webhook_url: '',
    }, requestUrl);
    
    return Response.json({ 
      message: 'Reprocessing triggered',
      status: 'processing' 
    });
  }
  
  await updatePhraseForUser(env, userId, id, body);
  
  const updated = await getPhraseForUser(env, userId, id);
  return Response.json({ phrase: updated });
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
  const userId = getUserId(request, env);
  const phrase = await getPhraseForUser(env, userId, id);
  
  if (!phrase) {
    return Response.json({ error: 'Phrase not found' }, { status: 404 });
  }
  
  if (!phrase.source_text) {
    return Response.json(
      { error: 'No source text to generate audio from' },
      { status: 400 }
    );
  }
  
  // This will trigger just TTS regeneration in Modal
  const requestUrl = new URL(request.url);
  
  // We'll handle this as a special "regenerate_audio" job type
  await triggerProcessing(env, {
    phrase_id: id,
    source_type: 'text',  // Treat as text since we just need TTS
    file_url: null,
    source_text: phrase.source_text,
    language: phrase.detected_language,
    webhook_url: '',
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
  await beginProcessingForUser(env, userId, id);
  await triggerProcessing(env, {
    phrase_id: id,
    source_type: phrase.source_type,
    file_url: phrase.original_file_url ? buildFileUrl(requestUrl, phrase.original_file_url) : null,
    source_text: phrase.source_text,
    language: phrase.detected_language,
    webhook_url: '',
  }, requestUrl);
  return Response.json({ message: 'Retry queued', status: 'processing' });
}

// DELETE /api/phrases/:id
export async function handleDeletePhrase(
  request: Request,
  env: Env,
  id: string
): Promise<Response> {
  const userId = getUserId(request, env);
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
        console.log('Deleted R2 object', { phrase_id: id, key });
      } catch (err) {
        console.error('Failed to delete R2 object', { phrase_id: id, key, error: err instanceof Error ? err.message : String(err) });
      }
    })
  );

  return Response.json({ message: 'Phrase deleted' });
}
