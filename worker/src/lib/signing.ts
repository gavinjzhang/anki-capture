import { Env } from '../types';

function toBase64Url(bytes: ArrayBuffer): string {
  const bin = String.fromCharCode(...new Uint8Array(bytes));
  const b64 = btoa(bin);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function getCryptoKey(env: Env): Promise<CryptoKey | null> {
  const secret = env.FILE_URL_SIGNING_SECRET;
  if (!secret) return null;
  const enc = new TextEncoder().encode(secret);
  return crypto.subtle.importKey('raw', enc, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function signFilePath(env: Env, key: string, expires: number): Promise<string | null> {
  const cryptoKey = await getCryptoKey(env);
  if (!cryptoKey) return null;
  const msg = new TextEncoder().encode(`${key}:${expires}`);
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, msg);
  return toBase64Url(sig);
}

export async function verifySignature(env: Env, key: string, expires: number, sig: string): Promise<boolean> {
  const expected = await signFilePath(env, key, expires);
  if (!expected) return false;
  // Simple equality check; Workers does not expose a constant-time helper
  return expected === sig;
}

export async function buildSignedPath(env: Env, key: string, ttlSeconds: number): Promise<string | null> {
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = await signFilePath(env, key, expires);
  if (!sig) return null;
  return `/api/files/${encodeURIComponent(key)}?e=${expires}&sig=${encodeURIComponent(sig)}`;
}

export async function buildAbsoluteSignedUrl(env: Env, origin: string, key: string, ttlSeconds: number): Promise<string | null> {
  const path = await buildSignedPath(env, key, ttlSeconds);
  if (!path) return null;
  const url = new URL(path, origin);
  return url.toString();
}

