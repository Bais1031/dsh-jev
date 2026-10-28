import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createToolResultMessage, createUserMessage, type LlmCallConfig, ToolCallId } from '@deepseek-ai/dsh-llm'
import { pluginRecordOf, Session, SessionId } from '@deepseek-ai/dsh-session'
import { DecisionError } from '../src/decision-errors.js'
import {
  installDecisionGuidanceShadow,
  type DecisionGuidanceMode,
} from '../src/decision-guidance-shadow.js'
import { decisionProviderName, type DecisionResult } from '../src/decision-types.js'

const ACTUAL_ROUTE = { provider: 'main', model: 'selected' } as const

describe('decision guidance Shadow integration', () => {
  it('does nothing in off mode and skips simple tasks in Shadow mode', async () => {
    for (const scenario of [
      { mode: 'off' as const, text: 'Analyze this failure.' },
      { mode: 'shadow' as const, text: 'Translate hello.' },
    ]) {
      const ctx = new Context()
      const session = Session.create(SessionId(`skip-${scenario.mode}`))
      const agent = { session } as Agent
      const decide = vi.fn(async () => result())
      installDecisionGuidanceShadow(ctx, { decide }, options(scenario.mode))
      await propose(ctx, agent, 1, 1, scenario.text)
      expect(await request(ctx, agent, 1, 1)).toBe(ACTUAL_ROUTE)
      expect(decide).not.toHaveBeenCalled()
      expect(records(session)).toEqual([])
      await ctx.fiber.dispose()
    }
  })

  it('records a paired brief while preserving the exact downstream route object', async () => {
    const ctx = new Context()
    const session = Session.create(SessionId('shadow-success'))
    const agent = { session } as Agent
    const decide = vi.fn(async () => result())
    installDecisionGuidanceShadow(ctx, { decide }, options('shadow'))

    const decision = await propose(ctx, agent, 1, 1, 'Analyze this architecture and compare the implementation options.')
    const actual = await request(ctx, agent, 1, 1)

    expect(actual).toBe(ACTUAL_ROUTE)
    expect(decision.kind === 'enter' && decision.messages).toHaveLength(1)
    expect(decide).toHaveBeenCalledOnce()
    const [requestRecord, resultRecord] = records(session)
    expect(requestRecord).toMatchObject({
      type: 'plugin:dsh-jev/decision-request',
      data: {
        strategyVersion: 'jev-decision-guidance-v1',
        questionVersion: 'decision-brief-v1',
        mode: 'shadow',
        nodeType: 'direction-selection',
        trigger: { reasons: ['multiple-direction-language'] },
      },
    })
    expect(resultRecord).toMatchObject({
      type: 'plugin:dsh-jev/decision-result',
      data: {
        requestSeq: requestRecord?.seq,
        status: 'success',
        brief: { nodeType: 'direction-selection', accepted: true, recommendedAction: 'inspect-context' },
        usage: { inputTokens: 10, outputTokens: 6 },
      },
    })
    await ctx.fiber.dispose()
  })

  it('records a safe provider failure and continues with the unchanged route', async () => {
    const ctx = new Context()
    const session = Session.create(SessionId('shadow-failure'))
    const agent = { session } as Agent
    installDecisionGuidanceShadow(ctx, {
      decide: async () => {
        throw new DecisionError('DECISION_PROVIDER_FAILURE', 'secret upstream text', {
          retryable: true,
          provider: decisionProviderName('jev'),
          providerCode: 'JEV_TIMEOUT',
          latencyMs: 25,
        })
      },
    }, options('shadow'))

    const decision = await propose(ctx, agent, 1, 1, 'Diagnose this complex failure.')
    expect(await request(ctx, agent, 1, 1)).toBe(ACTUAL_ROUTE)
    expect(decision.kind === 'enter' && decision.messages).toHaveLength(1)
    expect(records(session).at(-1)).toMatchObject({
      type: 'plugin:dsh-jev/decision-result',
      data: {
        status: 'failure',
        code: 'DECISION_PROVIDER_FAILURE',
        retryable: true,
        provider: 'jev',
        providerCode: 'JEV_TIMEOUT',
        latencyMs: 25,
      },
    })
    expect(JSON.stringify(records(session))).not.toContain('secret upstream text')
    await ctx.fiber.dispose()
  })

  it('bounds and records the exact request and does not repeat one proposed step', async () => {
    const ctx = new Context()
    const session = Session.create(SessionId('shadow-bounded'))
    const agent = { session } as Agent
    const decide = vi.fn(async () => result())
    installDecisionGuidanceShadow(ctx, { decide }, options('shadow', { maximumInputCharacters: 4 }))

    await propose(ctx, agent, 1, 1, 'Analyze abcdef.')
    await propose(ctx, agent, 1, 1, 'Analyze abcdef.')

    expect(decide).toHaveBeenCalledOnce()
    expect(records(session)[0]).toMatchObject({
      data: {
        inputSummary: { textCharacters: 15, includedCharacters: 4, truncated: true },
        request: { state: { content: 'Anal' } },
      },
    })
    await ctx.fiber.dispose()
  })

  it('includes only a configured bounded text excerpt from the immediately preceding tool result', async () => {
    const ctx = new Context()
    const session = Session.create(SessionId('shadow-tool-result'))
    const agent = { session } as Agent
    const callId = ToolCallId('read-1')
    session.append('tool/call', { turn: 1, step: 1, callId, name: 'read_file', arguments: '{"secret":"excluded"}' })
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId,
        content: [{ type: 'text', text: 'abcdef' }],
        isError: true,
      }),
      error: { name: 'ReadError', code: 'READ_FAILED' },
    }, { surfaceOp: 'append' })
    const decide = vi.fn(async () => result())
    installDecisionGuidanceShadow(ctx, { decide }, options('shadow', {
      maximumInputCharacters: 80,
      includeToolResultSummaries: true,
      toolResultSummaryCharacters: 3,
    }))

    await propose(ctx, agent, 1, 2, '')

    const requestRecord = records(session)[0]
    expect(requestRecord).toMatchObject({
      data: {
        inputSummary: { toolResultCharacters: 6, includedToolResultCharacters: 3, truncated: true },
        request: { state: { content: '<previous-tool-result-text>\nabc\n</previous-tool-result-text>' } },
      },
    })
    expect(JSON.stringify(requestRecord)).not.toContain('secret')
    await ctx.fiber.dispose()
  })

  it('records output-limit rejection without changing the main route', async () => {
    const ctx = new Context()
    const session = Session.create(SessionId('shadow-output-limit'))
    const agent = { session } as Agent
    installDecisionGuidanceShadow(ctx, {
      decide: async () => ({ ...result(), usage: { inputTokens: 10, outputTokens: 51 } }),
    }, options('shadow', { maximumOutputTokens: 50 }))

    const decision = await propose(ctx, agent, 1, 1, 'Review this architecture carefully.')
    expect(await request(ctx, agent, 1, 1)).toBe(ACTUAL_ROUTE)
    expect(decision.kind === 'enter' && decision.messages).toHaveLength(1)
    expect(records(session).at(-1)).toMatchObject({
      data: { status: 'failure', code: 'DECISION_GUIDANCE_OUTPUT_LIMIT_EXCEEDED', retryable: false },
    })
    await ctx.fiber.dispose()
  })

  it('records provider cancellation and preserves the turn cancellation signal', async () => {
    const ctx = new Context()
    const session = Session.create(SessionId('shadow-cancelled'))
    const agent = { session } as Agent
    const started = deferred<void>()
    installDecisionGuidanceShadow(ctx, {
      decide: async (_request, call) => {
        started.resolve()
        await new Promise<void>((resolve) => {
          if (call?.signal?.aborted === true) resolve()
          else call?.signal?.addEventListener('abort', () => resolve(), { once: true })
        })
        throw new DecisionError('DECISION_CANCELLED', 'cancelled', { retryable: false })
      },
    }, options('shadow'))
    const controller = new AbortController()

    const pending = propose(ctx, agent, 1, 1, 'Analyze this cancellation path.', controller.signal)
    await started.promise
    controller.abort(new Error('turn cancelled'))

    await expect(pending).rejects.toThrow('turn cancelled')
    expect(records(session).at(-1)).toMatchObject({
      data: { status: 'failure', code: 'DECISION_CANCELLED', retryable: false },
    })
    await ctx.fiber.dispose()
  })
})

