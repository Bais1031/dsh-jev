import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, ReasoningEffortId, type LlmCallConfig } from '@deepseek-ai/dsh-llm'
import { pluginRecordOf, Session, SessionId } from '@deepseek-ai/dsh-session'
import { DecisionError } from '../src/decision-errors.js'
import { decisionProviderName, type DecisionResult } from '../src/decision-types.js'
import { installJevRouter, type RouterAdvisoryPrompt, type RouterMode } from '../src/router.js'

const ACTUAL_ROUTE: LlmCallConfig = { provider: 'main', model: 'standard' }

describe('Jev shadow router', () => {
  it('records a bounded exact request and recommendation without changing the actual route', async () => {
    const ctx = new Context()
    const session = Session.create(SessionId('shadow-success'))
    const agent = { session } as Agent
    const decide = vi.fn(async (): Promise<DecisionResult> => {
      expect(pluginRecords(session).map(record => record.type)).toEqual(['plugin:dsh-jev/router-request'])
      return routeResult()
    })
    installJevRouter(ctx, { decide }, routerOptions('shadow', 3))

    await propose(ctx, agent, 'abcd')
    const routed = await request(ctx, agent)

    expect(routed).toBe(ACTUAL_ROUTE)
    expect(decide).toHaveBeenCalledOnce()
    const records = pluginRecords(session)
    expect(records.map(record => record.type)).toEqual([
      'plugin:dsh-jev/router-request',
      'plugin:dsh-jev/router-result',
    ])
    expect(records[0]?.data).toMatchObject({
      strategyVersion: 'jev-router-v1',
      questionVersion: 'agent-route-v1',
      mode: 'shadow',
      turn: 1,
      step: 1,
      actualRoute: ACTUAL_ROUTE,
      inputSummary: { messageCount: 1, textCharacters: 4, includedCharacters: 3, truncated: true },
      request: { state: { content: 'abc', messageCount: 1, textCharacters: 4, truncated: true }, model: 'jev-test' },
    })
    expect(records[1]?.data).toMatchObject({
      requestSeq: records[0]?.seq,
      status: 'success',
      recommendation: {
        tier: 'fast',
        risk: 'low',
        confidence: 0.9,
        accepted: true,
        reasons: [],
      },
      provider: 'jev',
      model: 'jev-test',
    })
    const successful = records[1]?.data as { recommendation?: { margin?: number } } | undefined
    expect(successful?.recommendation?.margin).toBeCloseTo(0.8667, 4)
    await ctx.fiber.dispose()
  })

  it('contains Jev failures and keeps the downstream route', async () => {
    const ctx = new Context()
    const session = Session.create(SessionId('shadow-failure'))
    const agent = { session } as Agent
    const decide = vi.fn(async () => {
      throw new DecisionError('DECISION_PROVIDER_FAILURE', 'safe', {
        retryable: true,
        provider: decisionProviderName('jev'),
        providerCode: 'JEV_RATE_LIMITED',
        latencyMs: 12,
      })
    })
    installJevRouter(ctx, { decide }, routerOptions('shadow'))

    await propose(ctx, agent, 'route this')
    expect(await request(ctx, agent)).toBe(ACTUAL_ROUTE)
    expect(pluginRecords(session)[1]?.data).toEqual({
      requestSeq: 0,
      status: 'failure',
      code: 'DECISION_PROVIDER_FAILURE',
      retryable: true,
      provider: 'jev',
      providerCode: 'JEV_RATE_LIMITED',
      latencyMs: 12,
    })
    await ctx.fiber.dispose()
  })

  it('does no work while off and evaluates a step only once across retries', async () => {
    const ctx = new Context()
    const session = Session.create(SessionId('shadow-once'))
    const agent = { session } as Agent
    let mode: RouterMode = 'off'
    const decide = vi.fn(async () => routeResult())
    installJevRouter(ctx, { decide }, {
      ...routerOptions('shadow'),
      mode: () => mode,
    })

    await propose(ctx, agent, 'off')
    expect(await request(ctx, agent)).toBe(ACTUAL_ROUTE)
    expect(decide).not.toHaveBeenCalled()
    expect(pluginRecords(session)).toEqual([])

    mode = 'shadow'
    await propose(ctx, agent, 'on')
    expect(await request(ctx, agent)).toBe(ACTUAL_ROUTE)
    expect(await request(ctx, agent)).toBe(ACTUAL_ROUTE)
    expect(decide).toHaveBeenCalledOnce()
    expect(pluginRecords(session)).toHaveLength(2)
    await ctx.fiber.dispose()
  })
})

