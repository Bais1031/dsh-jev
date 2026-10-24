/** JSON values accepted by the TypeSafe System One API. */
export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[]

/** JSON object accepted by the TypeSafe System One API. */
export interface JsonObject {
  readonly [key: string]: JsonValue
}

/** Structured content accepted for state, instructions, and criteria. */
export type JevContent = string | JsonObject | JsonValue[]

/** A yes/no or true/false question. */
export interface JevNoulQuestion {
  readonly type: 'noul'
  readonly instructions?: JevContent | null
  readonly criteria?: {
    readonly true?: JevContent | null
    readonly false?: JevContent | null
  } | null
}

/** A question that selects one named option. */
export interface JevChoiceQuestion {
  readonly type: 'choice'
  readonly instructions?: JevContent | null
  readonly criteria: Readonly<Record<string, JevContent | null>>
}

/** A question that assigns an expected score over ordered levels. */
export interface JevScoreQuestion {
  readonly type: 'score'
  readonly instructions?: JevContent | null
  readonly criteria: readonly JevContent[]
}

/** Question types supported by the first dsh-jev wire client. */
export type JevQuestion = JevNoulQuestion | JevChoiceQuestion | JevScoreQuestion

/** A System One request before client defaults are applied. */
export interface JevRequest {
  readonly model?: string
  readonly state: JevContent
  readonly questions: Readonly<Record<string, JevQuestion>>
}

/** Probability of a yes or true answer. */
export interface JevNoulAnswer {
  readonly type: 'noul'
  readonly noul: number
}

/** Selected option and its probability distribution. */
export interface JevChoiceAnswer {
  readonly type: 'choice'
  readonly choice: string
  readonly confidence: number
  readonly probabilities: Readonly<Record<string, number>>
}

/** Expected score and its probability distribution. */
export interface JevScoreAnswer {
  readonly type: 'score'
  readonly score: number
  readonly confidence: number
  readonly legend: Readonly<Record<string, JevContent>>
  readonly probabilities: Readonly<Record<string, number>>
}

/** Answers supported by the first dsh-jev wire client. */
export type JevAnswer = JevNoulAnswer | JevChoiceAnswer | JevScoreAnswer

/** Billable token counts reported by TypeSafe. */
export interface JevUsage {
  readonly inputTokens: number
  readonly outputTokens: number
}

/** Validated System One response. */
export interface JevResponse {
  readonly model: string
  readonly answers: Readonly<Record<string, JevAnswer>>
  readonly usage: JevUsage
}

/** Per-operation secrets and cancellation. */
export interface JevCallOptions {
  readonly apiKey: string | undefined
  readonly signal?: AbortSignal
}

/** Stable wire-client configuration. */
export interface JevClientOptions {
  readonly endpoint?: string
  readonly model?: string
  readonly timeoutMs?: number
  readonly maxInputBytes?: number
  readonly fetch?: typeof globalThis.fetch
}
