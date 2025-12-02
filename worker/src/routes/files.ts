import { Env } from '../types';
import { getFile } from '../lib/r2';

// GET /api/files/:key
export async function handleGetFile(
  request: Request,
  env: Env,
  key: string
): Promise<Response> {
  const decodedKey = decodeURIComponent(key);
  const object = await getFile(env, decodedKey);
  
  if (!object) {
    return Response.json({ error: 'File not found' }, { status: 404 });
  }
  
  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType || 'application/octet-stream');
  headers.set('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
  
  return new Response(object.body, { headers });
}