describe('Jev advisory router', () => {
  it('applies a configured recommendation only after the user accepts it', async () => {
    const ctx = new Context()
    const session = Session.create(SessionId('advisory-accept'))
    const agent = { session } as Agent
    const askUser = vi.fn(async (_agent: Agent, _prompt: RouterAdvisoryPrompt, _signal: AbortSignal) => 'recommended' as const)
    installJevRouter(ctx, { decide: async () => routeResult('deep') }, {
      ...routerOptions('advisory'),
      routeTarget: tier => tier === 'deep' ? { provider: 'premium', model: 'reasoner' } : undefined,
      askUser,
    })

    await propose(ctx, agent, 'hard task')
    const routed = await ctx.waterfall(
      ctx as never,
      'agent/request',
      { agent, turn: 1, step: 1, signal: new AbortController().signal },
      () => Promise.resolve({ ...ACTUAL_ROUTE, reasoningEffort: ReasoningEffortId('high') }),
    )

    expect(routed).toEqual({ provider: 'premium', model: 'reasoner' })
    expect(askUser).toHaveBeenCalledOnce()
    expect(askUser.mock.calls[0]?.[1]).toMatchObject({
      question: 'Jev recommends the deep route. Which route should handle this step?',
      recommendedLabel: 'Use premium/reasoner',
      currentLabel: 'Keep main/standard',
      recommendation: { tier: 'deep', risk: 'low', accepted: true },
    })
    const records = pluginRecords(session)
    expect(records.map(record => record.type)).toEqual([
      'plugin:dsh-jev/router-request',
      'plugin:dsh-jev/router-result',
      'plugin:dsh-jev/router-advisory-request',
      'plugin:dsh-jev/router-advisory-outcome',
    ])
    expect(records[3]?.data).toMatchObject({
      requestSeq: 0,
      resultSeq: 1,
      outcome: 'recommended',
      selectedRoute: { provider: 'premium', model: 'reasoner' },
    })
    await ctx.fiber.dispose()
  })

  it('keeps the current route when the user declines or interaction fails', async () => {
    for (const answer of ['current', 'failure'] as const) {
      const ctx = new Context()
      const session = Session.create(SessionId(`advisory-${answer}`))
      const agent = { session } as Agent
      installJevRouter(ctx, { decide: async () => routeResult('fast') }, {
        ...routerOptions('advisory'),
        routeTarget: () => ({ provider: 'cheap', model: 'flash' }),
        askUser: answer === 'current'
          ? async () => 'current'
          : async () => { throw Object.assign(new Error('cancelled'), { code: 'ASK_CANCELLED' }) },
      })

      await propose(ctx, agent, answer)
      expect(await request(ctx, agent)).toBe(ACTUAL_ROUTE)
      expect(pluginRecords(session).at(-1)?.data).toMatchObject(answer === 'current'
        ? { outcome: 'current', selectedRoute: ACTUAL_ROUTE }
        : { outcome: 'interaction-unavailable', selectedRoute: ACTUAL_ROUTE, errorCode: 'ASK_CANCELLED' })
      await ctx.fiber.dispose()
    }
  })

  it('does not ask when the recommended tier has no configured target', async () => {
    const ctx = new Context()
    const session = Session.create(SessionId('advisory-no-target'))
    const agent = { session } as Agent
    const askUser = vi.fn(async () => 'recommended' as const)
    installJevRouter(ctx, { decide: async () => routeResult('deep') }, {
      ...routerOptions('advisory'),
      routeTarget: () => undefined,
      askUser,
    })

    await propose(ctx, agent, 'no target')
    expect(await request(ctx, agent)).toBe(ACTUAL_ROUTE)
    expect(askUser).not.toHaveBeenCalled()
    expect(pluginRecords(session).at(-1)?.data).toMatchObject({
      outcome: 'target-unavailable',
      selectedRoute: ACTUAL_ROUTE,
    })
    await ctx.fiber.dispose()
  })

  it('preserves the current request when the accepted target is already selected', async () => {
    const ctx = new Context()
    const session = Session.create(SessionId('advisory-same-target'))
    const agent = { session } as Agent
    const actual = { ...ACTUAL_ROUTE, reasoningEffort: ReasoningEffortId('high') }
    installJevRouter(ctx, { decide: async () => routeResult('standard') }, {
      ...routerOptions('advisory'),
      routeTarget: () => ({ provider: actual.provider, model: actual.model }),
      askUser: async () => 'recommended',
    })

    await propose(ctx, agent, 'keep this route')
    const routed = await ctx.waterfall(
      ctx as never,
      'agent/request',
      { agent, turn: 1, step: 1, signal: new AbortController().signal },
      () => Promise.resolve(actual),
    )

    expect(routed).toBe(actual)
    expect(routed.reasoningEffort).toBe(ReasoningEffortId('high'))
    await ctx.fiber.dispose()
  })
})

