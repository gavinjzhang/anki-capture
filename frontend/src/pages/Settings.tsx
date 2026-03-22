import { useState, useEffect } from 'react'
import { getSettings, updateOpenAIKey, deleteOpenAIKey, AuthError } from '../lib/api'
import AuthErrorBanner from '../components/AuthErrorBanner'
import { useToast } from '../components/Toast'

export default function SettingsPage() {
  const [mask, setMask] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [authError, setAuthError] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [showKey, setShowKey] = useState(false)
  const { showToast } = useToast()

  useEffect(() => {
    loadSettings()
  }, [])

  async function loadSettings() {
    setLoading(true)
    try {
      const settings = await getSettings()
      setMask(settings.openai_api_key_mask)
      setAuthError(false)
    } catch (err) {
      if (err instanceof AuthError) {
        setAuthError(true)
      } else {
        showToast('Failed to load settings', 'error')
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    const trimmed = keyInput.trim()
    if (!trimmed) return

    if (!trimmed.startsWith('sk-') || trimmed.length < 20) {
      showToast('Invalid key format. Must start with sk- and be at least 20 characters.', 'error')
      return
    }

    setSaving(true)
    try {
      const result = await updateOpenAIKey(trimmed)
      setMask(result.openai_api_key_mask)
      setKeyInput('')
      showToast(result.validated ? 'API key saved and validated' : 'API key saved', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save key', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await deleteOpenAIKey()
      setMask(null)
      setKeyInput('')
      showToast('API key removed', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to remove key', 'error')
    } finally {
      setDeleting(false)
    }
  }

  if (authError) return <AuthErrorBanner />

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-zinc-400 mt-1">Manage your API keys and preferences</p>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">OpenAI API Key</h2>
          <p className="text-zinc-400 text-sm mt-1">
            Provide your own OpenAI API key for text analysis and phrase generation.
            If not set, the platform default key is used.
          </p>
        </div>

        {loading ? (
          <div className="h-10 bg-zinc-800 rounded animate-pulse" />
        ) : mask ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex-1 bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 font-mono text-sm text-zinc-300">
                {mask}
              </div>
              <span className="text-xs text-emerald-400 font-medium">Active</span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setMask(null)}
                className="px-3 py-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-md transition-colors"
              >
                Update
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-3 py-1.5 text-sm text-red-400 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-md transition-colors disabled:opacity-50"
              >
                {deleting ? 'Removing...' : 'Remove'}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  placeholder="sk-..."
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm font-mono placeholder-zinc-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                  onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-300 text-xs"
                >
                  {showKey ? 'Hide' : 'Show'}
                </button>
              </div>
              <button
                onClick={handleSave}
                disabled={saving || !keyInput.trim()}
                className="px-4 py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 rounded-md transition-colors"
              >
                {saving ? 'Validating...' : 'Save'}
              </button>
            </div>
          </div>
        )}

        <div className="pt-2 border-t border-zinc-800">
          <p className="text-zinc-500 text-xs">
            Your key is encrypted at rest and only decrypted when processing your uploads.
            It is validated with OpenAI on save and never logged or shared.
          </p>
        </div>
      </div>
    </div>
  )
}
