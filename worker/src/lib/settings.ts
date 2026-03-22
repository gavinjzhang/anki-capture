import { Env } from '../types';
import { encryptApiKey, decryptApiKey, maskApiKey } from './crypto';

export interface UserSettingsPublic {
  openai_api_key_mask: string | null;
}

interface UserSettingsRow {
  user_id: string;
  openai_api_key_encrypted: string | null;
  openai_api_key_iv: string | null;
  openai_api_key_mask: string | null;
  created_at: number;
  updated_at: number;
}

export async function getUserSettings(
  env: Env,
  userId: string,
): Promise<UserSettingsPublic> {
  const row = await env.DB.prepare(
    'SELECT openai_api_key_mask FROM user_settings WHERE user_id = ?',
  )
    .bind(userId)
    .first<Pick<UserSettingsRow, 'openai_api_key_mask'>>();

  return { openai_api_key_mask: row?.openai_api_key_mask ?? null };
}

export async function getDecryptedOpenAIKey(
  env: Env,
  userId: string,
): Promise<string | null> {
  const row = await env.DB.prepare(
    'SELECT openai_api_key_encrypted, openai_api_key_iv FROM user_settings WHERE user_id = ?',
  )
    .bind(userId)
    .first<Pick<UserSettingsRow, 'openai_api_key_encrypted' | 'openai_api_key_iv'>>();

  if (!row?.openai_api_key_encrypted || !row?.openai_api_key_iv) {
    return null;
  }

  return decryptApiKey(env, row.openai_api_key_encrypted, row.openai_api_key_iv);
}

export async function saveOpenAIKey(
  env: Env,
  userId: string,
  apiKey: string,
): Promise<string> {
  const { ciphertext, iv } = await encryptApiKey(env, apiKey);
  const mask = maskApiKey(apiKey);
  const now = Date.now();

  await env.DB.prepare(`
    INSERT INTO user_settings (user_id, openai_api_key_encrypted, openai_api_key_iv, openai_api_key_mask, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      openai_api_key_encrypted = excluded.openai_api_key_encrypted,
      openai_api_key_iv = excluded.openai_api_key_iv,
      openai_api_key_mask = excluded.openai_api_key_mask,
      updated_at = excluded.updated_at
  `)
    .bind(userId, ciphertext, iv, mask, now, now)
    .run();

  return mask;
}

export async function deleteOpenAIKey(
  env: Env,
  userId: string,
): Promise<void> {
  await env.DB.prepare(`
    UPDATE user_settings SET
      openai_api_key_encrypted = NULL,
      openai_api_key_iv = NULL,
      openai_api_key_mask = NULL,
      updated_at = ?
    WHERE user_id = ?
  `)
    .bind(Date.now(), userId)
    .run();
}
