import { Env } from '../types';

/**
 * AES-256-GCM encryption for user API keys.
 *
 * Uses HKDF to derive a strong AES key from the Wrangler secret,
 * so even a weaker passphrase becomes a full-entropy 256-bit key.
 */

const HKDF_SALT = new TextEncoder().encode('anki-capture-user-keys-v1');
const HKDF_INFO = new TextEncoder().encode('aes-256-gcm');

async function deriveKey(env: Env): Promise<CryptoKey> {
  const secret = env.USER_KEY_ENCRYPTION_SECRET;
  if (!secret) {
    throw new Error('USER_KEY_ENCRYPTION_SECRET is not configured');
  }

  const rawKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    'HKDF',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: HKDF_INFO },
    rawKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function toBase64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function fromBase64(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export async function encryptApiKey(
  env: Env,
  plaintext: string,
): Promise<{ ciphertext: string; iv: string }> {
  const key = await deriveKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded,
  );

  return {
    ciphertext: toBase64(encrypted),
    iv: toBase64(iv.buffer),
  };
}

export async function decryptApiKey(
  env: Env,
  ciphertext: string,
  iv: string,
): Promise<string> {
  const key = await deriveKey(env);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(fromBase64(iv)) },
    key,
    fromBase64(ciphertext),
  );

  return new TextDecoder().decode(decrypted);
}

export function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 7) return '****';
  const last4 = apiKey.slice(-4);
  return `${apiKey.slice(0, 3)}...${last4}`;
}
