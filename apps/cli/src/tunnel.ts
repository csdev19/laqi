import { spawn, type ChildProcess } from 'node:child_process'

export type Tunnel = {
  url: string
  stop: () => Promise<void>
}

/**
 * La capa de compartición como interfaz enchufable, desde el día uno
 * ([ADR-0007](../decisiones/0007-url-publica.md)). `CloudflaredProvider` es la
 * fase 1; el relay propio en Workers entra por acá sin reescribir nada.
 */
export type TunnelProvider = {
  name: string
  /** Por qué no se puede usar ahora, o `null` si está listo. */
  unavailable: () => Promise<string | null>
  start: (options: { port: number; signal?: AbortSignal }) => Promise<Tunnel>
}

/** Inyectable para poder testear sin el binario instalado. */
export type Spawner = (command: string, args: string[]) => ChildProcess

const TRYCLOUDFLARE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i

export const CLOUDFLARED_MISSING = [
  'cloudflared is not installed, and --share needs it to open a public URL.',
  '',
  '  macOS     brew install cloudflared',
  '  linux     https://github.com/cloudflare/cloudflared/releases',
  '  windows   winget install --id Cloudflare.cloudflared',
  '',
  'No account or login is required for a quick tunnel.',
].join('\n')

/** Cuánto se espera la URL antes de rendirse. */
export const URL_TIMEOUT_MS = 30_000

export function createCloudflaredProvider(options: { spawner?: Spawner } = {}): TunnelProvider {
  const spawner: Spawner = options.spawner ?? ((command, args) => spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] }))

  return {
    name: 'cloudflared',

    async unavailable() {
      return new Promise((resolve) => {
        let child: ChildProcess
        try {
          child = spawner('cloudflared', ['--version'])
        } catch {
          return resolve(CLOUDFLARED_MISSING)
        }

        child.on('error', () => resolve(CLOUDFLARED_MISSING))
        child.on('exit', (code) => resolve(code === 0 ? null : CLOUDFLARED_MISSING))
      })
    },

    start({ port, signal }) {
      return new Promise<Tunnel>((resolve, reject) => {
        const child = spawner('cloudflared', [
          'tunnel',
          '--no-autoupdate',
          '--url',
          `http://127.0.0.1:${port}`,
        ])

        let settled = false
        // cloudflared imprime la URL en un banner ASCII partido en varias
        // escrituras, así que hay que acumular en vez de mirar chunk a chunk.
        let buffered = ''

        /** Vacía el pipe sin guardar nada. Ver el comentario en `finish`. */
        const drain = () => {}

        const onChunk = (chunk: Buffer | string) => {
          buffered += String(chunk)
          const match = TRYCLOUDFLARE.exec(buffered)
          if (!match) return

          finish(() =>
            resolve({
              url: match[0],
              stop: () =>
                new Promise<void>((done) => {
                  if (child.exitCode !== null || child.killed) return done()
                  child.once('exit', () => done())
                  child.kill()
                }),
            }),
          )
        }

        const finish = (action: () => void) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          // Se deja de ACUMULAR, pero se sigue drenando.
          //
          // cloudflared loguea sin parar mientras el túnel vive, así que
          // guardarlo todo hacía crecer `buffered` sin límite y re-correr el
          // regex sobre una cadena cada vez más larga. Pero quitar los
          // listeners y ya está pausa el stream: Node deja de vaciar el pipe,
          // el pipe se llena, y cloudflared —que escribe a stderr de forma
          // bloqueante— se traba para siempre en su próximo log. Verificado:
          // el hijo se congelaba ~1.1MB después de resolver.
          child.stdout?.off('data', onChunk)
          child.stderr?.off('data', onChunk)
          child.stdout?.on('data', drain)
          child.stderr?.on('data', drain)
          buffered = ''
          action()
        }

        const timer = setTimeout(() => {
          finish(() => {
            child.kill()
            reject(new Error(`cloudflared did not report a URL within ${URL_TIMEOUT_MS / 1000}s`))
          })
        }, URL_TIMEOUT_MS)

        // La URL sale por stderr, pero no en todas las versiones — mirar los dos.
        child.stdout?.on('data', onChunk)
        child.stderr?.on('data', onChunk)

        child.on('error', (error) => finish(() => reject(error)))
        child.on('exit', (code) =>
          finish(() => reject(new Error(`cloudflared exited with code ${code} before reporting a URL`))),
        )

        // Matar y NO settlear dejaría la promesa colgada para siempre, y
        // como `finish` marca settled, el `exit` que viene después tampoco
        // podría rechazarla. Abortar tiene que terminar el await del CLI.
        signal?.addEventListener(
          'abort',
          () =>
            finish(() => {
              child.kill()
              reject(new Error('tunnel start aborted'))
            }),
          { once: true },
        )
      })
    },
  }
}
