import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { ConfigSchema } from '@laqi/schema'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startServer, type ServeHandle } from '../serve'
import { runInit } from './run'

let root: string
let handle: ServeHandle | undefined
let logSpy: ReturnType<typeof vi.spyOn>
let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'laqi-init-'))
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(async () => {
  await handle?.close()
  handle = undefined
  logSpy.mockRestore()
  errorSpy.mockRestore()
  rmSync(root, { recursive: true, force: true })
})

async function serves(dir: string, path: string) {
  const config = ConfigSchema.parse({ port: 0, host: '127.0.0.1', dir })
  handle = await startServer({ root, config })
  return fetch(`http://127.0.0.1:${handle.port}${path}`)
}

describe('runInit — writes only inside the mocks folder', () => {
  it('creates laqi/api.json, laqi/scenarios.json and laqi/README.md, and nothing else at the root', async () => {
    const before = readdirSync(root).sort()
    const exitCode = await runInit(['--yes'], root)
    expect(exitCode).toBeUndefined()

    expect(existsSync(join(root, 'laqi', 'api.json'))).toBe(true)
    expect(existsSync(join(root, 'laqi', 'scenarios.json'))).toBe(true)
    expect(existsSync(join(root, 'laqi', 'README.md'))).toBe(true)

    const after = readdirSync(root).sort()
    expect(after).toEqual([...before, 'laqi'].sort())
    expect(readdirSync(join(root, 'laqi')).sort()).toEqual([
      'README.md',
      'api.json',
      'scenarios.json',
    ])
  })

  it('the README explains the file format and warns off X-Laqi-Response for routine requests', async () => {
    await runInit(['--yes'], root)
    const readme = readFileSync(join(root, 'laqi', 'README.md'), 'utf8')
    expect(readme).toContain('"GET /todos"')
    expect(readme).toContain('status')
    expect(readme).toContain('body')
    expect(readme).toContain('delay')
    expect(readme).toContain('X-Laqi-Response')
    expect(readme).toContain('/__laqi')
  })

  it('the written scaffold actually loads and serves', async () => {
    await runInit(['--yes'], root)
    const res = await serves('laqi', '/todos')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: unknown[] }
    expect(Array.isArray(body.items)).toBe(true)
  })

  it('respects --dir and writes nothing at the default location', async () => {
    await runInit(['--yes', '--dir', 'mocks'], root)
    expect(existsSync(join(root, 'laqi'))).toBe(false)
    expect(existsSync(join(root, 'mocks', 'api.json'))).toBe(true)
    const res = await serves('mocks', '/todos')
    expect(res.status).toBe(200)
  })
})

describe('runInit — --from empty', () => {
  it('produces a scaffold that still loads', async () => {
    const exitCode = await runInit(['--yes', '--from', 'empty'], root)
    expect(exitCode).toBeUndefined()
    const res = await serves('laqi', '/example')
    expect(res.status).toBe(200)
  })
})

describe('runInit — does not overwrite', () => {
  it('reports what is there and exits 2 on a second run', async () => {
    await runInit(['--yes'], root)
    const before = readFileSync(join(root, 'laqi', 'api.json'), 'utf8')

    const exitCode = await runInit(['--yes'], root)
    expect(exitCode).toBe(2)

    const after = readFileSync(join(root, 'laqi', 'api.json'), 'utf8')
    expect(after).toBe(before)
    expect(errorSpy).toHaveBeenCalled()
  })

  it('--force overwrites', async () => {
    await runInit(['--yes'], root)
    const exitCode = await runInit(['--yes', '--from', 'empty', '--force'], root)
    expect(exitCode).toBeUndefined()

    const api = JSON.parse(readFileSync(join(root, 'laqi', 'api.json'), 'utf8')) as object
    expect(Object.keys(api)).toEqual(['GET /example'])
  })

  it('exits 2 when the target path exists and is a plain file', async () => {
    writeFileSync(join(root, 'laqi'), 'not a folder', 'utf8')
    const exitCode = await runInit(['--yes'], root)
    expect(exitCode).toBe(2)
  })
})

