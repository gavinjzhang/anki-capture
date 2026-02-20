import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { generatePhrases, confirmGeneratedPhrases, updatePhrase, deletePhrase, AuthError, type GeneratedPhrase } from '../lib/api'
import { useToast } from '../components/Toast'

export default function GeneratePage() {
  const navigate = useNavigate()
  const [language, setLanguage] = useState<'ru' | 'ar' | 'zh' | 'es' | 'ka'>('ru')
  const [theme, setTheme] = useState('')
  const [numPhrases, setNumPhrases] = useState(10)
  const [deckFile, setDeckFile] = useState<File | null>(null)
  const [generatedPhrases, setGeneratedPhrases] = useState<GeneratedPhrase[]>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [selectedPhrases, setSelectedPhrases] = useState<Set<string>>(new Set())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [editTranslation, setEditTranslation] = useState('')
  const { showToast } = useToast()

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!theme.trim()) {
      showToast('Please enter a theme', 'error')
      return
    }

    setIsGenerating(true)
    try {
      // Read deck file if provided
      let existingDeck: string | undefined
      if (deckFile) {
        existingDeck = await deckFile.text()
      }

      const result = await generatePhrases({
        language,
        theme: theme.trim(),
        num_phrases: numPhrases,
        existing_deck: existingDeck,
      })

      setGeneratedPhrases(result.phrases)
      // Select all by default
      setSelectedPhrases(new Set(result.phrases.map(p => p.id)))
      showToast(`Generated ${result.phrases.length} phrases!`, 'success')
    } catch (err) {
      if (err instanceof AuthError) {
        showToast('Session expired — please sign in again.', 'error')
      } else {
        showToast(err instanceof Error ? err.message : 'Generation failed', 'error')
      }
    } finally {
      setIsGenerating(false)
    }
  }

  const handleSelectAll = () => {
    setSelectedPhrases(new Set(generatedPhrases.map(p => p.id)))
  }

  const handleDeselectAll = () => {
    setSelectedPhrases(new Set())
  }

  const toggleSelect = (id: string) => {
    const newSelected = new Set(selectedPhrases)
    if (newSelected.has(id)) {
      newSelected.delete(id)
    } else {
      newSelected.add(id)
    }
    setSelectedPhrases(newSelected)
  }

  const startEdit = (phrase: GeneratedPhrase) => {
    setEditingId(phrase.id)
    setEditText(phrase.source_text)
    setEditTranslation(phrase.translation)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditText('')
    setEditTranslation('')
  }

  const saveEdit = async (id: string) => {
    if (!editText.trim()) {
      showToast('Phrase cannot be empty', 'error')
      return
    }

    try {
      await updatePhrase(id, {
        source_text: editText.trim(),
        translation: editTranslation.trim(),
      })

      setGeneratedPhrases(phrases =>
        phrases.map(p =>
          p.id === id
            ? { ...p, source_text: editText.trim(), translation: editTranslation.trim() }
            : p
        )
      )
      setEditingId(null)
      showToast('Phrase updated', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Update failed', 'error')
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this phrase?')) return

    try {
      await deletePhrase(id)
      setGeneratedPhrases(phrases => phrases.filter(p => p.id !== id))
      setSelectedPhrases(selected => {
        const newSelected = new Set(selected)
        newSelected.delete(id)
        return newSelected
      })
      showToast('Phrase deleted', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Delete failed', 'error')
    }
  }

  const handleProcessSelected = async () => {
    if (selectedPhrases.size === 0) {
      showToast('Please select at least one phrase', 'error')
      return
    }

    setIsProcessing(true)
    try {
      const discardIds = generatedPhrases
        .filter(p => !selectedPhrases.has(p.id))
        .map(p => p.id)
      const result = await confirmGeneratedPhrases(Array.from(selectedPhrases), discardIds)
      showToast(result.message, 'success')
      // Clear the generated phrases and navigate to Review
      setGeneratedPhrases([])
      setSelectedPhrases(new Set())
      setTheme('')
      navigate('/review')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Processing failed', 'error')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleClearAll = () => {
    if (!confirm('Clear all generated phrases?')) return
    setGeneratedPhrases([])
    setSelectedPhrases(new Set())
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold mb-2">Generate Phrases</h1>
        <p className="text-zinc-400">Create language learning phrases with AI.</p>
      </div>

      {/* Generation Form */}
      <form onSubmit={handleGenerate} className="bg-zinc-900 rounded-xl border border-zinc-800 p-6 space-y-6">
        {/* Language Selector */}
        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-2">
            Language
          </label>
          <div className="flex gap-2 flex-wrap">
            {[
              { id: 'ru' as const, label: 'Russian', flag: '🇷🇺' },
              { id: 'ar' as const, label: 'Arabic', flag: '🇸🇦' },
              { id: 'zh' as const, label: 'Chinese', flag: '🇨🇳' },
              { id: 'es' as const, label: 'Spanish', flag: '🇪🇸' },
              { id: 'ka' as const, label: 'Georgian', flag: '🇬🇪' },
            ].map(({ id, label, flag }) => (
              <button
                key={id}
                type="button"
                onClick={() => setLanguage(id)}
                className={`px-4 py-2 rounded-lg border text-sm font-medium transition-all ${
                  language === id
                    ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400'
                    : 'border-zinc-700 text-zinc-400 hover:border-zinc-600'
                }`}
              >
                <span className="mr-2">{flag}</span>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Theme Input */}
        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-2">
            Theme
          </label>
          <input
            type="text"
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            placeholder="e.g., restaurant conversation, travel, everyday life"
            className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
          />
        </div>

        {/* Number of Phrases Slider */}
        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-2">
            Number of phrases: <span className="text-emerald-400">{numPhrases}</span>
          </label>
          <input
            type="range"
            min="1"
            max="50"
            value={numPhrases}
            onChange={(e) => setNumPhrases(Number(e.target.value))}
            className="w-full h-2 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
          />
          <div className="flex justify-between text-xs text-zinc-500 mt-1">
            <span>1</span>
            <span>50</span>
          </div>
        </div>

        {/* Optional Deck Upload */}
        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-2">
            Existing deck (optional)
          </label>
          <input
            type="file"
            accept=".txt"
            onChange={(e) => setDeckFile(e.target.files?.[0] || null)}
            className="block w-full text-sm text-zinc-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-zinc-800 file:text-zinc-300 hover:file:bg-zinc-700 file:cursor-pointer"
          />
          {deckFile && (
            <p className="text-xs text-zinc-500 mt-1">
              📄 {deckFile.name} ({(deckFile.size / 1024).toFixed(1)} KB)
            </p>
          )}
        </div>

        {/* Generate Button */}
        <button
          type="submit"
          disabled={!theme.trim() || isGenerating}
          className="w-full px-6 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-400 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          {isGenerating ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <span>🎲</span>
              Generate Phrases
            </>
          )}
        </button>
      </form>

      {/* Generated Phrases Table */}
      {generatedPhrases.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">
              Generated Phrases ({generatedPhrases.length})
            </h2>
            <div className="flex gap-2">
              <button
                onClick={handleSelectAll}
                className="px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200 border border-zinc-700 rounded-lg hover:border-zinc-600 transition-colors"
              >
                Select All
              </button>
              <button
                onClick={handleDeselectAll}
                className="px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200 border border-zinc-700 rounded-lg hover:border-zinc-600 transition-colors"
              >
                Deselect All
              </button>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2">
            <button
              onClick={handleProcessSelected}
              disabled={selectedPhrases.size === 0 || isProcessing}
              className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-400 text-white font-medium rounded-lg transition-colors flex items-center gap-2"
            >
              {isProcessing ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <span>🚀</span>
                  Process Selected ({selectedPhrases.size})
                </>
              )}
            </button>
            <button
              onClick={handleClearAll}
              className="px-4 py-2.5 text-red-400 hover:text-red-300 border border-zinc-700 rounded-lg hover:border-red-500/50 transition-colors"
            >
              Clear All
            </button>
          </div>

          {/* Table */}
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
            <table className="w-full">
              <thead className="bg-zinc-800/50">
                <tr>
                  <th className="w-12 px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase"></th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase">Source Text</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase">Translation</th>
                  <th className="w-24 px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {generatedPhrases.map((phrase) => (
                  <tr key={phrase.id} className="hover:bg-zinc-800/30 transition-colors">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedPhrases.has(phrase.id)}
                        onChange={() => toggleSelect(phrase.id)}
                        className="w-4 h-4 rounded border-zinc-600 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-0 bg-zinc-800"
                      />
                    </td>
                    <td className="px-4 py-3" dir={language === 'ar' ? 'rtl' : 'ltr'}>
                      {editingId === phrase.id ? (
                        <input
                          type="text"
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          className="w-full px-2 py-1 bg-zinc-800 border border-zinc-600 rounded text-zinc-100"
                          autoFocus
                        />
                      ) : (
                        <span className="text-zinc-100">{phrase.source_text}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {editingId === phrase.id ? (
                        <input
                          type="text"
                          value={editTranslation}
                          onChange={(e) => setEditTranslation(e.target.value)}
                          className="w-full px-2 py-1 bg-zinc-800 border border-zinc-600 rounded text-zinc-100"
                        />
                      ) : (
                        <span className="text-zinc-400">{phrase.translation}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        {editingId === phrase.id ? (
                          <>
                            <button
                              onClick={() => saveEdit(phrase.id)}
                              className="text-emerald-400 hover:text-emerald-300 text-sm"
                              title="Save"
                            >
                              ✓
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="text-zinc-400 hover:text-zinc-300 text-sm"
                              title="Cancel"
                            >
                              ✕
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => startEdit(phrase)}
                              className="text-zinc-400 hover:text-zinc-300 text-sm"
                              title="Edit"
                            >
                              ✏️
                            </button>
                            <button
                              onClick={() => handleDelete(phrase.id)}
                              className="text-red-400 hover:text-red-300 text-sm"
                              title="Delete"
                            >
                              🗑️
                            </button>
                          </>
                        )}
                      </div>
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
