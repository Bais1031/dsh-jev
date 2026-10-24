import { JevError } from './errors.js'
import type {
  JevAnswer,
  JevCallOptions,
  JevChoiceQuestion,
  JevClientOptions,
  JevContent,
  JevQuestion,
  JevRequest,
  JevResponse,
  JevScoreQuestion,
  JsonValue,
} from './types.js'

const DEFAULT_ENDPOINT = 'https://api.typesafe.ai/v1/systemone'
const DEFAULT_MODEL = 'jev-latest'
const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_MAX_INPUT_BYTES = 1_000_000

interface WireRequest {
  readonly model: string
  readonly state: JevContent
  readonly questions: Readonly<Record<string, JevQuestion>>
}

/** HTTP client for TypeSafe's System One endpoint. */
export class JevClient {
  readonly #endpoint: string
  readonly #model: string
  readonly #timeoutMs: number
  readonly #maxInputBytes: number
  readonly #fetch: typeof globalThis.fetch

  /**
   * Create a client without retaining credentials.
   * @param options - Stable endpoint, model, limits, and optional test transport.
   */
  constructor(options: JevClientOptions = {}) {
    this.#endpoint = validEndpoint(options.endpoint ?? DEFAULT_ENDPOINT)
    this.#model = nonEmpty(options.model ?? DEFAULT_MODEL, 'model')
    this.#timeoutMs = positiveInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 'timeoutMs')
    this.#maxInputBytes = positiveInteger(options.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES, 'maxInputBytes')
    this.#fetch = options.fetch ?? globalThis.fetch
  }

  /**
   * Evaluate named questions against shared state.
   *
   * No automatic retry is attempted. A failure leaves no client-owned mutable
   * state; callers may retry retryable failures within their own time budget.
   *
   * @param request - Shared state and one or more named questions.
   * @param options - Per-operation credential and cancellation signal.
   * @returns A response whose names and answer types match the request.
   */
  async evaluate(request: JevRequest, options: JevCallOptions): Promise<JevResponse> {
    if (options.apiKey === undefined || options.apiKey.length === 0) {
      throw new JevError('JEV_CREDENTIAL_MISSING', 'A TypeSafe API key is required', { retryable: false })
    }
    throwIfCancelled(options.signal)

    const body: WireRequest = {
      model: nonEmpty(request.model ?? this.#model, 'model'),
      state: request.state,
      questions: request.questions,
    }
    validateRequest(body)
    const serialized = serializeRequest(body)
    if (new TextEncoder().encode(serialized).byteLength > this.#maxInputBytes) {
      throw new JevError('JEV_BAD_REQUEST', `Jev request exceeds the ${this.#maxInputBytes}-byte input limit`, {
        retryable: false,
      })
    }

    const controller = new AbortController()
    let timedOut = false
    const onCancel = (): void => controller.abort(options.signal?.reason)
    options.signal?.addEventListener('abort', onCancel, { once: true })
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort(new Error('Jev request timed out'))
    }, this.#timeoutMs)

    try {
      const response = await this.#fetch(this.#endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${options.apiKey}`,
          'content-type': 'application/json',
          'user-agent': 'dsh-jev/0.1.0',
        },
        body: serialized,
        signal: controller.signal,
      })
      if (!response.ok) throw httpError(response)

      let payload: unknown
      try {
        payload = await response.json()
      } catch (error: unknown) {
        throw new JevError('JEV_INVALID_RESPONSE', 'TypeSafe returned a non-JSON response', {
          retryable: true,
          cause: error,
          status: response.status,
        })
      }
      return decodeResponse(payload, body.questions)
    } catch (error: unknown) {
      if (error instanceof JevError) throw error
      if (timedOut) {
        throw new JevError('JEV_TIMEOUT', `TypeSafe did not respond within ${this.#timeoutMs} ms`, {
          retryable: true,
          cause: error,
        })
      }
      if (options.signal?.aborted === true) {
        throw new JevError('JEV_CANCELLED', 'Jev request was cancelled by the caller', {
          retryable: false,
          cause: error,
        })
      }
      throw new JevError('JEV_TRANSPORT_ERROR', 'The TypeSafe request could not be completed', {
        retryable: true,
        cause: error,
      })
    } finally {
      clearTimeout(timeout)
      options.signal?.removeEventListener('abort', onCancel)
    }
  }
}

