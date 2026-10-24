/** Stable failure identities exposed by the Jev wire client. */
export type JevErrorCode =
  | 'JEV_CREDENTIAL_MISSING'
  | 'JEV_AUTH_REJECTED'
  | 'JEV_BAD_REQUEST'
  | 'JEV_TIMEOUT'
  | 'JEV_CANCELLED'
  | 'JEV_RATE_LIMITED'
  | 'JEV_TRANSPORT_ERROR'
  | 'JEV_SERVER_ERROR'
  | 'JEV_INVALID_RESPONSE'

/** Structured details that callers can use without parsing error messages. */
export interface JevErrorOptions {
  readonly retryable: boolean
  readonly cause?: unknown
  readonly status?: number
  readonly retryAfterMs?: number
}

/** An expected Jev operation failure with a stable machine-readable code. */
export class JevError extends Error {
  readonly code: JevErrorCode
  readonly retryable: boolean
  readonly status: number | undefined
  readonly retryAfterMs: number | undefined

  /**
   * Create an expected Jev failure.
   * @param code - Stable identity used for handling.
   * @param message - Safe diagnostic without credentials or response bodies.
   * @param options - Retry and transport metadata.
   */
  constructor(code: JevErrorCode, message: string, options: JevErrorOptions) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'JevError'
    this.code = code
    this.retryable = options.retryable
    this.status = options.status
    this.retryAfterMs = options.retryAfterMs
  }
}
