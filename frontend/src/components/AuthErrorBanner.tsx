import { useAuth, SignInButton } from '@clerk/clerk-react'

export default function AuthErrorBanner() {
  const { isSignedIn } = useAuth()

  return (
    <div className="px-4 py-3 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-center justify-between">
      <span className="text-amber-300 text-sm">
        Session expired — sign in again to continue.
      </span>
      {isSignedIn ? (
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          Reload
        </button>
      ) : (
        <SignInButton mode="modal">
          <button className="px-4 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium rounded-lg transition-colors">
            Sign In
          </button>
        </SignInButton>
      )}
    </div>
  )
}
