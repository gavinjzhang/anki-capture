import { Env, SourceType, Language } from '../types';

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

export function buildFileUrl(requestUrl: URL, fileKey: string): string {
  return new URL(`/api/files/${encodeURIComponent(fileKey)}`, requestUrl.origin).toString();
}
