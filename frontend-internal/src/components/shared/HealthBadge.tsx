import type { ChurnRiskTier } from '@/types/api'

const config: Record<ChurnRiskTier, { label: string; className: string }> = {
  green: { label: 'Green', className: 'bg-green-100 text-green-800' },
  yellow: { label: 'Yellow', className: 'bg-yellow-100 text-yellow-800' },
  red: { label: 'Red', className: 'bg-red-100 text-red-800' },
}

export default function HealthBadge({ tier }: { tier: ChurnRiskTier }) {
  const { label, className } = config[tier]
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${className}`}>
      {label}
    </span>
  )
}
