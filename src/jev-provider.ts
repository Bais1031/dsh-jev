import { JevClient } from './client.js'
import { DecisionProviderError } from './decision-errors.js'
import { JevError } from './errors.js'
import type {
  DecisionAnswer,
  DecisionProvider,
  DecisionProviderCallOptions,
  DecisionProviderName,
  DecisionProviderResult,
  DecisionQuestion,
  DecisionRequest,
} from './decision-types.js'
import { decisionProviderName } from './decision-types.js'
import type { JevAnswer, JevQuestion, JevRequest } from './types.js'

/** Default registration name for the TypeSafe Jev provider. */
export const JEV_PROVIDER_NAME = decisionProviderName('jev')

/** Resolve the current credential for one Jev operation. */
export type JevApiKeyResolver = (signal?: AbortSignal) => Promise<string | undefined>

/** Construction options for the Jev decision provider. */
export interface JevDecisionProviderOptions {
  /** Wire client, or a factory read once per decision when live settings select its options. */
  readonly client: JevClient | (() => JevClient)
  readonly resolveApiKey: JevApiKeyResolver
  readonly name?: DecisionProviderName
}

/** Decision provider that maps the generic API to TypeSafe Jev. */
export class JevDecisionProvider implements DecisionProvider {
  readonly name: DecisionProviderName
  readonly #client: () => JevClient
  readonly #resolveApiKey: JevApiKeyResolver

  /**
   * Create a provider that resolves credentials once per operation.
   * @param options - Wire client, live credential resolver, and provider name.
   */
  constructor(options: JevDecisionProviderOptions) {
    this.name = options.name ?? JEV_PROVIDER_NAME
    const client = options.client
    this.#client = typeof client === 'function' ? client : () => client
    this.#resolveApiKey = options.resolveApiKey
  }

  /**
   * Evaluate a generic decision request with Jev.
   * @param request - Shared state and generic questions.
   * @param options - Caller cancellation for credential resolution and dispatch.
   * @returns Generic answers projected from the validated Jev response.
   */
  async decide(request: DecisionRequest, options: DecisionProviderCallOptions): Promise<DecisionProviderResult> {
    try {
      throwIfCancelled(options.signal)
      const apiKey = await this.#resolveApiKey(options.signal)
      throwIfCancelled(options.signal)
      const jevRequest: JevRequest = {
        state: request.state,
        questions: mapQuestions(request.questions),
        ...request.model === undefined ? {} : { model: request.model },
      }
      const response = await this.#client().evaluate(jevRequest, {
        apiKey,
        ...options.signal === undefined ? {} : { signal: options.signal },
      })
      const answers: Record<string, DecisionAnswer> = {}
      for (const [name, answer] of Object.entries(response.answers)) answers[name] = mapAnswer(answer)
      return {
        model: response.model,
        answers,
        usage: response.usage,
      }
    } catch (error: unknown) {
      if (!(error instanceof JevError)) throw error
      throw new DecisionProviderError(error.code, 'Jev decision operation failed', {
        retryable: error.retryable,
        cancelled: error.code === 'JEV_CANCELLED',
        cause: error,
      })
    }
  }
}

function mapQuestions(questions: Readonly<Record<string, DecisionQuestion>>): Readonly<Record<string, JevQuestion>> {
  const result: Record<string, JevQuestion> = {}
  for (const [name, question] of Object.entries(questions)) {
    const instructions = question.instructions === undefined ? {} : { instructions: question.instructions }
    switch (question.type) {
      case 'boolean':
        result[name] = {
          type: 'noul',
          ...instructions,
          ...question.criteria === undefined ? {} : { criteria: question.criteria },
        }
        break
      case 'choice':
        result[name] = { type: 'choice', ...instructions, criteria: question.options }
        break
      case 'score':
        result[name] = { type: 'score', ...instructions, criteria: question.levels }
        break
      default:
        assertNever(question)
    }
  }
  return result
}

function mapAnswer(answer: JevAnswer): DecisionAnswer {
  switch (answer.type) {
    case 'noul':
      return {
        type: 'boolean',
        value: answer.noul >= 0.5,
        probability: answer.noul,
        confidence: Math.max(answer.noul, 1 - answer.noul),
      }
    case 'choice':
      return {
        type: 'choice',
        value: answer.choice,
        confidence: answer.confidence,
        probabilities: answer.probabilities,
      }
    case 'score':
      return {
        type: 'score',
        value: answer.score,
        confidence: answer.confidence,
        levels: answer.legend,
        probabilities: answer.probabilities,
      }
    default:
      return assertNever(answer)
  }
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted !== true) return
  throw new JevError('JEV_CANCELLED', 'Jev request was cancelled by the caller', {
    retryable: false,
    cause: signal.reason,
  })
}

function assertNever(value: never): never {
  throw new Error(`Unsupported decision value: ${String(value)}`)
}
