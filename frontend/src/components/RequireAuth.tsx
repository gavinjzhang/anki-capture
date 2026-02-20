import { useAuth, SignInButton } from '@clerk/clerk-react'
import type { ReactNode } from 'react'

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
    return (
      <div className="flex flex-col items-center justify-center h-64 space-y-4">
        <p className="text-zinc-400 text-lg">Sign in to continue</p>
        <SignInButton mode="modal">
          <button className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg transition-colors">
            Sign In
          </button>
        </SignInButton>
      </div>
    )
  }

  return <>{children}</>
}
