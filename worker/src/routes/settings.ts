import { Env } from '../types';
import { requireAuth } from '../lib/auth';
import { getUserSettings, saveUserLLMKey, deleteUserLLMKey } from '../lib/settings';
import { isRateLimited } from '../lib/rateLimit';
import { LLM_PROVIDERS, PROVIDER_IDS, LLMProvider } from '../lib/llmProviders';

async function validateKeyWithProvider(provider: LLMProvider, apiKey: string): Promise<void> {
  let resp: Response;
  try {
    switch (provider) {
      case 'openai':
        resp = await fetch('https://api.openai.com/v1/models?limit=1', {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        break;
      case 'anthropic':
        resp = await fetch('https://api.anthropic.com/v1/models?limit=1', {
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
        });
        break;
      case 'gemini':
        resp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}&pageSize=1`,
        );
        break;
      case 'deepseek':
        resp = await fetch('https://api.deepseek.com/models', {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        break;
    }
  } catch {
    throw new Error(`Could not reach ${LLM_PROVIDERS[provider].name} to validate key. Please try again.`);
  }

  if (!resp.ok) {
    if (resp.status === 401 || resp.status === 403) {
      throw new Error(`Invalid API key — authentication failed with ${LLM_PROVIDERS[provider].name}.`);
    }
    const body = await resp.text().catch(() => '');
    throw new Error(
      `${LLM_PROVIDERS[provider].name} key validation failed (${resp.status}): ${body.slice(0, 200)}`,
    );
  }
}

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
  const { limited } = await isRateLimited(request, env, 'settings');
  if (limited) {
    return Response.json(
      { error: 'Too many settings updates. Please try again later.' },
      { status: 429 },
    );
  }

  const userId = await requireAuth(request, env);

  let body: { provider?: string; model?: string; api_key?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { provider, model, api_key } = body;

  if (!provider || !PROVIDER_IDS.includes(provider as LLMProvider)) {
    return Response.json(
      { error: `Invalid provider. Must be one of: ${PROVIDER_IDS.join(', ')}` },
      { status: 400 },
    );
  }

  const providerConfig = LLM_PROVIDERS[provider as LLMProvider];

  if (!model || !providerConfig.models.includes(model)) {
    return Response.json(
      { error: `Invalid model for ${providerConfig.name}. Must be one of: ${providerConfig.models.join(', ')}` },
      { status: 400 },
    );
  }

  if (!api_key || typeof api_key !== 'string') {
    return Response.json({ error: 'api_key is required' }, { status: 400 });
  }

  if (!providerConfig.keyPattern.test(api_key)) {
    return Response.json(
      { error: `Invalid API key format for ${providerConfig.name}. Expected format: ${providerConfig.keyHint}` },
      { status: 400 },
    );
  }

  if (!env.USER_KEY_ENCRYPTION_SECRET) {
    return Response.json(
      { error: 'Key storage is not configured on this server' },
      { status: 503 },
    );
  }

  try {
    await validateKeyWithProvider(provider as LLMProvider, api_key);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Key validation failed' },
      { status: 400 },
    );
  }

  const mask = await saveUserLLMKey(env, userId, provider as LLMProvider, model, api_key);

  return Response.json({ llm_provider: provider, llm_model: model, llm_api_key_mask: mask, validated: true });
}

// DELETE /api/settings
export async function handleDeleteSettings(
  request: Request,
  env: Env,
): Promise<Response> {
  const userId = await requireAuth(request, env);
  await deleteUserLLMKey(env, userId);
  return Response.json({ success: true });
}
