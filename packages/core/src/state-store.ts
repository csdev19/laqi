import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { withFileLock, writeFileAtomic } from './atomic-file'
import { DEFAULT_STATE, StateSchema, type LaqiState } from '@laqi/schema'

export const STATE_DIR = '.laqi'
export const STATE_FILE = 'state.json'

export class StateStore {
  readonly path: string

  constructor(root: string) {
    this.path = join(root, STATE_DIR, STATE_FILE)
  }

  /**
   * Lo genera la máquina, así que cualquier daño se descarta en silencio:
   * perder el estado de una sesión es preferible a no arrancar.
   */
  read(): LaqiState {
    if (!existsSync(this.path)) return { ...DEFAULT_STATE }

    try {
      const parsed = StateSchema.safeParse(JSON.parse(readFileSync(this.path, 'utf8')))
      return parsed.success ? parsed.data : { ...DEFAULT_STATE }
    } catch {
      return { ...DEFAULT_STATE }
    }
  }

  /**
   * Escribe el estado entero.
   *
   * Bajo el mismo lock que los archivos de mock, y por el mismo motivo: los
   * DOS procesos que escriben mocks —`laqi mcp` y el control plane del CLI—
   * escriben también acá, vía `setResponse`, `setScenario` y `PUT /api/state`.
   * El arreglo de concurrencia se había aplicado sólo a `writer.ts`, así que
   * este archivo seguía con el bug entero: temporal de nombre fijo, ENOENT al
   * renombrar, y escrituras perdidas. Medido antes: de 600 overrides escritos
   * desde dos procesos sobrevivían 300, con un crash.
   */
  write(state: LaqiState): void {
    withFileLock(this.path, () => {
      writeFileAtomic(this.path, `${JSON.stringify(state, null, 2)}\n`)
    })
    // Sin propagar el fallo a propósito: esto es estado de máquina, y su
    // contrato desde el Plan 1 es que nunca tumba el servidor. Un lock
    // vencido pierde ese cambio; perder un flip es preferible a un 500.
  }

  /**
   * Lee, transforma y escribe en un solo turno bajo el lock.
   *
   * `read()` seguido de `write()` desde afuera deja una ventana en la que
   * otro proceso escribe en el medio y su cambio se pierde. Quien mute el
   * estado debería usar esto.
   */
  update(change: (current: LaqiState) => LaqiState): LaqiState {
    let result: LaqiState = this.read()

    withFileLock(this.path, () => {
      result = change(this.read())
      writeFileAtomic(this.path, `${JSON.stringify(result, null, 2)}\n`)
    })

    return result
  }
}
