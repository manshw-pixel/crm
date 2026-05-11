import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect } from 'vitest'
import AccountListPage from '@/pages/AccountListPage'

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/accounts']}>
        <Routes>
          <Route path="/accounts" element={<AccountListPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('AccountListPage', () => {
  it('shows account name from API', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Acme Corp')).toBeInTheDocument())
  })

  it('shows health badge', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Green')).toBeInTheDocument())
  })

  it('shows tier', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText(/enterprise/i)).toBeInTheDocument())
  })
})
