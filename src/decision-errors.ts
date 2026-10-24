import type { DecisionProviderName } from './decision-types.js'

/** Stable failure identities exposed by the provider-independent decision API. */
export type DecisionErrorCode =
  | 'DECISION_NO_PROVIDER'
  | 'DECISION_PROVIDER_NOT_FOUND'
  | 'DECISION_PROVIDER_ALREADY_REGISTERED'
  | 'DECISION_CANCELLED'
  | 'DECISION_PROVIDER_FAILURE'

/** Structured metadata for an expected decision failure. */
export interface DecisionErrorOptions {
  readonly retryable: boolean
  readonly provider?: DecisionProviderName
  readonly providerCode?: string
  readonly latencyMs?: number
  readonly cause?: unknown
}

/** Metadata supplied when a provider reports an expected operation failure. */
export interface DecisionProviderErrorOptions {
  readonly retryable: boolean
  readonly cancelled?: boolean
  readonly cause?: unknown
}

/** Expected provider failure translated at the provider-independent boundary. */
export class DecisionProviderError extends Error {
  readonly providerCode: string
  readonly retryable: boolean
  readonly cancelled: boolean

  /**
   * Create an expected provider failure.
   * @param providerCode - Stable identity defined by the provider implementation.
   * @param message - Safe diagnostic without secrets or raw provider responses.
   * @param options - Retry, cancellation, and causal metadata.
   */
  constructor(providerCode: string, message: string, options: DecisionProviderErrorOptions) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'DecisionProviderError'
    this.providerCode = providerCode
    this.retryable = options.retryable
    this.cancelled = options.cancelled ?? false
  }
}

/** Expected service failure with handling fields that do not require message parsing. */
export class DecisionError extends Error {
  readonly code: DecisionErrorCode
  readonly retryable: boolean
  readonly provider: DecisionProviderName | undefined
  readonly providerCode: string | undefined
  readonly latencyMs: number | undefined

  /**
   * Create an expected decision failure.
   * @param code - Stable service-level failure identity.
   * @param message - Safe diagnostic without secrets or raw provider responses.
   * @param options - Provider, retry, timing, and causal metadata.
   */
  constructor(code: DecisionErrorCode, message: string, options: DecisionErrorOptions) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'DecisionError'
    this.code = code
    this.retryable = options.retryable
    this.provider = options.provider
    this.providerCode = options.providerCode
    this.latencyMs = options.latencyMs
  }
}