function validateRequest(request: WireRequest): void {
  assertContent(request.state, 'state')
  const entries = Object.entries(request.questions)
  if (entries.length === 0) badRequest('questions must contain at least one question')
  for (const [name, question] of entries) {
    nonEmpty(name, 'question name')
    if (question.instructions !== undefined && question.instructions !== null) {
      assertContent(question.instructions, `questions.${name}.instructions`)
    }
    switch (question.type) {
      case 'noul':
        if (question.criteria !== undefined && question.criteria !== null) {
          for (const value of Object.values(question.criteria)) {
            if (value !== undefined && value !== null) assertContent(value, `questions.${name}.criteria`)
          }
        }
        break
      case 'choice':
        validateChoiceQuestion(name, question)
        break
      case 'score':
        validateScoreQuestion(name, question)
        break
      default:
        assertNever(question)
    }
  }
}

function validateChoiceQuestion(name: string, question: JevChoiceQuestion): void {
  const criteria = Object.entries(question.criteria)
  if (criteria.length < 1 || criteria.length > 255) {
    badRequest(`questions.${name}.criteria must contain 1 to 255 choices`)
  }
  for (const [key, value] of criteria) {
    nonEmpty(key, `questions.${name}.criteria key`)
    if (value !== null) assertContent(value, `questions.${name}.criteria.${key}`)
  }
}

function validateScoreQuestion(name: string, question: JevScoreQuestion): void {
  if (question.criteria.length < 1 || question.criteria.length > 10) {
    badRequest(`questions.${name}.criteria must contain 1 to 10 score levels`)
  }
  for (const value of question.criteria) assertContent(value, `questions.${name}.criteria`)
}

function serializeRequest(request: WireRequest): string {
  try {
    const serialized = JSON.stringify(request)
    if (serialized === undefined) badRequest('request is not JSON serializable')
    return serialized
  } catch (error: unknown) {
    if (error instanceof JevError) throw error
    throw new JevError('JEV_BAD_REQUEST', 'Jev request is not JSON serializable', {
      retryable: false,
      cause: error,
    })
  }
}

function decodeResponse(payload: unknown, questions: Readonly<Record<string, JevQuestion>>): JevResponse {
  if (!isRecord(payload) || typeof payload.model !== 'string' || !isRecord(payload.answers) || !isRecord(payload.usage)) {
    invalidResponse()
  }
  const expectedNames = Object.keys(questions)
  if (!sameKeys(payload.answers, expectedNames)) invalidResponse()

  const answers: Record<string, JevAnswer> = {}
  for (const name of expectedNames) {
    const question = questions[name]
    const answer = payload.answers[name]
    if (question === undefined || !isRecord(answer) || answer.type !== question.type) invalidResponse()
    answers[name] = decodeAnswer(answer, question)
  }
  const inputTokens = payload.usage.input_tokens
  const outputTokens = payload.usage.output_tokens
  if (!isNonNegativeInteger(inputTokens) || !isNonNegativeInteger(outputTokens)) invalidResponse()
  return {
    model: payload.model,
    answers,
    usage: { inputTokens, outputTokens },
  }
}

function decodeAnswer(value: Record<string, unknown>, question: JevQuestion): JevAnswer {
  switch (question.type) {
    case 'noul': {
      const noul = value.noul
      if (!isProbability(noul)) invalidResponse()
      return { type: 'noul', noul }
    }
    case 'choice': {
      const choice = value.choice
      const confidence = value.confidence
      const probabilities = probabilityRecord(value.probabilities)
      const keys = Object.keys(question.criteria)
      if (typeof choice !== 'string' || !keys.includes(choice) || !isProbability(confidence) || !sameKeys(probabilities, keys)) {
        invalidResponse()
      }
      return { type: 'choice', choice, confidence, probabilities }
    }
    case 'score': {
      const score = value.score
      const confidence = value.confidence
      const probabilities = probabilityRecord(value.probabilities)
      const legend = contentRecord(value.legend)
      const keys = question.criteria.map((_, index) => String(index))
      if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > keys.length - 1
        || !isProbability(confidence) || !sameKeys(probabilities, keys) || !sameKeys(legend, keys)) {
        invalidResponse()
      }
      return { type: 'score', score, confidence, legend, probabilities }
    }
    default:
      return assertNever(question)
  }
}

