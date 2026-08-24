// apps/cli/src/watcher.ts
import { relative, sep } from 'node:path'
import { watch, type FSWatcher } from 'chokidar'

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
  const watcher: FSWatcher = watch(root, {
    ignoreInitial: true,
    ignored: (path: string) => {
      if (path === root) return false
      const parts = relative(root, path).split(sep)
      // Los dotfiles incluyen .laqi/state.json, que escribimos nosotros:
      // observarlo sería un bucle de recarga infinito.
      if (parts.some((part) => part.startsWith('.'))) return true
      return parts[0] !== dir && parts[0] !== file
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