describe('runInit — --script', () => {
  it('adds exactly one script to package.json and touches nothing else', async () => {
    const pkg = { name: 'demo-app', version: '1.0.0', dependencies: { react: '^19.0.0' } }
    writeFileSync(join(root, 'package.json'), JSON.stringify(pkg, null, 2), 'utf8')

    const exitCode = await runInit(['--yes', '--script'], root)
    expect(exitCode).toBeUndefined()

    const written = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      name: string
      version: string
      dependencies: Record<string, string>
      scripts: Record<string, string>
    }
    expect(written.name).toBe('demo-app')
    expect(written.version).toBe('1.0.0')
    expect(written.dependencies).toEqual({ react: '^19.0.0' })
    expect(written.scripts).toEqual({ mock: 'laqi' })
  })

  it('--script=name uses the given name', async () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'demo' }), 'utf8')
    await runInit(['--yes', '--script=mock:api'], root)
    const written = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    expect(written.scripts).toEqual({ 'mock:api': 'laqi' })
  })

  it('bakes a non-default port and dir into the script command', async () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'demo' }), 'utf8')
    await runInit(['--yes', '--script', '--port', '8010', '--dir', 'mocks'], root)
    const written = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    expect(written.scripts.mock).toBe('laqi --dir mocks --port 8010')
  })

  it('preserves existing scripts and only adds the new one', async () => {
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'demo', scripts: { build: 'tsc', test: 'vitest' } }),
      'utf8',
    )
    await runInit(['--yes', '--script'], root)
    const written = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    expect(written.scripts).toEqual({ build: 'tsc', test: 'vitest', mock: 'laqi' })
  })

  it('is a notice, not a failure, when there is no package.json to modify', async () => {
    const exitCode = await runInit(['--yes', '--script'], root)
    expect(exitCode).toBeUndefined()
    expect(existsSync(join(root, 'package.json'))).toBe(false)
    expect(existsSync(join(root, 'laqi', 'api.json'))).toBe(true)
    expect(errorSpy).toHaveBeenCalled()
  })

  it('leaves package.json untouched when --script is not given', async () => {
    const pkg = { name: 'demo', scripts: { build: 'tsc' } }
    writeFileSync(join(root, 'package.json'), JSON.stringify(pkg), 'utf8')
    await runInit(['--yes'], root)
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(JSON.stringify(pkg))
  })
})

describe('runInit — --from openapi', () => {
  const spec = {
    openapi: '3.0.0',
    paths: {
      '/widgets': {
        get: {
          responses: {
            '200': {
              description: 'ok',
              content: {
                'application/json': { schema: { type: 'array', items: { type: 'string' } } },
              },
            },
          },
        },
      },
    },
  }

  it('imports routes from a JSON spec and writes a scaffold that loads', async () => {
    writeFileSync(join(root, 'openapi.json'), JSON.stringify(spec), 'utf8')
    const exitCode = await runInit(['--yes', '--from', 'openapi', '--spec', 'openapi.json'], root)
    expect(exitCode).toBeUndefined()

    const api = JSON.parse(readFileSync(join(root, 'laqi', 'api.json'), 'utf8')) as object
    expect(Object.keys(api)).toEqual(['GET /widgets'])

    const res = await serves('laqi', '/widgets')
    expect(res.status).toBe(200)
  })

  it('exits 5 when --spec is missing entirely', async () => {
    const exitCode = await runInit(['--yes', '--from', 'openapi'], root)
    expect(exitCode).toBe(5)
    expect(existsSync(join(root, 'laqi'))).toBe(false)
  })

  it('exits 5 when the spec file does not exist', async () => {
    const exitCode = await runInit(['--yes', '--from', 'openapi', '--spec', 'nope.json'], root)
    expect(exitCode).toBe(5)
  })

  it('exits 5 with a clear message on a .yaml spec (no YAML parser yet)', async () => {
    writeFileSync(join(root, 'openapi.yaml'), 'openapi: 3.0.0', 'utf8')
    const exitCode = await runInit(['--yes', '--from', 'openapi', '--spec', 'openapi.yaml'], root)
    expect(exitCode).toBe(5)
    expect(errorSpy.mock.calls.join(' ')).toContain('YAML')
  })

  it('exits 5 on invalid JSON', async () => {
    writeFileSync(join(root, 'openapi.json'), '{not json', 'utf8')
    const exitCode = await runInit(['--yes', '--from', 'openapi', '--spec', 'openapi.json'], root)
    expect(exitCode).toBe(5)
  })

  it('exits 5 when the spec has nothing importable', async () => {
    writeFileSync(
      join(root, 'openapi.json'),
      JSON.stringify({ openapi: '3.0.0', paths: {} }),
      'utf8',
    )
    const exitCode = await runInit(['--yes', '--from', 'openapi', '--spec', 'openapi.json'], root)
    expect(exitCode).toBe(5)
  })
})

