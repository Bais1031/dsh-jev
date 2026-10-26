import { describe, expect, it, vi } from 'vitest'
import type {
  SettingsFormPathOp,
  SettingsFormScope,
  SettingsFormScopeSnapshot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  DEFAULT_API_KEY_REF,
  DshJevConfigCardController,
  type CredentialAccess,
  type DshJevSettings,
} from '../src/browser/config-card-controller.js'

describe('DshJevConfigCardController', () => {
  it('reports credential status without receiving the credential value', async () => {
    const scope = new TestScope({ apiKeyEnv: DEFAULT_API_KEY_REF })
    const credentials: CredentialAccess = {
      describe: vi.fn(async refs => ({
        ok: true,
        value: { [refs[0] ?? '']: { configured: true, writable: false } },
      })),
      set: vi.fn(async () => ({ ok: true })),
    }
    const controller = new DshJevConfigCardController(scope, credentials)
    try {
      await vi.waitFor(() => {
        expect(controller.inject().hooks.dshJevConfigCard.getSnapshot()).toMatchObject({
          apiKey: { text: '' },
          apiKeyConfigured: true,
          apiKeyWritable: false,
        })
      })
      expect(credentials.describe).toHaveBeenCalledWith([DEFAULT_API_KEY_REF])
    } finally {
      controller.dispose()
    }
  })

  it('blocks invalid router fields before any Host mutation', () => {
    const scope = new TestScope({ routingMode: 'off', minimumConfidence: 0.85 })
    const controller = new DshJevConfigCardController(scope, credentialStub())
    try {
      const face = controller.inject()
      face.edit('routingMode', 'sometimes')
      face.edit('minimumConfidence', '1.1')
      expect(face.hooks.dshJevConfigCard.getSnapshot()).toMatchObject({
        dirty: true,
        invalid: true,
        routingMode: { invalid: true },
        minimumConfidence: { invalid: true },
      })
      face.save()
      expect(scope.mutations).toEqual([])
    } finally {
      controller.dispose()
    }
  })

  it('saves settings atomically before writing the key under the accepted reference', async () => {
    const scope = new TestScope({
      apiKeyEnv: DEFAULT_API_KEY_REF,
      routingMode: 'off',
      minimumConfidence: 0.85,
      metricsEnabled: true,
    })
    let configured = false
    const credentials: CredentialAccess = {
      describe: vi.fn(async refs => ({
        ok: true,
        value: { [refs[0] ?? '']: { configured, writable: true } },
      })),
      set: vi.fn(async () => { configured = true; return { ok: true } }),
    }
    const controller = new DshJevConfigCardController(scope, credentials)
    try {
      const face = controller.inject()
      face.edit('apiKeyEnv', 'JEV_ROUTER_KEY')
      face.edit('routingMode', 'shadow')
      face.edit('minimumConfidence', '0.9')
      face.edit('metricsEnabled', 'false')
      face.edit('apiKey', 'secret-never-returned')
      face.save()

      await vi.waitFor(() => {
        expect(credentials.set).toHaveBeenCalledWith('JEV_ROUTER_KEY', 'secret-never-returned')
        expect(face.hooks.dshJevConfigCard.getSnapshot()).toMatchObject({
          dirty: false,
          failed: false,
          apiKeyConfigured: true,
        })
      })
      expect(scope.mutations).toEqual([[
        { op: 'set', path: ['apiKeyEnv'], value: 'JEV_ROUTER_KEY' },
        { op: 'set', path: ['routingMode'], value: 'shadow' },
        { op: 'set', path: ['minimumConfidence'], value: 0.9 },
        { op: 'set', path: ['metricsEnabled'], value: false },
      ]])
    } finally {
      controller.dispose()
    }
  })

  it('drops stale and post-disposal credential responses', async () => {
    const first = deferred<{ readonly ok: boolean; readonly value?: Readonly<Record<string, { configured: boolean; writable: boolean }>> }>()
    const second = deferred<{ readonly ok: boolean; readonly value?: Readonly<Record<string, { configured: boolean; writable: boolean }>> }>()
    const credentials: CredentialAccess = {
      describe: vi.fn((refs) => refs[0] === DEFAULT_API_KEY_REF ? first.promise : second.promise),
      set: vi.fn(async () => ({ ok: true })),
    }
    const scope = new TestScope({ apiKeyEnv: DEFAULT_API_KEY_REF })
    const controller = new DshJevConfigCardController(scope, credentials)
    const face = controller.inject()
    scope.replace({ apiKeyEnv: 'OTHER_KEY' })
    second.resolve({ ok: true, value: { OTHER_KEY: { configured: true, writable: true } } })
    await vi.waitFor(() => { expect(face.hooks.dshJevConfigCard.getSnapshot().apiKeyConfigured).toBe(true) })

    first.resolve({ ok: true, value: { [DEFAULT_API_KEY_REF]: { configured: false, writable: false } } })
    await Promise.resolve()
    expect(face.hooks.dshJevConfigCard.getSnapshot()).toMatchObject({
      apiKeyConfigured: true,
      apiKeyWritable: true,
    })

    controller.dispose()
    const third = deferred<{ readonly ok: boolean; readonly value?: Readonly<Record<string, { configured: boolean; writable: boolean }>> }>()
    credentials.describe = vi.fn(() => third.promise)
    controller.refreshCredential('OTHER_KEY')
    third.resolve({ ok: true, value: { OTHER_KEY: { configured: false, writable: false } } })
    await Promise.resolve()
    expect(face.hooks.dshJevConfigCard.getSnapshot()).toMatchObject({
      apiKeyConfigured: true,
      apiKeyWritable: true,
    })
  })
})

class TestScope implements SettingsFormScope<DshJevSettings> {
  readonly mutations: SettingsFormPathOp[][] = []
  private readonly listeners = new Set<() => void>()
  private snapshot: SettingsFormScopeSnapshot<DshJevSettings>

  constructor(value: DshJevSettings) {
    this.snapshot = { status: 'ready', value, base: value, user: {}, writable: true, revision: 1 }
  }

  getSnapshot(): SettingsFormScopeSnapshot<DshJevSettings> { return this.snapshot }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  async mutate(ops: readonly SettingsFormPathOp[]): Promise<boolean> {
    this.mutations.push([...ops])
    const next: Record<string, unknown> = { ...this.snapshot.value }
    const user: Record<string, unknown> = { ...this.snapshot.user as Record<string, unknown> }
    for (const op of ops) {
      const field = op.path[0]
      if (field === undefined) continue
      if (op.op === 'set') { next[field] = op.value; user[field] = op.value }
      else { delete next[field]; delete user[field] }
    }
    this.snapshot = {
      ...this.snapshot,
      value: next,
      user,
      revision: (this.snapshot.revision ?? 0) + 1,
    }
    for (const listener of this.listeners) listener()
    return true
  }

  replace(value: DshJevSettings): void {
    this.snapshot = { ...this.snapshot, value }
    for (const listener of this.listeners) listener()
  }
}

function credentialStub(): CredentialAccess {
  return {
    describe: async refs => ({
      ok: true,
      value: { [refs[0] ?? '']: { configured: false, writable: true } },
    }),
    set: async () => ({ ok: true }),
  }
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(fulfill => { resolve = fulfill })
  return { promise, resolve }
}
