import { Env } from '../types';
import { listPhrasesForUser, updatePhraseForUser } from '../lib/db';
import { getFile, uploadFile, deleteFile } from '../lib/r2';
import { getUserId } from '../lib/auth';

function isAdmin(request: Request, env: Env): boolean {
  const email = request.headers.get('Cf-Access-Authenticated-User-Email')?.toLowerCase();
  if (!email) return false;
  const list = (env.ADMIN_EMAILS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  if (list.length === 0) return true; // If not configured, allow any Access user
  return list.includes(email);
}

// POST /api/admin/backfill
// Body: { default_user_id: string }
export async function handleBackfillUsers(
  request: Request,
  env: Env
): Promise<Response> {
  if (!isAdmin(request, env)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = await request.json().catch(() => ({})) as { default_user_id?: string };
  const defaultUser = (body.default_user_id || '').toLowerCase();
  if (!defaultUser) {
    return Response.json({ error: 'default_user_id required' }, { status: 400 });
  }
  // Set user_id to default for any nulls
  await env.DB.prepare(`UPDATE phrases SET user_id = ? WHERE user_id IS NULL`).bind(defaultUser).run();
  return Response.json({ message: 'Backfill complete' });
}

// POST /api/admin/migrate-r2
// Body: { user_id: string, limit?: number }
// For phrases belonging to user where keys are not yet namespaced, copy to namespaced keys and update DB
export async function handleMigrateR2(
  request: Request,
  env: Env
): Promise<Response> {
  if (!isAdmin(request, env)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = await request.json().catch(() => ({})) as { user_id?: string; limit?: number };
  const userId = (body.user_id || '').toLowerCase();
  const limit = Math.min(Math.max(body.limit || 200, 1), 1000);
  if (!userId) return Response.json({ error: 'user_id required' }, { status: 400 });

  const phrases = await listPhrasesForUser(env, userId, undefined, limit);
  let migrated = 0;

  for (const p of phrases) {
    // Already namespaced
    const needsOrig = p.original_file_url && !p.original_file_url.startsWith(`${userId}/`);
    const needsAudio = p.audio_url && !p.audio_url.startsWith(`${userId}/`);
    if (!needsOrig && !needsAudio) continue;

    const updates: any = {};

    if (needsOrig && p.original_file_url) {
      const oldKey = p.original_file_url;
      const obj = await getFile(env, oldKey);
      if (obj) {
        const ext = oldKey.split('.').pop() || 'bin';
        const newKey = `${userId}/original/${p.id}.${ext}`;
        const contentType = obj.httpMetadata?.contentType || 'application/octet-stream';
        await uploadFile(env, newKey, obj.body as ReadableStream, contentType);
        updates.original_file_url = newKey;
        await deleteFile(env, oldKey);
      }
    }

    if (needsAudio && p.audio_url) {
      const oldKey = p.audio_url;
      const obj = await getFile(env, oldKey);
      if (obj) {
        const ext = oldKey.split('.').pop() || 'mp3';
        const newKey = `${userId}/audio/${p.id}.${ext}`;
        const contentType = obj.httpMetadata?.contentType || 'audio/mpeg';
        await uploadFile(env, newKey, obj.body as ReadableStream, contentType);
        updates.audio_url = newKey;
        await deleteFile(env, oldKey);
      }
    }

    if (Object.keys(updates).length) {
      await updatePhraseForUser(env, userId, p.id, updates);
      migrated++;
    }
  }

  return Response.json({ migrated, total: phrases.length });
}