describe('Jev automatic router', () => {
  it('applies an accepted low-risk route without asking the user', async () => {
    const ctx = new Context()
    const session = Session.create(SessionId('automatic-accepted'))
    const agent = { session } as Agent
    const askUser = vi.fn(async () => 'current' as const)
    installJevRouter(ctx, { decide: async () => routeResult('fast') }, {
      ...routerOptions('automatic'),
      routeTarget: tier => tier === 'fast' ? { provider: 'cheap', model: 'flash' } : undefined,
      askUser,
    })

    await propose(ctx, agent, 'simple task')
    expect(await request(ctx, agent)).toEqual({ provider: 'cheap', model: 'flash' })
    expect(askUser).not.toHaveBeenCalled()
    expect(pluginRecords(session).at(-1)?.data).toMatchObject({
      outcome: 'automatic',
      reason: 'accepted',
      selectedRoute: { provider: 'cheap', model: 'flash' },
    })
    await ctx.fiber.dispose()
  })

  it('never auto-routes a non-low-risk recommendation', async () => {
    const ctx = new Context()
    const session = Session.create(SessionId('automatic-risk'))
    const agent = { session } as Agent
    installJevRouter(ctx, { decide: async () => routeResult('fast', 'medium') }, {
      ...routerOptions('automatic'),
      routeTarget: () => ({ provider: 'cheap', model: 'flash' }),
    })

    await propose(ctx, agent, 'publish this release')
    expect(await request(ctx, agent)).toBe(ACTUAL_ROUTE)
    expect(pluginRecords(session)[1]?.data).toMatchObject({
      recommendation: { accepted: false, reasons: expect.arrayContaining(['risk-not-low']) },
    })
    expect(pluginRecords(session).at(-1)?.data).toMatchObject({
      outcome: 'fallback-current',
      reason: 'recommendation-rejected',
    })
    await ctx.fiber.dispose()
  })

  it('uses Advisory confirmation when an unaccepted recommendation falls back to user selection', async () => {
    const ctx = new Context()
    const session = Session.create(SessionId('automatic-user-selection'))
    const agent = { session } as Agent
    const askUser = vi.fn(async () => 'recommended' as const)
    installJevRouter(ctx, { decide: async () => routeResult('deep', 'medium') }, {
      ...routerOptions('automatic'),
      fallbackPolicy: () => 'user-selection',
      routeTarget: () => ({ provider: 'premium', model: 'reasoner' }),
      askUser,
    })

    await propose(ctx, agent, 'material decision')
    expect(await request(ctx, agent)).toEqual({ provider: 'premium', model: 'reasoner' })
    expect(askUser).toHaveBeenCalledOnce()
    expect(pluginRecords(session).at(-1)?.data).toMatchObject({
      outcome: 'fallback-user-selection',
      reason: 'recommendation-rejected',
      selectedRoute: { provider: 'premium', model: 'reasoner' },
    })
    await ctx.fiber.dispose()
  })

  it('fails closed after recording a Jev failure', async () => {
    const ctx = new Context()
    const session = Session.create(SessionId('automatic-fail-closed'))
    const agent = { session } as Agent
    installJevRouter(ctx, {
      decide: async () => {
        throw new DecisionError('DECISION_PROVIDER_FAILURE', 'safe', { retryable: true })
      },
    }, {
      ...routerOptions('automatic'),
      fallbackPolicy: () => 'fail-closed',
      routeTarget: () => ({ provider: 'cheap', model: 'flash' }),
    })

    await propose(ctx, agent, 'route me')
    await expect(request(ctx, agent)).rejects.toMatchObject({
      name: 'RouterPolicyError',
      code: 'JEV_ROUTER_FAIL_CLOSED',
      reason: 'analysis-failure',
    })
    expect(pluginRecords(session).at(-1)?.data).toMatchObject({
      outcome: 'failed-closed',
      reason: 'analysis-failure',
    })
    await ctx.fiber.dispose()
  })

  it('falls back when confidence is below threshold or the target is missing', async () => {
    for (const scenario of ['confidence', 'target'] as const) {
      const ctx = new Context()
      const session = Session.create(SessionId(`automatic-${scenario}`))
      const agent = { session } as Agent
      installJevRouter(ctx, {
        decide: async () => routeResult('fast', 'low', scenario === 'confidence' ? 0.6 : 0.9),
      }, {
        ...routerOptions('automatic'),
        routeTarget: () => scenario === 'target' ? undefined : { provider: 'cheap', model: 'flash' },
      })

      await propose(ctx, agent, scenario)
      expect(await request(ctx, agent)).toBe(ACTUAL_ROUTE)
      expect(pluginRecords(session).at(-1)?.data).toMatchObject({
        outcome: 'fallback-current',
        reason: scenario === 'confidence' ? 'recommendation-rejected' : 'target-unavailable',
      })
      await ctx.fiber.dispose()
    }
  })
})

