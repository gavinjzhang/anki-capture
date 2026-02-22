import { useAuth, SignInButton, SignUpButton } from '@clerk/clerk-react'
import type { ReactNode } from 'react'

function WelcomePage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] text-center px-4">
      <h1 className="text-4xl sm:text-5xl font-bold mb-4">
        <span className="text-emerald-400">anki</span>
        <span className="text-zinc-500">/</span>
        <span className="text-zinc-100">capture</span>
      </h1>
      <p className="text-xl text-zinc-400 mb-2 max-w-lg">
        Turn photos, audio, and text into Anki flashcards with AI.
      </p>
      <p className="text-zinc-500 mb-8 max-w-md">
        Upload a photo of foreign text, paste a phrase, or record audio.
        Get instant transliteration, translation, grammar notes, vocabulary breakdown, and TTS audio — ready to export to Anki.
      </p>

      <div className="flex flex-col sm:flex-row gap-3 mb-12">
        <SignUpButton mode="modal">
          <button className="px-8 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg transition-colors text-lg">
            Get Started
          </button>
        </SignUpButton>
        <SignInButton mode="modal">
          <button className="px-8 py-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium rounded-lg border border-zinc-700 transition-colors text-lg">
            Sign In
          </button>
        </SignInButton>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-2xl w-full">
        {[
          { title: 'Upload', desc: 'Photos, audio, or text in any supported language' },
          { title: 'AI Processing', desc: 'OCR, transcription, translation, grammar analysis, and TTS' },
          { title: 'Export to Anki', desc: 'Review, edit, and export as tab-separated flashcards' },
        ].map(({ title, desc }) => (
          <div key={title} className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 text-left">
            <h3 className="text-zinc-200 font-medium mb-1">{title}</h3>
            <p className="text-zinc-500 text-sm">{desc}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function RequireAuth({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth()

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-zinc-500">Loading...</div>
      </div>
    )
  }

  if (!isSignedIn) {
    return <WelcomePage />
  }

  return <>{children}</>
}
