import { useState, useRef, useCallback, useEffect } from 'react'
import { uploadFile, uploadText } from '../lib/api'

type InputMode = 'image' | 'audio' | 'text'

export default function UploadPage() {
  const [mode, setMode] = useState<InputMode>('image')
  const [text, setText] = useState('')
  const [language, setLanguage] = useState<'ru' | 'ar'>('ru')
  const [uploading, setUploading] = useState(false)
  const [uploadTotal, setUploadTotal] = useState(0)
  const [uploadDone, setUploadDone] = useState(0)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [recentUploads, setRecentUploads] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)

  const resetProgress = () => {
    setUploadTotal(0)
    setUploadDone(0)
  }

  const handleFiles = useCallback(async (files: File[]) => {
    if (!files.length) return
    setUploading(true)
    setMessage(null)
    setUploadTotal(files.length)
    setUploadDone(0)

    const maxConcurrency = 3
    let index = 0
    const runNext = async (): Promise<void> => {
      const i = index++
      if (i >= files.length) return
      const file = files[i]
      try {
        const result = await uploadFile(file)
        setRecentUploads(prev => [result.id, ...prev.slice(0, 19)])
      } catch (err) {
        console.error('Upload failed for', file.name, err)
        setMessage({ type: 'error', text: `Some files failed to upload (e.g., ${file.name})` })
      } finally {
        setUploadDone(done => done + 1)
        await runNext()
      }
    }
    await Promise.all(Array.from({ length: Math.min(maxConcurrency, files.length) }).map(() => runNext()))
    setMessage({ type: 'success', text: 'Batch started! Check Review page shortly.' })
    setUploading(false)
    resetProgress()
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    await handleFiles(files)
  }

  const handleTextSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!text.trim()) return
    
    setUploading(true)
    setMessage(null)
    
    try {
      const result = await uploadText(text.trim(), language)
      setRecentUploads(prev => [result.id, ...prev.slice(0, 4)])
      setMessage({ type: 'success', text: 'Processing started! Check Review page shortly.' })
      setText('')
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Upload failed' })
    } finally {
      setUploading(false)
    }
  }

  // Drag & Drop handlers for the drop area
  const onDrop = useCallback(async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    if (uploading) return
    const dt = e.dataTransfer
    const files = Array.from(dt.files || [])
    // Filter by mode
    const filtered = files.filter(f =>
      mode === 'image' ? f.type.startsWith('image/') : f.type.startsWith('audio/')
    )
    if (!filtered.length) return
    await handleFiles(filtered)
  }, [handleFiles, mode, uploading])

  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
  }, [])

  // Paste handler for images (when in Image mode)
  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      if (mode !== 'image' || uploading) return
      const items = e.clipboardData?.items
      if (!items) return
      const files: File[] = []
      for (const item of items) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) files.push(file)
        }
      }
      if (files.length) {
        e.preventDefault()
        await handleFiles(files)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [handleFiles, mode, uploading])

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold mb-2">Capture</h1>
        <p className="text-zinc-400">Upload screenshots, audio, or type directly.</p>
      </div>

      {/* Mode tabs */}
      <div className="flex gap-2 p-1 bg-zinc-900 rounded-lg w-fit">
        {[
          { id: 'image' as const, icon: '📷', label: 'Image' },
          { id: 'audio' as const, icon: '🎤', label: 'Audio' },
          { id: 'text' as const, icon: '✏️', label: 'Text' },
        ].map(({ id, icon, label }) => (
          <button
            key={id}
            onClick={() => setMode(id)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
              mode === id
                ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <span className="mr-2">{icon}</span>
            {label}
          </button>
        ))}
      </div>

      {/* Upload area */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-8">
        {mode === 'text' ? (
          <form onSubmit={handleTextSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-2">
                Language
              </label>
              <div className="flex gap-2">
                {[
                  { id: 'ru' as const, label: 'Russian', flag: '🇷🇺' },
                  { id: 'ar' as const, label: 'Arabic', flag: '🇸🇦' },
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
            
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-2">
                Phrase
              </label>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Type or paste the phrase..."
                rows={4}
                className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 resize-none"
                dir={language === 'ar' ? 'rtl' : 'ltr'}
              />
            </div>
            
            <button
              type="submit"
              disabled={!text.trim() || uploading}
              className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-400 text-white font-medium rounded-lg transition-colors"
            >
              {uploading ? 'Processing...' : 'Submit'}
            </button>
          </form>
        ) : (
          <label className={`block ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
            <input
              ref={fileInputRef}
              type="file"
              accept={mode === 'image' ? 'image/*' : 'audio/*'}
              multiple
              onChange={handleFileSelect}
              className="hidden"
            />
            <div
              ref={dropRef}
              onDrop={onDrop}
              onDragOver={onDragOver}
              className="border-2 border-dashed border-zinc-700 hover:border-zinc-600 rounded-xl p-12 text-center transition-colors"
            >
              <div className="text-4xl mb-4">
                {mode === 'image' ? '📷' : '🎤'}
              </div>
              <p className="text-zinc-300 font-medium mb-1">
                {uploading && uploadTotal > 1
                  ? `Uploading ${uploadDone}/${uploadTotal}...`
                  : `Drop ${mode} files here, paste ${mode === 'image' ? 'images' : ''}, or click to browse`}
              </p>
              <p className="text-zinc-500 text-sm">
                {mode === 'image' ? 'PNG, JPG, WebP — paste from clipboard supported' : 'MP3, WAV, M4A, WebM'}
              </p>
            </div>
          </label>
        )}
      </div>

      {/* Message */}
      {message && (
        <div
          className={`px-4 py-3 rounded-lg ${
            message.type === 'success'
              ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
              : 'bg-red-500/10 border border-red-500/30 text-red-400'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Recent uploads */}
      {recentUploads.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-zinc-400 mb-2">Recent uploads</h3>
          <div className="flex flex-wrap gap-2">
            {recentUploads.map((id) => (
              <span
                key={id}
                className="px-3 py-1 bg-zinc-800 rounded-full text-xs font-mono text-zinc-400"
              >
                {id.slice(0, 8)}...
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
