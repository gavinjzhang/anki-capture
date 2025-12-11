import { Env } from '../types';
import { isR2KeyReferenced } from '../lib/db';
import { deleteFile } from '../lib/r2';

export async function sweepR2Orphans(env: Env, options?: { limit?: number; minAgeMs?: number }): Promise<{ scanned: number; deleted: number }> {
  const limit = Math.max(1, Math.min(options?.limit ?? 50, 1000));
  const minAgeMs = options?.minAgeMs ?? 24 * 60 * 60 * 1000; // default 24h
  const cutoff = Date.now() - minAgeMs;

  let scanned = 0;
  let deleted = 0;

  // Process first page only; repeated runs eventually drain as we delete
  const list = await env.BUCKET.list({ limit });
  for (const obj of list.objects) {
    if (!obj || !obj.key) continue;
    // Skip very new objects to avoid racing in-flight operations
    const lastModified = obj.uploaded || obj.httpEtag ? (obj as any).uploaded : null;
    // R2's list returns no uploaded timestamp in Workers R2Object; use obj.uploaded if present, else skip age check
    if (typeof obj.size === 'number' && obj.size >= 0) {
      // ok
    }
    if (obj.customMetadata && obj.customMetadata['tmp']) continue;
    if (obj.key.endsWith('/')) continue; // folder placeholder

    // Approx age filter using original object
    if ((obj as any).uploaded && (obj as any).uploaded > cutoff) {
      continue;
    }

    scanned++;
    const referenced = await isR2KeyReferenced(env, obj.key);
    if (!referenced) {
      try {
        await deleteFile(env, obj.key);
        deleted++;
        console.log('Orphan deleted', { key: obj.key });
      } catch (e) {
        console.error('Orphan delete failed', { key: obj.key, error: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  return { scanned, deleted };
}

