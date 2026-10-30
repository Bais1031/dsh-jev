/** Versioned Jev questions and deterministic projection for decision guidance. */

import type {
  DecisionAnswer,
  DecisionBooleanAnswer,
  DecisionChoiceAnswer,
  DecisionQuestion,
  DecisionRequest,
  DecisionResult,
} from './decision-types.js'
import type { JevContent } from './types.js'

/** Stable interpretation rules for one decision-guidance result. */
export const DECISION_GUIDANCE_STRATEGY_VERSION = 'jev-decision-guidance-v1'
/** Stable node-specific question sets used by the current decision-guidance protocol. */
export const DECISION_GUIDANCE_QUESTION_VERSION = 'decision-brief-v2'

/** Agent analysis point that caused one Jev evaluation. */
export type DecisionNodeType =
  | 'task-intake'
  | 'missing-information'
  | 'direction-selection'
  | 'tool-recovery'
  | 'progress-check'
  | 'pre-conclusion'

/** Broad task class retained when reading version-one briefs. */
export type DecisionTaskType = 'coding' | 'retrieval' | 'writing' | 'analysis' | 'operation'

/** Next analytical action recommended to the main model. */
export type DecisionRecommendedAction =
  | 'continue'
  | 'ask-user'
  | 'inspect-context'
  | 'search'
  | 'use-tool'
  | 'change-direction'
  | 'answer'
  | 'stop'

/** Bounded analysis direction selected from the protocol vocabulary. */
export type DecisionFocus =
  | 'clarify-goal'
  | 'verify-assumptions'
  | 'inspect-local-context'
  | 'gather-external-evidence'
  | 'compare-options'
  | 'recover-tool'
  | 'synthesize-evidence'
  | 'answer-directly'

/** Bounded failure pattern the main model should avoid. */
export type DecisionAvoid =
  | 'unsupported-assumption'
  | 'broad-search'
  | 'repeat-failed-action'
  | 'premature-conclusion'
  | 'unnecessary-tool'
  | 'none'

/** Risk class reported by Jev without granting an authorization. */
export type DecisionRisk = 'low' | 'medium' | 'high'
/** Ambiguity class reported by Jev. */
export type DecisionAmbiguity = 'low' | 'medium' | 'high'

/** One ranked direction derived from Jev's complete focus distribution. */
export interface DecisionDirection {
  readonly focus: DecisionFocus
  readonly probability: number
}

/** Short structured advice derived from the question set selected for one analysis node. */
export interface JevDecisionBrief {
  readonly version: 2
  readonly nodeType: DecisionNodeType
  readonly taskType?: DecisionTaskType
  readonly informationSufficient: boolean
  readonly informationSufficientProbability: number
  readonly candidateDirections: readonly DecisionDirection[]
  readonly recommendedAction: DecisionRecommendedAction
  readonly focus: DecisionFocus
  readonly avoid?: DecisionAvoid
  readonly riskLevel?: DecisionRisk
  readonly ambiguity: DecisionAmbiguity
  readonly confidence: number
  readonly accepted: boolean
  readonly reasons: readonly DecisionBriefRejectionReason[]
}

/** Stable reason why a valid brief is not eligible for later model injection. */
export type DecisionBriefRejectionReason = 'confidence-below-threshold'

/** Stable protocol failure identities that do not require message parsing. */
export type DecisionGuidanceProtocolErrorCode =
  | 'DECISION_GUIDANCE_INVALID_RESULT'

/** Expected failure while validating or projecting a provider result. */
export class DecisionGuidanceProtocolError extends Error {
  readonly code: DecisionGuidanceProtocolErrorCode
  readonly retryable = false

  /**
   * @param code - Stable protocol failure identity.
   * @param message - Safe diagnostic without provider response content.
   */
  constructor(code: DecisionGuidanceProtocolErrorCode, message: string) {
    super(message)
    this.name = 'DecisionGuidanceProtocolError'
    this.code = code
  }
}

/**
 * Build the exact versioned question set for one analysis node.
 * @param nodeType - Analysis point that selects the smallest sufficient question set.
 * @param state - Bounded, secret-free state assembled by the trigger engine.
 * @param model - Jev model selected by live plugin configuration.
 * @returns A provider-independent request with fixed answer vocabularies.
 */