async function propose(
  ctx: Context,
  agent: Agent,
  turn: number,
  step: number,
  text: string,
  signal: AbortSignal = new AbortController().signal,
): Promise<PreStepDecision> {
  const messages = text.length === 0
    ? []
    : [createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })]
  return await ctx.waterfall(
    ctx as never,
    'agent/pre-step',
    { agent, messages, turn, step, signal },
    () => Promise.resolve({ kind: 'enter' as const, messages }),
  )
}

async function request(ctx: Context, agent: Agent, turn: number, step: number): Promise<LlmCallConfig> {
  return await ctx.waterfall(
    ctx as never,
    'agent/request',
    { agent, turn, step, signal: new AbortController().signal },
    () => Promise.resolve(ACTUAL_ROUTE),
  )
}

function options(mode: DecisionGuidanceMode, overrides: {
  readonly maximumInputCharacters?: number
  readonly maximumOutputTokens?: number
  readonly includeToolResultSummaries?: boolean
  readonly toolResultSummaryCharacters?: number
} = {}) {
  return {
    mode: () => mode,
    model: () => 'jev-test',
    maximumInputCharacters: () => overrides.maximumInputCharacters ?? 6_000,
    maximumOutputTokens: () => overrides.maximumOutputTokens ?? 250,
    minimumConfidence: () => 0.7,
    enabledNodes: () => [
      'task-intake', 'missing-information', 'direction-selection', 'tool-recovery', 'progress-check', 'pre-conclusion',
    ] as const,
    cooldownSteps: () => 0,
    maximumCallsPerSession: () => 8,
    progressCheckStep: () => 4,
    minimumTaskInputCharacters: () => 200,
    includeToolResultSummaries: () => overrides.includeToolResultSummaries ?? false,
    toolResultSummaryCharacters: () => overrides.toolResultSummaryCharacters ?? 1_000,
  }
}

