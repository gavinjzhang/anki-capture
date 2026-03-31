import { useState, useEffect } from 'react'
import {
  getSettings,
  updateLLMKey,
  deleteLLMKey,
  LLM_PROVIDERS,
  LLMProvider,
  AuthError,
} from '../lib/api'
import AuthErrorBanner from '../components/AuthErrorBanner'
import { useToast } from '../components/Toast'

const PROVIDER_IDS = Object.keys(LLM_PROVIDERS) as LLMProvider[]

export default function SettingsPage() {
  const [activeMask, setActiveMask] = useState<string | null>(null)
  const [activeProvider, setActiveProvider] = useState<LLMProvider | null>(null)
  const [activeModel, setActiveModel] = useState<string | null>(null)
  const [dailyUsage, setDailyUsage] = useState<number | null>(null)
  const [dailyLimit, setDailyLimit] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [authError, setAuthError] = useState(false)

  // Form state
  const [selectedProvider, setSelectedProvider] = useState<LLMProvider>('openai')
  const [selectedModel, setSelectedModel] = useState<string>(LLM_PROVIDERS.openai.models[0])
  const [keyInput, setKeyInput] = useState('')
  const [showKey, setShowKey] = useState(false)

  const { showToast } = useToast()

  useEffect(() => {
    loadSettings()
  }, [])

  // Reset model when provider changes
  useEffect(() => {
    setSelectedModel(LLM_PROVIDERS[selectedProvider].models[0])
    setKeyInput('')
  }, [selectedProvider])

  async function loadSettings() {
    setLoading(true)
    try {
      const settings = await getSettings()
      setActiveMask(settings.llm_api_key_mask)
      setActiveProvider(settings.llm_provider)
      setActiveModel(settings.llm_model)
      setDailyUsage(settings.daily_llm_usage)
      setDailyLimit(settings.daily_llm_limit)
      if (settings.llm_provider) setSelectedProvider(settings.llm_provider)
      if (settings.llm_model) setSelectedModel(settings.llm_model)
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

    const config = LLM_PROVIDERS[selectedProvider]
    if (!config.keyPattern.test(trimmed)) {
      showToast(
        `Invalid key format for ${config.name}. Expected: ${config.keyHint}`,
        'error',
      )
      return
    }

    setSaving(true)
    try {
      const result = await updateLLMKey(selectedProvider, selectedModel, trimmed)
      setActiveMask(result.llm_api_key_mask)
      setActiveProvider(result.llm_provider)
      setActiveModel(result.llm_model)
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
      await deleteLLMKey()
      setActiveMask(null)
      setActiveProvider(null)
      setActiveModel(null)
      setKeyInput('')
      showToast('API key removed', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to remove key', 'error')
    } finally {
      setDeleting(false)
    }
  }

  function startUpdate() {
    if (activeProvider) setSelectedProvider(activeProvider)
    if (activeModel) setSelectedModel(activeModel)
    setActiveMask(null)
    setKeyInput('')
  }

  if (authError) return <AuthErrorBanner />

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-zinc-400 mt-1">Manage your API keys and preferences</p>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 space-y-5">
        <div>
          <h2 className="text-lg font-semibold">LLM API Key</h2>
          <p className="text-zinc-400 text-sm mt-1">
            Bring your own key for text analysis and phrase generation.
            If not set, the platform default is used.
          </p>
        </div>

        {loading ? (
          <div className="h-10 bg-zinc-800 rounded animate-pulse" />
        ) : activeMask ? (
          /* Active key display */
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex-1 bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-300 flex items-center gap-2">
                <span className="text-zinc-500 text-xs uppercase tracking-wide">
                  {activeProvider ? LLM_PROVIDERS[activeProvider]?.name : ''}
                </span>
                <span className="text-zinc-600">·</span>
                <span className="font-mono text-xs text-zinc-400">{activeModel}</span>
                <span className="text-zinc-600">·</span>
                <span className="font-mono">{activeMask}</span>
              </div>
              <span className="text-xs text-emerald-400 font-medium">Active</span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={startUpdate}
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
          /* Key entry form */
          <div className="space-y-4">
            {/* Provider selector */}
            <div>
              <label className="block text-xs text-zinc-400 mb-1.5">Provider</label>
              <div className="flex gap-2 flex-wrap">
                {PROVIDER_IDS.map((id) => (
                  <button
                    key={id}
                    onClick={() => setSelectedProvider(id)}
                    className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
                      selectedProvider === id
                        ? 'bg-emerald-600 border-emerald-500 text-white'
                        : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700'
                    }`}
                  >
                    {LLM_PROVIDERS[id].name}
                  </button>
                ))}
              </div>
            </div>

            {/* Model selector */}
            <div>
              <label className="block text-xs text-zinc-400 mb-1.5">Model</label>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-300 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
              >
                {LLM_PROVIDERS[selectedProvider].models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            {/* Key input */}
            <div>
              <label className="block text-xs text-zinc-400 mb-1.5">API Key</label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={keyInput}
                    onChange={(e) => setKeyInput(e.target.value)}
                    placeholder={LLM_PROVIDERS[selectedProvider].keyHint}
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
          </div>
        )}

        <div className="pt-2 border-t border-zinc-800 space-y-2">
          {!activeMask && dailyLimit !== null && dailyUsage !== null && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-zinc-400">
                <span>Free analyses today</span>
                <span className={dailyUsage >= dailyLimit ? 'text-red-400' : ''}>
                  {dailyUsage} / {dailyLimit}
                </span>
              </div>
              <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    dailyUsage >= dailyLimit ? 'bg-red-500' : dailyUsage / dailyLimit > 0.75 ? 'bg-amber-500' : 'bg-emerald-500'
                  }`}
                  style={{ width: `${Math.min(100, (dailyUsage / dailyLimit) * 100)}%` }}
                />
              </div>
              {dailyUsage >= dailyLimit && (
                <p className="text-red-400 text-xs">Limit reached. Add your own API key to continue.</p>
              )}
            </div>
          )}
          <p className="text-zinc-500 text-xs">
            {activeMask
              ? 'Your key is encrypted at rest and only decrypted when processing your uploads. It is validated with the provider on save and never logged or shared.'
              : 'Using the platform default key. Add your own to remove the daily limit.'}
          </p>
        </div>
      </div>
    </div>
  )
}
