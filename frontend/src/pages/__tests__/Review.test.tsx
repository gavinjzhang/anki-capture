import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useAuth } from '@clerk/clerk-react'
import Review from '../Review'
import * as api from '../../lib/api'
import type { Phrase } from '../../lib/api'

/**
 * Review Page Integration Tests
 *
 * Tests the review workflow including:
 * - Loading pending phrases
 * - Editing fields
 * - Saving changes
 * - Approve workflow
 * - Delete functionality
 * - Regenerate audio
 * - Retry failed jobs
 * - Batch operations
 * - Empty/error states
 */

// Mock dependencies
vi.mock('@clerk/clerk-react')
vi.mock('../../lib/api')
vi.mock('../../lib/useAdaptivePolling', () => ({
  useAdaptivePolling: ({ onPoll, enabled }: any) => {
    // Call onPoll immediately if enabled
    if (enabled) {
      setTimeout(onPoll, 0)
    }
    return { pollNow: vi.fn(onPoll) }
  },
}))
vi.mock('../../components/Toast', () => ({
  useToast: () => ({
    showToast: vi.fn(),
  }),
}))

const mockPhrase: Phrase = {
  id: 'phrase-123',
  source_text: 'Привет, как дела?',
  transliteration: 'Privet, kak dela?',
  translation: 'Hello, how are you?',
  grammar_notes: 'Informal greeting',
  vocab_breakdown: [
    {
      word: 'Привет',
      root: null,
      meaning: 'Hello',
      gender: null,
      declension: null,
      notes: 'Informal',
    },
  ],
  detected_language: 'ru',
  language_confidence: 0.99,
  source_type: 'text',
  audio_url: 'user-123/audio/phrase-123.mp3',
  original_file_url: null,
  status: 'pending_review',
  exclude_from_export: false,
  job_started_at: null,
  job_attempts: 0,
  last_error: null,
  current_job_id: null,
  created_at: Date.now(),
  reviewed_at: null,
  exported_at: null,
  user_id: 'user-123',
}

