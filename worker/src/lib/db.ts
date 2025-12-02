import { Env, Phrase, PhraseRow, PhraseStatus, VocabItem } from '../types';

function rowToPhrase(row: PhraseRow): Phrase {
  return {
    ...row,
    vocab_breakdown: row.vocab_breakdown ? JSON.parse(row.vocab_breakdown) : null,
    detected_language: row.detected_language as Phrase['detected_language'],
    source_type: row.source_type as Phrase['source_type'],
    status: row.status as PhraseStatus,
    exclude_from_export: Boolean(row.exclude_from_export),
  };
}

export async function createPhrase(
  env: Env,
  id: string,
  sourceType: Phrase['source_type'],
  originalFileUrl: string | null,
  sourceText: string | null = null,
  language: string | null = null
): Promise<void> {
  await env.DB.prepare(`
    INSERT INTO phrases (id, source_type, original_file_url, source_text, detected_language, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'processing', ?)
  `).bind(id, sourceType, originalFileUrl, sourceText, language, Date.now()).run();
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

export async function getExportablePhrases(env: Env): Promise<Phrase[]> {
  const { results } = await env.DB.prepare(`
    SELECT * FROM phrases 
    WHERE status = 'approved' AND exclude_from_export = 0
    ORDER BY created_at ASC
  `).all<PhraseRow>();
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
  
  if (setClauses.length === 0) return;
  
  values.push(id);
  await env.DB.prepare(`UPDATE phrases SET ${setClauses.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();
}

export async function markPhrasesExported(env: Env, ids: string[]): Promise<void> {
  const now = Date.now();
  const placeholders = ids.map(() => '?').join(',');
  await env.DB.prepare(`
    UPDATE phrases SET status = 'exported', exported_at = ? 
    WHERE id IN (${placeholders})
  `).bind(now, ...ids).run();
}

export async function deletePhrase(env: Env, id: string): Promise<void> {
  await env.DB.prepare('DELETE FROM phrases WHERE id = ?').bind(id).run();
}
