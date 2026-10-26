/** Jev-backed routing analysis for DeepSeek Harness Agent requests. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { LlmCallConfig, UserMessage } from '@deepseek-ai/dsh-llm'
import {
  appendPluginRecord,
  type Session,
  type SessionSeq,
} from '@deepseek-ai/dsh-session'
import { DecisionError } from './decision-errors.js'
import type {
  DecisionAnswer,
  DecisionChoiceAnswer,
  DecisionQuestion,
  DecisionRequest,
  DecisionResult,
} from './decision-types.js'

/** Stable interpretation rules for a recorded routing decision. */
export const ROUTER_STRATEGY_VERSION = 'jev-router-v1'
/** Stable question set sent to Jev by the first router strategy. */
export const ROUTER_QUESTION_VERSION = 'agent-route-v1'

/** Operating modes supported by the router. */
export type RouterMode = 'off' | 'shadow' | 'advisory' | 'automatic'
/** Symbolic workload tier proposed by Jev before deployment routes are applied. */
export type RouterTier = 'fast' | 'standard' | 'deep' | 'ask-user'
/** Risk class used to prevent uncertain or sensitive work from being auto-routed. */
export type RouterRisk = 'low' | 'medium' | 'high'
/** Recovery policy used when Automatic mode cannot safely apply a recommendation. */
export type RouterFallbackPolicy = 'default-model' | 'user-selection' | 'fail-closed'
/** Concrete provider/model pair configured for a symbolic tier. */
export interface RouterRouteTarget {
  readonly provider: string
  readonly model: string
}

/** Non-secret statistics describing the bounded text supplied to Jev. */
export interface RouterInputSummary {
  readonly messageCount: number
  readonly textCharacters: number
  readonly includedCharacters: number
  readonly truncated: boolean
}

/** Concrete model route observed or selected for one Agent request. */
export interface RouterActualRoute {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

/** Deterministic interpretation of Jev's route and risk probabilities. */
export interface RouterRecommendation {
  readonly tier: RouterTier
  readonly risk: RouterRisk
  readonly confidence: number
  readonly margin: number
  readonly accepted: boolean
  readonly reasons: readonly string[]
}

/** Exact secret-free input recorded before one Jev router dispatch. */
export interface RouterRequestRecord {
  readonly strategyVersion: typeof ROUTER_STRATEGY_VERSION
  readonly questionVersion: typeof ROUTER_QUESTION_VERSION
  readonly mode: Exclude<RouterMode, 'off'>
  readonly turn: number
  readonly step: number
  readonly actualRoute: RouterActualRoute
  readonly inputSummary: RouterInputSummary
  readonly request: DecisionRequest
}

/** Successful Jev analysis associated with one request record. */
export interface RouterSuccessRecord {
  readonly requestSeq: SessionSeq
  readonly status: 'success'
  readonly recommendation: RouterRecommendation
  readonly provider: string
  readonly model: string
  readonly latencyMs: number
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number }
  readonly answers: Readonly<Record<string, DecisionAnswer>>
}

/** Safe structured failure associated with one request record. */
export interface RouterFailureRecord {
  readonly requestSeq: SessionSeq
  readonly status: 'failure'
  readonly code: string
  readonly retryable: boolean
  readonly provider?: string
  readonly providerCode?: string
  readonly latencyMs?: number
}

/** Durable result of one routing analysis. */
export type RouterResultRecord = RouterSuccessRecord | RouterFailureRecord

/** Exact choice displayed before Advisory mode can replace the current route. */
export interface RouterAdvisoryPrompt {
  readonly question: string
  readonly detail: string
  readonly recommendedLabel: string
  readonly currentLabel: string
  readonly recommendation: RouterRecommendation
  readonly currentRoute: RouterActualRoute
  readonly recommendedRoute: RouterRouteTarget
}

/** User response understood by the routing controller. */
export type RouterAdvisoryChoice = 'recommended' | 'current'

