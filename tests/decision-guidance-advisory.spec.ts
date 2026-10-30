import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { pluginRecordOf, Session, SessionId } from '@deepseek-ai/dsh-session'
import { DecisionError } from '../src/decision-errors.js'
import {
  installDecisionGuidanceShadow,
  renderDecisionAdvisory,
  type DecisionGuidanceMode,
} from '../src/decision-guidance-shadow.js'
import { decisionProviderName, type DecisionResult } from '../src/decision-types.js'

describe('decision guidance Advisory integration', () => {
  it('injects and durably records one accepted brief without granting authority', async () => {
    const ctx = new Context()
    const session = Session.create(SessionId('advisory-success'))
    const agent = { session } as Agent
    const decide = vi.fn(async () => result())
    installDecisionGuidanceShadow(ctx, { decide }, options('advisory'))

    const decision = await propose(ctx, agent, 1, 1, 'Compare two architecture options.')
    expect(decision.kind).toBe('enter')
    if (decision.kind !== 'enter') throw new Error('Expected an admitted step')
    expect(decision.messages).toHaveLength(2)
    const advisory = decision.messages[1]
    expect(advisory?.source).toMatchObject({ kind: 'dsh-jev-advisory', form: 'snapshot' })
    const content = advisory?.content[0]?.type === 'text' ? advisory.content[0].text : undefined
    expect(content).toContain('Non-authoritative analysis guidance')
    expect(content).toContain('You may accept, adapt, or reject it.')
    expect(content).toContain('grants no permission to use tools or perform external actions')

    const [requestRecord, resultRecord, advisoryRecord] = records(session)
    expect(requestRecord).toMatchObject({ data: { mode: 'advisory', nodeType: 'direction-selection' } })
    expect(resultRecord).toMatchObject({ data: { requestSeq: requestRecord?.seq, status: 'success' } })
    expect(advisoryRecord).toMatchObject({
      type: 'plugin:dsh-jev/decision-advisory',
      data: {
        requestSeq: requestRecord?.seq,
        resultSeq: resultRecord?.seq,
        content,
      },
    })
    expect(advisory?.source).toMatchObject({ requestSeq: requestRecord?.seq, resultSeq: resultRecord?.seq })
    await ctx.fiber.dispose()
  })

  it('injects at most once for one turn and step', async () => {
    const ctx = new Context()
    const session = Session.create(SessionId('advisory-once'))
    const agent = { session } as Agent
    const decide = vi.fn(async () => result())
    installDecisionGuidanceShadow(ctx, { decide }, options('advisory'))

    const first = await propose(ctx, agent, 1, 1, 'Analyze and compare options.')
    const retried = await propose(ctx, agent, 1, 1, 'Analyze and compare options.')
    expect(first.kind === 'enter' && first.messages).toHaveLength(2)
    expect(retried.kind === 'enter' && retried.messages).toHaveLength(1)
    expect(decide).toHaveBeenCalledOnce()
    expect(records(session)).toHaveLength(3)
    await ctx.fiber.dispose()
  })

  it.each([
    ['low confidence', async () => lowConfidenceResult(), 'success'],
    ['invalid result', async () => ({ ...result(), answers: {} }), 'failure'],
    ['provider timeout', async () => {
      throw new DecisionError('DECISION_PROVIDER_FAILURE', 'private timeout detail', {
        retryable: true,
        provider: decisionProviderName('jev'),
        providerCode: 'JEV_TIMEOUT',
      })
    }, 'failure'],
  ] as const)('does not inject a %s result', async (_name, decide, status) => {
    const ctx = new Context()
    const session = Session.create(SessionId(`advisory-${_name.replace(' ', '-')}`))
    const agent = { session } as Agent
    installDecisionGuidanceShadow(ctx, { decide }, options('advisory'))

    const decision = await propose(ctx, agent, 1, 1, 'Analyze this architecture.')
    expect(decision.kind === 'enter' && decision.messages).toHaveLength(1)
    expect(records(session).at(-1)).toMatchObject({
      type: 'plugin:dsh-jev/decision-result',
      data: { status },
    })
    expect(records(session).some(record => record.type === 'plugin:dsh-jev/decision-advisory')).toBe(false)
    expect(JSON.stringify(records(session))).not.toContain('private timeout detail')
    await ctx.fiber.dispose()
  })

  it('injects a valid brief even when Jev reports high output usage', async () => {
    const ctx = new Context()
    const session = Session.create(SessionId('advisory-high-usage'))
    const agent = { session } as Agent
    installDecisionGuidanceShadow(ctx, {
      decide: async () => ({ ...result(), usage: { inputTokens: 500, outputTokens: 1_500 } }),
    }, options('advisory'))

    const decision = await propose(ctx, agent, 1, 1, 'Analyze this architecture.')

    expect(decision.kind === 'enter' && decision.messages).toHaveLength(2)
    expect(records(session)[1]).toMatchObject({
      data: { status: 'success', usage: { inputTokens: 500, outputTokens: 1_500 } },
    })
    await ctx.fiber.dispose()
  })

  it('records cancellation and preserves the turn cancellation', async () => {
    const ctx = new Context()
    const session = Session.create(SessionId('advisory-cancelled'))
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
    }, options('advisory'))
    const controller = new AbortController()

    const pending = propose(ctx, agent, 1, 1, 'Analyze this cancellation path.', controller.signal)
    await started.promise
    controller.abort(new Error('turn cancelled'))

    await expect(pending).rejects.toThrow('turn cancelled')
    expect(records(session).at(-1)).toMatchObject({ data: { status: 'failure', code: 'DECISION_CANCELLED' } })
    expect(records(session).some(record => record.type === 'plugin:dsh-jev/decision-advisory')).toBe(false)
    await ctx.fiber.dispose()
  })

  it('renders only fixed protocol values and bounded decimal probabilities', () => {
    const text = renderDecisionAdvisory({
      version: 2,
      nodeType: 'progress-check',
      taskType: 'analysis',
      informationSufficient: false,
      informationSufficientProbability: 0.12345,
      candidateDirections: [{ focus: 'compare-options', probability: 0.98765 }],
      recommendedAction: 'change-direction',
      focus: 'compare-options',
      avoid: 'repeat-failed-action',
      riskLevel: 'medium',
      ambiguity: 'high',
      confidence: 0.87654,
      accepted: true,
      reasons: [],
    })
    expect(text).toContain('Information sufficient: false (0.123)')
    expect(text).toContain('compare-options (0.988)')
    expect(text).toContain('confidence: 0.877')
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
  const messages = [createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })]
  return await ctx.waterfall(
    ctx as never,
    'agent/pre-step',
    { agent, messages, turn, step, signal },
    () => Promise.resolve({ kind: 'enter' as const, messages }),
  )
}

function options(mode: DecisionGuidanceMode) {
  return {
    mode: () => mode,
    model: () => 'jev-test',
    maximumInputCharacters: () => 6_000,
    deadlineMs: () => 3_000,
    minimumConfidence: () => 0.7,
    enabledNodes: () => [
      'task-intake', 'missing-information', 'direction-selection', 'tool-recovery', 'progress-check', 'pre-conclusion',
    ] as const,
    cooldownSteps: () => 0,
    maximumCallsPerSession: () => 8,
    progressCheckStep: () => 4,
    minimumTaskInputCharacters: () => 200,
    includeToolResultSummaries: () => false,
    toolResultSummaryCharacters: () => 1_000,
  }
}

function lowConfidenceResult(): DecisionResult {
  const base = result()
  return {
    ...base,
    answers: {
      ...base.answers,
      recommendedAction: choice('inspect-context', {
        continue: 0.1, 'ask-user': 0.1, 'inspect-context': 0.4, search: 0.1,
        'use-tool': 0.1, 'change-direction': 0.1, answer: 0.05, stop: 0.05,
      }),
    },
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
