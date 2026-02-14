import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '@clerk/clerk-react'
import {
  listPhrases,
  updatePhrase,
  approvePhrase,
  deletePhrase,
  regenerateAudio,
  retryPhrase,
  getFileUrl,
  Phrase,
  VocabItem
} from '../lib/api'
import { useAdaptivePolling } from '../lib/useAdaptivePolling'
import { useToast } from '../components/Toast'

function VocabTable({ 
  vocab, 
  onChange,
  language 
}: { 
  vocab: VocabItem[];
  onChange: (vocab: VocabItem[]) => void;
  language: 'ru' | 'ar' | 'zh' | 'es' | 'ka' | null;
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
  onRetry,
  regenerating,
  retrying,
  audioBust,
  onDirtyChange,
}: {
  phrase: Phrase;
  onUpdate: (updates: Partial<Phrase>) => Promise<void>;
  onApprove: () => Promise<void>;
  onDelete: () => Promise<void>;
  onRegenerateAudio: (text: string, language: 'ru' | 'ar' | 'zh' | 'es' | 'ka' | null, hasUnsavedChanges: boolean, saveCallback: () => Promise<void>) => Promise<void>;
  onRetry: () => Promise<void>;
  regenerating: boolean;
  retrying: boolean;
  audioBust?: string;
  onDirtyChange: (id: string, dirty: boolean) => void;
}) {
  const [saving, setSaving] = useState(false)
  const [localPhrase, setLocalPhrase] = useState(phrase)
  const [isDirty, setIsDirty] = useState(false)
  const toast = useToast()

  // Do not clobber in-progress edits when polling refreshes props.
  useEffect(() => {
    if (!isDirty) setLocalPhrase(phrase)
  }, [phrase, isDirty])

  const hasChanges = JSON.stringify(localPhrase) !== JSON.stringify(phrase)

  const handleFieldChange = (field: keyof Phrase, value: unknown) => {
    setIsDirty(true)
    onDirtyChange(phrase.id, true)
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
      setIsDirty(false)
      onDirtyChange(phrase.id, false)
      toast.showToast('Changes saved successfully', 'success', 3000)
    } catch (error) {
      toast.showToast(
        error instanceof Error ? error.message : 'Failed to save changes',
        'error',
        5000
      )
      throw error
    } finally {
      setSaving(false)
    }
  }

  // Keyboard shortcut: Ctrl/Cmd+S to save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        if (hasChanges && !saving) {
          handleSave()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [hasChanges, saving])

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-zinc-800/50 border-b border-zinc-800">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${
              phrase.status === 'processing' ? 'bg-yellow-500/20 text-yellow-400' :
              phrase.status === 'pending_review' ? 'bg-blue-500/20 text-blue-400' :
              phrase.status === 'approved' ? 'bg-emerald-500/20 text-emerald-400' :
              'bg-zinc-500/20 text-zinc-400'
            }`}>
              {phrase.status.replace('_', ' ')}
            </span>
            {isDirty && (
              <span className="px-2 py-0.5 rounded text-xs font-medium bg-amber-500/20 text-amber-400 border border-amber-500/30">
                Unsaved
              </span>
            )}
          </div>
          <span className="text-zinc-500 text-sm">
            {phrase.detected_language === 'ru' ? '🇷🇺' :
             phrase.detected_language === 'ar' ? '🇸🇦' :
             phrase.detected_language === 'zh' ? '🇨🇳' :
             phrase.detected_language === 'es' ? '🇪🇸' :
             phrase.detected_language === 'ka' ? '🇬🇪' : '🏳️'}
          </span>
          <span className="text-zinc-600 text-xs font-mono">
            {phrase.id.slice(0, 8)}
          </span>
          {phrase.job_attempts > 0 && (
            <span className="text-zinc-500 text-xs">
              Attempts: {phrase.job_attempts}
            </span>
          )}
          {phrase.last_error && (
            <span className="text-red-400 text-xs max-w-xs truncate" title={phrase.last_error}>
              Error: {phrase.last_error}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {phrase.last_error && phrase.status === 'processing' && (
            <button
              onClick={onRetry}
              disabled={retrying}
              className="px-3 py-1 text-sm bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-700 rounded transition-colors"
              title="Retry processing this phrase"
            >
              {retrying ? 'Retrying...' : 'Retry'}
            </button>
          )}
          {hasChanges && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-3 py-1 text-sm bg-zinc-700 hover:bg-zinc-600 rounded transition-colors"
              title="Save changes (Ctrl/Cmd+S)"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          )}
          {phrase.status === 'pending_review' && !hasChanges && (
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
                onClick={() => onRegenerateAudio(
                  localPhrase.source_text || '',
                  localPhrase.detected_language,
                  hasChanges,
                  handleSave
                )}
                disabled={regenerating}
                className={`px-3 py-2 text-sm rounded-lg transition-colors flex items-center justify-center ${
                  regenerating
                    ? 'bg-zinc-800 text-zinc-400 cursor-not-allowed'
                    : 'bg-zinc-800 hover:bg-zinc-700'
                }`}
                title={hasChanges ? "Auto-save changes and regenerate audio" : "Regenerate audio from source text"}
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
  const { isLoaded } = useAuth()
  const [phrases, setPhrases] = useState<Phrase[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [approvingAll, setApprovingAll] = useState(false)
  const [approvedCount, setApprovedCount] = useState(0)
  const [regeneratingIds, setRegeneratingIds] = useState<Set<string>>(new Set())
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set())
  const [audioBust, setAudioBust] = useState<Record<string, string>>({})
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set())
  const toast = useToast()

  // Prevent race conditions: track request sequence number
  const loadSequenceRef = useRef(0)

  const loadPhrases = useCallback(async () => {
    const currentSeq = ++loadSequenceRef.current
    try {
      const { phrases } = await listPhrases('pending_review')
      // Only update if this is still the latest request
      if (currentSeq === loadSequenceRef.current) {
        setPhrases(phrases)
        setError(null) // Clear any previous errors
      }
    } catch (err) {
      // Only update error if this is still the latest request
      if (currentSeq === loadSequenceRef.current) {
        setError(err instanceof Error ? err.message : 'Failed to load phrases')
      }
    } finally {
      if (currentSeq === loadSequenceRef.current) {
        setLoading(false)
      }
    }
  }, [])

  // Adaptive polling: 3s when processing jobs exist, 30s when idle
  // Pauses while editing to avoid clobbering unsaved changes
  // Wait for Clerk to be ready before starting polls
  const { pollNow } = useAdaptivePolling({
    onPoll: loadPhrases,
    shouldPollFast: () => phrases.some(p => p.status === 'processing'),
    fastInterval: 3000,   // 3 seconds when jobs are processing
    slowInterval: 30000,  // 30 seconds when idle (AWS CloudFormation style)
    enabled: isLoaded && dirtyIds.size === 0, // Wait for Clerk to load and pause while editing
  })

  const handleUpdate = async (id: string, updates: Partial<Phrase>) => {
    try {
      await updatePhrase(id, updates)
      await pollNow() // Immediate refresh after user action
    } catch (error) {
      toast.showToast(
        error instanceof Error ? error.message : 'Failed to update phrase',
        'error'
      )
      throw error
    }
  }

  const handleApprove = async (id: string) => {
    try {
      await approvePhrase(id)
      toast.showToast('Phrase approved', 'success', 3000)
      await pollNow() // Immediate refresh after user action
    } catch (error) {
      toast.showToast(
        error instanceof Error ? error.message : 'Failed to approve phrase',
        'error'
      )
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this phrase?')) return
    try {
      await deletePhrase(id)
      toast.showToast('Phrase deleted', 'success', 3000)
      await pollNow() // Immediate refresh after user action
    } catch (error) {
      toast.showToast(
        error instanceof Error ? error.message : 'Failed to delete phrase',
        'error'
      )
    }
  }

  const handleRetry = async (id: string) => {
    setRetryingIds(prev => new Set(prev).add(id))
    try {
      await retryPhrase(id)
      toast.showToast('Phrase retry queued', 'success', 3000)
      await pollNow()
    } catch (error) {
      toast.showToast(
        error instanceof Error ? error.message : 'Failed to retry phrase',
        'error'
      )
    } finally {
      setRetryingIds(prev => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  const handleDirtyChange = (id: string, dirty: boolean) => {
    setDirtyIds(prev => {
      const next = new Set(prev)
      if (dirty) next.add(id); else next.delete(id)
      return next
    })
  }

  const handleRegenerateAudio = async (
    id: string,
    text: string,
    lang: 'ru' | 'ar' | 'zh' | 'es' | 'ka' | null,
    hasUnsavedChanges: boolean,
    saveCallback: () => Promise<void>
  ) => {
    // Auto-save changes before regenerating
    if (hasUnsavedChanges) {
      try {
        await saveCallback()
      } catch (err) {
        console.error('Failed to save before regenerating:', err)
        alert('Failed to save changes. Please save manually before regenerating.')
        return
      }
    }

    // Optimistically show progress and prevent multiple taps
    setRegeneratingIds(prev => new Set(prev).add(id))
    try {
      await regenerateAudio(id, { source_text: text, language: lang })
      toast.showToast('Audio regeneration started', 'success', 3000)
      // Give backend a moment to produce new audio, then bust cache and refresh
      await new Promise(r => setTimeout(r, 4000))
      setAudioBust(prev => ({ ...prev, [id]: String(Date.now()) }))
      await pollNow()
    } catch (error) {
      toast.showToast(
        error instanceof Error ? error.message : 'Failed to regenerate audio',
        'error'
      )
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
    await pollNow()
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
            onClick={pollNow}
            className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      {dirtyIds.size > 0 && (
        <div className="px-4 py-3 bg-amber-500/10 text-amber-300 border border-amber-500/30 rounded-lg">
          Auto-refresh paused while editing. Save changes or clear edits to resume.
        </div>
      )}

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
              onRegenerateAudio={(text, language, hasUnsavedChanges, saveCallback) =>
                handleRegenerateAudio(phrase.id, text, language, hasUnsavedChanges, saveCallback)
              }
              onRetry={() => handleRetry(phrase.id)}
              regenerating={regeneratingIds.has(phrase.id)}
              retrying={retryingIds.has(phrase.id)}
              audioBust={audioBust[phrase.id]}
              onDirtyChange={handleDirtyChange}
            />
          ))}
        </div>
      )}
    </div>
  )
}
