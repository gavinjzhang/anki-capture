import { Env } from './types';
import { handleFileUpload, handleTextUpload } from './routes/upload';
import { 
  handleListPhrases, 
  handleGetPhrase, 
  handleUpdatePhrase,
  handleApprovePhrase,
  handleRegenerateAudio,
  handleDeletePhrase,
  handleRetryPhrase
} from './routes/phrases';
import { handleExport, handleExportComplete, handleExportPreview } from './routes/export';
import { handleModalWebhook } from './routes/webhook';
import { handleGetFile } from './routes/files';
import { handleHealth } from './routes/health';
import { sweepProcessingTimeouts } from './lib/db';
import { sweepR2Orphans } from './maintenance/orphans';

// Simple router
type Handler = (request: Request, env: Env, ...args: string[]) => Promise<Response>;

interface Route {
  method: string;
  pattern: RegExp;
  handler: Handler;
}

const routes: Route[] = [
  // Upload
  { method: 'POST', pattern: /^\/api\/upload$/, handler: handleFileUpload },
  { method: 'POST', pattern: /^\/api\/upload\/text$/, handler: handleTextUpload },
  
  // Phrases CRUD
  { method: 'GET', pattern: /^\/api\/phrases$/, handler: handleListPhrases },
  { method: 'GET', pattern: /^\/api\/phrases\/([^/]+)$/, handler: handleGetPhrase },
  { method: 'PATCH', pattern: /^\/api\/phrases\/([^/]+)$/, handler: handleUpdatePhrase },
  { method: 'DELETE', pattern: /^\/api\/phrases\/([^/]+)$/, handler: handleDeletePhrase },
  { method: 'POST', pattern: /^\/api\/phrases\/([^/]+)\/approve$/, handler: handleApprovePhrase },
  { method: 'POST', pattern: /^\/api\/phrases\/([^/]+)\/regenerate-audio$/, handler: handleRegenerateAudio },
  { method: 'POST', pattern: /^\/api\/phrases\/([^/]+)\/retry$/, handler: handleRetryPhrase },
  
  // Export
  { method: 'GET', pattern: /^\/api\/export$/, handler: handleExport },
  { method: 'GET', pattern: /^\/api\/export\/preview$/, handler: handleExportPreview },
  { method: 'POST', pattern: /^\/api\/export\/complete$/, handler: handleExportComplete },
  
  // Webhook
  { method: 'POST', pattern: /^\/api\/webhook\/modal$/, handler: handleModalWebhook },
  
  // Files
  { method: 'GET', pattern: /^\/api\/files\/(.+)$/, handler: handleGetFile },

  // Health
  { method: 'GET', pattern: /^\/api\/health$/, handler: handleHealth },

];

function corsHeaders(env: Env, requestOrigin?: string | null): HeadersInit {
  const allowedOrigins = env.ALLOWED_ORIGINS?.split(',').map(o => o.trim()) || [];

  // For development, allow localhost origins
  if (env.ENVIRONMENT === 'development') {
    allowedOrigins.push('http://localhost:5173', 'http://localhost:8787', 'http://127.0.0.1:5173');
  }

  // Determine if the request origin is allowed
  const origin = requestOrigin && allowedOrigins.includes(requestOrigin)
    ? requestOrigin
    : (allowedOrigins.length > 0 ? allowedOrigins[0] : '*');

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Assign a request ID for structured logs
    const requestId = crypto.randomUUID();
    const headersClone = new Headers(request.headers);
    headersClone.set('x-request-id', requestId);
    const reqWithId = new Request(request, { headers: headersClone });
    const origin = request.headers.get('Origin');

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(env, origin) });
    }
    
    const url = new URL(request.url);
    const path = url.pathname;
    
    // Find matching route
    for (const route of routes) {
      if (request.method !== route.method) continue;
      
      const match = path.match(route.pattern);
      if (match) {
        try {
          const response = await route.handler(reqWithId, env, ...match.slice(1));

          // Add CORS headers to response
          const headers = new Headers(response.headers);
          Object.entries(corsHeaders(env, origin)).forEach(([k, v]) => headers.set(k, v));
          headers.set('x-request-id', requestId);

          return new Response(response.body, {
            status: response.status,
            headers,
          });
        } catch (error) {
          console.error('Route error', { request_id: requestId, path, error: error instanceof Error ? error.message : String(error) });
          return Response.json(
            { error: error instanceof Error ? error.message : 'Internal error' },
            { status: 500, headers: corsHeaders(env, origin) }
          );
        }
      }
    }

    return Response.json(
      { error: 'Not found' },
      { status: 404, headers: corsHeaders(env, origin) }
    );
  },
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    try {
      // Mark jobs stuck in processing for >10 minutes as failed
      await sweepProcessingTimeouts(env, 10 * 60 * 1000);
    } catch (err) {
      console.error('Scheduled sweep failed', err);
    }
    try {
      const limit = Number(env.MAX_ORPHAN_SWEEP || '50');
      const minAgeMs = Number(env.MIN_ORPHAN_AGE_MS || String(24 * 60 * 60 * 1000));
      const res = await sweepR2Orphans(env, { limit, minAgeMs });
      if (res.deleted > 0) {
        console.log('Orphan sweep', { scanned: res.scanned, deleted: res.deleted });
      }
    } catch (err) {
      console.error('Orphan sweep failed', err);
    }
  }
};
