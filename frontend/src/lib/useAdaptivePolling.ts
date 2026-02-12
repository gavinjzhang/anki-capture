import { useEffect, useRef, useCallback } from 'react'

export interface AdaptivePollingOptions {
  /**
   * Callback function to execute on each poll
   */
  onPoll: () => Promise<void> | void

  /**
   * Function that returns true if we should poll aggressively (e.g., jobs are processing)
   */
  shouldPollFast: () => boolean

  /**
   * Fast polling interval in ms (when shouldPollFast returns true)
   * @default 3000 (3 seconds)
   */
  fastInterval?: number

  /**
   * Slow polling interval in ms (when shouldPollFast returns false)
   * @default 30000 (30 seconds)
   */
  slowInterval?: number

  /**
   * Whether polling is enabled
   * @default true
   */
  enabled?: boolean

  /**
   * Stop polling when browser tab is hidden
   * @default true
   */
  pauseWhenHidden?: boolean
}

/**
 * Adaptive polling hook inspired by AWS CloudFormation and Vercel.
 * Polls aggressively when work is in progress, backs off when idle.
 */
export function useAdaptivePolling({
  onPoll,
  shouldPollFast,
  fastInterval = 3000,
  slowInterval = 30000,
  enabled = true,
  pauseWhenHidden = true,
}: AdaptivePollingOptions) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>()
  const isPollingRef = useRef(false)

  const poll = useCallback(async () => {
    // Prevent concurrent polls
    if (isPollingRef.current) return

    // Skip if tab is hidden and pauseWhenHidden is enabled
    if (pauseWhenHidden && document.hidden) {
      scheduleNext()
      return
    }

    isPollingRef.current = true
    try {
      await onPoll()
    } catch (error) {
      console.error('Polling error:', error)
    } finally {
      isPollingRef.current = false
      scheduleNext()
    }
  }, [onPoll, pauseWhenHidden])

  const scheduleNext = useCallback(() => {
    if (!enabled) return

    const interval = shouldPollFast() ? fastInterval : slowInterval

    timeoutRef.current = setTimeout(poll, interval)
  }, [enabled, shouldPollFast, fastInterval, slowInterval, poll])

  const pollNow = useCallback(async () => {
    // Clear any pending poll
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    await poll()
  }, [poll])

  // Initial poll and setup
  useEffect(() => {
    if (!enabled) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
      return
    }

    // Poll immediately on mount
    poll()

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [enabled, poll])

  // Resume polling when tab becomes visible
  useEffect(() => {
    if (!pauseWhenHidden) return

    const handleVisibilityChange = () => {
      if (!document.hidden && enabled) {
        // Poll immediately when tab becomes visible
        pollNow()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [pauseWhenHidden, enabled, pollNow])

  return {
    /**
     * Trigger an immediate poll (cancels any pending poll)
     */
    pollNow,

    /**
     * Current polling interval being used
     */
    currentInterval: shouldPollFast() ? fastInterval : slowInterval,
  }
}
