// apps/cli/src/watcher.ts
import { relative, sep } from 'node:path'
import { watch, type FSWatcher } from 'chokidar'

// ¿`relativePath` es el propio target, un ancestro suyo (para poder bajar
// hasta él) o algo dentro de él?
function matchesTarget(relativePath: string, target: string): boolean {
  return (
    relativePath === target ||
    relativePath.startsWith(`${target}${sep}`) ||
    target.startsWith(`${relativePath}${sep}`)
  )
}

export function watchMocks(options: {
  root: string
  dir: string
  file: string
  onChange: () => void
  debounceMs?: number
}): { close: () => Promise<void> } {
  const { root, dir, file, onChange, debounceMs = 60 } = options

  // chokidar 4 no observa rutas que todavía no existen, así que observamos la
  // raíz del proyecto y PODAMOS todo lo que no sea la carpeta o el archivo de
  // mocks. Así un proyecto fresco (F9) detecta `laqi/` cuando se crea, sin
  // indexar src/ ni node_modules.
  // dir/file pueden ser rutas anidadas ("config/mocks"): comparar sólo el
  // primer segmento las podaba enteras. Normalizamos a separadores del SO
  // para comparar contra `relative()`, que ya usa `sep`.
  const normalizedDir = dir.split('/').join(sep)
  const normalizedFile = file.split('/').join(sep)

  const watcher: FSWatcher = watch(root, {
    ignoreInitial: true,
    ignored: (path: string) => {
      if (path === root) return false
      const relativePath = relative(root, path)
      // Los dotfiles incluyen .laqi/state.json, que escribimos nosotros:
      // observarlo sería un bucle de recarga infinito.
      if (relativePath.split(sep).some((part) => part.startsWith('.'))) return true
      return (
        !matchesTarget(relativePath, normalizedDir) && !matchesTarget(relativePath, normalizedFile)
      )
    },
  })

  let timer: ReturnType<typeof setTimeout> | undefined

  // Un guardado dispara varios eventos; sin debounce se recargaría de más.
  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(onChange, debounceMs)
  }

  // v1 sólo escuchaba 'change', así que crear o borrar archivos no recargaba.
  watcher.on('add', schedule).on('change', schedule).on('unlink', schedule)

  return {
    close: async () => {
      if (timer) clearTimeout(timer)
      await watcher.close()
    },
  }
}