async function propose(ctx: Context, agent: Agent, text: string): Promise<void> {
  const messages = [createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })]
  await ctx.waterfall(
    ctx as never,
    'agent/pre-step',
    { agent, messages, turn: 1, step: 1, signal: new AbortController().signal },
    () => Promise.resolve({ kind: 'enter' as const, messages }),
  )
}

async function request(ctx: Context, agent: Agent): Promise<LlmCallConfig> {
  return await ctx.waterfall(
    ctx as never,
    'agent/request',
    { agent, turn: 1, step: 1, signal: new AbortController().signal },
    () => Promise.resolve(ACTUAL_ROUTE),
  )
}

function routerOptions(mode: RouterMode, maximumInputCharacters = 4_000) {
  return {
    mode: () => mode,
    model: () => 'jev-test',
    maximumInputCharacters: () => maximumInputCharacters,
    minimumConfidence: () => 0.85,
    minimumMargin: () => 0.2,
    fallbackPolicy: () => 'default-model' as const,
  }
}

function routeResult(
  tier: 'fast' | 'standard' | 'deep' | 'ask-user' = 'fast',
  risk: 'low' | 'medium' | 'high' = 'low',
  routeConfidence = 0.9,
): DecisionResult {
  const remainingRouteProbability = (1 - routeConfidence) / 3
  const routeProbabilities = {
    fast: tier === 'fast' ? routeConfidence : remainingRouteProbability,
    standard: tier === 'standard' ? routeConfidence : remainingRouteProbability,
    deep: tier === 'deep' ? routeConfidence : remainingRouteProbability,
    'ask-user': tier === 'ask-user' ? routeConfidence : remainingRouteProbability,
  }
  const riskProbabilities = {
    low: risk === 'low' ? 0.95 : 0.03,
    medium: risk === 'medium' ? 0.95 : 0.04,
    high: risk === 'high' ? 0.95 : 0.01,
  }
  return {
    provider: decisionProviderName('jev'),
    model: 'jev-test',
    latencyMs: 5,
    usage: { inputTokens: 10, outputTokens: 2 },
    answers: {
      taskType: choice('coding', { coding: 0.8, retrieval: 0.05, writing: 0.05, analysis: 0.05, operation: 0.05 }),
      complexity: choice('low', { low: 0.8, medium: 0.15, high: 0.05 }),
      needsLatestInformation: boolean(false, 0.05),
      needsTools: boolean(true, 0.8),
      needsDelegation: boolean(false, 0.1),
      ambiguity: choice('low', { low: 0.9, medium: 0.08, high: 0.02 }),
      risk: choice(risk, riskProbabilities),
      route: choice(tier, routeProbabilities),
    },
  }
}

function choice(value: string, probabilities: Readonly<Record<string, number>>) {
  return { type: 'choice' as const, value, confidence: probabilities[value] ?? 0, probabilities }
}

function boolean(value: boolean, probability: number) {
  return { type: 'boolean' as const, value, probability, confidence: Math.max(probability, 1 - probability) }
}

function pluginRecords(session: Session) {
  return session.snapshotEvents().map(pluginRecordOf).filter(record => record !== undefined)
}
