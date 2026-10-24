import type { JevContent } from './types.js'

declare const decisionProviderNameBrand: unique symbol

/** Opaque identifier for a registered decision provider. */
export type DecisionProviderName = string & { readonly [decisionProviderNameBrand]: true }

/**
 * Validate and brand a provider identifier at a configuration boundary.
 * @param value - Non-empty provider identifier.
 * @returns The branded provider identifier.
 */
export function decisionProviderName(value: string): DecisionProviderName {
  if (value.length === 0) throw new TypeError('Decision provider name must not be empty')
  return value as DecisionProviderName
}

/** A yes/no question exposed by the provider-independent decision API. */
export interface DecisionBooleanQuestion {
  readonly type: 'boolean'
  readonly instructions?: JevContent | null
  readonly criteria?: {
    readonly true?: JevContent | null
    readonly false?: JevContent | null
  } | null
}

/** A question that selects one named option. */
export interface DecisionChoiceQuestion {
  readonly type: 'choice'
  readonly instructions?: JevContent | null
  readonly options: Readonly<Record<string, JevContent | null>>
}

/** A question that assigns an expected score over ordered levels. */
export interface DecisionScoreQuestion {
  readonly type: 'score'
  readonly instructions?: JevContent | null
  readonly levels: readonly JevContent[]
}

/** Provider-independent questions supported by the decision service. */
export type DecisionQuestion = DecisionBooleanQuestion | DecisionChoiceQuestion | DecisionScoreQuestion

/** Shared state and named questions for one decision operation. */
export interface DecisionRequest {
  readonly state: JevContent
  readonly questions: Readonly<Record<string, DecisionQuestion>>
  readonly model?: string
}

/** A yes/no result with the underlying probability and confidence. */
export interface DecisionBooleanAnswer {
  readonly type: 'boolean'
  readonly value: boolean
  readonly probability: number
  readonly confidence: number
}

/** A selected option with all option probabilities. */
export interface DecisionChoiceAnswer {
  readonly type: 'choice'
  readonly value: string
  readonly confidence: number
  readonly probabilities: Readonly<Record<string, number>>
}

/** An expected score with all score-level probabilities. */
export interface DecisionScoreAnswer {
  readonly type: 'score'
  readonly value: number
  readonly confidence: number
  readonly levels: Readonly<Record<string, JevContent>>
  readonly probabilities: Readonly<Record<string, number>>
}

/** Provider-independent answer types returned by a decision provider. */
export type DecisionAnswer = DecisionBooleanAnswer | DecisionChoiceAnswer | DecisionScoreAnswer

/** Token use reported by a decision provider. */
export interface DecisionUsage {
  readonly inputTokens: number
  readonly outputTokens: number
}

/** Provider output before service-owned metadata is attached. */
export interface DecisionProviderResult {
  readonly model: string
  readonly answers: Readonly<Record<string, DecisionAnswer>>
  readonly usage: DecisionUsage
}

/** Successful decision result with provider and latency metadata. */
export interface DecisionResult extends DecisionProviderResult {
  readonly provider: DecisionProviderName
  readonly latencyMs: number
}

/** Options forwarded to a decision provider for one operation. */
export interface DecisionProviderCallOptions {
  readonly signal?: AbortSignal
}

/** A replaceable structured-decision implementation. */
export interface DecisionProvider {
  readonly name: DecisionProviderName

  /**
   * Evaluate a provider-independent decision request.
   * @param request - Shared state and named questions.
   * @param options - Caller cancellation for this operation.
   * @returns Validated structured answers and provider usage.
   */
  decide(request: DecisionRequest, options: DecisionProviderCallOptions): Promise<DecisionProviderResult>
}

/** Provider selection and cancellation for one service call. */
export interface DecisionCallOptions {
  readonly provider?: DecisionProviderName
  readonly signal?: AbortSignal
}

/** Explicit provider resolution produced before a decision runs. */
export interface ResolvedDecisionRequest {
  readonly provider: DecisionProvider
  readonly request: DecisionRequest
  readonly signal?: AbortSignal
}

/** Construction options for a decision service instance. */
export interface DecisionServiceOptions {
  readonly defaultProvider?: DecisionProviderName
  readonly now?: () => number
}
