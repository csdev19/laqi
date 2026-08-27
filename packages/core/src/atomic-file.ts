import {
  closeSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  openSync,
} from 'node:fs'
import { dirname } from 'node:path'

/**
 * Escritura de archivos segura entre PROCESOS.
 *
 * Hace falta porque esta versión conecta dos escritores independientes a los
 * mismos archivos: el servidor `laqi mcp` y el control plane del CLI, los dos
 * a través de `Project`. Sin esto, dos escrituras simultáneas se pisan el
 * temporal y una revienta al renombrar algo que la otra ya se llevó.
 */

/** Cuánto se espera el lock antes de rendirse. */
export const LOCK_TIMEOUT_MS = 5_000

/**
 * A partir de cuándo un lock se considera abandonado.
 *
 * Tiene que ser MENOR que el timeout: si fuera mayor, un lock huérfano recién
 * creado (un proceso muerto a mitad de escritura) haría que todos los demás
 * esperaran el timeout completo y fallaran, sin poder reclamarlo nunca.
 */
export const LOCK_STALE_MS = 2_000

let tmpCounter = 0

/**
 * Escribe `contents` de forma atómica: a un temporal y después rename encima.
 * Un rename en el mismo filesystem es atómico, así que un lector jamás ve un
 * archivo a medio escribir — y chokidar está mirando estos archivos.
 *
 * El nombre del temporal es único por escritura. Con uno fijo, dos procesos
 * se pisan el temporal y uno falla con ENOENT al renombrar.
 */
export function writeFileAtomic(fullPath: string, contents: string): void {
  mkdirSync(dirname(fullPath), { recursive: true })

  const tmpPath = `${fullPath}.${process.pid.toString(36)}.${(tmpCounter++).toString(36)}.tmp`
  try {
    writeFileSync(tmpPath, contents, 'utf8')
    renameSync(tmpPath, fullPath)
  } catch (error) {
    try {
      rmSync(tmpPath, { force: true })
    } catch {
      // Si tampoco se puede borrar, el error original es el que importa.
    }
    throw error
  }
}

export type LockOutcome<T> = { ok: true; value: T } | { ok: false; error: string }

/**
 * Serializa un ciclo leer-modificar-escribir contra otros procesos.
 *
 * Dentro de un proceso no hace falta: todo este camino es síncrono. Es entre
 * procesos donde dos `read` simultáneos ven el mismo estado y el segundo
 * `write` pisa al primero.
 *
 * Devuelve un resultado en vez de tirar: quien llama expone esto como un 500
 * HTTP o un error de herramienta MCP, y un throw se convertía en un stack sin
 * contexto.
 */
export function withFileLock<T>(fullPath: string, work: () => T): LockOutcome<T> {
  const lockPath = `${fullPath}.lock`
  const deadline = Date.now() + LOCK_TIMEOUT_MS
  let handle: number | undefined

  while (handle === undefined) {
    try {
      mkdirSync(dirname(lockPath), { recursive: true })
      handle = openSync(lockPath, 'wx')
      // El pid queda escrito para que otro proceso pueda ver si sigo vivo.
      writeFileSync(handle, String(process.pid), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        return { ok: false, error: `could not lock ${fullPath}: ${message(error)}` }
      }

      if (isAbandoned(lockPath)) {
        rmSync(lockPath, { force: true })
        continue
      }

      if (Date.now() > deadline) {
        // Seguir sin el lock es peor que fallar: se perderían escrituras en
        // silencio, que es justo lo que esto viene a evitar.
        return { ok: false, error: `timed out waiting for the lock on ${fullPath}` }
      }

      sleepBriefly()
    }
  }

  try {
    return { ok: true, value: work() }
  } finally {
    closeSync(handle)
    rmSync(lockPath, { force: true })
  }
}

/**
 * Si el lock quedó abandonado y se puede reclamar.
 *
 * Manda el pid, no la antigüedad: si el dueño murió se reclama al instante,
 * y si está VIVO se espera aunque el lock sea viejo — robárselo a alguien que
 * simplemente va lento perdería su escritura, que es justo lo que este lock
 * existe para evitar. La edad queda sólo como respaldo para cuando el pid no
 * se puede leer (lock a medio escribir, o un directorio compartido entre
 * máquinas donde el pid no significa nada acá).
 */
function isAbandoned(lockPath: string): boolean {
  const owner = readOwner(lockPath)

  // No se pudo leer el pid: sólo queda la antigüedad.
  if (owner === null) return isOlderThanStale(lockPath)

  // Nuestro propio lock. Este camino es síncrono, así que no podemos estarlo
  // sosteniendo ahora mismo: sobró de una llamada anterior que murió entre
  // el open y el finally.
  if (owner === process.pid) return true

  return !isAlive(owner)
}

function readOwner(lockPath: string): number | null {
  try {
    const pid = Number(readFileSync(lockPath, 'utf8').trim())
    return Number.isInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

function isAlive(pid: number): boolean {
  try {
    // Señal 0: no manda nada, sólo comprueba que el proceso exista.
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM = existe pero es de otro usuario, o sea está vivo.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function isOlderThanStale(lockPath: string): boolean {
  try {
    return Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS
  } catch {
    // Desapareció mientras mirábamos: que el próximo intento lo tome.
    return false
  }
}

/** Espera sin async: todo el camino de escritura es síncrono a propósito. */
function sleepBriefly(): void {
  const buffer = new Int32Array(new SharedArrayBuffer(4))
  Atomics.wait(buffer, 0, 0, 5)
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
