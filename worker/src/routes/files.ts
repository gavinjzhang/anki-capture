import { Env } from '../types';
import { getFile } from '../lib/r2';
import { getUserId } from '../lib/auth';
import { verifySignature } from '../lib/signing';

// GET /api/files/:key
export async function handleGetFile(
  request: Request,
  env: Env,
  key: string
): Promise<Response> {
  const decodedKey = decodeURIComponent(key);
  // Authorize via signed URL or authenticated namespace match
  const url = new URL(request.url);
  const e = url.searchParams.get('e');
  const sig = url.searchParams.get('sig');

  let authorized = false;
  if (e && sig) {
    const exp = parseInt(e, 10);
    if (!Number.isNaN(exp) && exp * 1000 >= Date.now()) {
      authorized = await verifySignature(env, decodedKey, exp, sig);
    }
  }

  if (!authorized) {
    // Check for Modal's auth header
    const modalSecret = request.headers.get('X-Modal-Secret');
    console.log('File access attempt', {
      key: decodedKey.slice(0, 50),
      hasModalSecret: !!modalSecret,
      modalSecretLength: modalSecret?.length,
      expectedSecretLength: env.MODAL_WEBHOOK_SECRET?.length
    });
    if (modalSecret && modalSecret === env.MODAL_WEBHOOK_SECRET) {
      authorized = true;
    } else {
      // Check for user authentication
      const hasBearer = request.headers.get('Authorization')?.startsWith('Bearer ');
      const callerEmail = request.headers.get('Cf-Access-Authenticated-User-Email');
      if (hasBearer || callerEmail) {
        const userId = await getUserId(request, env);
        const isLegacy = decodedKey.startsWith('original/') || decodedKey.startsWith('audio/');
        if (!isLegacy && decodedKey.startsWith(`${userId}/`)) {
          authorized = true;
        }
      }
    }
  }

  if (!authorized) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
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