describe('runInit — bad flags and unknown commands', () => {
  it('exits 5 on an unrecognised flag, and writes nothing', async () => {
    const exitCode = await runInit(['--bogus'], root)
    expect(exitCode).toBe(5)
    expect(existsSync(join(root, 'laqi'))).toBe(false)
  })

  it('exits 5 on an invalid --from value', async () => {
    const exitCode = await runInit(['--from', 'bogus'], root)
    expect(exitCode).toBe(5)
  })

  it('prints usage and exits cleanly on --help', async () => {
    const exitCode = await runInit(['--help'], root)
    expect(exitCode).toBeUndefined()
    expect(logSpy).toHaveBeenCalled()
    expect(existsSync(join(root, 'laqi'))).toBe(false)
  })
})

describe('runInit — --open', () => {
  it('calls the injected opener with the panel URL', async () => {
    const openBrowser = vi.fn().mockResolvedValue({ opened: true })
    await runInit(['--yes', '--open', '--port', '8010'], root, { openBrowser })
    expect(openBrowser).toHaveBeenCalledWith('http://127.0.0.1:8010/__laqi')
  })

  it('a browser that could not open is a notice, not a failure', async () => {
    const openBrowser = vi.fn().mockResolvedValue({ opened: false, reason: 'no display' })
    const exitCode = await runInit(['--yes', '--open'], root, { openBrowser })
    expect(exitCode).toBeUndefined()
    expect(errorSpy).toHaveBeenCalled()
  })

  it('does not call the opener when --open is not given', async () => {
    const openBrowser = vi.fn()
    await runInit(['--yes'], root, { openBrowser })
    expect(openBrowser).not.toHaveBeenCalled()
  })
})

describe('runInit — non-interactive is detected, not requested', () => {
  it('a non-TTY stdout behaves as though --yes were passed, with no --yes flag given', async () => {
    // vitest's stdout/stdin are never a real TTY, so this exercises the same
    // auto-detection a piped `laqi init` in CI hits for real — no
    // `deps.interactive` override here, unlike the equivalence suite.
    expect(process.stdout.isTTY).not.toBe(true)
    const exitCode = await runInit(['--dir', 'auto'], root)
    expect(exitCode).toBeUndefined()
    expect(existsSync(join(root, 'auto', 'api.json'))).toBe(true)
  })
})

describe('runInit — cancelling the wizard', () => {
  it('writes nothing and exits 130 on Escape', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    output.on('data', () => {})
    input.write(String.fromCharCode(0x1b))

    const exitCode = await runInit([], root, {
      interactive: true,
      promptIO: { input, output },
    })

    expect(exitCode).toBe(130)
    expect(existsSync(join(root, 'laqi'))).toBe(false)
    expect(errorSpy).toHaveBeenCalled()
  })
})

describe('runInit — summary', () => {
  it('reports the "next" command as npm run <name> once a script is added', async () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'demo' }), 'utf8')
    await runInit(['--yes', '--script'], root)
    const printed = logSpy.mock.calls.map((call) => call[0]).join('\n')
    expect(printed).toContain('npm run mock')
  })

  it('reports the bare laqi command as "next" when no script is added', async () => {
    await runInit(['--yes'], root)
    const printed = logSpy.mock.calls.map((call) => call[0]).join('\n')
    expect(printed).toContain('laqi')
    expect(printed).not.toContain('npm run')
  })
})