export function createDecisionGuidanceRequest(
  nodeType: DecisionNodeType,
  state: JevContent,
  model: string,
): DecisionRequest {
  return { state, model, questions: questionsForNode(nodeType) }
}

/**
 * Validate and project one provider result into a bounded decision brief.
 * @param nodeType - Analysis point represented by the result.
 * @param result - Provider result for {@link createDecisionGuidanceRequest}.
 * @param minimumConfidence - Minimum joint confidence for future model injection.
 * @returns A brief containing fixed vocabulary and at most three candidate directions.
 */
export function createDecisionBrief(
  nodeType: DecisionNodeType,
  result: DecisionResult,
  minimumConfidence: number,
): JevDecisionBrief {
  const informationSufficient = boolean(result.answers, 'informationSufficient')
  const action = choice(result.answers, 'recommendedAction', RECOMMENDED_ACTIONS)
  const focus = choice(result.answers, 'focus', FOCUS_OPTIONS)
  const ambiguity = choice(result.answers, 'ambiguity', AMBIGUITY_OPTIONS)
  const avoid = includesAvoid(nodeType) ? choice(result.answers, 'avoid', AVOID_OPTIONS) : undefined
  const risk = includesRisk(nodeType) ? choice(result.answers, 'risk', RISK_OPTIONS) : undefined
  const confidence = Math.min(action.confidence, focus.confidence)
  const accepted = confidence >= minimumConfidence
  return {
    version: 2,
    nodeType,
    informationSufficient: informationSufficient.value,
    informationSufficientProbability: informationSufficient.probability,
    candidateDirections: rankedDirections(focus.probabilities),
    recommendedAction: action.value,
    focus: focus.value,
    ...avoid === undefined ? {} : { avoid: avoid.value },
    ...risk === undefined ? {} : { riskLevel: risk.value },
    ambiguity: ambiguity.value,
    confidence,
    accepted,
    reasons: accepted ? [] : ['confidence-below-threshold'],
  }
}

const RECOMMENDED_ACTIONS = [
  'continue', 'ask-user', 'inspect-context', 'search', 'use-tool', 'change-direction', 'answer', 'stop',
] as const
const FOCUS_OPTIONS = [
  'clarify-goal', 'verify-assumptions', 'inspect-local-context', 'gather-external-evidence',
  'compare-options', 'recover-tool', 'synthesize-evidence', 'answer-directly',
] as const
const AVOID_OPTIONS = [
  'unsupported-assumption', 'broad-search', 'repeat-failed-action', 'premature-conclusion', 'unnecessary-tool', 'none',
] as const
const RISK_OPTIONS = ['low', 'medium', 'high'] as const
const AMBIGUITY_OPTIONS = ['low', 'medium', 'high'] as const

const CORE_QUESTIONS = {
  informationSufficient: {
    type: 'boolean',
    instructions: 'Is the available information sufficient for the next reliable analytical action?',
  },
  recommendedAction: {
    type: 'choice',
    instructions: 'Choose the next action that most directly reduces uncertainty or completes the analysis.',
    options: {
      continue: 'Continue the current analysis direction.',
      'ask-user': 'Ask the user for material missing information.',
      'inspect-context': 'Inspect available local context before drawing a conclusion.',
      search: 'Gather current or external evidence.',
      'use-tool': 'Use an available tool to obtain necessary evidence.',
      'change-direction': 'Stop the current line of investigation and test another direction.',
      answer: 'The evidence supports answering now.',
      stop: 'Stop because continuation is unsafe or cannot produce a reliable result.',
    },
  },
  focus: {
    type: 'choice',
    instructions: 'Choose the most useful analysis direction for the next step.',
    options: {
      'clarify-goal': 'Resolve the intended outcome or constraints.',
      'verify-assumptions': 'Test assumptions that materially affect the result.',
      'inspect-local-context': 'Read the supplied files, state, or prior evidence.',
      'gather-external-evidence': 'Find relevant current or external evidence.',
      'compare-options': 'Compare viable alternatives against explicit criteria.',
      'recover-tool': 'Diagnose a failed or unproductive tool action.',
      'synthesize-evidence': 'Combine established evidence into a conclusion.',
      'answer-directly': 'Respond without further exploration.',
    },
  },
  ambiguity: {
    type: 'choice',
    instructions: 'Classify unresolved ambiguity that can change the correct next action.',
    options: {
      low: 'The next action is clear.',
      medium: 'A reversible default can continue.',
      high: 'The user must clarify before reliable progress.',
    },
  },
} satisfies Readonly<Record<string, DecisionQuestion>>

