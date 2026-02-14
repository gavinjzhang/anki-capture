import { Env, Phrase, PhraseRow, PhraseStatus, VocabItem } from '../types';

function rowToPhrase(row: PhraseRow): Phrase {
  return {
    ...row,
    vocab_breakdown: row.vocab_breakdown ? JSON.parse(row.vocab_breakdown) : null,
    detected_language: row.detected_language as Phrase['detected_language'],
    source_type: row.source_type as Phrase['source_type'],
    status: row.status as PhraseStatus,
    exclude_from_export: Boolean(row.exclude_from_export),
    job_attempts: row.job_attempts ?? 0,
    current_job_id: row.current_job_id ?? null,
  };
}

export async function createPhrase(
  env: Env,
  userId: string,
  id: string,
  sourceType: Phrase['source_type'],
  originalFileUrl: string | null,
  sourceText: string | null = null,
  language: string | null = null
): Promise<void> {
  await env.DB.prepare(`
    INSERT INTO phrases (
      id, user_id, source_type, original_file_url, source_text, detected_language,
      status, created_at, job_started_at, job_attempts, current_job_id
    )
    VALUES (?, ?, ?, ?, ?, ?, 'processing', ?, NULL, 0, NULL)
  `).bind(id, userId, sourceType, originalFileUrl, sourceText, language, Date.now()).run();
}

export async function getPhrase(env: Env, id: string): Promise<Phrase | null> {
  const row = await env.DB.prepare('SELECT * FROM phrases WHERE id = ?')
    .bind(id)
    .first<PhraseRow>();
  return row ? rowToPhrase(row) : null;
}

export async function listPhrases(
  env: Env,
  status?: PhraseStatus,
  limit = 100
): Promise<Phrase[]> {
  let query = 'SELECT * FROM phrases';
  const params: (string | number)[] = [];
  
  if (status) {
    query += ' WHERE status = ?';
    params.push(status);
  }
  
  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);
  
  const stmt = env.DB.prepare(query);
  const { results } = await stmt.bind(...params).all<PhraseRow>();
  return results.map(rowToPhrase);
}

// User-scoped helpers (multi-tenant)
export async function getPhraseForUser(env: Env, userId: string, id: string): Promise<Phrase | null> {
  const row = await env.DB.prepare('SELECT * FROM phrases WHERE id = ? AND (user_id = ? OR user_id IS NULL)')
    .bind(id, userId)
    .first<PhraseRow>();
  return row ? rowToPhrase(row) : null;
}

export async function listPhrasesForUser(
  env: Env,
  userId: string,
  status?: PhraseStatus,
  limit = 100
): Promise<Phrase[]> {
  let query = 'SELECT * FROM phrases WHERE (user_id = ? OR user_id IS NULL)';
  const params: (string | number)[] = [userId];
  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }
  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);
  const { results } = await env.DB.prepare(query).bind(...params).all<PhraseRow>();
  return results.map(rowToPhrase);
}

export async function getExportablePhrases(env: Env): Promise<Phrase[]> {
  const { results } = await env.DB.prepare(`
    SELECT * FROM phrases 
    WHERE status = 'approved' AND exclude_from_export = 0
    ORDER BY created_at ASC
  `).all<PhraseRow>();
  return results.map(rowToPhrase);
}

export async function getExportablePhrasesForUser(env: Env, userId: string): Promise<Phrase[]> {
  const { results } = await env.DB.prepare(`
    SELECT * FROM phrases 
    WHERE (user_id = ? OR user_id IS NULL) AND status = 'approved' AND exclude_from_export = 0
    ORDER BY created_at ASC
  `).bind(userId).all<PhraseRow>();
  return results.map(rowToPhrase);
}

