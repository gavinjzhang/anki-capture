import { Env } from '../types';
import { requireAuth } from '../lib/auth';
import { getUserSettings, saveOpenAIKey, deleteOpenAIKey } from '../lib/settings';
import { isRateLimited } from '../lib/rateLimit';

// Validation: OpenAI keys start with sk- and are typically 51+ chars
const OPENAI_KEY_REGEX = /^sk-[A-Za-z0-9_-]{20,200}$/;

// GET /api/settings
export async function handleGetSettings(
  request: Request,
  env: Env,
): Promise<Response> {
  const userId = await requireAuth(request, env);
  const settings = await getUserSettings(env, userId);
  return Response.json(settings);
}

// PUT /api/settings
export async function handleUpdateSettings(
  request: Request,
  env: Env,
): Promise<Response> {
  // Rate limit key updates
  const { limited } = await isRateLimited(request, env, 'settings');
  if (limited) {
    return Response.json(
      { error: 'Too many settings updates. Please try again later.' },
      { status: 429 },
    );
  }

  const userId = await requireAuth(request, env);

  let body: { openai_api_key?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { openai_api_key } = body;
  if (!openai_api_key || typeof openai_api_key !== 'string') {
    return Response.json({ error: 'openai_api_key is required' }, { status: 400 });
  }

  if (!OPENAI_KEY_REGEX.test(openai_api_key)) {
    return Response.json(
      { error: 'Invalid API key format. Must start with sk- and contain only alphanumeric characters.' },
      { status: 400 },
    );
  }

  if (!env.USER_KEY_ENCRYPTION_SECRET) {
    return Response.json(
      { error: 'Key storage is not configured on this server' },
      { status: 503 },
    );
  }

  // Validate the key by making a lightweight OpenAI API call
  try {
    const validateResp = await fetch('https://api.openai.com/v1/models?limit=1', {
      headers: { Authorization: `Bearer ${openai_api_key}` },
    });
    if (!validateResp.ok) {
      const errBody = await validateResp.text();
      if (validateResp.status === 401) {
        return Response.json({ error: 'Invalid API key — authentication failed with OpenAI' }, { status: 400 });
      }
      return Response.json(
        { error: `OpenAI API key validation failed (${validateResp.status}): ${errBody.slice(0, 200)}` },
        { status: 400 },
      );
    }
  } catch (err) {
    return Response.json(
      { error: 'Could not reach OpenAI to validate key. Please try again.' },
      { status: 502 },
    );
  }

  const mask = await saveOpenAIKey(env, userId, openai_api_key);

  return Response.json({ openai_api_key_mask: mask, validated: true });
}

// DELETE /api/settings
export async function handleDeleteSettings(
  request: Request,
  env: Env,
): Promise<Response> {
  const userId = await requireAuth(request, env);
  await deleteOpenAIKey(env, userId);
  return Response.json({ success: true });
}
