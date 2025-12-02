import { Env, PhraseStatus, Phrase, VocabItem } from '../types';
import { getPhrase, listPhrases, updatePhrase, deletePhrase } from '../lib/db';
import { triggerProcessing, buildFileUrl } from '../lib/modal';

// GET /api/phrases
export async function handleListPhrases(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const status = url.searchParams.get('status') as PhraseStatus | null;
  const limit = parseInt(url.searchParams.get('limit') || '100', 10);
  
  const phrases = await listPhrases(env, status || undefined, limit);
  return Response.json({ phrases });
}

// GET /api/phrases/:id
export async function handleGetPhrase(
  request: Request,
  env: Env,
  id: string
): Promise<Response> {
  const phrase = await getPhrase(env, id);
  
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
  const phrase = await getPhrase(env, id);
  
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
    
    await updatePhrase(env, id, { 
      status: 'processing',
      detected_language: body.detected_language 
    });
    
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
  
  await updatePhrase(env, id, body);
  
  const updated = await getPhrase(env, id);
  return Response.json({ phrase: updated });
}

// POST /api/phrases/:id/approve
export async function handleApprovePhrase(
  request: Request,
  env: Env,
  id: string
): Promise<Response> {
  const phrase = await getPhrase(env, id);
  
  if (!phrase) {
    return Response.json({ error: 'Phrase not found' }, { status: 404 });
  }
  
  if (phrase.status !== 'pending_review') {
    return Response.json(
      { error: 'Can only approve phrases in pending_review status' },
      { status: 400 }
    );
  }
  
  await updatePhrase(env, id, { status: 'approved' });
  
  return Response.json({ message: 'Phrase approved' });
}

// POST /api/phrases/:id/regenerate-audio
export async function handleRegenerateAudio(
  request: Request,
  env: Env,
  id: string
): Promise<Response> {
  const phrase = await getPhrase(env, id);
  
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

// DELETE /api/phrases/:id
export async function handleDeletePhrase(
  request: Request,
  env: Env,
  id: string
): Promise<Response> {
  const phrase = await getPhrase(env, id);
  
  if (!phrase) {
    return Response.json({ error: 'Phrase not found' }, { status: 404 });
  }
  
  await deletePhrase(env, id);
  
  // TODO: Also delete files from R2
  
  return Response.json({ message: 'Phrase deleted' });
}
