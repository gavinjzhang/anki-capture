import { useState, useRef, useEffect, useCallback } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { listPhrases, Phrase } from '../lib/api'
import { useAdaptivePolling } from '../lib/useAdaptivePolling'

const STEPS = [
  { key: 'extracting', label: 'Extracting text', num: 1 },
  { key: 'analyzing', label: 'Analyzing', num: 2 },
  { key: 'generating_audio', label: 'Generating audio', num: 3 },
] as const

const TOTAL_STEPS = 3

function getStepInfo(step: string | null) {
  const found = STEPS.find(s => s.key === step)
  return found ?? { key: null, label: 'Processing', num: 0 }
}

interface DoneToast {
  id: string
  text: string
  dismissAt: number
}

export default function ProcessingStatus() {
  const { isLoaded, isSignedIn } = useAuth()
  const [phrases, setPhrases] = useState<Phrase[]>([])
  const [expanded, setExpanded] = useState(false)
  const [doneToasts, setDoneToasts] = useState<DoneToast[]>([])
  const prevIdsRef = useRef<Set<string>>(new Set())
  const phraseCountRef = useRef(0)

  const checkProcessing = useCallback(async () => {
    try {
      const { phrases: current } = await listPhrases('processing')
      setPhrases(current)
      phraseCountRef.current = current.length

      // Detect phrases that finished (were processing, now gone)
      const currentIds = new Set(current.map(p => p.id))
      const prevIds = prevIdsRef.current

      if (prevIds.size > 0) {
        const finished: DoneToast[] = []
        for (const id of prevIds) {
          if (!currentIds.has(id)) {
            finished.push({
              id,
              text: 'Phrase ready for review',
              dismissAt: Date.now() + 4000,
            })
          }
        }
        if (finished.length > 0) {
          setDoneToasts(prev => [...prev, ...finished])
        }
      }

      prevIdsRef.current = currentIds
    } catch {
      // Ignore errors
    }
  }, [])

  // Auto-dismiss done toasts
  useEffect(() => {
    if (doneToasts.length === 0) return
    const timer = setInterval(() => {
      const now = Date.now()
      setDoneToasts(prev => prev.filter(t => t.dismissAt > now))
    }, 500)
    return () => clearInterval(timer)
  }, [doneToasts.length])

  useAdaptivePolling({
    onPoll: checkProcessing,
    shouldPollFast: () => phraseCountRef.current > 0,
    fastInterval: 3000,
    slowInterval: 60000,
    enabled: isLoaded && !!isSignedIn,
  })

  // Find the furthest-behind step for summary
  const minStep = phrases.reduce((min, p) => {
    const info = getStepInfo(p.processing_step)
    return info.num < min.num ? info : min
  }, { key: null, label: 'Processing', num: TOTAL_STEPS + 1 } as ReturnType<typeof getStepInfo>)

  const showWidget = phrases.length > 0
  const showDone = doneToasts.length > 0

  if (!showWidget && !showDone) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2 max-w-sm">
      {/* Done toasts */}
      {doneToasts.map(toast => (
        <div
          key={toast.id}
          className="px-4 py-3 bg-emerald-900/90 border border-emerald-700 rounded-lg shadow-lg flex items-center gap-3 animate-in slide-in-from-right"
        >
          <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center flex-shrink-0">
            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <span className="text-sm text-emerald-200">{toast.text}</span>
        </div>
      ))}

      {/* Processing widget */}
      {showWidget && (
        <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-lg overflow-hidden w-full">
          {/* Collapsed header — always visible */}
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full px-4 py-3 flex items-center gap-3 hover:bg-zinc-800/50 transition-colors text-left"
          >
            <div className="relative flex-shrink-0">
              <div className="w-3 h-3 bg-yellow-500 rounded-full animate-pulse" />
              <div className="absolute inset-0 w-3 h-3 bg-yellow-500 rounded-full animate-ping" />
            </div>
            <span className="text-sm text-zinc-300 flex-1">
              Processing {phrases.length} phrase{phrases.length !== 1 ? 's' : ''}...
              {minStep.num > 0 && minStep.num <= TOTAL_STEPS && (
                <span className="text-zinc-500 ml-1">
                  ({minStep.num}/{TOTAL_STEPS})
                </span>
              )}
            </span>
            <svg
              className={`w-4 h-4 text-zinc-500 transition-transform ${expanded ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
            </svg>
          </button>

          {/* Expanded: per-phrase details */}
          {expanded && (
            <div className="border-t border-zinc-800 divide-y divide-zinc-800/50">
              {phrases.map(phrase => {
                const step = getStepInfo(phrase.processing_step)
                const progress = step.num > 0 ? (step.num / TOTAL_STEPS) * 100 : 10
                return (
                  <div key={phrase.id} className="px-4 py-2.5">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm text-zinc-300 truncate max-w-[200px]">
                        {phrase.source_text
                          ? phrase.source_text.slice(0, 30) + (phrase.source_text.length > 30 ? '...' : '')
                          : phrase.source_type === 'image' ? 'Image upload'
                          : phrase.source_type === 'audio' ? 'Audio upload'
                          : 'Text input'}
                      </span>
                      <span className="text-xs text-zinc-500 ml-2 flex-shrink-0">
                        {step.num > 0 ? `${step.num}/${TOTAL_STEPS}` : '...'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-yellow-500 rounded-full transition-all duration-500"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <span className="text-xs text-zinc-500 w-28 text-right">
                        {step.num > 0 ? step.label + '...' : 'Starting...'}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
