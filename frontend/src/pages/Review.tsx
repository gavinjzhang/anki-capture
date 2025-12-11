import { useState, useEffect, useCallback } from 'react'
import { 
  listPhrases, 
  updatePhrase, 
  approvePhrase, 
  deletePhrase,
  regenerateAudio,
  getFileUrl,
  Phrase,
  VocabItem 
} from '../lib/api'

function VocabTable({ 
  vocab, 
  onChange,
  language 
}: { 
  vocab: VocabItem[];
  onChange: (vocab: VocabItem[]) => void;
  language: 'ru' | 'ar' | null;
}) {
  const updateItem = (index: number, field: keyof VocabItem, value: string | null) => {
    const updated = [...vocab]
    updated[index] = { ...updated[index], [field]: value || null }
    onChange(updated)
  }

  const addItem = () => {
    onChange([...vocab, { word: '', root: null, meaning: '', gender: null, declension: null, notes: null }])
  }

  const removeItem = (index: number) => {
    onChange(vocab.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-zinc-500 text-xs uppercase tracking-wider">
              <th className="pb-2 pr-2">Word</th>
              <th className="pb-2 pr-2">Root</th>
              <th className="pb-2 pr-2">Meaning</th>
              <th className="pb-2 pr-2">Gender</th>
              <th className="pb-2 pr-2">Decl.</th>
              <th className="pb-2 pr-2">Notes</th>
              <th className="pb-2 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {vocab.map((item, i) => (
              <tr key={i} className="border-t border-zinc-800">
                <td className="py-1 pr-2">
                  <input
                    value={item.word}
                    onChange={(e) => updateItem(i, 'word', e.target.value)}
                    className="editable-cell w-full min-w-[80px]"
                    dir={language === 'ar' ? 'rtl' : 'ltr'}
                  />
                </td>
                <td className="py-1 pr-2">
                  <input
                    value={item.root || ''}
                    onChange={(e) => updateItem(i, 'root', e.target.value)}
                    className="editable-cell w-full min-w-[60px]"
                    dir={language === 'ar' ? 'rtl' : 'ltr'}
                  />
                </td>
                <td className="py-1 pr-2">
                  <input
                    value={item.meaning}
                    onChange={(e) => updateItem(i, 'meaning', e.target.value)}
                    className="editable-cell w-full min-w-[100px]"
                  />
                </td>
                <td className="py-1 pr-2">
                  <input
                    value={item.gender || ''}
                    onChange={(e) => updateItem(i, 'gender', e.target.value)}
                    className="editable-cell w-16"
                    placeholder="m/f/n"
                  />
                </td>
                <td className="py-1 pr-2">
                  <input
                    value={item.declension || ''}
                    onChange={(e) => updateItem(i, 'declension', e.target.value)}
                    className="editable-cell w-full min-w-[80px]"
                  />
                </td>
                <td className="py-1 pr-2">
                  <input
                    value={item.notes || ''}
                    onChange={(e) => updateItem(i, 'notes', e.target.value)}
                    className="editable-cell w-full min-w-[100px]"
                  />
                </td>
                <td className="py-1">
                  <button
                    onClick={() => removeItem(i)}
                    className="text-zinc-500 hover:text-red-400 transition-colors"
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        onClick={addItem}
        className="text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
      >
        + Add word
      </button>
    </div>
  )
}

function PhraseCard({ 
  phrase, 
  onUpdate, 
  onApprove, 
  onDelete,
  onRegenerateAudio,
  regenerating,
  audioBust,
}: { 
  phrase: Phrase;
  onUpdate: (updates: Partial<Phrase>) => Promise<void>;
  onApprove: () => Promise<void>;
  onDelete: () => Promise<void>;
  onRegenerateAudio: (text: string, language: 'ru' | 'ar' | null) => Promise<void>;
  regenerating: boolean;
  audioBust?: string;
}) {
  const [saving, setSaving] = useState(false)
  const [localPhrase, setLocalPhrase] = useState(phrase)

  useEffect(() => {
    setLocalPhrase(phrase)
  }, [phrase])

  const handleFieldChange = (field: keyof Phrase, value: unknown) => {
    setLocalPhrase(prev => ({ ...prev, [field]: value }))
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await onUpdate({
        source_text: localPhrase.source_text,
        transliteration: localPhrase.transliteration,
        translation: localPhrase.translation,
        grammar_notes: localPhrase.grammar_notes,
        vocab_breakdown: localPhrase.vocab_breakdown,
      })
    } finally {
      setSaving(false)
    }
  }

  const hasChanges = JSON.stringify(localPhrase) !== JSON.stringify(phrase)

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-zinc-800/50 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
            phrase.status === 'processing' ? 'bg-yellow-500/20 text-yellow-400' :
            phrase.status === 'pending_review' ? 'bg-blue-500/20 text-blue-400' :
            phrase.status === 'approved' ? 'bg-emerald-500/20 text-emerald-400' :
            'bg-zinc-500/20 text-zinc-400'
          }`}>
            {phrase.status.replace('_', ' ')}
          </span>
          <span className="text-zinc-500 text-sm">
            {phrase.detected_language === 'ru' ? '🇷🇺' : '🇸🇦'}
          </span>
          <span className="text-zinc-600 text-xs font-mono">
            {phrase.id.slice(0, 8)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {hasChanges && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-3 py-1 text-sm bg-zinc-700 hover:bg-zinc-600 rounded transition-colors"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          )}
          {phrase.status === 'pending_review' && (
            <button
              onClick={onApprove}
              className="px-3 py-1 text-sm bg-emerald-600 hover:bg-emerald-500 rounded transition-colors"
            >
              Approve
            </button>
          )}
          <button
            onClick={onDelete}
            className="px-2 py-1 text-sm text-zinc-400 hover:text-red-400 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 space-y-4">
        {/* Source text & Audio */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">
              Source Text
            </label>
            <textarea
              value={localPhrase.source_text || ''}
              onChange={(e) => handleFieldChange('source_text', e.target.value)}
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-lg focus:border-emerald-500 resize-none"
              rows={2}
              dir={phrase.detected_language === 'ar' ? 'rtl' : 'ltr'}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">
              Audio
            </label>
            <div className="flex items-center gap-2">
              {phrase.audio_url ? (
                <audio 
                  controls 
                  className="flex-1 h-10"
                  src={`${getFileUrl(phrase.audio_url)}${audioBust ? `?v=${audioBust}` : ''}`}
                />
              ) : (
                <span className="text-zinc-500 text-sm">No audio</span>
              )}
              <button
                onClick={() => onRegenerateAudio(localPhrase.source_text || '', localPhrase.detected_language)}
                disabled={regenerating}
                className={`px-3 py-2 text-sm rounded-lg transition-colors flex items-center justify-center ${
                  regenerating 
                    ? 'bg-zinc-800 text-zinc-400 cursor-not-allowed' 
                    : 'bg-zinc-800 hover:bg-zinc-700'
                }`}
                title="Regenerate audio from source text"
                aria-busy={regenerating}
              >
                {regenerating ? (
                  <svg className="animate-spin h-4 w-4 text-zinc-300" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                    <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
                  </svg>
                ) : (
                  <span role="img" aria-label="Regenerate">🔄</span>
                )}
              </button>
            </div>
            {regenerating && (
              <div className="mt-2 h-1 w-full bg-zinc-800 rounded overflow-hidden">
                <div className="h-full w-1/3 bg-emerald-500 animate-pulse" />
              </div>
            )}
          </div>
        </div>

        {/* Transliteration & Translation */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">
              Transliteration
            </label>
            <input
              value={localPhrase.transliteration || ''}
              onChange={(e) => handleFieldChange('transliteration', e.target.value)}
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg focus:border-emerald-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">
              Translation
            </label>
            <input
              value={localPhrase.translation || ''}
              onChange={(e) => handleFieldChange('translation', e.target.value)}
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg focus:border-emerald-500"
            />
          </div>
        </div>

        {/* Grammar notes */}
        <div>
          <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">
            Grammar Notes
          </label>
          <textarea
            value={localPhrase.grammar_notes || ''}
            onChange={(e) => handleFieldChange('grammar_notes', e.target.value)}
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg focus:border-emerald-500 resize-none"
            rows={2}
          />
        </div>

        {/* Vocab breakdown */}
        <div>
          <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
            Vocabulary Breakdown
          </label>
          <VocabTable
            vocab={localPhrase.vocab_breakdown || []}
            onChange={(vocab) => handleFieldChange('vocab_breakdown', vocab)}
            language={phrase.detected_language}
          />
        </div>
      </div>
    </div>
  )
}

export default function ReviewPage() {
  const [phrases, setPhrases] = useState<Phrase[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [approvingAll, setApprovingAll] = useState(false)
  const [approvedCount, setApprovedCount] = useState(0)
  const [regeneratingIds, setRegeneratingIds] = useState<Set<string>>(new Set())
  const [audioBust, setAudioBust] = useState<Record<string, string>>({})

  const loadPhrases = useCallback(async () => {
    try {
      const { phrases } = await listPhrases('pending_review')
      setPhrases(phrases)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load phrases')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadPhrases()
    const interval = setInterval(loadPhrases, 10000)
    return () => clearInterval(interval)
  }, [loadPhrases])

  const handleUpdate = async (id: string, updates: Partial<Phrase>) => {
    await updatePhrase(id, updates)
    await loadPhrases()
  }

  const handleApprove = async (id: string) => {
    await approvePhrase(id)
    await loadPhrases()
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this phrase?')) return
    await deletePhrase(id)
    await loadPhrases()
  }

  const handleRegenerateAudio = async (id: string, text: string, lang: 'ru' | 'ar' | null) => {
    // Optimistically show progress and prevent multiple taps
    setRegeneratingIds(prev => new Set(prev).add(id))
    try {
      await regenerateAudio(id, { source_text: text, language: lang })
      // Give backend a moment to produce new audio, then bust cache and refresh
      await new Promise(r => setTimeout(r, 4000))
      setAudioBust(prev => ({ ...prev, [id]: String(Date.now()) }))
      await loadPhrases()
    } finally {
      setRegeneratingIds(prev => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  const handleApproveAll = async () => {
    if (!phrases.length) return
    if (!confirm(`Approve all ${phrases.length} pending phrase(s)?`)) return
    setApprovingAll(true)
    setApprovedCount(0)
    const ids = phrases.map(p => p.id)
    const concurrency = 5
    let idx = 0
    const runNext = async (): Promise<void> => {
      const i = idx++
      if (i >= ids.length) return
      try {
        await approvePhrase(ids[i])
      } catch (e) {
        console.error('Approve failed for', ids[i], e)
      } finally {
        setApprovedCount(c => c + 1)
        await runNext()
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }).map(() => runNext()))
    await loadPhrases()
    setApprovingAll(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-zinc-500">Loading...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg">
        {error}
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold mb-2">Review</h1>
          <p className="text-zinc-400">
            {phrases.length} phrase{phrases.length !== 1 ? 's' : ''} pending review
          </p>
        </div>
        <div className="flex gap-2">
          {phrases.length > 0 && (
            <button
              onClick={handleApproveAll}
              disabled={approvingAll}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 rounded-lg text-sm text-white transition-colors"
            >
              {approvingAll ? `Approving ${approvedCount}/${phrases.length}...` : 'Approve All'}
            </button>
          )}
          <button
            onClick={loadPhrases}
            className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      {phrases.length === 0 ? (
        <div className="text-center py-16 text-zinc-500">
          <div className="text-4xl mb-4">✨</div>
          <p>No phrases to review. Upload something!</p>
        </div>
      ) : (
        <div className="space-y-6">
          {phrases.map((phrase) => (
            <PhraseCard
              key={phrase.id}
              phrase={phrase}
              onUpdate={(updates) => handleUpdate(phrase.id, updates)}
              onApprove={() => handleApprove(phrase.id)}
              onDelete={() => handleDelete(phrase.id)}
              onRegenerateAudio={(text, language) => handleRegenerateAudio(phrase.id, text, language)}
              regenerating={regeneratingIds.has(phrase.id)}
              audioBust={audioBust[phrase.id]}
            />
          ))}
        </div>
      )}
    </div>
  )
}
