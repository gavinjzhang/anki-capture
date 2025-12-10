import { Env } from '../types';

// GET /api/health
export async function handleHealth(
  _request: Request,
  env: Env
): Promise<Response> {
  const start = Date.now();
  let dbOk = false;
  let r2Ok = false;
  try {
    const row = await env.DB.prepare('SELECT 1 as ok').first<{ ok: number }>();
    dbOk = !!row?.ok;
  } catch (e) {
    dbOk = false;
  }
  try {
    const list = await env.BUCKET.list({ limit: 1 });
    r2Ok = Array.isArray(list.objects);
  } catch (e) {
    r2Ok = false;
  }

  const ok = dbOk && r2Ok;
  return Response.json({
    ok,
    db: dbOk,
    r2: r2Ok,
    elapsed_ms: Date.now() - start,
  }, { status: ok ? 200 : 503 });
}

