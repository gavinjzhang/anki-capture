import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import UploadPage from './pages/Upload'
import ReviewPage from './pages/Review'
import LibraryPage from './pages/Library'
import ExportPage from './pages/Export'
import ProcessingStatus from './components/ProcessingStatus'
import './index.css'

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-zinc-950 text-zinc-100">
        <nav className="border-b border-zinc-800 bg-zinc-900/50 backdrop-blur sticky top-0 z-50">
          <div className="max-w-6xl mx-auto px-4">
            <div className="flex items-center justify-between h-14">
              <div className="font-semibold text-lg tracking-tight">
                <span className="text-emerald-400">anki</span>
                <span className="text-zinc-500">/</span>
                <span>capture</span>
              </div>
              <div className="flex gap-1">
                {[
                  { to: '/', label: 'Upload' },
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
              </div>
            </div>
          </div>
        </nav>
        <main className="max-w-6xl mx-auto px-4 py-8">
          <Routes>
            <Route path="/" element={<UploadPage />} />
            <Route path="/review" element={<ReviewPage />} />
            <Route path="/library" element={<LibraryPage />} />
            <Route path="/export" element={<ExportPage />} />
          </Routes>
        </main>
        <ProcessingStatus />
      </div>
    </BrowserRouter>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
