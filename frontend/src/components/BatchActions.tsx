import { Phrase } from '../lib/api'

interface BatchActionsProps {
  phrases: Phrase[]
  selectedIds: Set<string>
  onSelectAll: () => void
  onClearSelection: () => void
  onBatchApprove: () => Promise<void>
  onBatchDelete: () => Promise<void>
  loading: boolean
}

export default function BatchActions({
  phrases,
  selectedIds,
  onSelectAll,
  onClearSelection,
  onBatchApprove,
  onBatchDelete,
  loading,
}: BatchActionsProps) {
  if (phrases.length === 0) return null

  const allSelected = selectedIds.size === phrases.length
  const someSelected = selectedIds.size > 0

  return (
    <div className="flex items-center justify-between px-4 py-3 bg-zinc-800/50 rounded-lg">
      <div className="flex items-center gap-4">
        <button
          onClick={allSelected ? onClearSelection : onSelectAll}
          className="flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          <span className={`w-4 h-4 rounded border flex items-center justify-center ${
            allSelected ? 'bg-emerald-500 border-emerald-500' : 
            someSelected ? 'bg-emerald-500/50 border-emerald-500' : 
            'border-zinc-600'
          }`}>
            {(allSelected || someSelected) && <span className="text-white text-xs">✓</span>}
          </span>
          {allSelected ? 'Deselect all' : 'Select all'}
        </button>
        
        {someSelected && (
          <span className="text-sm text-zinc-500">
            {selectedIds.size} selected
          </span>
        )}
      </div>

      {someSelected && (
        <div className="flex items-center gap-2">
          <button
            onClick={onBatchApprove}
            disabled={loading}
            className="px-4 py-1.5 text-sm bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-lg transition-colors"
          >
            {loading ? 'Processing...' : `Approve ${selectedIds.size}`}
          </button>
          <button
            onClick={onBatchDelete}
            disabled={loading}
            className="px-4 py-1.5 text-sm text-red-400 hover:bg-red-500/20 rounded-lg transition-colors"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  )
}
