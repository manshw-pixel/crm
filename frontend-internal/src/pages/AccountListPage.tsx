import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAccounts } from '@/hooks/useAccounts'
import HealthBadge from '@/components/shared/HealthBadge'
import LoadingSpinner from '@/components/shared/LoadingSpinner'
import ErrorMessage from '@/components/shared/ErrorMessage'
import type { ChurnRiskTier } from '@/types/api'

const RISK_TIERS: { value: string; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'red', label: 'Red' },
  { value: 'yellow', label: 'Yellow' },
  { value: 'green', label: 'Green' },
]

export default function AccountListPage() {
  const navigate = useNavigate()
  const [riskTier, setRiskTier] = useState('')
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 25

  const { data, isLoading, error, refetch } = useAccounts({
    page,
    page_size: PAGE_SIZE,
    ...(riskTier ? { risk_tier: riskTier } : {}),
  })

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Accounts</h1>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Risk tier:</label>
          <select
            value={riskTier}
            onChange={(e) => { setRiskTier(e.target.value); setPage(1) }}
            className="text-sm border rounded px-2 py-1"
          >
            {RISK_TIERS.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
      </div>

      {isLoading && <LoadingSpinner />}
      {error && <ErrorMessage onRetry={() => refetch()} />}

      {data && (
        <>
          <div className="bg-white rounded-lg border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
                <tr>
                  {['Name', 'Tier', 'ARR', 'Health', 'Renewal Date', 'Last Updated'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.items.map((a) => (
                  <tr
                    key={a.id}
                    onClick={() => navigate(`/accounts/${a.id}`)}
                    className="hover:bg-gray-50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-primary">{a.name}</td>
                    <td className="px-4 py-3 text-gray-600 capitalize">{a.tier.replace('_', '-')}</td>
                    <td className="px-4 py-3 text-gray-600">
                      {a.arr ? `$${(a.arr / 1000).toFixed(0)}k` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <HealthBadge tier={a.churn_risk_tier as ChurnRiskTier} />
                    </td>
                    <td className="px-4 py-3 text-gray-600">{a.renewal_date ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-400">
                      {new Date(a.updated_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between text-sm text-gray-600">
            <span>{data.total} accounts</span>
            <div className="flex gap-2">
              <button
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
                className="px-3 py-1 border rounded disabled:opacity-40 hover:bg-gray-50"
              >
                Previous
              </button>
              <span className="px-3 py-1">Page {page} of {totalPages}</span>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1 border rounded disabled:opacity-40 hover:bg-gray-50"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
