import { Env, Phrase, VocabItem } from '../types';
import { getExportablePhrasesForUser, markPhrasesExportedForUser } from '../lib/db';
import { getFile } from '../lib/r2';
import { getUserId } from '../lib/auth';

function formatVocabBreakdown(vocab: VocabItem[] | null): string {
  if (!vocab || vocab.length === 0) return '';
  
  return vocab.map(v => {
    const parts = [v.word];
    if (v.root) parts.push(`(root: ${v.root})`);
    parts.push(`- ${v.meaning}`);
    if (v.gender) parts.push(`[${v.gender}]`);
    if (v.declension) parts.push(`(${v.declension})`);
    if (v.notes) parts.push(`// ${v.notes}`);
    return parts.join(' ');
  }).join('<br>');
}

function phraseToAnkiLine(phrase: Phrase): string {
  // Format: source_text \t translation \t grammar_notes \t vocab \t [sound:id.mp3]
  const fields = [
    phrase.source_text || '',
    phrase.translation || '',
    phrase.grammar_notes || '',
    formatVocabBreakdown(phrase.vocab_breakdown),
    phrase.audio_url ? `[sound:${phrase.id}.mp3]` : '',
  ];
  
  // Escape tabs and newlines in fields
  return fields.map(f => f.replace(/\t/g, ' ').replace(/\n/g, ' ')).join('\t');
}

// GET /api/export
// Returns a zip file with phrases.txt and media folder
export async function handleExport(
  request: Request,
  env: Env
): Promise<Response> {
  const userId = await getUserId(request, env);
  const phrases = await getExportablePhrasesForUser(env, userId);
  
  if (phrases.length === 0) {
    return Response.json(
      { error: 'No phrases available for export' },
      { status: 404 }
    );
  }
  
  // For simplicity, we'll return JSON with the data
  // The frontend can handle creating the zip
  // (Creating actual zip in Worker is possible but adds complexity)
  
  const exportData = {
    phrases: phrases.map(p => ({
      id: p.id,
      line: phraseToAnkiLine(p),
      audio_url: p.audio_url,
    })),
    txt_content: phrases.map(phraseToAnkiLine).join('\n'),
  };
  
  return Response.json(exportData);
}

// POST /api/export/complete
// Mark phrases as exported after successful download
export async function handleExportComplete(
  request: Request,
  env: Env
): Promise<Response> {
  const body = await request.json() as { phrase_ids: string[] };
  const userId = await getUserId(request, env);
  
  if (!body.phrase_ids?.length) {
    return Response.json({ error: 'No phrase IDs provided' }, { status: 400 });
  }
  
  await markPhrasesExportedForUser(env, userId, body.phrase_ids);
  
  return Response.json({ 
    message: `Marked ${body.phrase_ids.length} phrases as exported` 
  });
}

// GET /api/export/preview
// Get count and preview of what will be exported
export async function handleExportPreview(
  request: Request,
  env: Env
): Promise<Response> {
  const userId = await getUserId(request, env);
  const phrases = await getExportablePhrasesForUser(env, userId);
  
  return Response.json({
    count: phrases.length,
    preview: phrases.slice(0, 5).map(p => ({
      id: p.id,
      source_text: p.source_text,
      translation: p.translation,
    })),
  });
}
