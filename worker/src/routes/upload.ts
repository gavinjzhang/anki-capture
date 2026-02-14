import { Env, SourceType, Language } from '../types';
import { createPhrase, setCurrentJobForUser } from '../lib/db';
import { uploadFile, generateFileKey, getExtensionFromContentType } from '../lib/r2';
import { getUserId } from '../lib/auth';
import { triggerProcessing, buildFileUrl } from '../lib/modal';
import { isRateLimited, addRateLimitHeaders } from '../lib/rateLimit';

function generateId(): string {
  return crypto.randomUUID();
}

function detectSourceType(contentType: string): SourceType | null {
  if (contentType.startsWith('image/')) return 'image';
  if (contentType.startsWith('audio/')) return 'audio';
  return null;
}

// POST /api/upload - multipart form with file
export async function handleFileUpload(
  request: Request,
  env: Env
): Promise<Response> {
  // Check rate limit
  const { limited, userId: rateLimitUserId } = await isRateLimited(request, env, 'upload');
  if (limited) {
    const headers = new Headers();
    if (rateLimitUserId) addRateLimitHeaders(headers, rateLimitUserId, 'upload');
    return Response.json(
      { error: 'Too many upload requests. Please try again later.' },
      { status: 429, headers }
    );
  }

  const userId = await getUserId(request, env)
  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  
  if (!file) {
    return Response.json({ error: 'No file provided' }, { status: 400 });
  }

  // Enforce size limits (default 20MB, overridable via env)
  const maxMb = parseInt(env.MAX_UPLOAD_MB || '20', 10);
  const maxBytes = maxMb * 1024 * 1024;
  if (file.size > maxBytes) {
    return Response.json({ error: `File too large. Max ${maxMb}MB` }, { status: 413 });
  }
  
  const sourceType = detectSourceType(file.type);
  if (!sourceType) {
    return Response.json(
      { error: 'Invalid file type. Must be image or audio.' },
      { status: 400 }
    );
  }
  
  const phraseId = generateId();
  const ext = getExtensionFromContentType(file.type);
  const fileKey = generateFileKey(userId, phraseId, 'original', ext);
  
  // Upload to R2
  await uploadFile(env, fileKey, await file.arrayBuffer(), file.type);
  
  // Create DB record
  await createPhrase(env, userId, phraseId, sourceType, fileKey);
  
  // Trigger Modal processing
  const requestUrl = new URL(request.url);
  const jobId = crypto.randomUUID();
  await setCurrentJobForUser(env, userId, phraseId, jobId, true);
  console.log('Enqueue processing', { request_id: request.headers.get('x-request-id') || undefined, phrase_id: phraseId, job_id: jobId, source_type: sourceType });
  await triggerProcessing(env, {
    phrase_id: phraseId,
    source_type: sourceType,
    file_url: await buildFileUrl(env, requestUrl, fileKey),
    source_text: null,
    language: null,
    webhook_url: '', // Will be set in triggerProcessing
    job_id: jobId,
  }, requestUrl);

  const responseHeaders = new Headers();
  addRateLimitHeaders(responseHeaders, userId, 'upload');

  return Response.json({
    id: phraseId,
    status: 'processing',
  }, { headers: responseHeaders });
}

// POST /api/upload/text - JSON body with text content
export async function handleTextUpload(
  request: Request,
  env: Env
): Promise<Response> {
  // Check rate limit
  const { limited, userId: rateLimitUserId } = await isRateLimited(request, env, 'upload');
  if (limited) {
    const headers = new Headers();
    if (rateLimitUserId) addRateLimitHeaders(headers, rateLimitUserId, 'upload');
    return Response.json(
      { error: 'Too many upload requests. Please try again later.' },
      { status: 429, headers }
    );
  }

  const userId = await getUserId(request, env)
  const body = await request.json() as { text?: string; language?: Language };
  
  if (!body.text?.trim()) {
    return Response.json({ error: 'No text provided' }, { status: 400 });
  }
  
  if (!body.language || !['ru', 'ar', 'zh', 'es', 'ka'].includes(body.language)) {
    return Response.json(
      { error: 'Language required for text input (ru, ar, zh, es, ka)' },
      { status: 400 }
    );
  }
  
  const phraseId = generateId();
  
  // Create DB record with text already set
  await createPhrase(env, userId, phraseId, 'text', null, body.text.trim(), body.language);
  
  // Trigger Modal processing (no file, just text)
  const requestUrl = new URL(request.url);
  const jobId = crypto.randomUUID();
  await setCurrentJobForUser(env, userId, phraseId, jobId, true);
  console.log('Enqueue processing', { request_id: request.headers.get('x-request-id') || undefined, phrase_id: phraseId, job_id: jobId, source_type: 'text' });
  await triggerProcessing(env, {
    phrase_id: phraseId,
    source_type: 'text',
    file_url: null,
    source_text: body.text.trim(),
    language: body.language,
    webhook_url: '',
    job_id: jobId,
  }, requestUrl);

  const responseHeaders = new Headers();
  addRateLimitHeaders(responseHeaders, userId, 'upload');

  return Response.json({
    id: phraseId,
    status: 'processing',
  }, { headers: responseHeaders });
}