const AVOID_QUESTION = {
  avoid: {
    type: 'choice',
    instructions: 'Choose the most important failure pattern to avoid in the next step.',
    options: {
      'unsupported-assumption': 'Do not treat an unverified assumption as evidence.',
      'broad-search': 'Do not expand the search beyond the decision-relevant scope.',
      'repeat-failed-action': 'Do not repeat an action that failed without a changed condition.',
      'premature-conclusion': 'Do not conclude before the available evidence is sufficient.',
      'unnecessary-tool': 'Do not call a tool when existing context is sufficient.',
      none: 'No specific failure pattern dominates the next step.',
    },
  },
} satisfies Readonly<Record<string, DecisionQuestion>>

const RISK_QUESTION = {
  risk: {
    type: 'choice',
    instructions: 'Classify the harm caused by an incorrect next analytical action.',
    options: {
      low: 'Reversible with limited impact.',
      medium: 'Material time, data, or workflow impact.',
      high: 'Deletion, payment, publication, credentials, permissions, legal, medical, or other high stakes.',
    },
  },
} satisfies Readonly<Record<string, DecisionQuestion>>

function questionsForNode(nodeType: DecisionNodeType): Readonly<Record<string, DecisionQuestion>> {
  switch (nodeType) {
    case 'task-intake':
    case 'missing-information':
    case 'direction-selection':
      return CORE_QUESTIONS
    case 'progress-check':
      return { ...CORE_QUESTIONS, ...AVOID_QUESTION }
    case 'tool-recovery':
      return { ...CORE_QUESTIONS, ...AVOID_QUESTION, ...RISK_QUESTION }
    case 'pre-conclusion':
      return { ...CORE_QUESTIONS, ...RISK_QUESTION }
    default:
      return assertNever(nodeType)
  }
}

function includesAvoid(nodeType: DecisionNodeType): boolean {
  return nodeType === 'tool-recovery' || nodeType === 'progress-check'
}

function includesRisk(nodeType: DecisionNodeType): boolean {
  return nodeType === 'tool-recovery' || nodeType === 'pre-conclusion'
}

function boolean(answers: Readonly<Record<string, DecisionAnswer>>, name: string): DecisionBooleanAnswer {
  const answer = answers[name]
  if (answer?.type !== 'boolean') invalidResult()
  return answer
}

function choice<const Values extends readonly string[]>(
  answers: Readonly<Record<string, DecisionAnswer>>,
  name: string,
  values: Values,
): DecisionChoiceAnswer & { readonly value: Values[number]; readonly probabilities: Readonly<Record<Values[number], number>> } {
  const answer = answers[name]
  if (answer?.type !== 'choice' || !values.includes(answer.value)) invalidResult()
  const keys = Object.keys(answer.probabilities)
  if (keys.length !== values.length || values.some(value => !isProbability(answer.probabilities[value]))) invalidResult()
  return answer as DecisionChoiceAnswer & {
    readonly value: Values[number]
    readonly probabilities: Readonly<Record<Values[number], number>>
  }
}

function rankedDirections(probabilities: Readonly<Record<DecisionFocus, number>>): readonly DecisionDirection[] {
  return Object.entries(probabilities)
    .map(([focus, probability]) => ({ focus: focus as DecisionFocus, probability }))
    .sort((left, right) => right.probability - left.probability)
    .slice(0, 3)
}

function isProbability(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value >= 0 && value <= 1
}

function invalidResult(): never {
  throw new DecisionGuidanceProtocolError(
    'DECISION_GUIDANCE_INVALID_RESULT',
    'Jev returned a result that does not match decision-brief-v2',
  )
}

function assertNever(value: never): never {
  throw new Error(`Unsupported decision node: ${String(value)}`)
}
