import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import HealthBadge from '@/components/shared/HealthBadge'

describe('HealthBadge', () => {
  it('renders green label', () => {
    render(<HealthBadge tier="green" />)
    expect(screen.getByText('Green')).toBeInTheDocument()
  })

  it('renders yellow label', () => {
    render(<HealthBadge tier="yellow" />)
    expect(screen.getByText('Yellow')).toBeInTheDocument()
  })

  it('renders red label', () => {
    render(<HealthBadge tier="red" />)
    expect(screen.getByText('Red')).toBeInTheDocument()
  })

  it('applies green color class', () => {
    const { container } = render(<HealthBadge tier="green" />)
    expect(container.firstChild).toHaveClass('bg-green-100')
  })

  it('applies red color class', () => {
    const { container } = render(<HealthBadge tier="red" />)
    expect(container.firstChild).toHaveClass('bg-red-100')
  })
})
