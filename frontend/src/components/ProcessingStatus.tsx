import { useState } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { listPhrases } from '../lib/api'
import { useAdaptivePolling } from '../lib/useAdaptivePolling'

export default function ProcessingStatus() {
  const { isLoaded } = useAuth()
  const [processingCount, setProcessingCount] = useState(0)

  const checkProcessing = async () => {
    try {
      const { phrases } = await listPhrases('processing')
      setProcessingCount(phrases.length)
    } catch {
      // Ignore errors
    }
  }

  // Only poll fast when there ARE processing jobs, otherwise poll slowly
  useAdaptivePolling({
    onPoll: checkProcessing,
    shouldPollFast: () => processingCount > 0,
    fastInterval: 5000,   // 5s when processing
    slowInterval: 60000,  // 60s when idle
    enabled: isLoaded,
  })

  if (processingCount === 0) return null

  return (
    <div className="fixed bottom-4 right-4 px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-lg shadow-lg flex items-center gap-3 z-50">
      <div className="relative">
        <div className="w-3 h-3 bg-yellow-500 rounded-full animate-pulse" />
        <div className="absolute inset-0 w-3 h-3 bg-yellow-500 rounded-full animate-ping" />
      </div>
      <span className="text-sm text-zinc-300">
        {processingCount} phrase{processingCount !== 1 ? 's' : ''} processing...
      </span>
    </div>
  )
}
