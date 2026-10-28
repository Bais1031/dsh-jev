import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { pluginRecordOf, Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import DshDecisionService, { Config } from '../src/dsh-plugin.js'

class TestCredentials extends Service {
  private readonly values: string[]

  constructor(ctx: Context, values: string[]) {
    super(ctx, 'credentials')
    this.values = [...values]
  }

  resolve(): Promise<{ value: string; source: string } | undefined> {
    const value = this.values.shift()
    return Promise.resolve(value === undefined ? undefined : { value, source: 'test' })
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('DSH plugin integration', () => {
  it('publishes every browser-editable field as live configuration', () => {
    const fields = [
      'apiKeyEnv', 'endpoint', 'model', 'timeoutMs', 'maxInputBytes',
      'decisionMode', 'decisionNodes', 'decisionCooldownSteps', 'decisionMaxCallsPerSession',
      'decisionProgressCheckStep', 'decisionMinimumTaskInputCharacters', 'decisionMaxInputCharacters',
      'decisionMaxOutputTokens', 'decisionMinimumConfidence',
      'decisionIncludeToolResultSummaries', 'decisionToolResultSummaryCharacters',
    ]
    expect(fields.map(field => [field, Config.dict?.[field]?.meta.volatile]))
      .toEqual(fields.map(field => [field, true]))
    expect(Config.dict?.providerName?.meta.volatile).toBeUndefined()
  })

  it('exposes marked Host operations and returns only safe connection metadata', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(JSON.stringify({
      model: 'jev-1.14',
      answers: { reachable: { type: 'noul', noul: 0.99 } },
      usage: { input_tokens: 3, output_tokens: 1 },
    }), { headers: { 'content-type': 'application/json' } })))
    const ctx = await boot(['connection-key'])
    try {
      expect(remoteMethods(ctx.decisions).map(method => method.exportName)).toEqual([
        'testConnection',
        'latestSessionSummary',
      ])
      await expect(ctx.decisions.remoteTestConnection(new AbortController().signal)).resolves.toEqual({
        ok: true,
        model: 'jev-1.14',
        latencyMs: expect.any(Number),
      })
      await expect(ctx.decisions.remoteLatestSessionSummary()).resolves.toBeNull()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('publishes ctx.decisions, registers jev_decide, and resolves rotated credentials', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jevResponse(0.08))
      .mockResolvedValueOnce(jevResponse(0.91))
    vi.stubGlobal('fetch', fetch)
    const ctx = await boot(['key-one', 'key-two'])
    try {
      expect(ctx.get('decisions')).toBeDefined()
      expect(ctx.tools.schemas().map(schema => schema.name)).toContain('jev_decide')

      const first = await execute(ctx, 'first')
      const second = await execute(ctx, 'second')
      expect(first.isError).toBe(false)
      expect(second.isError).toBe(false)
      if (first.isError || second.isError) throw new Error('expected successful tool results')
      expect(first.value).toMatchObject({
        provider: 'jev',
        model: 'jev-1.14',
        answers: {
          risky: { type: 'boolean', value: false, probability: 0.08 },
          task: { type: 'choice', value: 'coding' },
        },
        usage: { inputTokens: 30, outputTokens: 4 },
      })
      expect(second.value).toMatchObject({
        answers: { risky: { value: true, probability: 0.91 } },
      })
      expect(fetch.mock.calls.map(call => (call[1]?.headers as Record<string, string>).authorization))
        .toEqual(['Bearer key-one', 'Bearer key-two'])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('returns actionable credential guidance without dispatching HTTP', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    vi.stubGlobal('fetch', fetch)
    const ctx = await boot([])
    try {
      const result = await execute(ctx, 'missing-key')
      expect(result).toMatchObject({
        isError: true,
        error: { message: expect.stringContaining('JEV_API_KEY') },
      })
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('rejects malformed dynamic questions before dispatching HTTP', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    vi.stubGlobal('fetch', fetch)
    const ctx = await boot(['unused'])
    try {
      const result = await ctx.tools.execute({
        signal: new AbortController().signal,
        callId: ToolCallId('invalid-question'),
        name: 'jev_decide',
        arguments: {
          state: 'text',
          questions: { route: { type: 'choice', options: {} } },
        },
      })
      expect(result).toMatchObject({
        isError: true,
        error: { message: expect.stringContaining('1 to 255') },
      })
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('aborts and drains an admitted tool call before plugin disposal completes', async () => {
    const started = deferred<void>()
    const aborted = deferred<void>()
    const release = deferred<void>()
    vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>().mockImplementation(async (_input, init) => {
      started.resolve()
      await new Promise<void>((resolve) => {
        if (init?.signal?.aborted === true) resolve()
        else init?.signal?.addEventListener('abort', () => resolve(), { once: true })
      })
      aborted.resolve()
      await release.promise
      throw init?.signal?.reason ?? new Error('aborted')
    }))

    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime, {})
    await ctx.plugin(TestCredentials, ['key'])
    const plugin = await ctx.plugin(DshDecisionService, {})
    try {
      const execution = execute(ctx, 'dispose')
      await started.promise
      let disposed = false
      const disposal = plugin.dispose().then(() => { disposed = true })
      await aborted.promise
      await Promise.resolve()
      expect(disposed).toBe(false)

      release.resolve()
      const result = await execution
      expect(result.isError).toBe(true)
      await disposal
      expect(ctx.get('decisions')).toBeUndefined()
      expect(ctx.tools.schemas().map(schema => schema.name)).not.toContain('jev_decide')
    } finally {
      release.resolve()
      await ctx.fiber.dispose()
    }
  })

  it('records Shadow guidance without changing the downstream model route', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>().mockResolvedValue(decisionGuidanceResponse()))
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime, {})
    await ctx.plugin(TestCredentials, ['key'])
    await ctx.plugin(DshDecisionService, {
      decisionMode: 'shadow',
      decisionNodes: ['task-intake'],
      decisionCooldownSteps: 0,
      decisionMinimumTaskInputCharacters: 1,
    })
    const session = Session.create(SessionId('shadow-plugin'))
    const agent = { session } as Agent
    const messages = [createUserMessage({
      content: [{ type: 'text', text: 'Analyze this decision.' }],
      source: { kind: 'user' },
    })]
    const selected = { provider: 'main', model: 'user-selected' } as const
    try {
      await ctx.waterfall(
        ctx as never,
        'agent/pre-step',
        { agent, messages, turn: 1, step: 1, signal: new AbortController().signal },
        () => Promise.resolve({ kind: 'enter' as const, messages }),
      )
      const actual = await ctx.waterfall(
        ctx as never,
        'agent/request',
        { agent, turn: 1, step: 1, signal: new AbortController().signal },
        () => Promise.resolve(selected),
      )

      expect(actual).toBe(selected)
      expect(session.snapshotEvents().map(pluginRecordOf).filter(Boolean).map(record => record?.type)).toEqual([
        'plugin:dsh-jev/decision-request',
        'plugin:dsh-jev/decision-result',
      ])
    } finally {
      await ctx.fiber.dispose()
    }
  })

})

async function boot(credentials: string[]): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime, {})
  await ctx.plugin(TestCredentials, credentials)
  await ctx.plugin(DshDecisionService, {})
  return ctx
}

async function execute(ctx: Context, id: string) {
  return await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(id),
    name: 'jev_decide',
    arguments: {
      state: { message: 'Review this change' },
      questions: {
        risky: {
          type: 'boolean',
          instructions: 'Does this authorize a high-risk operation?',
        },
        task: {
          type: 'choice',
          options: { coding: 'Code work', writing: 'Writing work' },
        },
      },
    },
  })
}