/** Recorded Advisory interaction outcome. */
export interface RouterAdvisoryOutcomeRecord {
  readonly requestSeq: SessionSeq
  readonly resultSeq: SessionSeq
  readonly outcome: 'recommended' | 'current' | 'target-unavailable' | 'interaction-unavailable'
  readonly selectedRoute: RouterActualRoute
  readonly errorCode?: string
}

/** Automatic routing or deterministic fallback recorded for one analysis. */
export interface RouterAutomaticOutcomeRecord {
  readonly requestSeq: SessionSeq
  readonly resultSeq: SessionSeq
  readonly outcome: 'automatic' | 'fallback-current' | 'fallback-user-selection' | 'failed-closed'
  readonly reason: 'analysis-failure' | 'recommendation-rejected' | 'target-unavailable' | 'accepted'
  readonly selectedRoute?: RouterActualRoute
}

declare module '@deepseek-ai/dsh-session/types' {
  interface PluginRecordMap {
    /** Exact input for one optional dsh-jev routing analysis. */
    'plugin:dsh-jev/router-request': RouterRequestRecord
    /** Successful result or safe failure for one dsh-jev routing analysis. */
    'plugin:dsh-jev/router-result': RouterResultRecord
    /** Exact user-visible Advisory question displayed before route selection. */
    'plugin:dsh-jev/router-advisory-request': {
      readonly requestSeq: SessionSeq
      readonly resultSeq: SessionSeq
      readonly prompt: RouterAdvisoryPrompt
    }
    /** User choice or safe Advisory fallback applied to the model request. */
    'plugin:dsh-jev/router-advisory-outcome': RouterAdvisoryOutcomeRecord
    /** Automatic route application or its explicit fallback. */
    'plugin:dsh-jev/router-automatic-outcome': RouterAutomaticOutcomeRecord
  }
}

/** Minimal decision service consumed by the router. */
export interface RouterDecisionService {
  /** @param request - Versioned route questions. @param options - Turn cancellation. @returns Jev answers and usage. */
  decide(request: DecisionRequest, options?: { readonly signal?: AbortSignal }): Promise<DecisionResult>
}

/** Live settings read once for each routing analysis. */
export interface JevRouterOptions {
  readonly mode: () => RouterMode
  readonly model: () => string
  readonly maximumInputCharacters: () => number
  readonly minimumConfidence: () => number
  readonly minimumMargin: () => number
  readonly fallbackPolicy: () => RouterFallbackPolicy
  /** @param tier - Jev's symbolic recommendation. @returns Configured concrete route, when usable. */
  readonly routeTarget?: (tier: Exclude<RouterTier, 'ask-user'>) => RouterRouteTarget | undefined
  /** Ask a live root Agent whether to apply one concrete recommendation. */
  readonly askUser?: (
    agent: Agent,
    prompt: RouterAdvisoryPrompt,
    signal: AbortSignal,
  ) => Promise<RouterAdvisoryChoice>
}

interface PendingStep {
  readonly turn: number
  readonly step: number
  readonly messages: readonly UserMessage[]
}

/**
 * Register the Agent listeners that evaluate routing advice.
 *
 * Shadow mode records the recommendation but always returns the exact route
 * produced by downstream listeners. Later modes reuse the same captured step
 * and recorded decision without changing this stage's shadow guarantee.
 *
 * @param ctx - Plugin context that observes Agent extension points.
 * @param decisions - Structured decision service used for Jev calls.
 * @param options - Per-operation configuration readers.
 */
