import { describe, expect, it, vi } from 'vitest'
import {
  JevClient,
  JevDecisionProvider,
  DecisionProviderError,
  type DecisionRequest,
} from '../src/index.js'

const REQUEST: DecisionRequest = {
  state: { message: 'Please review this change', hasAttachments: false },
  model: 'jev-test',
  questions: {
    risky: {
      type: 'boolean',
      instructions: 'Does this request authorize a high-risk operation?',
      criteria: { true: 'High risk', false: 'Low risk' },
    },
    task: {
      type: 'choice',
      instructions: 'Select the task type',
      options: { coding: 'Code work', writing: 'Writing work' },
    },
    complexity: {
      type: 'score',
      instructions: 'Rate complexity',
      levels: ['Simple', 'Standard', 'Complex'],
    },
  },
}

describe('JevDecisionProvider', () => {
  it('maps generic questions and answers without retaining credentials', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(0.08))
      .mockResolvedValueOnce(response(0.91))
    const resolveApiKey = vi.fn()
      .mockResolvedValueOnce('rotated-one')
      .mockResolvedValueOnce('rotated-two')
    const provider = new JevDecisionProvider({ client: new JevClient({ fetch }), resolveApiKey })

    const first = await provider.decide(REQUEST, {})
    const second = await provider.decide(REQUEST, {})

    expect(first).toEqual({
      model: 'jev-1.14',
      answers: {
        risky: { type: 'boolean', value: false, probability: 0.08, confidence: 0.92 },
        task: {
          type: 'choice',
          value: 'coding',
          confidence: 0.8,
          probabilities: { coding: 0.8, writing: 0.2 },
        },
        complexity: {
          type: 'score',
          value: 1.4,
          confidence: 0.6,
          levels: { 0: 'Simple', 1: 'Standard', 2: 'Complex' },
          probabilities: { 0: 0.1, 1: 0.4, 2: 0.5 },
        },
      },
      usage: { inputTokens: 50, outputTokens: 6 },
    })
    expect(second.answers.risky).toMatchObject({ value: true, probability: 0.91 })
    expect(resolveApiKey).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls.map((call) => (call[1]?.headers as Record<string, string>).authorization))
      .toEqual(['Bearer rotated-one', 'Bearer rotated-two'])

    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))
    expect(body).toEqual({
      model: 'jev-test',
      state: REQUEST.state,
      questions: {
        risky: {
          type: 'noul',
          instructions: 'Does this request authorize a high-risk operation?',
          criteria: { true: 'High risk', false: 'Low risk' },
        },
        task: {
          type: 'choice',
          instructions: 'Select the task type',
          criteria: { coding: 'Code work', writing: 'Writing work' },
        },
        complexity: {
          type: 'score',
          instructions: 'Rate complexity',
          criteria: ['Simple', 'Standard', 'Complex'],
        },
      },
    })
  })

  it('checks cancellation before and after credential resolution', async () => {
    const controller = new AbortController()
    const fetch = vi.fn<typeof globalThis.fetch>()
    const resolveApiKey = vi.fn(async () => {
      controller.abort(new Error('cancelled during credential lookup'))
      return 'unused'
    })
    const provider = new JevDecisionProvider({ client: new JevClient({ fetch }), resolveApiKey })

    await expect(provider.decide(REQUEST, { signal: controller.signal })).rejects.toMatchObject({
      providerCode: 'JEV_CANCELLED',
      cancelled: true,
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reports a missing resolved credential through the wire error', async () => {
    const provider = new JevDecisionProvider({
      client: new JevClient({ fetch: vi.fn<typeof globalThis.fetch>() }),
      resolveApiKey: vi.fn().mockResolvedValue(undefined),
    })
    await expect(provider.decide(REQUEST, {})).rejects.toBeInstanceOf(DecisionProviderError)
    await expect(provider.decide(REQUEST, {})).rejects.toMatchObject({
      providerCode: 'JEV_CREDENTIAL_MISSING',
      retryable: false,
    })
  })
})

function response(risk: number): Response {
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
      complexity: {
        type: 'score',
        score: 1.4,
        confidence: 0.6,
        legend: { 0: 'Simple', 1: 'Standard', 2: 'Complex' },
        probabilities: { 0: 0.1, 1: 0.4, 2: 0.5 },
      },
    },
    usage: { input_tokens: 50, output_tokens: 6 },
  }), { headers: { 'content-type': 'application/json' } })
}
