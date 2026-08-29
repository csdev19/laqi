// apps/cli/src/watcher.ts
import { relative, sep } from 'node:path'
import { watch, type FSWatcher } from 'chokidar'

// Is `relativePath` the target itself, an ancestor of it (so we can walk
// down into it), or something inside it?
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

  // chokidar 4 doesn't watch paths that don't exist yet, so we watch the
  // project root and PRUNE everything that isn't the mocks folder or file.
  // That way a fresh project (F9) detects `laqi/` when it gets created,
  // without indexing src/ or node_modules.
  // dir/file can be nested paths ("config/mocks"): comparing only the
  // first segment pruned them whole. We normalize to OS separators to
  // compare against `relative()`, which already uses `sep`.
  const normalizedDir = dir.split('/').join(sep)
  const normalizedFile = file.split('/').join(sep)

  const watcher: FSWatcher = watch(root, {
    ignoreInitial: true,
    ignored: (path: string) => {
      if (path === root) return false
      const relativePath = relative(root, path)
      // Dotfiles include .laqi/state.json, which we write ourselves:
      // watching it would be an infinite reload loop.
      if (relativePath.split(sep).some((part) => part.startsWith('.'))) return true
      return (
        !matchesTarget(relativePath, normalizedDir) && !matchesTarget(relativePath, normalizedFile)
      )
    },
  })

  let timer: ReturnType<typeof setTimeout> | undefined

  // A single save fires several events; without debounce it would reload
  // more than necessary.
  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(onChange, debounceMs)
  }

  // v1 only listened for 'change', so creating or deleting files didn't reload.
  watcher.on('add', schedule).on('change', schedule).on('unlink', schedule)

  return {
    close: async () => {
      if (timer) clearTimeout(timer)
      await watcher.close()
    },
  }
}
