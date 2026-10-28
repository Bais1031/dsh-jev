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
    const controller = new DshJevConfigCardController(scope, credentials, statusStub())
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

  it('blocks invalid transport fields before any Host mutation', () => {
    const scope = new TestScope({ timeoutMs: 10_000, decisionMode: 'off' })
    const controller = new DshJevConfigCardController(scope, credentialStub(), statusStub())
    try {
      const face = controller.inject()
      face.edit('timeoutMs', '0')
      face.edit('endpoint', 'not-a-url')
      face.edit('decisionMode', 'automatic')
      face.edit('decisionNodes', 'task-intake, task-intake')
      expect(face.hooks.dshJevConfigCard.getSnapshot()).toMatchObject({
        dirty: true,
        invalid: true,
        timeoutMs: { invalid: true },
        endpoint: { invalid: true },
        decisionMode: { invalid: true },
        decisionNodes: { invalid: true },
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
      timeoutMs: 10_000,
      decisionMode: 'off',
      decisionNodes: ['task-intake'],
    })
    let configured = false
    const credentials: CredentialAccess = {
      describe: vi.fn(async refs => ({
        ok: true,
        value: { [refs[0] ?? '']: { configured, writable: true } },
      })),
      set: vi.fn(async () => { configured = true; return { ok: true } }),
    }
    const controller = new DshJevConfigCardController(scope, credentials, statusStub())
    try {
      const face = controller.inject()
      face.edit('apiKeyEnv', 'JEV_ROUTER_KEY')
      face.edit('timeoutMs', '9000')
      face.edit('decisionMode', 'shadow')
      face.edit('decisionNodes', 'task-intake, tool-recovery')
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
        { op: 'set', path: ['timeoutMs'], value: 9000 },
        { op: 'set', path: ['decisionMode'], value: 'shadow' },
        { op: 'set', path: ['decisionNodes'], value: ['task-intake', 'tool-recovery'] },
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
    const controller = new DshJevConfigCardController(scope, credentials, statusStub())
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

  it('publishes connection and content-free Session summary states', async () => {
    const scope = new TestScope({ apiKeyEnv: DEFAULT_API_KEY_REF })
    const status = {
      testConnection: vi.fn(async () => ({ ok: true as const, model: 'jev-live', latencyMs: 17 })),
      latestSessionSummary: vi.fn(async () => ({
        sessionId: 'session-1', calls: 2, successes: 1, failures: 1, pending: 0,
        inputTokens: 20, outputTokens: 4, totalTokens: 24, totalLatencyMs: 33,
      })),
    }
    const controller = new DshJevConfigCardController(scope, credentialStub(), status)
    try {
      const face = controller.inject()
      face.testConnection()
      face.refreshSummary()
      await vi.waitFor(() => {
        expect(face.hooks.dshJevConfigCard.getSnapshot()).toMatchObject({
          connectionTest: { status: 'success', model: 'jev-live', latencyMs: 17 },
          latestSessionSummary: { sessionId: 'session-1', totalTokens: 24 },
          summaryLoading: false,
          summaryFailed: false,
        })
      })
      expect(status.testConnection).toHaveBeenCalledOnce()
      expect(status.latestSessionSummary).toHaveBeenCalledOnce()
    } finally {
      controller.dispose()
    }
  })

  it('contains remote failures and ignores results after disposal', async () => {
    const pending = deferred<{ readonly ok: true; readonly model: string; readonly latencyMs: number }>()
    const status = {
      testConnection: vi.fn(() => pending.promise),
      latestSessionSummary: vi.fn(async () => { throw new Error('transport detail') }),
    }
    const controller = new DshJevConfigCardController(new TestScope({}), credentialStub(), status)
    const face = controller.inject()
    face.refreshSummary()
    await vi.waitFor(() => {
      expect(face.hooks.dshJevConfigCard.getSnapshot()).toMatchObject({ summaryLoading: false, summaryFailed: true })
    })
    face.testConnection()
    controller.dispose()
    pending.resolve({ ok: true, model: 'late', latencyMs: 1 })
    await Promise.resolve()
    expect(face.hooks.dshJevConfigCard.getSnapshot().connectionTest).toEqual({ status: 'testing' })
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

function statusStub() {
  return {
    testConnection: async () => ({ ok: true as const, model: 'jev-test', latencyMs: 1 }),
    latestSessionSummary: async () => null,
  }
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(fulfill => { resolve = fulfill })
  return { promise, resolve }
}
