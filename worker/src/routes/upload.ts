import { Env, SourceType, Language } from '../types';
import { createPhrase } from '../lib/db';
import { uploadFile, generateFileKey, getExtensionFromContentType } from '../lib/r2';
import { getUserId } from '../lib/auth';
import { triggerProcessing, buildFileUrl } from '../lib/modal';

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
  await triggerProcessing(env, {
    phrase_id: phraseId,
    source_type: sourceType,
    file_url: buildFileUrl(requestUrl, fileKey),
    source_text: null,
    language: null,
    webhook_url: '', // Will be set in triggerProcessing
  }, requestUrl);
  
  return Response.json({
    id: phraseId,
    status: 'processing',
  });
}

// POST /api/upload/text - JSON body with text content
export async function handleTextUpload(
  request: Request,
  env: Env
): Promise<Response> {
  const userId = await getUserId(request, env)
  const body = await request.json() as { text?: string; language?: Language };
  
  if (!body.text?.trim()) {
    return Response.json({ error: 'No text provided' }, { status: 400 });
  }
  
  if (!body.language || !['ru', 'ar'].includes(body.language)) {
    return Response.json(
      { error: 'Language required for text input (ru or ar)' },
      { status: 400 }
    );
  }
  
  const phraseId = generateId();
  
  // Create DB record with text already set
  await createPhrase(env, userId, phraseId, 'text', null, body.text.trim(), body.language);
  
  // Trigger Modal processing (no file, just text)
  const requestUrl = new URL(request.url);
  await triggerProcessing(env, {
    phrase_id: phraseId,
    source_type: 'text',
    file_url: null,
    source_text: body.text.trim(),
    language: body.language,
    webhook_url: '',
  }, requestUrl);
  
  return Response.json({
    id: phraseId,
    status: 'processing',
  });
}
