import { Env } from '../types';
import { getFile } from '../lib/r2';
import { getUserId } from '../lib/auth';

// GET /api/files/:key
export async function handleGetFile(
  request: Request,
  env: Env,
  key: string
): Promise<Response> {
  const decodedKey = decodeURIComponent(key);
  // If the request is authenticated (Clerk or Access), ensure the caller can only fetch
  // files under their own user namespace. Allow unauthenticated access to
  // support Modal jobs fetching originals/audio.
  const hasBearer = request.headers.get('Authorization')?.startsWith('Bearer ');
  const callerEmail = request.headers.get('Cf-Access-Authenticated-User-Email');
  if (hasBearer || callerEmail) {
    const userId = await getUserId(request, env);
    const isLegacy = decodedKey.startsWith('original/') || decodedKey.startsWith('audio/');
    if (!isLegacy && !decodedKey.startsWith(`${userId}/`)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
  }
  const object = await getFile(env, decodedKey);
  
  if (!object) {
    return Response.json({ error: 'File not found' }, { status: 404 });
  }
  
  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType || 'application/octet-stream');
  headers.set('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
  
  return new Response(object.body, { headers });
}