export function installJevRouter(
  ctx: Context,
  decisions: RouterDecisionService,
  options: JevRouterOptions,
): void {
  const pending = new WeakMap<Agent, PendingStep>()

  ctx.on('agent/pre-step', async ({ agent, turn, step }, next) => {
    const decision = await next()
    if (decision.kind === 'enter') pending.set(agent, { turn, step, messages: decision.messages })
    return decision
  }, { prepend: true })

  ctx.on('agent/request', async ({ agent, turn, step, signal }, next): Promise<LlmCallConfig> => {
    const actual = await next()
    const mode = options.mode()
    if (mode === 'off') return actual

    const captured = pending.get(agent)
    if (captured === undefined || captured.turn !== turn || captured.step !== step) return actual
    pending.delete(agent)
    const analysis = await evaluateRoute(agent.session, captured, actual, mode, decisions, options, signal)
    signal.throwIfAborted()
    if (mode === 'shadow') return actual
    if (mode === 'advisory') {
      if (analysis.status === 'failure') return actual
      return await advisoryRoute(agent, actual, analysis, options, signal)
    }
    return await automaticRoute(agent, actual, analysis, options, signal)
  })

  ctx.on('agent/disposed', ({ agent }) => {
    pending.delete(agent)
  })
}

async function evaluateRoute(
  session: Session,
  captured: PendingStep,
  actual: LlmCallConfig,
  mode: Exclude<RouterMode, 'off'>,
  decisions: RouterDecisionService,
  options: JevRouterOptions,
  signal: AbortSignal,
): Promise<RoutingAnalysis> {
  const input = routerInput(captured.messages, options.maximumInputCharacters())
  const request = routerRequest(input.state, options.model())
  const requestSeq = appendPluginRecord(session, 'plugin:dsh-jev/router-request', {
    strategyVersion: ROUTER_STRATEGY_VERSION,
    questionVersion: ROUTER_QUESTION_VERSION,
    mode,
    turn: captured.turn,
    step: captured.step,
    actualRoute: actualRoute(actual),
    inputSummary: input.summary,
    request,
  })

  try {
    const result = await decisions.decide(request, { signal })
    const recommendationValue = recommendation(result, options.minimumConfidence(), options.minimumMargin())
    const resultSeq = appendPluginRecord(session, 'plugin:dsh-jev/router-result', {
      requestSeq,
      status: 'success',
      recommendation: recommendationValue,
      provider: result.provider,
      model: result.model,
      latencyMs: result.latencyMs,
      usage: result.usage,
      answers: result.answers,
    })
    return { status: 'success', requestSeq, resultSeq, recommendation: recommendationValue }
  } catch (error: unknown) {
    const resultSeq = appendPluginRecord(session, 'plugin:dsh-jev/router-result', failureRecord(requestSeq, error))
    return { status: 'failure', requestSeq, resultSeq }
  }
}

type RoutingAnalysis = {
  readonly status: 'success'
  readonly requestSeq: SessionSeq
  readonly resultSeq: SessionSeq
  readonly recommendation: RouterRecommendation
} | {
  readonly status: 'failure'
  readonly requestSeq: SessionSeq
  readonly resultSeq: SessionSeq
}

