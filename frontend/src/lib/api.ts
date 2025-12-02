// API base override: set VITE_API_BASE to point at a deployed Worker
// Example: VITE_API_BASE=https://anki-capture-api.<account>.workers.dev
const API_BASE = (import.meta as any).env?.VITE_API_BASE || '';

export interface VocabItem {
  word: string;
  root: string | null;
  meaning: string;
  gender: string | null;
  declension: string | null;
  notes: string | null;
}

export interface Phrase {
  id: string;
  source_text: string | null;
  transliteration: string | null;
  translation: string | null;
  grammar_notes: string | null;
  vocab_breakdown: VocabItem[] | null;
  detected_language: 'ru' | 'ar' | null;
  language_confidence: number | null;
  source_type: 'image' | 'audio' | 'text';
  audio_url: string | null;
  original_file_url: string | null;
  status: 'processing' | 'pending_review' | 'approved' | 'exported';
  exclude_from_export: boolean;
  created_at: number;
  reviewed_at: number | null;
  exported_at: number | null;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...options?.headers,
    },
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || 'Request failed');
  }
  
  return response.json();
}

// Upload
export async function uploadFile(file: File): Promise<{ id: string; status: string }> {
  const formData = new FormData();
  formData.append('file', file);
  
  return request('/api/upload', {
    method: 'POST',
    body: formData,
  });
}

export async function uploadText(text: string, language: 'ru' | 'ar'): Promise<{ id: string; status: string }> {
  return request('/api/upload/text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, language }),
  });
}

// Phrases
export async function listPhrases(status?: string): Promise<{ phrases: Phrase[] }> {
  const params = status ? `?status=${status}` : '';
  return request(`/api/phrases${params}`);
}

export async function getPhrase(id: string): Promise<{ phrase: Phrase }> {
  return request(`/api/phrases/${id}`);
}

export async function updatePhrase(id: string, updates: Partial<Phrase>): Promise<{ phrase: Phrase }> {
  return request(`/api/phrases/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
}

export async function approvePhrase(id: string): Promise<void> {
  await request(`/api/phrases/${id}/approve`, { method: 'POST' });
}

export async function deletePhrase(id: string): Promise<void> {
  await request(`/api/phrases/${id}`, { method: 'DELETE' });
}

export async function regenerateAudio(id: string): Promise<void> {
  await request(`/api/phrases/${id}/regenerate-audio`, { method: 'POST' });
}

// Export
export interface ExportData {
  phrases: { id: string; line: string; audio_url: string | null }[];
  txt_content: string;
}

export async function getExportData(): Promise<ExportData> {
  return request('/api/export');
}

export async function getExportPreview(): Promise<{ count: number; preview: Phrase[] }> {
  return request('/api/export/preview');
}

export async function markExported(phraseIds: string[]): Promise<void> {
  await request('/api/export/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phrase_ids: phraseIds }),
  });
}

// Files
export function getFileUrl(path: string): string {
  if (path.startsWith('/')) return `${API_BASE}${path}`;
  return `${API_BASE}/api/files/${encodeURIComponent(path)}`;
}
