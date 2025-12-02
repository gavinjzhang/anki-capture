import { useState, useRef, useEffect } from 'react'

interface AudioPlayerProps {
  src: string
  onRegenerate?: () => void
  compact?: boolean
}

export default function AudioPlayer({ src, onRegenerate, compact = false }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const handleLoadedMetadata = () => setDuration(audio.duration)
    const handleTimeUpdate = () => setCurrentTime(audio.currentTime)
    const handleEnded = () => setIsPlaying(false)

    audio.addEventListener('loadedmetadata', handleLoadedMetadata)
    audio.addEventListener('timeupdate', handleTimeUpdate)
    audio.addEventListener('ended', handleEnded)

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata)
      audio.removeEventListener('timeupdate', handleTimeUpdate)
      audio.removeEventListener('ended', handleEnded)
    }
  }, [src])

  const togglePlay = () => {
    const audio = audioRef.current
    if (!audio) return

    if (isPlaying) {
      audio.pause()
    } else {
      audio.play()
    }
    setIsPlaying(!isPlaying)
  }

  const formatTime = (time: number) => {
    const mins = Math.floor(time / 60)
    const secs = Math.floor(time % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <audio ref={audioRef} src={src} preload="metadata" />
        <button
          onClick={togglePlay}
          className="w-8 h-8 flex items-center justify-center bg-zinc-800 hover:bg-zinc-700 rounded-full transition-colors"
        >
          {isPlaying ? '⏸' : '▶️'}
        </button>
        {onRegenerate && (
          <button
            onClick={onRegenerate}
            className="text-zinc-500 hover:text-zinc-300 transition-colors"
            title="Regenerate audio"
          >
            🔄
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3 p-2 bg-zinc-800 rounded-lg">
      <audio ref={audioRef} src={src} preload="metadata" />
      
      <button
        onClick={togglePlay}
        className="w-10 h-10 flex items-center justify-center bg-emerald-600 hover:bg-emerald-500 rounded-full transition-colors flex-shrink-0"
      >
        {isPlaying ? '⏸' : '▶️'}
      </button>

      <div className="flex-1 min-w-0">
        <div className="h-1.5 bg-zinc-700 rounded-full overflow-hidden">
          <div 
            className="h-full bg-emerald-500 transition-all duration-100"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex justify-between mt-1 text-xs text-zinc-500">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      {onRegenerate && (
        <button
          onClick={onRegenerate}
          className="p-2 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 rounded-lg transition-colors"
          title="Regenerate audio"
        >
          🔄
        </button>
      )}
    </div>
  )
}