async function advisoryRoute(
  agent: Agent,
  actual: LlmCallConfig,
  analysis: Extract<RoutingAnalysis, { readonly status: 'success' }>,
  options: JevRouterOptions,
  signal: AbortSignal,
): Promise<LlmCallConfig> {
  const tier = analysis.recommendation.tier
  const target = tier === 'ask-user' ? undefined : options.routeTarget?.(tier)
  if (target === undefined) {
    appendPluginRecord(agent.session, 'plugin:dsh-jev/router-advisory-outcome', {
      requestSeq: analysis.requestSeq,
      resultSeq: analysis.resultSeq,
      outcome: 'target-unavailable',
      selectedRoute: actualRoute(actual),
    })
    return actual
  }
  if (options.askUser === undefined) {
    appendPluginRecord(agent.session, 'plugin:dsh-jev/router-advisory-outcome', {
      requestSeq: analysis.requestSeq,
      resultSeq: analysis.resultSeq,
      outcome: 'interaction-unavailable',
      selectedRoute: actualRoute(actual),
      errorCode: 'ADVISORY_INTERACTION_UNAVAILABLE',
    })
    return actual
  }

  const prompt = advisoryPrompt(analysis.recommendation, actualRoute(actual), target)
  appendPluginRecord(agent.session, 'plugin:dsh-jev/router-advisory-request', {
    requestSeq: analysis.requestSeq,
    resultSeq: analysis.resultSeq,
    prompt,
  })
  try {
    const choice = await options.askUser(agent, prompt, signal)
    const useRecommended = choice === 'recommended'
    const selected = useRecommended ? applyTarget(actual, target) : actual
    appendPluginRecord(agent.session, 'plugin:dsh-jev/router-advisory-outcome', {
      requestSeq: analysis.requestSeq,
      resultSeq: analysis.resultSeq,
      outcome: useRecommended ? 'recommended' : 'current',
      selectedRoute: actualRoute(selected),
    })
    return selected
  } catch (error: unknown) {
    appendPluginRecord(agent.session, 'plugin:dsh-jev/router-advisory-outcome', {
      requestSeq: analysis.requestSeq,
      resultSeq: analysis.resultSeq,
      outcome: 'interaction-unavailable',
      selectedRoute: actualRoute(actual),
      errorCode: safeInteractionCode(error),
    })
    return actual
  }
}

async function automaticRoute(
  agent: Agent,
  actual: LlmCallConfig,
  analysis: RoutingAnalysis,
  options: JevRouterOptions,
  signal: AbortSignal,
): Promise<LlmCallConfig> {
  const reason = automaticFallbackReason(analysis, options)
  if (reason === undefined && analysis.status === 'success') {
    const tier = analysis.recommendation.tier
    const target = tier === 'ask-user' ? undefined : options.routeTarget?.(tier)
    if (target !== undefined) {
      const selected = applyTarget(actual, target)
      appendAutomaticOutcome(agent.session, analysis, 'automatic', 'accepted', selected)
      return selected
    }
  }

  const fallbackReason = reason ?? 'target-unavailable'
  const policy = options.fallbackPolicy()
  if (policy === 'user-selection' && analysis.status === 'success') {
    const tier = analysis.recommendation.tier
    const target = tier === 'ask-user' ? undefined : options.routeTarget?.(tier)
    if (target !== undefined) {
      const selected = await advisoryRoute(agent, actual, analysis, options, signal)
      appendAutomaticOutcome(agent.session, analysis, 'fallback-user-selection', fallbackReason, selected)
      return selected
    }
  }
  if (policy === 'fail-closed') {
    appendAutomaticOutcome(agent.session, analysis, 'failed-closed', fallbackReason)
    throw new RouterPolicyError(fallbackReason)
  }
  appendAutomaticOutcome(agent.session, analysis, 'fallback-current', fallbackReason, actual)
  return actual
}

function automaticFallbackReason(
  analysis: RoutingAnalysis,
  options: JevRouterOptions,
): RouterAutomaticOutcomeRecord['reason'] | undefined {
  if (analysis.status === 'failure') return 'analysis-failure'
  if (!analysis.recommendation.accepted) return 'recommendation-rejected'
  const tier = analysis.recommendation.tier
  if (tier === 'ask-user' || options.routeTarget?.(tier) === undefined) return 'target-unavailable'
  return undefined
}

function appendAutomaticOutcome(
  session: Session,
  analysis: RoutingAnalysis,
  outcome: RouterAutomaticOutcomeRecord['outcome'],
  reason: RouterAutomaticOutcomeRecord['reason'],
  selected?: LlmCallConfig,
): void {
  appendPluginRecord(session, 'plugin:dsh-jev/router-automatic-outcome', {
    requestSeq: analysis.requestSeq,
    resultSeq: analysis.resultSeq,
    outcome,
    reason,
    ...selected === undefined ? {} : { selectedRoute: actualRoute(selected) },
  })
}

/** Automatic mode stopped a request because its configured fallback is fail-closed. */
export class RouterPolicyError extends Error {
  readonly code = 'JEV_ROUTER_FAIL_CLOSED'
  readonly reason: RouterAutomaticOutcomeRecord['reason']

