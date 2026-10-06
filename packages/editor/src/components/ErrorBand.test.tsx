/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ErrorBand } from './ErrorBand'

afterEach(cleanup)

// A number JavaScript cannot carry is not a broken file: the endpoint is
// served. The band has to say that, and say why saving will be refused,
// or the reader goes looking for a syntax error that is not there.
describe('ErrorBand', () => {
  it('says a file with a lossy number is still served, and why edits are refused', () => {
    render(
      <ErrorBand
        errors={[
          {
            kind: 'lossy-number',
            file: 'laqi/api.json',
            line: 2,
            col: 9,
            message: '1234567890123456789 cannot be held exactly by JavaScript',
          },
        ]}
        onReload={() => {}}
      />,
    )

    expect(screen.getByText(/still served, with the number JavaScript kept/)).toBeTruthy()
    expect(screen.getByText(/Edits to this file are refused/)).toBeTruthy()
    expect(screen.queryByText(/failed to load/)).toBeNull()
  })

  it('keeps the broken-file wording for a file that did not load', () => {
    render(
      <ErrorBand
        errors={[
          { file: 'laqi/a.json', message: 'Unexpected token' },
          { file: 'laqi/b.json', message: 'Unexpected token' },
        ]}
        onReload={() => {}}
      />,
    )

    expect(screen.getByText('The rest of the mocks are still being served.')).toBeTruthy()
    expect(screen.getByText(/and 1 more problem in the mock files/)).toBeTruthy()
  })
})
