import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import AudioPlayer from '../AudioPlayer'

/**
 * AudioPlayer Component Tests
 *
 * Tests audio playback UI including:
 * - Play/pause button rendering and interaction
 * - Regenerate button callback
 * - Compact vs full mode rendering
 * - Time display formatting
 */

describe('AudioPlayer', () => {
  beforeEach(() => {
    // Mock HTMLMediaElement methods
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
    window.HTMLMediaElement.prototype.pause = vi.fn()
    window.HTMLMediaElement.prototype.load = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Rendering', () => {
    it('renders audio element with correct src', () => {
      const { container } = render(<AudioPlayer src="https://example.com/audio.mp3" />)
      const audio = container.querySelector('audio')

      expect(audio).toBeTruthy()
      expect(audio?.src).toBe('https://example.com/audio.mp3')
      expect(audio?.preload).toBe('metadata')
    })

    it('renders play button initially', () => {
      const { container } = render(<AudioPlayer src="https://example.com/audio.mp3" />)

      const playButton = container.querySelector('button')
      expect(playButton).toBeTruthy()
      expect(playButton?.textContent).toContain('▶️')
    })

    it('renders regenerate button when onRegenerate provided', () => {
      const handleRegenerate = vi.fn()
      render(<AudioPlayer src="https://example.com/audio.mp3" onRegenerate={handleRegenerate} />)

      const regenButton = screen.getByTitle('Regenerate audio')
      expect(regenButton).toBeTruthy()
      expect(regenButton.textContent).toContain('🔄')
    })

    it('does not render regenerate button when onRegenerate not provided', () => {
      render(<AudioPlayer src="https://example.com/audio.mp3" />)

      const regenButton = screen.queryByTitle('Regenerate audio')
      expect(regenButton).toBeNull()
    })

    it('displays initial time as 0:00', () => {
      render(<AudioPlayer src="https://example.com/audio.mp3" />)

      const times = screen.getAllByText('0:00')
      expect(times.length).toBeGreaterThan(0)
    })
  })

  describe('Compact Mode', () => {
    it('renders in compact mode when compact prop is true', () => {
      const { container } = render(<AudioPlayer src="https://example.com/audio.mp3" compact />)

      // Compact mode should not have progress bar (bg-zinc-700 class)
      const progressBarContainer = container.querySelector('.bg-zinc-700')
      expect(progressBarContainer).toBeNull()

      // Should still have play button
      const playButton = container.querySelector('button')
      expect(playButton).toBeTruthy()
    })

    it('renders full mode with progress bar by default', () => {
      const { container } = render(<AudioPlayer src="https://example.com/audio.mp3" />)

      // Full mode should have progress bar
      const progressBarContainer = container.querySelector('.bg-zinc-700')
      expect(progressBarContainer).toBeTruthy()

      // Should have time displays
      expect(screen.getAllByText(/\d:\d{2}/).length).toBeGreaterThan(0)
    })

    it('renders smaller button in compact mode', () => {
      const { container: compactContainer } = render(
        <AudioPlayer src="https://example.com/audio.mp3" compact />
      )
      const { container: fullContainer } = render(<AudioPlayer src="https://example.com/audio.mp3" />)

      const compactButton = compactContainer.querySelector('button')
      const fullButton = fullContainer.querySelector('button')

      // Compact has w-8 h-8, full has w-10 h-10
      expect(compactButton?.className).toContain('w-8')
      expect(compactButton?.className).toContain('h-8')
      expect(fullButton?.className).toContain('w-10')
      expect(fullButton?.className).toContain('h-10')
    })
  })

  describe('Play/Pause Functionality', () => {
    it('calls play when play button clicked', () => {
      render(<AudioPlayer src="https://example.com/audio.mp3" />)

      const playButton = screen.getAllByRole('button')[0]
      fireEvent.click(playButton)

      expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled()
    })

    it('toggles button icon when clicked', () => {
      const { container } = render(<AudioPlayer src="https://example.com/audio.mp3" />)

      const button = container.querySelector('button')!

      // Initially shows play
      expect(button.textContent).toContain('▶️')

      // Click to toggle
      fireEvent.click(button)

      // Should show pause
      expect(button.textContent).toContain('⏸')

      // Click again
      fireEvent.click(button)

      // Should show play again
      expect(button.textContent).toContain('▶️')
    })

    it('calls pause when toggling from playing to paused', () => {
      render(<AudioPlayer src="https://example.com/audio.mp3" />)

      const button = screen.getAllByRole('button')[0]

      // Click to play
      fireEvent.click(button)

      // Click to pause
      fireEvent.click(button)

      expect(window.HTMLMediaElement.prototype.pause).toHaveBeenCalled()
    })
  })

  describe('Regenerate Button', () => {
    it('calls onRegenerate callback when clicked', () => {
      const handleRegenerate = vi.fn()
      render(<AudioPlayer src="https://example.com/audio.mp3" onRegenerate={handleRegenerate} />)

      const regenButton = screen.getByTitle('Regenerate audio')
      fireEvent.click(regenButton)

      expect(handleRegenerate).toHaveBeenCalledTimes(1)
    })

    it('renders in both compact and full modes', () => {
      const handleRegenerate = vi.fn()

      const { container: compactContainer } = render(
        <AudioPlayer src="https://example.com/audio.mp3" onRegenerate={handleRegenerate} compact />
      )
      const { container: fullContainer } = render(
        <AudioPlayer src="https://example.com/audio.mp3" onRegenerate={handleRegenerate} />
      )

      expect(compactContainer.querySelector('[title="Regenerate audio"]')).toBeTruthy()
      expect(fullContainer.querySelector('[title="Regenerate audio"]')).toBeTruthy()
    })

    it('does not interfere with play button', () => {
      const handleRegenerate = vi.fn()
      render(<AudioPlayer src="https://example.com/audio.mp3" onRegenerate={handleRegenerate} />)

      // Click play button (first button)
      const playButton = screen.getAllByRole('button')[0]
      fireEvent.click(playButton)

      expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled()
      expect(handleRegenerate).not.toHaveBeenCalled()
    })
  })

  describe('Progress Bar', () => {
    it('renders progress bar in full mode', () => {
      const { container } = render(<AudioPlayer src="https://example.com/audio.mp3" />)

      const progressBar = container.querySelector('.bg-emerald-500')
      expect(progressBar).toBeTruthy()
    })

    it('does not render progress bar in compact mode', () => {
      const { container } = render(<AudioPlayer src="https://example.com/audio.mp3" compact />)

      const progressBar = container.querySelector('.bg-emerald-500')
      expect(progressBar).toBeNull()
    })

    it('has correct styling classes', () => {
      const { container } = render(<AudioPlayer src="https://example.com/audio.mp3" />)

      const progressBar = container.querySelector('.bg-emerald-500') as HTMLElement
      expect(progressBar.className).toContain('bg-emerald-500')
      expect(progressBar.className).toContain('h-full')
    })
  })

  describe('Accessibility', () => {
    it('has descriptive title for regenerate button', () => {
      const handleRegenerate = vi.fn()
      render(<AudioPlayer src="https://example.com/audio.mp3" onRegenerate={handleRegenerate} />)

      const regenButton = screen.getByTitle('Regenerate audio')
      expect(regenButton).toBeTruthy()
    })

    it('uses semantic audio element', () => {
      const { container } = render(<AudioPlayer src="https://example.com/audio.mp3" />)

      const audio = container.querySelector('audio')
      expect(audio?.tagName).toBe('AUDIO')
    })

    it('preloads metadata for better UX', () => {
      const { container } = render(<AudioPlayer src="https://example.com/audio.mp3" />)

      const audio = container.querySelector('audio')
      expect(audio?.preload).toBe('metadata')
    })
  })

  describe('Styling', () => {
    it('applies correct background colors', () => {
      const { container } = render(<AudioPlayer src="https://example.com/audio.mp3" />)

      const playButton = container.querySelector('button')
      expect(playButton?.className).toContain('bg-emerald-600')
      expect(playButton?.className).toContain('hover:bg-emerald-500')
    })

    it('applies compact styling when in compact mode', () => {
      const { container } = render(<AudioPlayer src="https://example.com/audio.mp3" compact />)

      const playButton = container.querySelector('button')
      expect(playButton?.className).toContain('bg-zinc-800')
      expect(playButton?.className).toContain('hover:bg-zinc-700')
    })

    it('renders rounded buttons', () => {
      const { container } = render(<AudioPlayer src="https://example.com/audio.mp3" />)

      const button = container.querySelector('button')
      expect(button?.className).toContain('rounded-full')
    })
  })
})