function probabilityRecord(value: unknown): Readonly<Record<string, number>> {
  if (!isRecord(value)) invalidResponse()
  const result: Record<string, number> = {}
  for (const [key, probability] of Object.entries(value)) {
    if (!isProbability(probability)) invalidResponse()
    result[key] = probability
  }
  return result
}

function contentRecord(value: unknown): Readonly<Record<string, JevContent>> {
  if (!isRecord(value)) invalidResponse()
  const result: Record<string, JevContent> = {}
  for (const [key, content] of Object.entries(value)) {
    if (!isContent(content)) invalidResponse()
    result[key] = content
  }
  return result
}

function httpError(response: Response): JevError {
  const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'))
  const common = retryAfterMs === undefined
    ? { status: response.status }
    : { status: response.status, retryAfterMs }
  if (response.status === 401 || response.status === 403) {
    return new JevError('JEV_AUTH_REJECTED', 'TypeSafe rejected the API credential', { ...common, retryable: false })
  }
  if (response.status === 429) {
    return new JevError('JEV_RATE_LIMITED', 'TypeSafe rate limit exceeded', { ...common, retryable: true })
  }
  if (response.status >= 500) {
    return new JevError('JEV_SERVER_ERROR', `TypeSafe failed with HTTP ${response.status}`, {
      ...common,
      retryable: true,
    })
  }
  return new JevError('JEV_BAD_REQUEST', `TypeSafe rejected the request with HTTP ${response.status}`, {
    ...common,
    retryable: false,
  })
}

function parseRetryAfter(value: string | null): number | undefined {
  if (value === null) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1_000)
  const date = Date.parse(value)
  if (!Number.isFinite(date)) return undefined
  return Math.max(0, date - Date.now())
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted !== true) return
  throw new JevError('JEV_CANCELLED', 'Jev request was cancelled by the caller', {
    retryable: false,
    cause: signal.reason,
  })
}

function validEndpoint(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch (error: unknown) {
    throw new JevError('JEV_BAD_REQUEST', 'endpoint must be an absolute HTTP or HTTPS URL', {
      retryable: false,
      cause: error,
    })
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') badRequest('endpoint must use HTTP or HTTPS')
  return url.href
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) badRequest(`${name} must be a positive integer`)
  return value
}

function nonEmpty(value: string, name: string): string {
  if (value.length === 0) badRequest(`${name} must not be empty`)
  return value
}

function assertContent(value: unknown, name: string): asserts value is JevContent {
  if (!isContent(value)) badRequest(`${name} must be a string, object, or array containing JSON values`)
}

function isContent(value: unknown): value is JevContent {
  return typeof value === 'string' || Array.isArray(value) && value.every(isJsonValue) || isRecord(value) && Object.values(value).every(isJsonValue)
}

function isJsonValue(value: unknown): value is JsonValue {
  return value === null || typeof value === 'string' || typeof value === 'boolean'
    || typeof value === 'number' && Number.isFinite(value)
    || Array.isArray(value) && value.every(isJsonValue)
    || isRecord(value) && Object.values(value).every(isJsonValue)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isProbability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function sameKeys(value: Readonly<Record<string, unknown>>, expected: readonly string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === expected.length && expected.every((key) => Object.hasOwn(value, key))
}

function badRequest(message: string): never {
  throw new JevError('JEV_BAD_REQUEST', message, { retryable: false })
}

function invalidResponse(): never {
  throw new JevError('JEV_INVALID_RESPONSE', 'TypeSafe returned a response that does not match the Jev protocol', {
    retryable: true,
  })
}

function assertNever(value: never): never {
  throw new Error(`Unsupported Jev question: ${String(value)}`)
}
