import { AlertCircle } from 'lucide-react'

export default function ErrorMessage({
  message = 'Something went wrong.',
  onRetry,
}: {
  message?: string
  onRetry?: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-red-600">
      <AlertCircle size={32} className="mb-2" />
      <p className="text-sm mb-3">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="text-xs underline hover:no-underline"
        >
          Try again
        </button>
      )}
    </div>
  )
}
