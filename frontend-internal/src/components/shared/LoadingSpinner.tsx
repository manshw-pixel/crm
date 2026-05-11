export default function LoadingSpinner({ message = 'Loading…' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-gray-400">
      <div className="w-8 h-8 border-2 border-gray-200 border-t-primary rounded-full animate-spin mb-3" />
      <p className="text-sm">{message}</p>
    </div>
  )
}
