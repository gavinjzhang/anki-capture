import { Env, Language } from '../types';
import { requireAuth } from '../lib/auth';
import { isRateLimited } from '../lib/rateLimit';
import { createPhrase, getPhraseForUser, setCurrentJobForUser } from '../lib/db';
import { triggerProcessing } from '../lib/modal';

export interface GeneratePhraseRequest {
  language: Language;
  theme: string;
  num_phrases: number;
  existing_deck?: string;
}

export interface GeneratedPhrase {
  id: string;
  source_text: string;
  translation: string;
}

/**
 * POST /api/generate
 * Generate phrases using GPT based on theme
 */
export async function handleGenerate(
  request: Request,
  env: Env
): Promise<Response> {
  const userId = await requireAuth(request, env);

  // Rate limit check
  const { limited } = await isRateLimited(request, env, 'generate');
  if (limited) {
    return Response.json({ error: 'Rate limited. Please try again later.' }, { status: 429 });
  }

  let body: GeneratePhraseRequest;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { language, theme, num_phrases, existing_deck } = body;

  // Validation
  if (!language || !['ru', 'ar', 'zh', 'es', 'ka'].includes(language)) {
    return Response.json({ error: 'Invalid language' }, { status: 400 });
  }
  if (!theme || theme.trim().length === 0) {
    return Response.json({ error: 'Theme is required' }, { status: 400 });
  }
  if (!num_phrases || num_phrases < 1 || num_phrases > 50) {
    return Response.json({ error: 'num_phrases must be between 1 and 50' }, { status: 400 });
  }

  try {
    // Call Modal to generate phrases
    const endpoint = env.MODAL_GENERATE_ENDPOINT;
    if (!endpoint) {
      throw new Error('MODAL_GENERATE_ENDPOINT is not configured');
    }

    const modalResponse = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        language,
        theme: theme.trim(),
        num_phrases,
        existing_deck: existing_deck || null,
      }),
    });

    if (!modalResponse.ok) {
      const error = await modalResponse.text();
      throw new Error(`Phrase generation failed: ${error}`);
    }

    const result = await modalResponse.json();
    const phrases: GeneratedPhrase[] = result.phrases || [];

    // Store as draft phrases in DB
    const draftPhrases: GeneratedPhrase[] = [];
    for (const phrase of phrases) {
      const id = crypto.randomUUID();

      // Insert full phrase record directly
      await env.DB.prepare(`
        INSERT INTO phrases (
          id, user_id, source_text, transliteration, translation, grammar_notes,
          vocab_breakdown, detected_language, language_confidence, source_type,
          audio_url, original_file_url, status, exclude_from_export,
          job_started_at, job_attempts, last_error, current_job_id, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        id,
        userId,
        phrase.source_text,
        null, // transliteration
        phrase.translation,
        null, // grammar_notes
        null, // vocab_breakdown
        language,
        1.0, // language_confidence
        'text',
        null, // audio_url
        null, // original_file_url
        'pending_review',
        1, // exclude_from_export (boolean as 1/0)
        null, // job_started_at
        0, // job_attempts
        null, // last_error
        null, // current_job_id
        Date.now()
      ).run();

      draftPhrases.push({
        id,
        source_text: phrase.source_text,
        translation: phrase.translation,
      });
    }

    return Response.json({ phrases: draftPhrases });
  } catch (error) {
    console.error('Generate phrases error:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Generation failed' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/generate/confirm
 * Confirm and process selected draft phrases
 */
export async function handleConfirmGenerated(
  request: Request,
  env: Env
): Promise<Response> {
  const userId = await requireAuth(request, env);

  let body: { phrase_ids: string[]; discard_ids?: string[] };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { phrase_ids, discard_ids } = body;

  if (!phrase_ids || !Array.isArray(phrase_ids) || phrase_ids.length === 0) {
    return Response.json({ error: 'phrase_ids array is required' }, { status: 400 });
  }

  try {
    // Delete discarded draft phrases
    if (discard_ids && Array.isArray(discard_ids)) {
      for (const id of discard_ids) {
        const phrase = await getPhraseForUser(env, userId, id);
        if (phrase && phrase.exclude_from_export) {
          await env.DB.prepare('DELETE FROM phrases WHERE id = ? AND user_id = ?')
            .bind(id, userId)
            .run();
        }
      }
    }

    // Validate all phrases belong to user and are in draft state (exclude_from_export = true)
    for (const id of phrase_ids) {
      const phrase = await getPhraseForUser(env, userId, id);
      if (!phrase) {
        return Response.json({ error: `Phrase not found: ${id}` }, { status: 404 });
      }
      if (!phrase.exclude_from_export) {
        return Response.json({ error: `Phrase already confirmed: ${id}` }, { status: 400 });
      }
    }

    // Trigger processing for each phrase
    const requestUrl = new URL(request.url);
    for (const id of phrase_ids) {
      const phrase = await getPhraseForUser(env, userId, id);
      if (!phrase) continue;

      const jobId = crypto.randomUUID();
      await setCurrentJobForUser(env, userId, id, jobId, true);

      // Trigger Modal processing
      await triggerProcessing(
        env,
        {
          phrase_id: id,
          source_type: 'text',
          file_url: null,
          source_text: phrase.source_text,
          language: phrase.detected_language,
          webhook_url: '', // Will be built in triggerProcessing
          job_id: jobId,
        },
        requestUrl
      );
    }

    return Response.json({
      message: `Processing ${phrase_ids.length} phrase${phrase_ids.length > 1 ? 's' : ''}`,
    });
  } catch (error) {
    console.error('Confirm generated phrases error:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Confirmation failed' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/generate/:id
 * Delete a draft phrase before confirmation
 */
export async function handleDeleteDraft(
  request: Request,
  env: Env,
  id: string
): Promise<Response> {
  const userId = await requireAuth(request, env);

  try {
    const phrase = await getPhraseForUser(env, userId, id);
    if (!phrase) {
      return Response.json({ error: 'Phrase not found' }, { status: 404 });
    }

    if (!phrase.exclude_from_export) {
      return Response.json({ error: 'Can only delete draft phrases' }, { status: 400 });
    }

    // Delete the phrase
    await env.DB.prepare('DELETE FROM phrases WHERE id = ? AND user_id = ?')
      .bind(id, userId)
      .run();

    return Response.json({ message: 'Draft deleted' });
  } catch (error) {
    console.error('Delete draft error:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Delete failed' },
      { status: 500 }
    );
  }
}
