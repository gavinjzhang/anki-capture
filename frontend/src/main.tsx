import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import { ClerkProvider, SignedIn, SignedOut, SignInButton, UserButton, useAuth } from '@clerk/clerk-react'
import { setAuthTokenProvider } from './lib/auth'
import UploadPage from './pages/Upload'
import GeneratePage from './pages/Generate'
import ReviewPage from './pages/Review'
import LibraryPage from './pages/Library'
import ExportPage from './pages/Export'
import ProcessingStatus from './components/ProcessingStatus'
import { ToastProvider } from './components/Toast'
import './index.css'

function AuthWire() {
  const auth = useAuth()
  const authRef = React.useRef(auth)

  // Keep ref updated with latest auth state
  React.useEffect(() => {
    authRef.current = auth
  })

  // Set up token provider ONCE on mount
  // Provider reads from ref to get current auth state (avoiding stale closures)
  React.useEffect(() => {
    setAuthTokenProvider(async () => {
      const current = authRef.current
      if (!current.isLoaded) return null
      if (!current.isSignedIn) return null
      try {
        return await current.getToken()
      } catch {
        return null
      }
    })
  }, []) // Empty deps - only set provider once

  return null
}

function App() {
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false)

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-zinc-950 text-zinc-100 w-full overflow-x-hidden">
        <nav className="border-b border-zinc-800 bg-zinc-900/50 backdrop-blur sticky top-0 z-50 w-full">
          <div className="max-w-6xl mx-auto px-4 w-full">
            <div className="flex items-center justify-between h-14">
              <div className="font-semibold text-lg tracking-tight shrink-0">
                <span className="text-emerald-400">anki</span>
                <span className="text-zinc-500">/</span>
                <span>capture</span>
              </div>

              {/* Desktop Navigation */}
              <div className="hidden md:flex items-center gap-2">
                {[
                  { to: '/', label: 'Upload' },
                  { to: '/generate', label: 'Generate' },
                  { to: '/review', label: 'Review' },
                  { to: '/library', label: 'Library' },
                  { to: '/export', label: 'Export' },
                ].map(({ to, label }) => (
                  <NavLink
                    key={to}
                    to={to}
                    className={({ isActive }) =>
                      `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                        isActive
                          ? 'bg-zinc-800 text-zinc-100'
                          : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
                      }`
                    }
                  >
                    {label}
                  </NavLink>
                ))}
                <SignedIn>
                  <UserButton afterSignOutUrl="/" />
                </SignedIn>
                <SignedOut>
                  <SignInButton />
                </SignedOut>
              </div>

              {/* Mobile Menu Button */}
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="md:hidden p-2 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 transition-colors"
                aria-label="Toggle menu"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {mobileMenuOpen ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  )}
                </svg>
              </button>
            </div>
          </div>
        </nav>

        {/* Mobile Menu Overlay */}
        {mobileMenuOpen && (
          <div
            className="fixed inset-0 bg-black/50 z-40 md:hidden"
            onClick={() => setMobileMenuOpen(false)}
          />
        )}

        {/* Mobile Menu Drawer */}
        <div
          className={`fixed top-0 right-0 h-full w-64 bg-zinc-900 border-l border-zinc-800 z-50 transform transition-transform duration-300 ease-in-out md:hidden ${
            mobileMenuOpen ? 'translate-x-0' : 'translate-x-full'
          }`}
        >
          <div className="flex flex-col h-full">
            <div className="flex items-center justify-between p-4 border-b border-zinc-800">
              <div className="font-semibold text-lg">
                <span className="text-emerald-400">anki</span>
                <span className="text-zinc-500">/</span>
                <span>capture</span>
              </div>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="p-2 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto py-4">
              {[
                { to: '/', label: 'Upload' },
                { to: '/generate', label: 'Generate' },
                { to: '/review', label: 'Review' },
                { to: '/library', label: 'Library' },
                { to: '/export', label: 'Export' },
              ].map(({ to, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  onClick={() => setMobileMenuOpen(false)}
                  className={({ isActive }) =>
                    `block px-4 py-3 text-base font-medium transition-colors ${
                      isActive
                        ? 'bg-zinc-800 text-zinc-100 border-l-2 border-emerald-400'
                        : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
                    }`
                  }
                >
                  {label}
                </NavLink>
              ))}
            </nav>

            <div className="p-4 border-t border-zinc-800">
              <SignedIn>
                <UserButton afterSignOutUrl="/" />
              </SignedIn>
              <SignedOut>
                <SignInButton />
              </SignedOut>
            </div>
          </div>
        </div>

        <main className="max-w-6xl mx-auto px-4 py-8 w-full overflow-x-hidden">
          <Routes>
            <Route path="/" element={<UploadPage />} />
            <Route path="/generate" element={<GeneratePage />} />
            <Route path="/review" element={<ReviewPage />} />
            <Route path="/library" element={<LibraryPage />} />
            <Route path="/export" element={<ExportPage />} />
          </Routes>
        </main>
        <AuthWire />
        <ProcessingStatus />
      </div>
    </BrowserRouter>
  )
}

const clerkPublishableKey = (import.meta as any).env?.VITE_CLERK_PUBLISHABLE_KEY;

// Log for debugging (will show in CI)
if (!clerkPublishableKey) {
  console.error('❌ VITE_CLERK_PUBLISHABLE_KEY is not set!');
  console.error('Available env vars:', Object.keys((import.meta as any).env || {}));
} else {
  console.log('✅ Clerk key found:', clerkPublishableKey.substring(0, 10) + '...');
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ClerkProvider publishableKey={clerkPublishableKey || ''}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </ClerkProvider>
  </React.StrictMode>,
)
