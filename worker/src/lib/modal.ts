import { Env, SourceType, Language } from '../types';
import { buildAbsoluteSignedUrl } from './signing';

export interface ProcessingJob {
  phrase_id: string;
  source_type: SourceType;
  file_url: string | null;      // R2 URL for image/audio
  source_text: string | null;   // Direct text for text input
  language: Language | null;    // Forced language (for text input or reprocessing)
  webhook_url: string;
  job_id: string;
}

export async function triggerProcessing(
  env: Env,
  job: ProcessingJob,
  requestUrl: URL
): Promise<void> {
  // Build the webhook URL that Modal will call back to
  const webhookUrl = new URL('/api/webhook/modal', requestUrl.origin).toString();
  const endpoint = env.MODAL_ENDPOINT;
  if (!endpoint) {
    throw new Error('MODAL_ENDPOINT is not configured');
  }
  
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...job,
      webhook_url: webhookUrl,
      webhook_secret: env.MODAL_WEBHOOK_SECRET,
    }),
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Modal trigger failed: ${error}`);
  }
}

export async function buildFileUrl(env: Env, requestUrl: URL, fileKey: string): Promise<string> {
  // Default to a long TTL for background jobs
  const ttl = 24 * 60 * 60; // 24 hours
  const signed = await buildAbsoluteSignedUrl(env, requestUrl.origin, fileKey, ttl);
  // Fallback to unsigned path if signing is not configured
  return signed || new URL(`/api/files/${encodeURIComponent(fileKey)}`, requestUrl.origin).toString();
}
