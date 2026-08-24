import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
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

  write(state: LaqiState): void {
    mkdirSync(dirname(this.path), { recursive: true })
    writeFileSync(this.path, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  }
}
