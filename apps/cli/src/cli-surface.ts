// The CLI's public vocabulary — the commands and flags it accepts — in one
// side-effect-free module. index.ts owns the behaviour and imports the
// vocabulary from here; tests import it too, so a documented flag can be
// checked against the parser that will actually receive it. Importing
// index.ts for that is not an option: it invokes main() on load.

/** Positional commands. `start` is an alias for the default serve mode. */
export const CLI_COMMANDS = ['start', 'init', 'mcp', 'migrate'] as const

/** The shared parseArgs config. An unlisted flag makes parseArgs throw. */
export const CLI_ARGS_CONFIG = {
  allowPositionals: true,
  options: {
    port: { type: 'string' },
    host: { type: 'string' },
    dir: { type: 'string' },
    file: { type: 'string' },
    share: { type: 'boolean' },
    public: { type: 'boolean' },
    'share-port': { type: 'string' },
    'dry-run': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
} as const

/**
 * `laqi init` parses its own arguments (see init/args.ts) because `--script`
 * takes an optional value, which node's parseArgs cannot express. Its
 * vocabulary therefore has to be listed separately.
 */
export const INIT_FLAGS = [
  '--dir',
  '--from',
  '--spec',
  '--port',
  '--script',
  '--open',
  '--force',
  '--yes',
  '--help',
] as const
