import { Env } from '../types';

export async function uploadFile(
  env: Env,
  key: string,
  data: ArrayBuffer | ReadableStream,
  contentType: string
): Promise<string> {
  await env.BUCKET.put(key, data, {
    httpMetadata: { contentType },
  });
  return key;
}

export async function getFileUrl(env: Env, key: string): Promise<string | null> {
  const object = await env.BUCKET.head(key);
  if (!object) return null;
  // For signed URLs, you'd generate them here
  // For now, return the key and handle via a /files/:key route
  return `/api/files/${encodeURIComponent(key)}`;
}

export async function getFile(env: Env, key: string): Promise<R2ObjectBody | null> {
  return env.BUCKET.get(key);
}

export async function deleteFile(env: Env, key: string): Promise<void> {
  await env.BUCKET.delete(key);
}

export function generateFileKey(phraseId: string, type: 'original' | 'audio', ext: string): string {
  return `${type}/${phraseId}.${ext}`;
}

export function getExtensionFromContentType(contentType: string): string {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/webm': 'webm',
    'audio/ogg': 'ogg',
    'audio/m4a': 'm4a',
    'audio/mp4': 'm4a',
  };
  return map[contentType] || 'bin';
}