function jevResponse(risk: number): Response {
  return new Response(JSON.stringify({
    model: 'jev-1.14',
    answers: {
      risky: { type: 'noul', noul: risk },
      task: {
        type: 'choice',
        choice: 'coding',
        confidence: 0.8,
        probabilities: { coding: 0.8, writing: 0.2 },
      },
    },
    usage: { input_tokens: 30, output_tokens: 4 },
  }), { headers: { 'content-type': 'application/json' } })
}

function decisionGuidanceResponse(): Response {
  return new Response(JSON.stringify({
    model: 'jev-1.14',
    answers: {
      taskType: answer('analysis', { coding: 0.05, retrieval: 0.05, writing: 0.05, analysis: 0.8, operation: 0.05 }),
      informationSufficient: { type: 'noul', noul: 0.8 },
      recommendedAction: answer('inspect-context', {
        continue: 0.02, 'ask-user': 0.03, 'inspect-context': 0.8, search: 0.03,
        'use-tool': 0.04, 'change-direction': 0.03, answer: 0.03, stop: 0.02,
      }),
      focus: answer('verify-assumptions', {
        'clarify-goal': 0.01, 'verify-assumptions': 0.8, 'inspect-local-context': 0.1,
        'gather-external-evidence': 0.01, 'compare-options': 0.05, 'recover-tool': 0.01,
        'synthesize-evidence': 0.01, 'answer-directly': 0.01,
      }),
      avoid: answer('unsupported-assumption', {
        'unsupported-assumption': 0.8, 'broad-search': 0.05, 'repeat-failed-action': 0.05,
        'premature-conclusion': 0.05, 'unnecessary-tool': 0.03, none: 0.02,
      }),
      risk: answer('medium', { low: 0.2, medium: 0.7, high: 0.1 }),
      ambiguity: answer('low', { low: 0.8, medium: 0.15, high: 0.05 }),
    },
    usage: { input_tokens: 30, output_tokens: 8 },
  }), { headers: { 'content-type': 'application/json' } })
}

function answer(choice: string, probabilities: Readonly<Record<string, number>>) {
  return { type: 'choice', choice, confidence: probabilities[choice] ?? 0, probabilities }
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((fulfill) => { resolve = fulfill })
  return { promise, resolve }
}
