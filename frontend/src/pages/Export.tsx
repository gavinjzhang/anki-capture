import { useState, useEffect } from 'react'
import JSZip from 'jszip'
import { getExportPreview, getExportData, markExported, getFileUrl } from '../lib/api'

interface ExportPreview {
  count: number
  preview: { id: string; source_text: string | null; translation: string | null }[]
}

export default function ExportPage() {
  const [preview, setPreview] = useState<ExportPreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const loadPreview = async () => {
    setLoading(true)
    try {
      const data = await getExportPreview()
      setPreview(data)
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to load export preview' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadPreview()
  }, [])

  const handleExport = async () => {
    setExporting(true)
    setMessage(null)

    try {
      const data = await getExportData()
      
      const zip = new JSZip()
      
      // Add phrases.txt
      zip.file('phrases.txt', data.txt_content)
      
      // Create media folder and download audio files
      const mediaFolder = zip.folder('media')
      
      for (const phrase of data.phrases) {
        if (phrase.audio_url) {
          try {
            const audioUrl = getFileUrl(phrase.audio_url)
            const response = await fetch(audioUrl)
            if (response.ok) {
              const audioBlob = await response.blob()
              mediaFolder?.file(`${phrase.id}.mp3`, audioBlob)
            }
          } catch (err) {
            console.warn(`Failed to fetch audio for ${phrase.id}`)
          }
        }
      }
      
      // Generate and download zip
      const zipBlob = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(zipBlob)
      const a = document.createElement('a')
      a.href = url
      a.download = `anki-export-${new Date().toISOString().slice(0, 10)}.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      
      // Mark phrases as exported
      const phraseIds = data.phrases.map(p => p.id)
      await markExported(phraseIds)
      
      setMessage({ 
        type: 'success', 
        text: `Exported ${phraseIds.length} phrases. Extract the zip, move media files to Anki's collection.media folder, then import phrases.txt.` 
      })
      
      // Refresh preview
      await loadPreview()
      
    } catch (err) {
      setMessage({ 
        type: 'error', 
        text: err instanceof Error ? err.message : 'Export failed' 
      })
    } finally {
      setExporting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-zinc-500">Loading...</div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold mb-2">Export</h1>
        <p className="text-zinc-400">Download phrases for Anki import</p>
      </div>

      {/* Export card */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h2 className="text-lg font-medium mb-1">Ready to Export</h2>
            <p className="text-zinc-400">
              {preview?.count || 0} approved phrase{preview?.count !== 1 ? 's' : ''} ready
            </p>
          </div>
          <button
            onClick={handleExport}
            disabled={!preview?.count || exporting}
            className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-400 text-white font-medium rounded-lg transition-colors"
          >
            {exporting ? 'Exporting...' : 'Download ZIP'}
          </button>
        </div>

        {/* Preview */}
        {preview && preview.preview.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-zinc-400 mb-3">Preview</h3>
            <div className="space-y-2">
              {preview.preview.map((phrase) => (
                <div 
                  key={phrase.id}
                  className="flex items-center gap-4 px-3 py-2 bg-zinc-800/50 rounded-lg text-sm"
                >
                  <span className="font-medium">{phrase.source_text}</span>
                  <span className="text-zinc-500">→</span>
                  <span className="text-zinc-400">{phrase.translation}</span>
                </div>
              ))}
              {preview.count > 5 && (
                <p className="text-zinc-500 text-sm px-3">
                  ...and {preview.count - 5} more
                </p>
              )}
            </div>
          </div>
        )}

        {preview?.count === 0 && (
          <div className="text-center py-8 text-zinc-500">
            <div className="text-4xl mb-4">📦</div>
            <p>No phrases ready for export. Approve some phrases first!</p>
          </div>
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

      {/* Instructions */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6">
        <h3 className="font-medium mb-4">Import Instructions</h3>
        <ol className="space-y-3 text-zinc-400">
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 bg-zinc-800 rounded-full flex items-center justify-center text-xs font-medium">1</span>
            <span>Download and extract the ZIP file</span>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 bg-zinc-800 rounded-full flex items-center justify-center text-xs font-medium">2</span>
            <span>Copy all files from the <code className="px-1.5 py-0.5 bg-zinc-800 rounded text-sm">media</code> folder to your Anki <code className="px-1.5 py-0.5 bg-zinc-800 rounded text-sm">collection.media</code> folder</span>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 bg-zinc-800 rounded-full flex items-center justify-center text-xs font-medium">3</span>
            <span>In Anki, go to File → Import and select <code className="px-1.5 py-0.5 bg-zinc-800 rounded text-sm">phrases.txt</code></span>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 bg-zinc-800 rounded-full flex items-center justify-center text-xs font-medium">4</span>
            <span>Set the note type to Basic (and reversed card), with fields: Front, Back, Grammar, Vocab, Audio</span>
          </li>
        </ol>

        <details className="mt-6 group">
          <summary className="flex items-center justify-between cursor-pointer select-none px-3 py-2 bg-zinc-800/50 rounded-md">
            <span className="font-medium text-zinc-300">Where is Anki's collection.media?</span>
            <span className="text-zinc-400 transition-transform">›</span>
          </summary>
          <div className="mt-3 space-y-2 text-sm text-zinc-400 px-1">
            <p>
              Tip: In Anki, you can open it via <span className="font-medium text-zinc-300">Tools → Open Profile Folder</span>, then open the
              <code className="px-1.5 py-0.5 bg-zinc-800 rounded text-sm ml-1">collection.media</code> folder.
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li>
                macOS: <code className="px-1.5 py-0.5 bg-zinc-800 rounded">~/Library/Application Support/Anki2/User 1/collection.media</code>
              </li>
              <li>
                Windows: <code className="px-1.5 py-0.5 bg-zinc-800 rounded">%APPDATA%\Anki2\User 1\collection.media</code>
                <span className="ml-2 text-zinc-500">(usually C:\Users\&lt;You&gt;\AppData\Roaming\Anki2\User 1\collection.media)</span>
              </li>
              <li>
                Linux: <code className="px-1.5 py-0.5 bg-zinc-800 rounded">~/.local/share/Anki2/User 1/collection.media</code>
              </li>
            </ul>
            <p className="text-zinc-500">Replace “User 1” with your profile name if different.</p>
          </div>
        </details>
      </div>
    </div>
  )
}
