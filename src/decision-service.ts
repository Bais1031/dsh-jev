import { DecisionError, DecisionProviderError } from './decision-errors.js'
import type {
  DecisionCallOptions,
  DecisionProvider,
  DecisionProviderName,
  DecisionRequest,
  DecisionResult,
  DecisionServiceOptions,
  ResolvedDecisionRequest,
} from './decision-types.js'

/** Registry and execution boundary for replaceable structured-decision providers. */
export class DecisionService {
  readonly #providers = new Map<DecisionProviderName, DecisionProvider>()
  readonly #defaultProvider: DecisionProviderName | undefined
  readonly #now: () => number

  /**
   * Create an isolated decision service.
   * @param options - Explicit default provider and monotonic test clock.
   */
  constructor(options: DecisionServiceOptions = {}) {
    this.#defaultProvider = options.defaultProvider
    this.#now = options.now ?? performance.now.bind(performance)
  }

  /**
   * Register one provider until the returned disposer is called.
   * @param provider - Named provider implementation owned by its caller.
   * @returns An idempotent disposer that removes only this registration.
   */
  registerProvider(provider: DecisionProvider): () => void {
    if (this.#providers.has(provider.name)) {
      throw new DecisionError(
        'DECISION_PROVIDER_ALREADY_REGISTERED',
        `Decision provider "${provider.name}" is already registered`,
        { retryable: false, provider: provider.name },
      )
    }
    this.#providers.set(provider.name, provider)
    let active = true
    return () => {
      if (!active) return
      active = false
      if (this.#providers.get(provider.name) === provider) this.#providers.delete(provider.name)
    }
  }

  /**
   * Resolve an explicit execution request.
   *
   * An omitted provider uses `defaultProvider` when configured. Without either,
   * resolution fails even when exactly one provider is registered.
   *
   * @param request - Shared state and named decision questions.
   * @param options - Optional explicit provider and caller cancellation.
   * @returns A provider-bound request ready for `run()`.
   */
  resolve(request: DecisionRequest, options: DecisionCallOptions = {}): ResolvedDecisionRequest {
    const providerName = options.provider ?? this.#defaultProvider
    if (providerName === undefined) {
      throw new DecisionError('DECISION_NO_PROVIDER', 'No decision provider was selected', { retryable: false })
    }
    const provider = this.#providers.get(providerName)
    if (provider === undefined) {
      throw new DecisionError(
        'DECISION_PROVIDER_NOT_FOUND',
        `Decision provider "${providerName}" is not registered`,
        { retryable: false, provider: providerName },
      )
    }
    return {
      provider,
      request,
      ...options.signal === undefined ? {} : { signal: options.signal },
    }
  }

  /**
   * Run a previously resolved request against its selected provider.
   *
   * Provider failures never trigger an implicit fallback. The consumer owns
   * fallback policy and can inspect `retryable`, `providerCode`, and `cause`.
   * No service-owned state is committed by this operation.
   *
   * @param resolved - Provider-bound request from `resolve()`.
   * @returns Provider answers with provider identity and elapsed milliseconds.
   */
  async run(resolved: ResolvedDecisionRequest): Promise<DecisionResult> {
    const { provider, request, signal } = resolved
    if (this.#providers.get(provider.name) !== provider) {
      throw new DecisionError(
        'DECISION_PROVIDER_NOT_FOUND',
        `Decision provider "${provider.name}" is no longer registered`,
        { retryable: false, provider: provider.name },
      )
    }
    if (isAborted(signal)) throw cancelled(provider.name, 0, signal?.reason)
    const startedAt = this.#now()
    try {
      const result = await provider.decide(request, signal === undefined ? {} : { signal })
      return {
        ...result,
        provider: provider.name,
        latencyMs: elapsed(startedAt, this.#now()),
      }
    } catch (error: unknown) {
      const latencyMs = elapsed(startedAt, this.#now())
      if (isAborted(signal) || error instanceof DecisionProviderError && error.cancelled) {
        throw cancelled(provider.name, latencyMs, error)
      }
      if (error instanceof DecisionProviderError) {
        throw new DecisionError('DECISION_PROVIDER_FAILURE', `Decision provider "${provider.name}" failed`, {
          retryable: error.retryable,
          provider: provider.name,
          providerCode: error.providerCode,
          latencyMs,
          cause: error,
        })
      }
      throw new DecisionError('DECISION_PROVIDER_FAILURE', `Decision provider "${provider.name}" failed`, {
        retryable: false,
        provider: provider.name,
        latencyMs,
        cause: error,
      })
    }
  }

  /**
   * Resolve and run one decision request.
   * @param request - Shared state and named decision questions.
   * @param options - Optional explicit provider and caller cancellation.
   * @returns Provider answers with provider identity and elapsed milliseconds.
   */
  async decide(request: DecisionRequest, options: DecisionCallOptions = {}): Promise<DecisionResult> {
    return await this.run(this.resolve(request, options))
  }
}

function cancelled(provider: DecisionProviderName, latencyMs: number, cause: unknown): DecisionError {
  return new DecisionError('DECISION_CANCELLED', 'Decision request was cancelled by the caller', {
    retryable: false,
    provider,
    latencyMs,
    cause,
  })
}

function elapsed(startedAt: number, finishedAt: number): number {
  return Math.max(0, finishedAt - startedAt)
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true
}