export async function updatePhraseFromProcessing(
  env: Env,
  id: string,
  data: {
    source_text: string;
    transliteration: string;
    translation: string;
    grammar_notes: string;
    vocab_breakdown: VocabItem[];
    detected_language: string;
    language_confidence: number;
    audio_url: string;
  }
): Promise<void> {
  await env.DB.prepare(`
    UPDATE phrases SET
      source_text = ?,
      transliteration = ?,
      translation = ?,
      grammar_notes = ?,
      vocab_breakdown = ?,
      detected_language = ?,
      language_confidence = ?,
      audio_url = ?,
      last_error = NULL,
      status = 'pending_review'
    WHERE id = ?
  `).bind(
    data.source_text,
    data.transliteration,
    data.translation,
    data.grammar_notes,
    JSON.stringify(data.vocab_breakdown),
    data.detected_language,
    data.language_confidence,
    data.audio_url,
    id
  ).run();
}

export async function updatePhrase(
  env: Env,
  id: string,
  updates: Partial<Omit<Phrase, 'id' | 'created_at'>>
): Promise<void> {
  const setClauses: string[] = [];
  const values: (string | number | null)[] = [];
  
  if (updates.source_text !== undefined) {
    setClauses.push('source_text = ?');
    values.push(updates.source_text);
  }
  if (updates.transliteration !== undefined) {
    setClauses.push('transliteration = ?');
    values.push(updates.transliteration);
  }
  if (updates.translation !== undefined) {
    setClauses.push('translation = ?');
    values.push(updates.translation);
  }
  if (updates.grammar_notes !== undefined) {
    setClauses.push('grammar_notes = ?');
    values.push(updates.grammar_notes);
  }
  if (updates.vocab_breakdown !== undefined) {
    setClauses.push('vocab_breakdown = ?');
    values.push(updates.vocab_breakdown ? JSON.stringify(updates.vocab_breakdown) : null);
  }
  if (updates.detected_language !== undefined) {
    setClauses.push('detected_language = ?');
    values.push(updates.detected_language);
  }
  if (updates.audio_url !== undefined) {
    setClauses.push('audio_url = ?');
    values.push(updates.audio_url);
  }
  if (updates.status !== undefined) {
    setClauses.push('status = ?');
    values.push(updates.status);
    if (updates.status === 'approved') {
      setClauses.push('reviewed_at = ?');
      values.push(Date.now());
    }
  }
  if (updates.exclude_from_export !== undefined) {
    setClauses.push('exclude_from_export = ?');
    values.push(updates.exclude_from_export ? 1 : 0);
  }
  if (updates.exported_at !== undefined) {
    setClauses.push('exported_at = ?');
    values.push(updates.exported_at);
  }
  if (updates.job_started_at !== undefined) {
    setClauses.push('job_started_at = ?');
    values.push(updates.job_started_at);
  }
  if (updates.job_attempts !== undefined) {
    setClauses.push('job_attempts = ?');
    values.push(updates.job_attempts);
  }
  if (updates.last_error !== undefined) {
    setClauses.push('last_error = ?');
    values.push(updates.last_error);
  }
  
  if (setClauses.length === 0) return;
  
  values.push(id);
  await env.DB.prepare(`UPDATE phrases SET ${setClauses.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();
}

export async function updatePhraseForUser(
  env: Env,
  userId: string,
  id: string,
  updates: Partial<Omit<Phrase, 'id' | 'created_at'>>
): Promise<void> {
  const setClauses: string[] = [];
  const values: (string | number | null)[] = [];
  if (updates.source_text !== undefined) { setClauses.push('source_text = ?'); values.push(updates.source_text); }
  if (updates.transliteration !== undefined) { setClauses.push('transliteration = ?'); values.push(updates.transliteration); }
  if (updates.translation !== undefined) { setClauses.push('translation = ?'); values.push(updates.translation); }
  if (updates.grammar_notes !== undefined) { setClauses.push('grammar_notes = ?'); values.push(updates.grammar_notes); }
  if (updates.vocab_breakdown !== undefined) { setClauses.push('vocab_breakdown = ?'); values.push(updates.vocab_breakdown ? JSON.stringify(updates.vocab_breakdown) : null); }
  if (updates.detected_language !== undefined) { setClauses.push('detected_language = ?'); values.push(updates.detected_language); }
  if (updates.audio_url !== undefined) { setClauses.push('audio_url = ?'); values.push(updates.audio_url); }
  if (updates.status !== undefined) {
    setClauses.push('status = ?');
    values.push(updates.status);
    if (updates.status === 'approved') { setClauses.push('reviewed_at = ?'); values.push(Date.now()); }
  }
  if (updates.exclude_from_export !== undefined) { setClauses.push('exclude_from_export = ?'); values.push(updates.exclude_from_export ? 1 : 0); }
  if (updates.exported_at !== undefined) { setClauses.push('exported_at = ?'); values.push(updates.exported_at); }
  if (updates.job_started_at !== undefined) { setClauses.push('job_started_at = ?'); values.push(updates.job_started_at); }
  if (updates.job_attempts !== undefined) { setClauses.push('job_attempts = ?'); values.push(updates.job_attempts); }
  if (updates.last_error !== undefined) { setClauses.push('last_error = ?'); values.push(updates.last_error); }
  if (setClauses.length === 0) return;
  values.push(id, userId);
  await env.DB.prepare(`UPDATE phrases SET ${setClauses.join(', ')} WHERE id = ? AND (user_id = ? OR user_id IS NULL)`).bind(...values).run();
}

export async function setCurrentJobForUser(env: Env, userId: string, id: string, jobId: string, setStatusProcessing = false): Promise<void> {
  const fields = [
    'current_job_id = ?',
    'job_started_at = ?',
    'job_attempts = COALESCE(job_attempts,0) + 1',
    'last_error = NULL'
  ];
  const values: (string|number)[] = [jobId, Date.now()];
  if (setStatusProcessing) {
    fields.push("status = 'processing'");
  }
  await env.DB.prepare(`
    UPDATE phrases SET ${fields.join(', ')} WHERE id = ? AND (user_id = ? OR user_id IS NULL)
  `).bind(...values, id, userId).run();
}

export async function sweepProcessingTimeouts(env: Env, timeoutMs: number): Promise<number> {
  const cutoff = Date.now() - timeoutMs;
  // Mark stuck processing jobs as failed so they can be retried
  const stmt = env.DB.prepare(`
    UPDATE phrases SET
      status = 'failed',
      last_error = 'Job timed out - click Retry to reprocess',
      current_job_id = NULL
    WHERE status = 'processing'
      AND COALESCE(job_started_at, created_at) < ?
  `).bind(cutoff);
  const result = await stmt.run();
  const count = result.meta?.changes || 0;
  if (count > 0) {
    console.log(`Cleaned up ${count} stuck job(s) older than ${timeoutMs}ms`);
  }
  return count;
}

export async function markPhrasesExported(env: Env, ids: string[]): Promise<void> {
  const now = Date.now();
  const placeholders = ids.map(() => '?').join(',');
  await env.DB.prepare(`
    UPDATE phrases SET status = 'exported', exported_at = ? 
    WHERE id IN (${placeholders})
  `).bind(now, ...ids).run();
}

export async function markPhrasesExportedForUser(env: Env, userId: string, ids: string[]): Promise<void> {
  const now = Date.now();
  const placeholders = ids.map(() => '?').join(',');
  await env.DB.prepare(`
    UPDATE phrases SET status = 'exported', exported_at = ?
    WHERE id IN (${placeholders}) AND (user_id = ? OR user_id IS NULL)
  `).bind(now, ...ids, userId).run();
}

export async function deletePhrase(env: Env, id: string): Promise<void> {
  await env.DB.prepare('DELETE FROM phrases WHERE id = ?').bind(id).run();
}

export async function deletePhraseForUser(env: Env, userId: string, id: string): Promise<void> {
  await env.DB.prepare('DELETE FROM phrases WHERE id = ? AND (user_id = ? OR user_id IS NULL)')
    .bind(id, userId)
    .run();
}

export async function isR2KeyReferenced(env: Env, key: string): Promise<boolean> {
  const row = await env.DB.prepare(
    'SELECT 1 as ok FROM phrases WHERE original_file_url = ? OR audio_url = ? LIMIT 1'
  ).bind(key, key).first<{ ok: number }>();
  return !!row?.ok;
}
