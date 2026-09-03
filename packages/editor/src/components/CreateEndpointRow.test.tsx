/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CreateEndpointRow } from './CreateEndpointRow'

// This row writes into the user's repository. A malformed submission does
// not bounce off a validation layer somewhere else — it becomes a mock file,
// so the guard has to hold here, before onCreate is ever called.

afterEach(cleanup)

function renderRow(props: Partial<Parameters<typeof CreateEndpointRow>[0]> = {}) {
  const onCreate = vi.fn()
  const onCreateFromModel = vi.fn()
  const onCancel = vi.fn()
  render(
    <CreateEndpointRow
      error={null}
      onCreate={onCreate}
      onCreateFromModel={onCreateFromModel}
      onCancel={onCancel}
      {...props}
    />,
  )
  return {
    onCreate,
    onCreateFromModel,
    onCancel,
    path: screen.getByLabelText('path'),
    create: screen.getByRole('button', { name: 'Create' }),
  }
}

describe('CreateEndpointRow', () => {
  it('refuses to submit until the path looks like a path', () => {
    const { path, create, onCreate } = renderRow()

    expect(create.hasAttribute('disabled')).toBe(true)

    fireEvent.change(path, { target: { value: 'todos' } })
    expect(create.hasAttribute('disabled')).toBe(true)

    fireEvent.change(path, { target: { value: '/todos' } })
    expect(create.hasAttribute('disabled')).toBe(false)

    expect(onCreate).not.toHaveBeenCalled()
  })

  it('refuses a blank response name', () => {
    const { path, create } = renderRow()

    fireEvent.change(path, { target: { value: '/todos' } })
    fireEvent.change(screen.getByLabelText('response name'), { target: { value: '   ' } })

    expect(create.hasAttribute('disabled')).toBe(true)
  })

  it('submits trimmed values and a numeric status', () => {
    const { path, create, onCreate } = renderRow()

    fireEvent.change(path, { target: { value: '  /orders/:id  ' } })
    fireEvent.change(screen.getByLabelText('response name'), { target: { value: ' missing ' } })
    fireEvent.change(screen.getByLabelText('status'), { target: { value: '404' } })
    fireEvent.click(screen.getByRole('button', { name: 'POST' }))
    fireEvent.click(create)

    expect(onCreate).toHaveBeenCalledWith({
      method: 'POST',
      path: '/orders/:id',
      responseName: 'missing',
      status: 404,
    })
  })

  // A status field that has been cleared, or typed into badly, must not
  // become NaN in a mock file.
  it('falls back to 200 when the status is not a number', () => {
    const { path, create, onCreate } = renderRow()

    fireEvent.change(path, { target: { value: '/todos' } })
    fireEvent.change(screen.getByLabelText('status'), { target: { value: '' } })
    fireEvent.click(create)

    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ status: 200 }))
  })

  it('switches to the model flow and needs a model before it will submit', () => {
    const { path, onCreateFromModel } = renderRow()

    fireEvent.change(path, { target: { value: '/todos' } })
    fireEvent.click(screen.getByRole('button', { name: 'from a model' }))

    const create = screen.getByRole('button', { name: 'Create' })
    expect(create.hasAttribute('disabled')).toBe(true)

    fireEvent.change(screen.getByLabelText('model'), {
      target: { value: 'interface Todo { id: number }' },
    })
    fireEvent.click(create)

    expect(onCreateFromModel).toHaveBeenCalledWith({
      method: 'GET',
      path: '/todos',
      model: 'interface Todo { id: number }',
    })
  })

  it('submits on Enter from an input', () => {
    const { path, onCreate } = renderRow()

    fireEvent.change(path, { target: { value: '/todos' } })
    fireEvent.keyDown(path, { key: 'Enter' })

    expect(onCreate).toHaveBeenCalledOnce()
  })

  // A model is multi-line by nature; Enter there is a newline, not a submit.
  it('does not submit on Enter inside the model textarea', () => {
    const { path, onCreateFromModel } = renderRow()

    fireEvent.change(path, { target: { value: '/todos' } })
    fireEvent.click(screen.getByRole('button', { name: 'from a model' }))
    const model = screen.getByLabelText('model')
    fireEvent.change(model, { target: { value: 'interface Todo { id: number }' } })
    fireEvent.keyDown(model, { key: 'Enter' })

    expect(onCreateFromModel).not.toHaveBeenCalled()
  })

  it('cancels on Escape', () => {
    const { path, onCancel } = renderRow()

    fireEvent.keyDown(path, { key: 'Escape' })

    expect(onCancel).toHaveBeenCalledOnce()
  })

  // The failure belongs where the action was taken, not in a toast that
  // outlives the row.
  it('shows a rejection from the server inline', () => {
    renderRow({ error: 'GET /todos already exists' })

    expect(screen.getByText('GET /todos already exists')).toBeTruthy()
  })
})

describe('the status field', () => {
  it('offers the named codes and still submits an unlisted one', () => {
    const { onCreate } = renderRow()
    fireEvent.change(screen.getByLabelText('path'), { target: { value: '/orders' } })

    const status = screen.getByLabelText('status')
    fireEvent.focus(status)
    fireEvent.change(status, { target: { value: 'not found' } })
    fireEvent.mouseDown(screen.getByRole('option', { name: /404 Not Found/ }))

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ status: 404 }))
  })

  it('submits a code that is not in the catalogue', () => {
    const { onCreate } = renderRow()
    fireEvent.change(screen.getByLabelText('path'), { target: { value: '/orders' } })
    fireEvent.change(screen.getByLabelText('status'), { target: { value: '599' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ status: 599 }))
  })
})