function result(): DecisionResult {
  return {
    provider: decisionProviderName('jev'),
    model: 'jev-test',
    latencyMs: 4,
    usage: { inputTokens: 10, outputTokens: 6 },
    answers: {
      taskType: choice('coding', { coding: 0.8, retrieval: 0.05, writing: 0.05, analysis: 0.05, operation: 0.05 }),
      informationSufficient: { type: 'boolean', value: true, probability: 0.9, confidence: 0.9 },
      recommendedAction: choice('inspect-context', {
        continue: 0.02, 'ask-user': 0.03, 'inspect-context': 0.8, search: 0.03,
        'use-tool': 0.04, 'change-direction': 0.03, answer: 0.03, stop: 0.02,
      }),
      focus: choice('verify-assumptions', {
        'clarify-goal': 0.01, 'verify-assumptions': 0.8, 'inspect-local-context': 0.1,
        'gather-external-evidence': 0.01, 'compare-options': 0.05, 'recover-tool': 0.01,
        'synthesize-evidence': 0.01, 'answer-directly': 0.01,
      }),
      avoid: choice('unsupported-assumption', {
        'unsupported-assumption': 0.8, 'broad-search': 0.05, 'repeat-failed-action': 0.05,
        'premature-conclusion': 0.05, 'unnecessary-tool': 0.03, none: 0.02,
      }),
      risk: choice('medium', { low: 0.2, medium: 0.7, high: 0.1 }),
      ambiguity: choice('low', { low: 0.8, medium: 0.15, high: 0.05 }),
    },
  }
}

function choice(value: string, probabilities: Readonly<Record<string, number>>) {
  return { type: 'choice' as const, value, confidence: probabilities[value] ?? 0, probabilities }
}

function records(session: Session) {
  return session.snapshotEvents().map(pluginRecordOf).filter(record => record !== undefined)
}

function deferred<T>(): { readonly promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(fulfill => { resolve = fulfill })
  return { promise, resolve }
}
