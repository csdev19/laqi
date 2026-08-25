import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CLOUDFLARED_MISSING, createCloudflaredProvider, type Spawner } from './tunnel'

/** Un cloudflared de mentira: los mismos eventos, sin el binario. */
class FakeChild extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  exitCode: number | null = null
  killed = false

  kill(): boolean {
    this.killed = true
    // Un proceso real tarda un tick en salir tras el kill.
    setImmediate(() => {
      this.exitCode = 0
      this.emit('exit', 0)
    })
    return true
  }
}

let children: FakeChild[] = []
let calls: { command: string; args: string[] }[] = []

function fakeSpawner(): Spawner {
  return (command, args) => {
    calls.push({ command, args })
    const child = new FakeChild()
    children.push(child)
    return child as unknown as ChildProcess
  }
}

afterEach(() => {
  children = []
  calls = []
  vi.useRealTimers()
})

const BANNER = `
+--------------------------------------------------------+
|  Your quick Tunnel has been created! Visit it at:       |
|  https://shy-forest-1234.trycloudflare.com              |
+--------------------------------------------------------+
`

describe('unavailable', () => {
  it('is null when cloudflared answers --version', async () => {
    const provider = createCloudflaredProvider({ spawner: fakeSpawner() })
    const check = provider.unavailable()
    children[0]!.emit('exit', 0)
    await expect(check).resolves.toBeNull()
  })

  it('explains how to install it when the binary is missing', async () => {
    const provider = createCloudflaredProvider({ spawner: fakeSpawner() })
    const check = provider.unavailable()
    children[0]!.emit('error', new Error('ENOENT'))
    await expect(check).resolves.toBe(CLOUDFLARED_MISSING)
  })

  it('treats a non-zero exit as unavailable too', async () => {
    const provider = createCloudflaredProvider({ spawner: fakeSpawner() })
    const check = provider.unavailable()
    children[0]!.emit('exit', 127)
    await expect(check).resolves.toBe(CLOUDFLARED_MISSING)
  })

  it('names the install command for each platform', () => {
    expect(CLOUDFLARED_MISSING).toContain('brew install cloudflared')
    expect(CLOUDFLARED_MISSING).toContain('winget')
    expect(CLOUDFLARED_MISSING).toContain('github.com/cloudflare/cloudflared')
  })
})

describe('start', () => {
  it('points cloudflared at the local port and returns the URL it prints', async () => {
    const provider = createCloudflaredProvider({ spawner: fakeSpawner() })
    const starting = provider.start({ port: 8123 })

    children[0]!.stderr.write(BANNER)
    const tunnel = await starting

    expect(tunnel.url).toBe('https://shy-forest-1234.trycloudflare.com')
    expect(calls[0]).toEqual({
      command: 'cloudflared',
      args: ['tunnel', '--no-autoupdate', '--url', 'http://127.0.0.1:8123'],
    })
  })

  it('finds the URL even when the banner arrives in pieces', async () => {
    const provider = createCloudflaredProvider({ spawner: fakeSpawner() })
    const starting = provider.start({ port: 8000 })

    // cloudflared parte el banner en varias escrituras; mirar chunk a chunk
    // se perdería una URL cortada al medio.
    children[0]!.stderr.write('|  Visit it at: https://shy-forest')
    children[0]!.stderr.write('-1234.trycloudflare.com   |')

    await expect(starting).resolves.toMatchObject({
      url: 'https://shy-forest-1234.trycloudflare.com',
    })
  })

  it('reads the URL from stdout too, not only stderr', async () => {
    const provider = createCloudflaredProvider({ spawner: fakeSpawner() })
    const starting = provider.start({ port: 8000 })
    children[0]!.stdout.write(BANNER)
    await expect(starting).resolves.toMatchObject({ url: expect.stringContaining('trycloudflare') })
  })

  it('rejects when cloudflared dies before printing a URL', async () => {
    const provider = createCloudflaredProvider({ spawner: fakeSpawner() })
    const starting = provider.start({ port: 8000 })
    children[0]!.emit('exit', 1)
    await expect(starting).rejects.toThrow('exited with code 1')
  })

  it('rejects rather than hanging when no URL ever arrives', async () => {
    vi.useFakeTimers()
    const provider = createCloudflaredProvider({ spawner: fakeSpawner() })
    const starting = provider.start({ port: 8000 })

    // El handler se adjunta ANTES de avanzar el reloj: si no, la promesa
    // rechaza en un tick sin handler y Node lo reporta como unhandled.
    const rejects = expect(starting).rejects.toThrow('did not report a URL')
    await vi.advanceTimersByTimeAsync(31_000)
    await rejects
    expect(children[0]!.killed).toBe(true)
  })

  it('ignores output that arrives after it already resolved', async () => {
    const provider = createCloudflaredProvider({ spawner: fakeSpawner() })
    const starting = provider.start({ port: 8000 })
    children[0]!.stderr.write(BANNER)
    const tunnel = await starting

    // Un exit tardío no debe convertirse en un unhandled rejection.
    children[0]!.emit('exit', 0)
    expect(tunnel.url).toContain('trycloudflare')
  })

  it('stops the process and waits for it to actually exit', async () => {
    const provider = createCloudflaredProvider({ spawner: fakeSpawner() })
    const starting = provider.start({ port: 8000 })
    children[0]!.stderr.write(BANNER)
    const tunnel = await starting

    await tunnel.stop()
    expect(children[0]!.killed).toBe(true)
    expect(children[0]!.exitCode).toBe(0)
  })

  it('stop() is safe to call twice', async () => {
    const provider = createCloudflaredProvider({ spawner: fakeSpawner() })
    const starting = provider.start({ port: 8000 })
    children[0]!.stderr.write(BANNER)
    const tunnel = await starting

    await tunnel.stop()
    await expect(tunnel.stop()).resolves.toBeUndefined()
  })

  it('kills the process when the caller aborts', async () => {
    const controller = new AbortController()
    const provider = createCloudflaredProvider({ spawner: fakeSpawner() })
    const starting = provider.start({ port: 8000, signal: controller.signal })

    const rejects = expect(starting).rejects.toThrow('aborted')
    controller.abort()
    children[0]!.emit('exit', 0)

    await rejects
    expect(children[0]!.killed).toBe(true)
  })
})

describe('after the URL is found', () => {
  it('stops listening, so a long-lived tunnel does not accumulate its own logs', async () => {
    const provider = createCloudflaredProvider({ spawner: fakeSpawner() })
    const starting = provider.start({ port: 8000 })
    children[0]!.stderr.write(BANNER)
    await starting

    // cloudflared loguea sin parar mientras el túnel vive. Si los listeners
    // siguieran puestos, cada línea se acumularía y el regex se re-correría
    // sobre una cadena cada vez más larga.
    expect(children[0]!.stderr.listenerCount('data')).toBe(0)
    expect(children[0]!.stdout.listenerCount('data')).toBe(0)
  })

  it('detaches on the failure paths too', async () => {
    const provider = createCloudflaredProvider({ spawner: fakeSpawner() })
    const starting = provider.start({ port: 8000 })
    const rejects = expect(starting).rejects.toThrow()
    children[0]!.emit('exit', 1)
    await rejects

    expect(children[0]!.stderr.listenerCount('data')).toBe(0)
  })
})
