import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LOCK_TIMEOUT_MS, withFileLock, writeFileAtomic } from './atomic-file'

let root: string
let target: string
const lockOf = (path: string) => `${path}.lock`

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'laqi-atomic-'))
  target = join(root, 'nested', 'file.json')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('writeFileAtomic', () => {
  it('creates missing directories and writes the content', () => {
    writeFileAtomic(target, '{"a":1}')
    expect(readFileSync(target, 'utf8')).toBe('{"a":1}')
  })

  it('leaves no temp file behind', () => {
    writeFileAtomic(target, 'x')
    expect(readdirNames(join(root, 'nested')).filter((n) => n.includes('.tmp'))).toEqual([])
  })

  it('uses a distinct temp name per write, so two writers cannot collide', () => {
    // Con un `.tmp` fijo, dos procesos se pisaban el temporal y uno moría
    // con ENOENT al renombrar algo que el otro ya se había llevado.
    const names = new Set<string>()
    for (let i = 0; i < 20; i++) {
      writeFileAtomic(target, String(i))
      names.add(readFileSync(target, 'utf8'))
    }
    expect(names.size).toBe(20)
  })
})

describe('withFileLock', () => {
  it('runs the work and returns its value', () => {
    expect(withFileLock(target, () => 42)).toEqual({ ok: true, value: 42 })
  })

  it('releases the lock afterwards', () => {
    withFileLock(target, () => 1)
    expect(existsSync(lockOf(target))).toBe(false)
  })

  it('releases the lock even when the work throws', () => {
    expect(() =>
      withFileLock(target, () => {
        throw new Error('boom')
      }),
    ).toThrow('boom')
    expect(existsSync(lockOf(target))).toBe(false)
  })

  it('reclaims a lock whose owner process is gone, without waiting', () => {
    // El caso real: un proceso muerto a mitad de escritura deja el lock con
    // un mtime fresco. Decidir por antigüedad hacía esperar el timeout
    // entero y después fallar, dejando el lock puesto para siempre.
    mkdirSync(join(root, 'nested'), { recursive: true })
    writeFileSync(lockOf(target), '999999', 'utf8')

    const started = Date.now()
    expect(withFileLock(target, () => 'done')).toEqual({ ok: true, value: 'done' })
    expect(Date.now() - started).toBeLessThan(1000)
    expect(existsSync(lockOf(target))).toBe(false)
  })

  it('reclaims a lock this same process left behind', () => {
    // Este camino es síncrono, así que no podemos estarlo sosteniendo ahora:
    // sobró de una llamada anterior que murió entre el open y el finally.
    mkdirSync(join(root, 'nested'), { recursive: true })
    writeFileSync(lockOf(target), String(process.pid), 'utf8')

    expect(withFileLock(target, () => 'done').ok).toBe(true)
  })

  it('falls back to age when the lock carries no readable pid', () => {
    mkdirSync(join(root, 'nested'), { recursive: true })
    writeFileSync(lockOf(target), 'not-a-pid', 'utf8')
    const old = new Date(Date.now() - 60_000)
    utimesSync(lockOf(target), old, old)

    expect(withFileLock(target, () => 'done').ok).toBe(true)
  })

  it(
    'returns a failure rather than throwing when it cannot get the lock',
    () => {
      // Un dueño VIVO y ajeno no se desaloja: robarle el lock perdería su
      // escritura, que es justo lo que esto evita. Se espera y se falla.
      mkdirSync(join(root, 'nested'), { recursive: true })
      writeFileSync(lockOf(target), String(process.ppid), 'utf8')

      const result = withFileLock(target, () => 'never runs')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toContain('timed out')
    },
    LOCK_TIMEOUT_MS + 5_000,
  )

  it(
    'does not run the work when it could not lock',
    () => {
      mkdirSync(join(root, 'nested'), { recursive: true })
      writeFileSync(lockOf(target), String(process.ppid), 'utf8')

      let ran = false
      withFileLock(target, () => {
        ran = true
      })
      expect(ran).toBe(false)
    },
    LOCK_TIMEOUT_MS + 5_000,
  )
})

function readdirNames(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir) : []
}
