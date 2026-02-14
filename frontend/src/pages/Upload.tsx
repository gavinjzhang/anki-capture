import { useState, useRef, useCallback, useEffect } from 'react'
import { uploadFile, uploadText } from '../lib/api'

type InputMode = 'image' | 'audio' | 'text'
type AudioInputMode = 'upload' | 'record'

export default function UploadPage() {
  const [mode, setMode] = useState<InputMode>('image')
  const [text, setText] = useState('')
  const [language, setLanguage] = useState<'ru' | 'ar' | 'zh' | 'es' | 'ka'>('ru')
  const [uploading, setUploading] = useState(false)
  const [uploadTotal, setUploadTotal] = useState(0)
  const [uploadDone, setUploadDone] = useState(0)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [recentUploads, setRecentUploads] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)

  // Audio recording state
  const [audioInputMode, setAudioInputMode] = useState<AudioInputMode>('upload')
  const [isRecording, setIsRecording] = useState(false)
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null)
  const [recordingTime, setRecordingTime] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioStreamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const timerIntervalRef = useRef<number | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const audioPreviewRef = useRef<HTMLAudioElement>(null)

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

  // Audio recording functions
  const MAX_RECORDING_TIME = 30 // seconds

  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current
    const analyser = analyserRef.current
    if (!canvas || !analyser) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const bufferLength = analyser.frequencyBinCount
    const dataArray = new Uint8Array(bufferLength)

    const draw = () => {
      animationFrameRef.current = requestAnimationFrame(draw)
      analyser.getByteTimeDomainData(dataArray)

      ctx.fillStyle = 'rgb(24, 24, 27)' // zinc-900
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      ctx.lineWidth = 2
      ctx.strokeStyle = 'rgb(16, 185, 129)' // emerald-500
      ctx.beginPath()

      const sliceWidth = canvas.width / bufferLength
      let x = 0

      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0
        const y = (v * canvas.height) / 2

        if (i === 0) {
          ctx.moveTo(x, y)
        } else {
          ctx.lineTo(x, y)
        }

        x += sliceWidth
      }

      ctx.lineTo(canvas.width, canvas.height / 2)
      ctx.stroke()
    }

    draw()
  }, [])

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      })

      audioStreamRef.current = stream

      // Set up audio context for waveform visualization
      const audioContext = new AudioContext()
      audioContextRef.current = audioContext
      const source = audioContext.createMediaStreamSource(stream)
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 2048
      source.connect(analyser)
      analyserRef.current = analyser

      // Start waveform visualization
      drawWaveform()

      // Set up MediaRecorder
      const recorder = new MediaRecorder(stream)
      const chunks: Blob[] = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.push(e.data)
        }
      }

      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'audio/webm' })
        setRecordedBlob(blob)

        // Stop waveform animation
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current)
        }
      }

      recorder.start()
      mediaRecorderRef.current = recorder
      setIsRecording(true)
      setRecordingTime(0)
      setRecordedBlob(null)
      setMessage(null)

      // Start timer
      timerIntervalRef.current = window.setInterval(() => {
        setRecordingTime(prev => {
          const newTime = prev + 1
          if (newTime >= MAX_RECORDING_TIME) {
            stopRecording()
          }
          return newTime
        })
      }, 1000)

    } catch (err) {
      console.error('Failed to start recording:', err)
      setMessage({
        type: 'error',
        text: 'Failed to access microphone. Please grant permission and try again.'
      })
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
    }

    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach(track => track.stop())
    }

    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current)
      timerIntervalRef.current = null
    }

    if (audioContextRef.current) {
      audioContextRef.current.close()
      audioContextRef.current = null
    }

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
  }

  const resetRecording = () => {
    setRecordedBlob(null)
    setRecordingTime(0)
    setIsPlaying(false)
  }

  const submitRecording = async () => {
    if (!recordedBlob) return

    const file = new File(
      [recordedBlob],
      `recording-${Date.now()}.webm`,
      { type: 'audio/webm' }
    )

    await handleFiles([file])
    resetRecording()
  }

  const togglePlayback = () => {
    const audio = audioPreviewRef.current
    if (!audio || !recordedBlob) return

    if (isPlaying) {
      audio.pause()
      setIsPlaying(false)
    } else {
      if (!audio.src || audio.src === window.location.href) {
        audio.src = URL.createObjectURL(recordedBlob)
      }
      audio.play()
      setIsPlaying(true)
    }
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopRecording()
      if (audioPreviewRef.current?.src) {
        URL.revokeObjectURL(audioPreviewRef.current.src)
      }
    }
  }, [])

  // Handle audio playback end
  useEffect(() => {
    const audio = audioPreviewRef.current
    if (!audio) return

    const handleEnded = () => setIsPlaying(false)
    audio.addEventListener('ended', handleEnded)
    return () => audio.removeEventListener('ended', handleEnded)
  }, [])

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

      {/* Audio input mode toggle (only for audio mode) */}
      {mode === 'audio' && (
        <div className="flex gap-2 p-1 bg-zinc-900 rounded-lg w-fit">
          {[
            { id: 'upload' as const, icon: '📁', label: 'Upload File' },
            { id: 'record' as const, icon: '🔴', label: 'Record' },
          ].map(({ id, icon, label }) => (
            <button
              key={id}
              onClick={() => {
                setAudioInputMode(id)
                if (id === 'upload') {
                  resetRecording()
                  stopRecording()
                }
              }}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                audioInputMode === id
                  ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <span className="mr-2">{icon}</span>
              {label}
            </button>
          ))}
        </div>
      )}

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
        ) : mode === 'audio' && audioInputMode === 'record' ? (
          // Audio recording interface
          <div className="space-y-6">
            {/* Waveform visualization */}
            <div className="relative">
              <canvas
                ref={canvasRef}
                width={600}
                height={120}
                className="w-full h-[120px] bg-zinc-950 rounded-lg border border-zinc-800"
              />
              {!isRecording && !recordedBlob && (
                <div className="absolute inset-0 flex items-center justify-center text-zinc-500 text-sm">
                  Ready to record
                </div>
              )}
            </div>

            {/* Timer */}
            <div className="text-center">
              <div className={`text-3xl font-mono transition-colors ${
                recordingTime >= MAX_RECORDING_TIME - 5 && isRecording
                  ? 'text-red-400 animate-pulse'
                  : 'text-zinc-300'
              }`}>
                {Math.floor(recordingTime / 60)}:{String(recordingTime % 60).padStart(2, '0')}
              </div>
              <div className="text-xs text-zinc-500 mt-1">
                {isRecording
                  ? recordingTime >= MAX_RECORDING_TIME - 5
                    ? `Ending soon... (max ${MAX_RECORDING_TIME}s)`
                    : `Recording... (max ${MAX_RECORDING_TIME}s)`
                  : recordedBlob ? 'Recording complete' : 'Not recording'}
              </div>
            </div>

            {/* Controls */}
            <div className="flex gap-3 justify-center">
              {!recordedBlob ? (
                // Recording controls
                <>
                  {!isRecording ? (
                    <button
                      onClick={startRecording}
                      disabled={uploading}
                      className="px-6 py-3 bg-red-600 hover:bg-red-500 disabled:bg-zinc-700 disabled:text-zinc-400 text-white font-medium rounded-lg transition-colors flex items-center gap-2"
                    >
                      <span className="text-xl">⏺️</span>
                      Start Recording
                    </button>
                  ) : (
                    <button
                      onClick={stopRecording}
                      className="px-6 py-3 bg-zinc-700 hover:bg-zinc-600 text-white font-medium rounded-lg transition-colors flex items-center gap-2"
                    >
                      <span className="text-xl">⏹️</span>
                      Stop
                    </button>
                  )}
                </>
              ) : (
                // Playback controls
                <>
                  <button
                    onClick={togglePlayback}
                    className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg transition-colors flex items-center gap-2"
                  >
                    <span className="text-xl">{isPlaying ? '⏸️' : '▶️'}</span>
                    {isPlaying ? 'Pause' : 'Play Preview'}
                  </button>
                  <button
                    onClick={resetRecording}
                    className="px-6 py-3 bg-zinc-700 hover:bg-zinc-600 text-white font-medium rounded-lg transition-colors flex items-center gap-2"
                  >
                    <span className="text-xl">🔄</span>
                    Re-record
                  </button>
                  <button
                    onClick={submitRecording}
                    disabled={uploading}
                    className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-400 text-white font-medium rounded-lg transition-colors flex items-center gap-2"
                  >
                    <span className="text-xl">✓</span>
                    {uploading ? 'Uploading...' : 'Submit'}
                  </button>
                </>
              )}
            </div>

            {/* Hidden audio element for preview */}
            <audio ref={audioPreviewRef} className="hidden" />
          </div>
        ) : (
          // File upload interface (image or audio upload mode)
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
