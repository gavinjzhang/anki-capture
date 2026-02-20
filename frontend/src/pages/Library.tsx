import { useState, useEffect } from 'react'
import { listPhrases, updatePhrase, deletePhrase as apiDeletePhrase, AuthError, Phrase } from '../lib/api'
import { useAdaptivePolling } from '../lib/useAdaptivePolling'
import AuthErrorBanner from '../components/AuthErrorBanner'

type StatusFilter = 'all' | 'processing' | 'pending_review' | 'approved' | 'exported'

export default function LibraryPage() {
  const [phrases, setPhrases] = useState<Phrase[]>([])
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState(false)
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [revertingId, setRevertingId] = useState<string | null>(null)

  const loadPhrases = async (showLoadingSpinner = true) => {
    if (showLoadingSpinner) {
      setLoading(true)
    }
    try {
      const status = filter === 'all' ? undefined : filter
      const { phrases } = await listPhrases(status)
      setPhrases(phrases)
      setAuthError(false)
    } catch (err) {
      if (err instanceof AuthError) {
        setAuthError(true)
      }
    } finally {
      if (showLoadingSpinner) {
        setLoading(false)
      }
    }
  }

  // Adaptive polling: 5s when processing jobs exist, 60s when idle
  // Wait for Clerk to be ready before starting polls
  const { pollNow } = useAdaptivePolling({
    onPoll: () => loadPhrases(false), // Don't show spinner during background polling
    shouldPollFast: () => phrases.some(p => p.status === 'processing'),
    fastInterval: 5000,   // 5 seconds when jobs are processing
    slowInterval: 60000,  // 60 seconds when idle (less critical than Review page)
    enabled: true,
  })

  // Reload when filter changes
  useEffect(() => {
    loadPhrases()
  }, [filter])

  const toggleExclude = async (phrase: Phrase) => {
    await updatePhrase(phrase.id, { exclude_from_export: !phrase.exclude_from_export })
    await pollNow() // Immediate refresh after user action
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this phrase?')) return
    setDeletingId(id)
    try {
      await apiDeletePhrase(id)
      await pollNow() // Immediate refresh after user action
    } finally {
      setDeletingId(null)
    }
  }

  const handleSendToReview = async (id: string) => {
    setRevertingId(id)
    try {
      await updatePhrase(id, { status: 'pending_review' as any })
      await pollNow() // Immediate refresh after user action
    } finally {
      setRevertingId(null)
    }
  }

  const statusCounts = phrases.reduce((acc, p) => {
    acc[p.status] = (acc[p.status] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div className="space-y-8">
      {authError && <AuthErrorBanner />}
      <div>
        <h1 className="text-2xl font-semibold mb-2">Library</h1>
        <p className="text-zinc-400">All captured phrases</p>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {(['all', 'processing', 'pending_review', 'approved', 'exported'] as StatusFilter[]).map((status) => (
          <button
            key={status}
            onClick={() => setFilter(status)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              filter === status
                ? 'bg-zinc-800 text-zinc-100'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
            }`}
          >
            {status.replace('_', ' ')}
            {status !== 'all' && statusCounts[status] ? (
              <span className="ml-1.5 text-zinc-500">({statusCounts[status]})</span>
            ) : null}
          </button>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="text-zinc-500">Loading...</div>
        </div>
      ) : phrases.length === 0 ? (
        <div className="text-center py-16 text-zinc-500">
          <div className="text-4xl mb-4">📚</div>
          <p>No phrases found</p>
        </div>
      ) : (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wider bg-zinc-800/50">
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Translation</th>
                  <th className="px-4 py-3">Lang</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3 text-center">Export</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {phrases.map((phrase) => (
                  <tr key={phrase.id} className="hover:bg-zinc-800/30 transition-colors">
                    <td className="px-4 py-3">
                      <div 
                        className="max-w-xs truncate font-medium"
                        dir={phrase.detected_language === 'ar' ? 'rtl' : 'ltr'}
                      >
                        {phrase.source_text || <span className="text-zinc-500 italic">Processing...</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="max-w-xs truncate text-zinc-400">
                        {phrase.translation || '-'}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {phrase.detected_language === 'ru' ? '🇷🇺' :
                       phrase.detected_language === 'ar' ? '🇸🇦' :
                       phrase.detected_language === 'zh' ? '🇨🇳' :
                       phrase.detected_language === 'es' ? '🇪🇸' :
                       phrase.detected_language === 'ka' ? '🇬🇪' : '-'}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-zinc-400">
                        {phrase.source_type === 'image' ? '📷' :
                         phrase.source_type === 'audio' ? '🎤' : '✏️'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        phrase.status === 'processing' ? 'bg-yellow-500/20 text-yellow-400' :
                        phrase.status === 'pending_review' ? 'bg-blue-500/20 text-blue-400' :
                        phrase.status === 'approved' ? 'bg-emerald-500/20 text-emerald-400' :
                        'bg-zinc-500/20 text-zinc-400'
                      }`}>
                        {phrase.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-500 text-sm">
                      {formatDate(phrase.created_at)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {phrase.status === 'approved' && (
                        <button
                          onClick={() => toggleExclude(phrase)}
                          className={`w-5 h-5 rounded border transition-colors ${
                            phrase.exclude_from_export
                              ? 'border-zinc-600 bg-transparent'
                              : 'border-emerald-500 bg-emerald-500'
                          }`}
                        >
                          {!phrase.exclude_from_export && (
                            <span className="text-white text-xs">✓</span>
                          )}
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right space-x-2">
                      {(phrase.status === 'approved' || phrase.status === 'exported') && (
                        <button
                          onClick={() => handleSendToReview(phrase.id)}
                          disabled={revertingId === phrase.id}
                          className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                            revertingId === phrase.id
                              ? 'text-zinc-400 bg-zinc-800 cursor-not-allowed'
                              : 'text-blue-400 hover:bg-blue-500/20'
                          }`}
                        >
                          {revertingId === phrase.id ? 'Sending…' : 'Send to Review'}
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(phrase.id)}
                        disabled={deletingId === phrase.id}
                        className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                          deletingId === phrase.id
                            ? 'text-zinc-400 bg-zinc-800 cursor-not-allowed'
                            : 'text-red-400 hover:bg-red-500/20'
                        }`}
                      >
                        {deletingId === phrase.id ? 'Deleting…' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
