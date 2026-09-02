/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Share } from '../types'
import { ShareBand } from './ShareBand'

// Exposure is a condition, not a task: this band is the only thing standing
// between a developer and forgetting their mocks are reachable from the
// internet. Its two jobs are to be unmissable and to not leak the token.

afterEach(cleanup)

function aShare(overrides: Partial<Share> = {}): Share {
  return {
    url: 'https://calm-fox.trycloudflare.com',
    token: 'sekret-token',
    exposed: 'Only the mocks are shared. The panel stays on your machine.',
    ...overrides,
  }
}

describe('ShareBand', () => {
  it('announces the exposure and the guarantee that bounds it', () => {
    render(<ShareBand share={aShare()} />)

    expect(screen.getByText('EXPOSED TO THE INTERNET')).toBeTruthy()
    expect(screen.getByText(/Only the mocks are shared/)).toBeTruthy()
    expect(screen.getByRole('status')).toBeTruthy()
  })

  // Screenshots and screen shares are exactly when this band is on display.
  // The token must not be in the document until someone asks for it.
  it('masks the token until it is revealed', () => {
    render(<ShareBand share={aShare()} />)

    expect(document.body.textContent).not.toContain('sekret-token')
    expect(screen.getByText('•'.repeat('sekret-token'.length))).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Reveal token' }))

    expect(screen.getByText('sekret-token')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Hide token' })).toBeTruthy()
  })

  it('hides the token again on a second click', () => {
    render(<ShareBand share={aShare()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Reveal token' }))
    fireEvent.click(screen.getByRole('button', { name: 'Hide token' }))

    expect(document.body.textContent).not.toContain('sekret-token')
  })

  // --public means no token at all. That is a bigger deal than a hidden
  // token, so it gets words rather than a subtler affordance.
  it('warns in plain words when there is no token at all', () => {
    render(<ShareBand share={aShare({ token: null })} />)

    expect(screen.getByText(/anyone with this URL can read your mocks/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /token/i })).toBeNull()
  })

  it('says the tunnel is still coming up before there is a URL', () => {
    render(<ShareBand share={aShare({ url: null })} />)

    expect(screen.getByText(/opening the tunnel/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Copy URL' })).toBeNull()
  })

  it('offers the URL and a ready-to-paste curl once the tunnel is up', () => {
    render(<ShareBand share={aShare()} />)

    expect(screen.getByRole('button', { name: 'Copy URL' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy curl' })).toBeTruthy()
  })
})
