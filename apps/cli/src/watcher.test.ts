// apps/cli/src/watcher.test.ts
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { watchMocks } from './watcher'

let root: string
let watcher: { close: () => Promise<void> } | undefined

const settle = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms))

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'laqi-watch-'))
  mkdirSync(join(root, 'laqi'), { recursive: true })
})

afterEach(async () => {
  await watcher?.close()
  watcher = undefined
  rmSync(root, { recursive: true, force: true })
})

describe('watchMocks', () => {
  it('fires when a file changes', async () => {
    const file = join(root, 'laqi', 'api.json')
    writeFileSync(file, '{}', 'utf8')

    let calls = 0
    watcher = watchMocks({ root, dir: 'laqi', file: 'laqi.json', onChange: () => calls++, debounceMs: 20 })
    await settle()

    writeFileSync(file, '{"a":1}', 'utf8')
    await settle()

    expect(calls).toBeGreaterThanOrEqual(1)
  })

  it('fires when a file is added (v1 defect G)', async () => {
    let calls = 0
    watcher = watchMocks({ root, dir: 'laqi', file: 'laqi.json', onChange: () => calls++, debounceMs: 20 })
    await settle()

    writeFileSync(join(root, 'laqi', 'new.json'), '{}', 'utf8')
    await settle()

    expect(calls).toBeGreaterThanOrEqual(1)
  })

  it('fires when a file is deleted (v1 defect G)', async () => {
    const file = join(root, 'laqi', 'api.json')
    writeFileSync(file, '{}', 'utf8')

    let calls = 0
    watcher = watchMocks({ root, dir: 'laqi', file: 'laqi.json', onChange: () => calls++, debounceMs: 20 })
    await settle()

    unlinkSync(file)
    await settle()

    expect(calls).toBeGreaterThanOrEqual(1)
  })

  it('debounces a burst of writes into a single call (v1 defect H)', async () => {
    const file = join(root, 'laqi', 'api.json')
    writeFileSync(file, '{}', 'utf8')

    let calls = 0
    watcher = watchMocks({ root, dir: 'laqi', file: 'laqi.json', onChange: () => calls++, debounceMs: 120 })
    await settle()

    for (let i = 0; i < 5; i++) writeFileSync(file, `{"n":${i}}`, 'utf8')
    await settle(400)

    expect(calls).toBe(1)
  })

  it('detects the mocks folder even when it is created after startup (F9)', async () => {
    const fresh = mkdtempSync(join(tmpdir(), 'laqi-fresh-'))
    let calls = 0
    watcher = watchMocks({ root: fresh, dir: 'laqi', file: 'laqi.json', onChange: () => calls++, debounceMs: 20 })
    await settle()

    mkdirSync(join(fresh, 'laqi'))
    writeFileSync(join(fresh, 'laqi', 'api.json'), '{}', 'utf8')
    await settle(600)

    expect(calls).toBeGreaterThanOrEqual(1)
    rmSync(fresh, { recursive: true, force: true })
  })
})
