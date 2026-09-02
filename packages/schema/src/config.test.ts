import { describe, expect, it } from 'vitest'
import { ConfigSchema } from './config'

// Every laqi run passes through these defaults, and two of them are
// promises the docs make: the server binds loopback, and it listens on
// 8000. A change here silently changes the URL in every tutorial.

describe('ConfigSchema', () => {
  it('fills in a complete config from nothing', () => {
    expect(ConfigSchema.parse({})).toEqual({
      port: 8000,
      host: '127.0.0.1',
      dir: 'laqi',
      file: 'laqi.json',
      cors: '*',
      density: 'regular',
      showDescriptions: true,
    })
  })

  // Loopback, not 0.0.0.0: reaching laqi from another device is what
  // --share is for, and it is off by default on purpose.
  it('binds loopback by default', () => {
    expect(ConfigSchema.parse({}).host).toBe('127.0.0.1')
  })

  it('keeps the values it is given', () => {
    const config = ConfigSchema.parse({ port: 4000, dir: 'mocks', density: 'compact' })

    expect(config.port).toBe(4000)
    expect(config.dir).toBe('mocks')
    expect(config.density).toBe('compact')
    expect(config.host).toBe('127.0.0.1')
  })

  // 0 means "let the OS pick", which the tests rely on to run in parallel.
  it('accepts port 0 and the top of the range', () => {
    expect(ConfigSchema.parse({ port: 0 }).port).toBe(0)
    expect(ConfigSchema.parse({ port: 65535 }).port).toBe(65535)
  })

  it('rejects ports that are not real ports', () => {
    for (const port of [-1, 65536, 8000.5, '8000']) {
      expect(ConfigSchema.safeParse({ port }).success, `accepted ${String(port)}`).toBe(false)
    }
  })

  it('takes cors as the wildcard or as an allowlist, and nothing else', () => {
    expect(ConfigSchema.parse({ cors: '*' }).cors).toBe('*')
    expect(ConfigSchema.parse({ cors: ['http://localhost:5173'] }).cors).toEqual([
      'http://localhost:5173',
    ])
    expect(ConfigSchema.safeParse({ cors: 'http://localhost:5173' }).success).toBe(false)
  })

  it('rejects a density the panel cannot render', () => {
    expect(ConfigSchema.safeParse({ density: 'cosy' }).success).toBe(false)
  })
})
