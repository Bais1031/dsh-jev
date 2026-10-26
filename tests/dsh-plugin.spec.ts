import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'
import DshDecisionService, { Config } from '../src/dsh-plugin.js'

const seenUserQuestions: AskUserQuestionRequest[] = []

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

class TestUserQuestions extends Service {
  constructor(ctx: Context) {
    super(ctx, 'userQuestions')
  }

  ask(request: AskUserQuestionRequest) {
    seenUserQuestions.push(request)
    const question = request.questions[0]
    const label = question?.options?.[0]?.label ?? ''
    return Promise.resolve({ answers: [{ id: question?.id ?? '', selected: [label] }] })
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('DSH plugin integration', () => {
  it('publishes every browser-editable field as live configuration', () => {
    const fields = [
      'apiKeyEnv', 'endpoint', 'model', 'timeoutMs', 'maxInputBytes',
      'routingMode', 'fallbackPolicy', 'minimumConfidence', 'minimumMargin', 'metricsEnabled',
      'routerMaxInputCharacters',
      'fastRoute', 'standardRoute', 'deepRoute',
    ]
    expect(fields.map(field => [field, Config.dict?.[field]?.meta.volatile]))
      .toEqual(fields.map(field => [field, true]))
    expect(Config.dict?.providerName?.meta.volatile).toBeUndefined()
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

  it('uses the DSH question service before applying an Advisory route', async () => {
    seenUserQuestions.length = 0
    vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>().mockResolvedValue(routerJevResponse('deep')))
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime, {})
    await ctx.plugin(TestCredentials, ['key'])
    await ctx.plugin(TestUserQuestions)
    await ctx.plugin(DshDecisionService, {
      routingMode: 'advisory',
      deepRoute: { provider: 'premium', model: 'reasoner' },
    })
    const session = Session.create(SessionId('advisory-plugin'))
    const agent = { session } as Agent
    const messages = [createUserMessage({ content: [{ type: 'text', text: 'Analyze this carefully' }], source: { kind: 'user' } })]
    try {
      await ctx.waterfall(
        ctx as never,
        'agent/pre-step',
        { agent, messages, turn: 1, step: 1, signal: new AbortController().signal },
        () => Promise.resolve({ kind: 'enter' as const, messages }),
      )
      const selected = await ctx.waterfall(
        ctx as never,
        'agent/request',
        { agent, turn: 1, step: 1, signal: new AbortController().signal },
        () => Promise.resolve({ provider: 'main', model: 'standard' }),
      )

      expect(selected).toEqual({ provider: 'premium', model: 'reasoner' })
      expect(seenUserQuestions[0]?.questions[0]).toMatchObject({ id: 'dsh-jev-route' })
      expect(seenUserQuestions[0]?.questions[0]?.options?.[0]?.label).toBe('Use premium/reasoner')
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

function routerJevResponse(route: 'deep'): Response {
  return new Response(JSON.stringify({
    model: 'jev-1.14',
    answers: {
      taskType: { type: 'choice', choice: 'analysis', confidence: 0.8, probabilities: { coding: 0.05, retrieval: 0.05, writing: 0.05, analysis: 0.8, operation: 0.05 } },
      complexity: { type: 'choice', choice: 'high', confidence: 0.9, probabilities: { low: 0.03, medium: 0.07, high: 0.9 } },
      needsLatestInformation: { type: 'noul', noul: 0.05 },
      needsTools: { type: 'noul', noul: 0.2 },
      needsDelegation: { type: 'noul', noul: 0.2 },
      ambiguity: { type: 'choice', choice: 'low', confidence: 0.9, probabilities: { low: 0.9, medium: 0.08, high: 0.02 } },
      risk: { type: 'choice', choice: 'low', confidence: 0.95, probabilities: { low: 0.95, medium: 0.04, high: 0.01 } },
      route: { type: 'choice', choice: route, confidence: 0.9, probabilities: { fast: 0.03, standard: 0.05, deep: 0.9, 'ask-user': 0.02 } },
    },
    usage: { input_tokens: 30, output_tokens: 4 },
  }), { headers: { 'content-type': 'application/json' } })
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((fulfill) => { resolve = fulfill })
  return { promise, resolve }
}
