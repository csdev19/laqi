/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { exampleBody, exampleModel } from '@laqi/generate/examples'
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
  // Create stays clickable whatever the form holds. A disabled button
  // states that something is wrong without ever saying what, and a path
  // typed without its slash is the easiest way to meet one: the button
  // greys out and nothing on screen explains it.
  it('says what is wrong instead of disabling the button', () => {
    const { create, onCreate } = renderRow()

    expect(create.hasAttribute('disabled')).toBe(false)

    fireEvent.click(create)
    expect(screen.getByRole('alert').textContent).toContain('path')
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('suggests the path the developer meant when the slash is missing', () => {
    const { path, create, onCreate } = renderRow()

    fireEvent.change(path, { target: { value: 'test2' } })
    fireEvent.click(create)

    expect(screen.getByRole('alert').textContent).toContain('/test2')
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('clears the complaint as soon as the path is fixed', () => {
    const { path, create, onCreate } = renderRow()

    fireEvent.change(path, { target: { value: 'todos' } })
    fireEvent.click(create)
    expect(screen.queryByRole('alert')).not.toBeNull()

    fireEvent.change(path, { target: { value: '/todos' } })
    expect(screen.queryByRole('alert')).toBeNull()

    fireEvent.click(create)
    expect(onCreate).toHaveBeenCalledOnce()
  })

  it('refuses a blank response name, and names that field', () => {
    const { path, create, onCreate } = renderRow()

    fireEvent.change(path, { target: { value: '/todos' } })
    fireEvent.change(screen.getByLabelText('response name'), { target: { value: '   ' } })
    fireEvent.click(create)

    expect(screen.getByRole('alert').textContent).toContain('response name')
    expect(onCreate).not.toHaveBeenCalled()
  })

  // The row is where the server's refusal lands too. One complaint at a
  // time, and the one the developer just caused wins.
  it('shows the server rejection until the developer causes a new complaint', () => {
    renderRow({ error: 'already exists in laqi/api.json' })
    expect(screen.getByRole('alert').textContent).toContain('already exists')

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(screen.getByRole('alert').textContent).toContain('path')
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
  // become NaN in a mock file. It used to fall back to 200 quietly; the
  // developer who cleared the field meant to type something else.
  it('asks for a status rather than filling one in when the field is empty', () => {
    const { path, create, onCreate } = renderRow()

    fireEvent.change(path, { target: { value: '/todos' } })
    fireEvent.change(screen.getByLabelText('status'), { target: { value: '' } })
    fireEvent.click(create)

    expect(screen.getByRole('alert').textContent).toContain('status')
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('switches to the model flow and needs a model before it will submit', () => {
    const { path, onCreateFromModel } = renderRow()

    fireEvent.change(path, { target: { value: '/todos' } })
    fireEvent.click(screen.getByRole('button', { name: 'from a model' }))

    const create = screen.getByRole('button', { name: 'Create' })
    fireEvent.click(create)
    expect(screen.getByRole('alert').textContent).toContain('model')
    expect(onCreateFromModel).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('model'), {
      target: { value: 'interface Todo { id: number }' },
    })
    fireEvent.click(create)

    expect(onCreateFromModel).toHaveBeenCalledWith({
      method: 'GET',
      path: '/todos',
      model: 'interface Todo { id: number }',
      responseName: 'ok',
      status: 200,
    })
  })

  // The model decides the BODY. What the response is called and what it
  // returns are separate questions, and hiding them behind the model flow
  // meant every generated endpoint arrived as `ok 200` with no way to say
  // otherwise from here.
  it('names and numbers a generated response the same as a blank one', () => {
    const { path, onCreateFromModel } = renderRow()

    fireEvent.change(path, { target: { value: '/orders' } })
    fireEvent.click(screen.getByRole('button', { name: 'POST' }))
    fireEvent.click(screen.getByRole('button', { name: 'from a model' }))

    expect(screen.getByLabelText('response name')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('response name'), { target: { value: ' created ' } })
    fireEvent.change(screen.getByLabelText('status'), { target: { value: '201' } })
    fireEvent.change(screen.getByLabelText('model'), {
      target: { value: 'interface Order { id: number }' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(onCreateFromModel).toHaveBeenCalledWith({
      method: 'POST',
      path: '/orders',
      model: 'interface Order { id: number }',
      responseName: 'created',
      status: 201,
    })
  })

  it('keeps the name and status when switching between the two flows', () => {
    const { path, onCreate } = renderRow()

    fireEvent.change(path, { target: { value: '/orders' } })
    fireEvent.change(screen.getByLabelText('response name'), { target: { value: 'missing' } })
    fireEvent.change(screen.getByLabelText('status'), { target: { value: '404' } })
    fireEvent.click(screen.getByRole('button', { name: 'from a model' }))
    fireEvent.click(screen.getByRole('button', { name: 'blank' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ responseName: 'missing', status: 404 }),
    )
  })

  // A model file declares several types and the parser picks one, which is
  // rarely the one you meant: paste the medium example and it mocks `Role`
  // — the string 'viewer' — because that is the first export.
  it('passes the type to generate from when one is named', () => {
    const { path, onCreateFromModel } = renderRow()

    fireEvent.change(path, { target: { value: '/projects' } })
    fireEvent.click(screen.getByRole('button', { name: 'from a model' }))
    fireEvent.change(screen.getByLabelText('model'), { target: { value: 'interface P { a: 1 }' } })
    fireEvent.change(screen.getByLabelText('type'), { target: { value: '  Project  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(onCreateFromModel).toHaveBeenCalledWith(expect.objectContaining({ typeName: 'Project' }))
  })

  it('leaves the choice to the parser when the type is left empty', () => {
    const { path, onCreateFromModel } = renderRow()

    fireEvent.change(path, { target: { value: '/projects' } })
    fireEvent.click(screen.getByRole('button', { name: 'from a model' }))
    fireEvent.change(screen.getByLabelText('model'), { target: { value: 'interface P { a: 1 }' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(onCreateFromModel).toHaveBeenCalledWith(expect.objectContaining({ typeName: undefined }))
  })

  // `Number('201e44')` is 2.01e46. It reached the mock file and came back
  // as "Too big: expected int to be ≤9007199254740991", which tells the
  // developer nothing about the field they typed into.
  it('refuses a status that is not a code, in words the developer can act on', () => {
    const { path, onCreate } = renderRow()

    fireEvent.change(path, { target: { value: '/test' } })
    fireEvent.change(screen.getByLabelText('status'), { target: { value: '201e44' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    const said = screen.getByRole('alert').textContent ?? ''
    expect(said).toContain('100')
    expect(said).toContain('599')
    expect(said).toContain('201e44')
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('refuses a code outside the range, and a half-typed name', () => {
    const { path, onCreate } = renderRow()
    fireEvent.change(path, { target: { value: '/test' } })

    for (const value of ['600', '99', 'not found']) {
      fireEvent.change(screen.getByLabelText('status'), { target: { value } })
      fireEvent.click(screen.getByRole('button', { name: 'Create' }))
      expect(screen.getByRole('alert').textContent, value).toContain('status')
    }
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('offers the type field only in the model flow', () => {
    renderRow()
    expect(screen.queryByLabelText('type')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'from a model' }))
    expect(screen.getByLabelText('type')).toBeTruthy()
  })

  it('still refuses a blank response name in the model flow', () => {
    const { path, onCreateFromModel } = renderRow()

    fireEvent.change(path, { target: { value: '/orders' } })
    fireEvent.click(screen.getByRole('button', { name: 'from a model' }))
    fireEvent.change(screen.getByLabelText('response name'), { target: { value: '  ' } })
    fireEvent.change(screen.getByLabelText('model'), { target: { value: 'interface A { a: 1 }' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(screen.getByRole('alert').textContent).toContain('response name')
    expect(onCreateFromModel).not.toHaveBeenCalled()
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

// Something to paste when trying laqi out. The panel and the parser tests
// read the same three models, so a button that fills the box with something
// the parser chokes on would fail in packages/generate first.
describe('the JSON flow', () => {
  function openJson() {
    const row = renderRow()
    fireEvent.change(row.path, { target: { value: '/orders' } })
    fireEvent.click(screen.getByRole('button', { name: 'from JSON' }))
    return row
  }

  it('offers the three flows, and shows the body box only in this one', () => {
    renderRow()
    expect(screen.queryByLabelText('response body')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'from JSON' }))
    expect(screen.getByLabelText('response body')).toBeTruthy()
    expect(screen.queryByLabelText('model')).toBeNull()
  })

  it('creates the endpoint with the pasted body, parsed', () => {
    const { onCreate } = openJson()

    fireEvent.change(screen.getByLabelText('response body'), {
      target: { value: '{ "id": 1, "tags": ["a"] }' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(onCreate).toHaveBeenCalledWith({
      method: 'GET',
      path: '/orders',
      responseName: 'ok',
      status: 200,
      body: { id: 1, tags: ['a'] },
    })
  })

  it('says what is wrong with the JSON rather than sending it', () => {
    const { onCreate } = openJson()

    fireEvent.change(screen.getByLabelText('response body'), { target: { value: '{ "id": }' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(screen.getByRole('alert').textContent).toContain('JSON')
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('asks for a body before it will create an empty one', () => {
    const { onCreate } = openJson()

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(screen.getByRole('alert').textContent).toContain('JSON')
    expect(onCreate).not.toHaveBeenCalled()
  })

  // A body is what the endpoint returns, and `null`, `[]` and `0` are all
  // things an endpoint returns.
  it.each(['null', '[]', '0', '"text"'])('accepts %s as a body', (source) => {
    const { onCreate } = openJson()

    fireEvent.change(screen.getByLabelText('response body'), { target: { value: source } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ body: JSON.parse(source) }))
  })

  it('fills the box from an example body, and creates what it filled in', () => {
    const { onCreate } = openJson()

    fireEvent.click(screen.getByRole('button', { name: 'invoice' }))
    expect((screen.getByLabelText('response body') as HTMLTextAreaElement).value).toBe(
      exampleBody('invoice').source,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ body: JSON.parse(exampleBody('invoice').source) }),
    )
  })

  it('offers the bodies only in this flow, and the models only in theirs', () => {
    renderRow()
    expect(screen.queryByRole('button', { name: 'invoice' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'from JSON' }))
    expect(screen.getByRole('button', { name: 'invoice' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'complex' })).toBeNull()
  })

  it('keeps the path, name and status when moving between flows', () => {
    const { onCreate } = openJson()

    fireEvent.change(screen.getByLabelText('response name'), { target: { value: 'empty' } })
    fireEvent.change(screen.getByLabelText('status'), { target: { value: '204' } })
    fireEvent.change(screen.getByLabelText('response body'), { target: { value: '[]' } })
    fireEvent.click(screen.getByRole('button', { name: 'blank' }))
    fireEvent.click(screen.getByRole('button', { name: 'from JSON' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(onCreate).toHaveBeenCalledWith({
      method: 'GET',
      path: '/orders',
      responseName: 'empty',
      status: 204,
      body: [],
    })
  })
})

describe('the example models', () => {
  function openModelMode() {
    const row = renderRow()
    fireEvent.change(row.path, { target: { value: '/orders' } })
    fireEvent.click(screen.getByRole('button', { name: 'from a model' }))
    return row
  }

  it('offers the three models only in the model flow', () => {
    renderRow()
    expect(screen.queryByRole('button', { name: 'simple' })).toBeNull()
    cleanup()

    openModelMode()
    for (const name of ['simple', 'medium', 'complex']) {
      expect(screen.getByRole('button', { name })).toBeTruthy()
    }
  })

  it('fills the box with the model, and submits exactly what it filled in', () => {
    const { onCreateFromModel } = openModelMode()

    fireEvent.click(screen.getByRole('button', { name: 'complex' }))

    const box = screen.getByLabelText('model') as HTMLTextAreaElement
    expect(box.value).toBe(exampleModel('complex').source)

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(onCreateFromModel).toHaveBeenCalledWith({
      method: 'GET',
      path: '/orders',
      model: exampleModel('complex').source.trim(),
      // The example names its own root: left to the parser, `complex`
      // would generate from `Currency` and mock the string 'PEN'.
      typeName: 'Order',
      responseName: 'ok',
      status: 200,
    })
  })

  it('replaces one example with another', () => {
    openModelMode()

    fireEvent.click(screen.getByRole('button', { name: 'simple' }))
    fireEvent.click(screen.getByRole('button', { name: 'medium' }))

    expect((screen.getByLabelText('model') as HTMLTextAreaElement).value).toBe(
      exampleModel('medium').source,
    )
  })

  it('explains each model in a title, for the developer choosing one', () => {
    openModelMode()

    expect(screen.getByRole('button', { name: 'complex' }).getAttribute('title')).toContain(
      'Four levels deep',
    )
  })
})