  /** @param reason - Stable cause that made automatic routing unavailable. */
  constructor(reason: RouterAutomaticOutcomeRecord['reason']) {
    super(`dsh-jev automatic routing stopped: ${reason}`)
    this.name = 'RouterPolicyError'
    this.reason = reason
  }
}

function advisoryPrompt(
  recommendationValue: RouterRecommendation,
  currentRoute: RouterActualRoute,
  recommendedRoute: RouterRouteTarget,
): RouterAdvisoryPrompt {
  const recommendedLabel = `Use ${recommendedRoute.provider}/${recommendedRoute.model}`
  const currentLabel = `Keep ${currentRoute.provider}/${currentRoute.model}`
  return {
    question: `Jev recommends the ${recommendationValue.tier} route. Which route should handle this step?`,
    detail: `Confidence ${percent(recommendationValue.confidence)}, probability gap ${percent(recommendationValue.margin)}, risk ${recommendationValue.risk}.`,
    recommendedLabel,
    currentLabel,
    recommendation: recommendationValue,
    currentRoute,
    recommendedRoute,
  }
}

function applyTarget(actual: LlmCallConfig, target: RouterRouteTarget): LlmCallConfig {
  if (actual.provider === target.provider && actual.model === target.model) return actual
  const { reasoningEffort: _reasoningEffort, ...withoutEffort } = actual
  return { ...withoutEffort, provider: target.provider, model: target.model }
}

function percent(value: number): string {
  return `${String(Math.round(value * 100))}%`
}

function safeInteractionCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') {
    return error.code
  }
  return 'ADVISORY_INTERACTION_FAILED'
}

function routerRequest(state: DecisionRequest['state'], model: string): DecisionRequest {
  return {
    state,
    model,
    questions: ROUTER_QUESTIONS,
  }
}

const ROUTER_QUESTIONS = {
  taskType: {
    type: 'choice',
    instructions: 'Classify the primary work requested by the user.',
    options: {
      coding: 'Implement, debug, review, or explain software.',
      retrieval: 'Find or verify current external information.',
      writing: 'Draft, edit, translate, or summarize prose.',
      analysis: 'Reason over supplied information without an external action.',
      operation: 'Change external state, publish, purchase, delete, or manage access.',
    },
  },
  complexity: {
    type: 'choice',
    instructions: 'Estimate the reasoning complexity required for a reliable answer.',
    options: { low: 'Routine and bounded.', medium: 'Several dependent judgments.', high: 'Deep, ambiguous, or many dependent steps.' },
  },
  needsLatestInformation: { type: 'boolean', instructions: 'Does success require current external information?' },
  needsTools: { type: 'boolean', instructions: 'Does success require tools, files, code execution, or external services?' },
  needsDelegation: { type: 'boolean', instructions: 'Would independent delegated work materially improve completion?' },
  ambiguity: {
    type: 'choice',
    instructions: 'How much unresolved user intent would change the correct action?',
    options: { low: 'Intent is sufficiently clear.', medium: 'Defaults can safely resolve it.', high: 'User confirmation is required.' },
  },
  risk: {
    type: 'choice',
    instructions: 'Classify harm if the system chooses an unsuitable route or acts on a mistaken interpretation.',
    options: { low: 'Reversible and low impact.', medium: 'Material time, data, or workflow impact.', high: 'Deletion, payment, publication, credentials, permissions, legal, medical, or other high stakes.' },
  },
  route: {
    type: 'choice',
    instructions: 'Recommend the least expensive route that can reliably handle the request. Use ask-user when unresolved intent prevents a safe choice.',
    options: {
      fast: 'Fast low-cost model.',
      standard: 'Default balanced model.',
      deep: 'Highest-capability reasoning model.',
      'ask-user': 'Ask the user to resolve material ambiguity.',
    },
  },
} satisfies Readonly<Record<string, DecisionQuestion>>

