import { Env } from '../types';
import { encryptApiKey, decryptApiKey, maskApiKey } from './crypto';
import { LLMProvider } from './llmProviders';
import { getDailyUsage } from './dailyUsage';

export interface UserSettingsPublic {
  llm_provider: LLMProvider | null;
  llm_model: string | null;
  llm_api_key_mask: string | null;
  daily_llm_usage: number | null;   // null when user has a BYO key
  daily_llm_limit: number | null;   // null when user has a BYO key
}

export interface LLMKeyData {
  provider: LLMProvider;
  model: string;
  key: string;
}

interface UserSettingsRow {
  user_id: string;
  llm_provider: string | null;
  llm_model: string | null;
  llm_api_key_encrypted: string | null;
  llm_api_key_iv: string | null;
  llm_api_key_mask: string | null;
  created_at: number;
  updated_at: number;
}

export async function getUserSettings(
  env: Env,
  userId: string,
): Promise<UserSettingsPublic> {
  const row = await env.DB.prepare(
    'SELECT llm_provider, llm_model, llm_api_key_mask FROM user_settings WHERE user_id = ?',
  )
    .bind(userId)
    .first<Pick<UserSettingsRow, 'llm_provider' | 'llm_model' | 'llm_api_key_mask'>>();

  const hasBYOKey = !!row?.llm_api_key_mask;
  const usage = hasBYOKey ? null : await getDailyUsage(env, userId);

  return {
    llm_provider: (row?.llm_provider as LLMProvider) ?? null,
    llm_model: row?.llm_model ?? null,
    llm_api_key_mask: row?.llm_api_key_mask ?? null,
    daily_llm_usage: usage?.count ?? null,
    daily_llm_limit: usage?.limit ?? null,
  };
}

export async function getDecryptedLLMKey(
  env: Env,
  userId: string,
): Promise<LLMKeyData | null> {
  const row = await env.DB.prepare(
    'SELECT llm_provider, llm_model, llm_api_key_encrypted, llm_api_key_iv FROM user_settings WHERE user_id = ?',
  )
    .bind(userId)
    .first<Pick<UserSettingsRow, 'llm_provider' | 'llm_model' | 'llm_api_key_encrypted' | 'llm_api_key_iv'>>();

  if (!row?.llm_provider || !row?.llm_model || !row?.llm_api_key_encrypted || !row?.llm_api_key_iv) {
    return null;
  }

  const key = await decryptApiKey(env, row.llm_api_key_encrypted, row.llm_api_key_iv);
  return { provider: row.llm_provider as LLMProvider, model: row.llm_model, key };
}

export async function saveUserLLMKey(
  env: Env,
  userId: string,
  provider: LLMProvider,
  model: string,
  apiKey: string,
): Promise<string> {
  const { ciphertext, iv } = await encryptApiKey(env, apiKey);
  const mask = maskApiKey(apiKey);
  const now = Date.now();

  await env.DB.prepare(`
    INSERT INTO user_settings (user_id, llm_provider, llm_model, llm_api_key_encrypted, llm_api_key_iv, llm_api_key_mask, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      llm_provider = excluded.llm_provider,
      llm_model = excluded.llm_model,
      llm_api_key_encrypted = excluded.llm_api_key_encrypted,
      llm_api_key_iv = excluded.llm_api_key_iv,
      llm_api_key_mask = excluded.llm_api_key_mask,
      updated_at = excluded.updated_at
  `)
    .bind(userId, provider, model, ciphertext, iv, mask, now, now)
    .run();

  return mask;
}

export async function deleteUserLLMKey(
  env: Env,
  userId: string,
): Promise<void> {
  await env.DB.prepare(`
    UPDATE user_settings SET
      llm_provider = NULL,
      llm_model = NULL,
      llm_api_key_encrypted = NULL,
      llm_api_key_iv = NULL,
      llm_api_key_mask = NULL,
      updated_at = ?
    WHERE user_id = ?
  `)
    .bind(Date.now(), userId)
    .run();
}