describe('Review Page', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue({ isLoaded: true } as any)
    vi.mocked(api.listPhrases).mockResolvedValue({ phrases: [] })
    vi.mocked(api.updatePhrase).mockResolvedValue({ phrase: mockPhrase })
    vi.mocked(api.approvePhrase).mockResolvedValue(undefined as any)
    vi.mocked(api.deletePhrase).mockResolvedValue(undefined as any)
    vi.mocked(api.regenerateAudio).mockResolvedValue(undefined as any)
    vi.mocked(api.retryPhrase).mockResolvedValue(undefined as any)
    vi.mocked(api.getFileUrl).mockImplementation((path) => `/api/files/${path}`)

    // Mock window.confirm
    window.confirm = vi.fn(() => true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Loading and Empty States', () => {
    it('shows loading state initially', () => {
      render(<Review />)
      expect(screen.getByText('Loading...')).toBeTruthy()
    })

    it('shows empty state when no phrases', async () => {
      vi.mocked(api.listPhrases).mockResolvedValue({ phrases: [] })

      render(<Review />)

      await waitFor(() => {
        expect(screen.getByText(/No phrases to review/i)).toBeTruthy()
        expect(screen.getByText(/Upload something/i)).toBeTruthy()
      })
    })

    it('displays phrase count', async () => {
      vi.mocked(api.listPhrases).mockResolvedValue({ phrases: [mockPhrase, { ...mockPhrase, id: 'phrase-456' }] })

      render(<Review />)

      await waitFor(() => {
        expect(screen.getByText('2 phrases pending review')).toBeTruthy()
      })
    })

    it('shows error state on load failure', async () => {
      vi.mocked(api.listPhrases).mockRejectedValue(new Error('Network error'))

      render(<Review />)

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeTruthy()
      })
    })
  })

  describe('Phrase Display', () => {
    beforeEach(() => {
      vi.mocked(api.listPhrases).mockResolvedValue({ phrases: [mockPhrase] })
    })

    it('displays phrase details', async () => {
      render(<Review />)

      await waitFor(() => {
        expect(screen.getByDisplayValue('Привет, как дела?')).toBeTruthy()
        expect(screen.getByDisplayValue('Privet, kak dela?')).toBeTruthy()
        expect(screen.getByDisplayValue('Hello, how are you?')).toBeTruthy()
        expect(screen.getByDisplayValue('Informal greeting')).toBeTruthy()
      })
    })

    it('displays status badge', async () => {
      render(<Review />)

      await waitFor(() => {
        expect(screen.getByText('pending review')).toBeTruthy()
      })
    })

    it('displays language flag for Russian', async () => {
      render(<Review />)

      await waitFor(() => {
        expect(screen.getByText('🇷🇺')).toBeTruthy()
      })
    })

    it('displays phrase ID', async () => {
      render(<Review />)

      await waitFor(() => {
        expect(screen.getByText('phrase-1')).toBeTruthy() // First 8 chars: phrase-1
      })
    })

    it('displays vocab breakdown table', async () => {
      render(<Review />)

      await waitFor(() => {
        expect(screen.getByDisplayValue('Привет')).toBeTruthy()
        expect(screen.getByDisplayValue('Hello')).toBeTruthy()
      })
    })

    it('displays audio player when audio exists', async () => {
      render(<Review />)

      await waitFor(() => {
        const audio = document.querySelector('audio')
        expect(audio).toBeTruthy()
        expect(audio?.src).toContain('phrase-123.mp3')
      })
    })
  })

  describe('Edit Functionality', () => {
    beforeEach(() => {
      vi.mocked(api.listPhrases).mockResolvedValue({ phrases: [mockPhrase] })
    })

    it('shows unsaved indicator when field is edited', async () => {
      render(<Review />)

      await waitFor(() => screen.getByDisplayValue('Hello, how are you?'))

      const translationInput = screen.getByDisplayValue('Hello, how are you?')
      fireEvent.change(translationInput, { target: { value: 'Hi, how are you?' } })

      await waitFor(() => {
        expect(screen.getByText('Unsaved')).toBeTruthy()
      })
    })

    it('shows save button when changes are made', async () => {
      render(<Review />)

      await waitFor(() => screen.getByDisplayValue('Hello, how are you?'))

      const translationInput = screen.getByDisplayValue('Hello, how are you?')
      fireEvent.change(translationInput, { target: { value: 'Updated translation' } })

      await waitFor(() => {
        expect(screen.getByText('Save')).toBeTruthy()
      })
    })

    it('saves changes when save button clicked', async () => {
      render(<Review />)

      await waitFor(() => screen.getByDisplayValue('Hello, how are you?'))

      const translationInput = screen.getByDisplayValue('Hello, how are you?')
      fireEvent.change(translationInput, { target: { value: 'Updated' } })

      const saveButton = await screen.findByText('Save')
      fireEvent.click(saveButton)

      await waitFor(() => {
        expect(api.updatePhrase).toHaveBeenCalledWith('phrase-123', expect.objectContaining({
          translation: 'Updated',
        }))
      })
    })

    it('shows saving state while saving', async () => {
      let resolveSave: any
      vi.mocked(api.updatePhrase).mockReturnValue(new Promise(resolve => { resolveSave = resolve }))

      render(<Review />)

      await waitFor(() => screen.getByDisplayValue('Hello, how are you?'))

      const translationInput = screen.getByDisplayValue('Hello, how are you?')
      fireEvent.change(translationInput, { target: { value: 'Updated' } })

      const saveButton = await screen.findByText('Save')
      fireEvent.click(saveButton)

      await waitFor(() => {
        expect(screen.getByText('Saving...')).toBeTruthy()
      })

      resolveSave({ phrase: mockPhrase })
    })

    it('pauses auto-refresh while editing', async () => {
      render(<Review />)

      await waitFor(() => screen.getByDisplayValue('Hello, how are you?'))

      const translationInput = screen.getByDisplayValue('Hello, how are you?')
      fireEvent.change(translationInput, { target: { value: 'Updated' } })

      await waitFor(() => {
        expect(screen.getByText(/Auto-refresh paused while editing/i)).toBeTruthy()
      })
    })
  })

  describe('Approve Workflow', () => {
    beforeEach(() => {
      vi.mocked(api.listPhrases).mockResolvedValue({ phrases: [mockPhrase] })
    })

    it('shows approve button for pending review phrases', async () => {
      render(<Review />)

      await waitFor(() => {
        expect(screen.getByText('Approve')).toBeTruthy()
      })
    })

    it('hides approve button when there are unsaved changes', async () => {
      render(<Review />)

      await waitFor(() => screen.getByDisplayValue('Hello, how are you?'))

      // Edit field
      const translationInput = screen.getByDisplayValue('Hello, how are you?')
      fireEvent.change(translationInput, { target: { value: 'Updated' } })

      await waitFor(() => {
        // Approve button should be replaced by Save button
        expect(screen.queryByText('Approve')).toBeNull()
        expect(screen.getByText('Save')).toBeTruthy()
      })
    })

    it('calls approve API when approve clicked', async () => {
      render(<Review />)

      await waitFor(() => screen.getByText('Approve'))

      const approveButton = screen.getByText('Approve')
      fireEvent.click(approveButton)

      await waitFor(() => {
        expect(api.approvePhrase).toHaveBeenCalledWith('phrase-123')
      })
    })
  })

  describe('Delete Functionality', () => {
    beforeEach(() => {
      vi.mocked(api.listPhrases).mockResolvedValue({ phrases: [mockPhrase] })
    })

    it('shows delete button', async () => {
      render(<Review />)

      await waitFor(() => {
        expect(screen.getByText('Delete')).toBeTruthy()
      })
    })

    it('prompts for confirmation before deleting', async () => {
      render(<Review />)

      await waitFor(() => screen.getByText('Delete'))

      const deleteButton = screen.getByText('Delete')
      fireEvent.click(deleteButton)

      expect(window.confirm).toHaveBeenCalledWith('Delete this phrase?')
    })

    it('does not delete if confirmation is cancelled', async () => {
      window.confirm = vi.fn(() => false)

      render(<Review />)

      await waitFor(() => screen.getByText('Delete'))

      const deleteButton = screen.getByText('Delete')
      fireEvent.click(deleteButton)

      expect(api.deletePhrase).not.toHaveBeenCalled()
    })

    it('calls delete API when confirmed', async () => {
      render(<Review />)

      await waitFor(() => screen.getByText('Delete'))

      const deleteButton = screen.getByText('Delete')
      fireEvent.click(deleteButton)

      await waitFor(() => {
        expect(api.deletePhrase).toHaveBeenCalledWith('phrase-123')
      })
    })
  })

  describe('Retry Functionality', () => {
    beforeEach(() => {
      const failedPhrase = { ...mockPhrase, last_error: 'Processing failed', status: 'processing' as const }
      vi.mocked(api.listPhrases).mockResolvedValue({ phrases: [failedPhrase] })
    })

    it('shows retry button for failed phrases', async () => {
      render(<Review />)

      await waitFor(() => {
        expect(screen.getByText('Retry')).toBeTruthy()
      })
    })

    it('shows error message', async () => {
      render(<Review />)

      await waitFor(() => {
        expect(screen.getByText(/Error: Processing failed/i)).toBeTruthy()
      })
    })

    it('calls retry API when clicked', async () => {
      render(<Review />)

      await waitFor(() => screen.getByText('Retry'))

      const retryButton = screen.getByText('Retry')
      fireEvent.click(retryButton)

      await waitFor(() => {
        expect(api.retryPhrase).toHaveBeenCalledWith('phrase-123')
      })
    })

    it('shows retrying state', async () => {
      let resolveRetry: any
      vi.mocked(api.retryPhrase).mockReturnValue(new Promise(resolve => { resolveRetry = resolve }))

      render(<Review />)

      await waitFor(() => screen.getByText('Retry'))

      const retryButton = screen.getByText('Retry')
      fireEvent.click(retryButton)

      await waitFor(() => {
        expect(screen.getByText('Retrying...')).toBeTruthy()
      })

      resolveRetry(undefined)
    })
  })

  describe('Regenerate Audio', () => {
    beforeEach(() => {
      vi.mocked(api.listPhrases).mockResolvedValue({ phrases: [mockPhrase] })
    })

    it('shows regenerate button', async () => {
      render(<Review />)

      await waitFor(() => {
        const regenButton = screen.getByRole('img', { name: /regenerate/i })
        expect(regenButton).toBeTruthy()
      })
    })
  })



})