function routerInput(messages: readonly UserMessage[], limit: number): {
  readonly state: DecisionRequest['state']
  readonly summary: RouterInputSummary
} {
  const segments: string[] = []
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === 'text' && block.text.length > 0) segments.push(block.text)
    }
  }
  const text = segments.join('\n\n')
  const textCharacters = Array.from(text).length
  const bounded = takeCharacters(text, limit)
  const content = bounded.length === 0 ? '[No textual user content]' : bounded
  return {
    state: {
      content,
      messageCount: messages.length,
      textCharacters,
      truncated: textCharacters > limit,
    },
    summary: {
      messageCount: messages.length,
      textCharacters,
      includedCharacters: Array.from(bounded).length,
      truncated: textCharacters > limit,
    },
  }
}

function takeCharacters(value: string, limit: number): string {
  let result = ''
  let count = 0
  for (const character of value) {
    if (count >= limit) break
    result += character
    count += 1
  }
  return result
}

function actualRoute(config: LlmCallConfig): RouterActualRoute {
  return {
    provider: config.provider,
    model: config.model,
    ...config.reasoningEffort === undefined ? {} : { reasoningEffort: config.reasoningEffort },
  }
}

function recommendation(result: DecisionResult, minimumConfidence: number, minimumMargin: number): RouterRecommendation {
  const route = choice(result.answers.route, 'route')
  const risk = choice(result.answers.risk, 'risk')
  const ambiguity = choice(result.answers.ambiguity, 'ambiguity')
  const probabilities = Object.values(route.probabilities).sort((left, right) => right - left)
  const margin = Math.max(0, (probabilities[0] ?? 0) - (probabilities[1] ?? 0))
  const reasons: string[] = []
  if (route.confidence < minimumConfidence) reasons.push('confidence-below-threshold')
  if (margin < minimumMargin) reasons.push('margin-below-threshold')
  if (risk.value !== 'low') reasons.push('risk-not-low')
  const riskProbabilities = Object.values(risk.probabilities).sort((left, right) => right - left)
  const riskMargin = Math.max(0, (riskProbabilities[0] ?? 0) - (riskProbabilities[1] ?? 0))
  if (risk.confidence < minimumConfidence) reasons.push('risk-confidence-below-threshold')
  if (riskMargin < minimumMargin) reasons.push('risk-margin-below-threshold')
  if (ambiguity.value === 'high') reasons.push('ambiguity-high')
  return {
    tier: routerTier(route.value),
    risk: routerRisk(risk.value),
    confidence: route.confidence,
    margin,
    accepted: reasons.length === 0,
    reasons,
  }
}

function choice(answer: DecisionAnswer | undefined, name: string): DecisionChoiceAnswer {
  if (answer?.type !== 'choice') throw new Error(`dsh-jev router expected a choice answer for ${name}`)
  return answer
}

function routerTier(value: string): RouterTier {
  if (value === 'fast' || value === 'standard' || value === 'deep' || value === 'ask-user') return value
  throw new Error(`dsh-jev router returned an unsupported route ${value}`)
}

function routerRisk(value: string): RouterRisk {
  if (value === 'low' || value === 'medium' || value === 'high') return value
  throw new Error(`dsh-jev router returned an unsupported risk ${value}`)
}

function failureRecord(requestSeq: SessionSeq, error: unknown): RouterFailureRecord {
  if (error instanceof DecisionError) {
    return {
      requestSeq,
      status: 'failure',
      code: error.code,
      retryable: error.retryable,
      ...error.provider === undefined ? {} : { provider: error.provider },
      ...error.providerCode === undefined ? {} : { providerCode: error.providerCode },
      ...error.latencyMs === undefined ? {} : { latencyMs: error.latencyMs },
    }
  }
  return { requestSeq, status: 'failure', code: 'ROUTER_UNEXPECTED', retryable: false }
}
