import { describe, expect, it, vi } from 'vitest'
import {
  DecisionError,
  DecisionProviderError,
  DecisionService,
  decisionProviderName,
  type DecisionProvider,
  type DecisionRequest,
} from '../src/index.js'

const REQUEST: DecisionRequest = {
  state: 'route this request',
  questions: {
    task: { type: 'choice', options: { coding: 'Code work', writing: 'Writing work' } },
  },
}

function provider(name = decisionProviderName('mock')): DecisionProvider {
  return {
    name,
    decide: vi.fn().mockResolvedValue({
      model: 'mock-v1',
      answers: {
        task: { type: 'choice', value: 'coding', confidence: 0.9, probabilities: { coding: 0.9, writing: 0.1 } },
      },
      usage: { inputTokens: 10, outputTokens: 2 },
    }),
  }
}

describe('DecisionService', () => {
  it('rejects an empty provider name at the configuration boundary', () => {
    expect(() => decisionProviderName('')).toThrow(TypeError)
  })

  it('requires explicit or configured provider selection', async () => {
    const service = new DecisionService()
    service.registerProvider(provider())
    await expect(service.decide(REQUEST)).rejects.toMatchObject({ code: 'DECISION_NO_PROVIDER' })
  })

  it('resolves the default provider and attaches service metadata', async () => {
    const clock = vi.fn()
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(112.5)
    const selected = provider()
    const service = new DecisionService({ defaultProvider: decisionProviderName('mock'), now: clock })
    service.registerProvider(selected)

    await expect(service.decide(REQUEST)).resolves.toMatchObject({
      provider: 'mock',
      model: 'mock-v1',
      latencyMs: 12.5,
      usage: { inputTokens: 10, outputTokens: 2 },
    })
    expect(selected.decide).toHaveBeenCalledWith(REQUEST, {})
  })

  it('allows an explicit provider to override the configured default', async () => {
    const defaultProvider = provider(decisionProviderName('default'))
    const selectedProvider = provider(decisionProviderName('selected'))
    const service = new DecisionService({ defaultProvider: decisionProviderName('default') })
    service.registerProvider(defaultProvider)
    service.registerProvider(selectedProvider)

    const result = await service.decide(REQUEST, { provider: decisionProviderName('selected') })
    expect(result.provider).toBe('selected')
    expect(defaultProvider.decide).not.toHaveBeenCalled()
  })

  it('rejects missing and duplicate providers', () => {
    const service = new DecisionService({ defaultProvider: decisionProviderName('missing') })
    expect(() => service.resolve(REQUEST)).toThrowError(DecisionError)
    expect(() => service.resolve(REQUEST)).toThrow(/not registered/)

    service.registerProvider(provider(decisionProviderName('same')))
    expect(() => service.registerProvider(provider(decisionProviderName('same')))).toThrowError(expect.objectContaining({
      code: 'DECISION_PROVIDER_ALREADY_REGISTERED',
    }))
  })

  it('unregisters only the owned provider and makes disposal idempotent', () => {
    const service = new DecisionService({ defaultProvider: decisionProviderName('mock') })
    const dispose = service.registerProvider(provider())
    dispose()
    dispose()
    expect(() => service.resolve(REQUEST)).toThrowError(expect.objectContaining({
      code: 'DECISION_PROVIDER_NOT_FOUND',
    }))
  })

  it('does not run a request whose provider was unregistered after resolution', async () => {
    const selected = provider()
    const service = new DecisionService({ defaultProvider: decisionProviderName('mock') })
    const dispose = service.registerProvider(selected)
    const resolved = service.resolve(REQUEST)
    dispose()

    await expect(service.run(resolved)).rejects.toMatchObject({
      code: 'DECISION_PROVIDER_NOT_FOUND',
      provider: 'mock',
    })
    expect(selected.decide).not.toHaveBeenCalled()
  })

  it('stops before provider dispatch when already cancelled', async () => {
    const selected = provider()
    const service = new DecisionService({ defaultProvider: decisionProviderName('mock') })
    service.registerProvider(selected)
    const controller = new AbortController()
    controller.abort(new Error('stop'))

    await expect(service.decide(REQUEST, { signal: controller.signal })).rejects.toMatchObject({
      code: 'DECISION_CANCELLED',
      retryable: false,
      provider: 'mock',
      latencyMs: 0,
    })
    expect(selected.decide).not.toHaveBeenCalled()
  })

  it('normalizes known provider failures without applying fallback', async () => {
    const failure = new DecisionProviderError('JEV_RATE_LIMITED', 'limited', { retryable: true })
    const broken: DecisionProvider = {
      name: decisionProviderName('broken'),
      decide: vi.fn().mockRejectedValue(failure),
    }
    const fallback = provider(decisionProviderName('fallback'))
    const service = new DecisionService({ defaultProvider: decisionProviderName('broken'), now: vi.fn()
      .mockReturnValueOnce(1)
      .mockReturnValueOnce(4) })
    service.registerProvider(broken)
    service.registerProvider(fallback)

    await expect(service.decide(REQUEST)).rejects.toMatchObject({
      code: 'DECISION_PROVIDER_FAILURE',
      provider: 'broken',
      providerCode: 'JEV_RATE_LIMITED',
      retryable: true,
      latencyMs: 3,
    })
    expect(fallback.decide).not.toHaveBeenCalled()
  })

  it('normalizes provider-reported cancellation', async () => {
    const cancelledProvider: DecisionProvider = {
      name: decisionProviderName('cancelled'),
      decide: vi.fn().mockRejectedValue(new DecisionProviderError('REMOTE_CANCELLED', 'cancelled', {
        retryable: false,
        cancelled: true,
      })),
    }
    const service = new DecisionService({ defaultProvider: decisionProviderName('cancelled') })
    service.registerProvider(cancelledProvider)

    await expect(service.decide(REQUEST)).rejects.toMatchObject({
      code: 'DECISION_CANCELLED',
      provider: 'cancelled',
      retryable: false,
    })
  })

  it('marks unexpected provider defects as non-retryable and preserves the cause', async () => {
    const cause = new Error('provider defect')
    const broken: DecisionProvider = {
      name: decisionProviderName('broken'),
      decide: vi.fn().mockRejectedValue(cause),
    }
    const service = new DecisionService({ defaultProvider: decisionProviderName('broken') })
    service.registerProvider(broken)

    const error = await service.decide(REQUEST).catch((caught: unknown) => caught)
    expect(error).toMatchObject({ code: 'DECISION_PROVIDER_FAILURE', retryable: false })
    expect((error as Error).cause).toBe(cause)
  })
})
