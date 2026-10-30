/** Shadow observation and Advisory injection for DeepSeek Harness Agent requests. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type ContextFormed, type UserMessage } from '@deepseek-ai/dsh-llm'
import { appendPluginRecord, type Session, type SessionSeq } from '@deepseek-ai/dsh-session'
import { DecisionError } from './decision-errors.js'
import {
  createDecisionBrief,
  createDecisionGuidanceRequest,
  DECISION_GUIDANCE_QUESTION_VERSION,
  DECISION_GUIDANCE_STRATEGY_VERSION,
  DecisionGuidanceProtocolError,
  type DecisionNodeType,
  type JevDecisionBrief,
} from './decision-guidance-protocol.js'
import {
  DecisionTriggerGate,
  type DecisionTrigger,
  type DecisionTriggerOptions,
} from './decision-guidance-trigger.js'
import type { DecisionAnswer, DecisionRequest, DecisionResult } from './decision-types.js'

/** Decision-guidance modes implemented by the MVP. */
export type DecisionGuidanceMode = 'off' | 'shadow' | 'advisory'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Durable, non-authoritative Jev brief added by dsh-jev. */
    'dsh-jev-advisory': {
      readonly kind: 'dsh-jev-advisory'
      readonly requestSeq: SessionSeq
      readonly resultSeq: SessionSeq
    } & ContextFormed
  }
}

/** Non-secret statistics describing text copied into one Jev request. */
export interface DecisionGuidanceInputSummary {
  readonly messageCount: number
  readonly textCharacters: number
  readonly includedCharacters: number
  readonly truncated: boolean
  readonly toolResultCharacters: number
  readonly includedToolResultCharacters: number
}

/** Exact bounded input recorded before one Jev decision dispatch; API credentials are excluded. */
export interface DecisionGuidanceRequestRecord {
  readonly strategyVersion: typeof DECISION_GUIDANCE_STRATEGY_VERSION
  readonly questionVersion: typeof DECISION_GUIDANCE_QUESTION_VERSION
  readonly mode: Exclude<DecisionGuidanceMode, 'off'>
  readonly turn: number
  readonly step: number
  readonly nodeType: DecisionNodeType
  readonly trigger: Pick<DecisionTrigger, 'reasons' | 'signals'>
  readonly inputSummary: DecisionGuidanceInputSummary
  readonly request: DecisionRequest
}

/** Successful Jev result and the bounded brief derived from it. */
export interface DecisionGuidanceSuccessRecord {
  readonly requestSeq: SessionSeq
  readonly status: 'success'
  readonly brief: JevDecisionBrief
  readonly provider: string
  readonly model: string
  readonly latencyMs: number
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number }
  readonly minimumConfidence: number
  readonly answers: Readonly<Record<string, DecisionAnswer>>
}

/** Safe structured failure associated with one recorded request. */
export interface DecisionGuidanceFailureRecord {
  readonly requestSeq: SessionSeq
  readonly status: 'failure'
  readonly code: string
  readonly stage: DecisionGuidanceFailureStage
  readonly retryable: boolean
  readonly responseReceived: boolean
  readonly provider?: string
  readonly providerCode?: string
  readonly model?: string
  readonly latencyMs?: number
  readonly usage?: { readonly inputTokens: number; readonly outputTokens: number }
}

/** Operation stage that owns one automatic-guidance failure. */
export type DecisionGuidanceFailureStage =
  | 'provider'
  | 'deadline'
  | 'cancellation'
  | 'projection'
  | 'unexpected'

/** Durable outcome of one decision-guidance analysis. */
export type DecisionGuidanceResultRecord = DecisionGuidanceSuccessRecord | DecisionGuidanceFailureRecord

/** Exact model-visible Advisory text associated with one accepted Jev result. */
export interface DecisionGuidanceAdvisoryRecord {
  readonly requestSeq: SessionSeq
  readonly resultSeq: SessionSeq
  readonly strategyVersion: typeof DECISION_GUIDANCE_STRATEGY_VERSION
  readonly turn: number
  readonly step: number
  readonly nodeType: DecisionNodeType
  readonly content: string
}

declare module '@deepseek-ai/dsh-session/types' {
  interface PluginRecordMap {
    /** Exact bounded input for one optional dsh-jev decision analysis; API credentials are excluded. */
    'plugin:dsh-jev/decision-request': DecisionGuidanceRequestRecord
    /** Successful brief or safe failure for one dsh-jev decision analysis. */
    'plugin:dsh-jev/decision-result': DecisionGuidanceResultRecord
    /** Exact accepted Advisory text added to the current model request. */
    'plugin:dsh-jev/decision-advisory': DecisionGuidanceAdvisoryRecord
  }
}

/** Minimal decision service consumed by automatic guidance. */
export interface DecisionGuidanceService {
  /** @param request - Versioned decision questions. @param options - Turn cancellation. @returns Jev answers and usage. */
  decide(request: DecisionRequest, options?: { readonly signal?: AbortSignal }): Promise<DecisionResult>
}

/** Live settings read for each proposed decision analysis. */
export interface DecisionGuidanceShadowOptions extends DecisionTriggerOptions {
  readonly mode: () => DecisionGuidanceMode
  readonly model: () => string
  readonly maximumInputCharacters: () => number
  readonly deadlineMs: () => number
  readonly minimumConfidence: () => number
}

/**
 * Register bounded Shadow observation and Advisory context injection.
 * @param ctx - Plugin context that observes and may extend admitted Agent input.
 * @param decisions - Structured decision service used for Jev calls.
 * @param options - Live trigger, budget, request, and confidence settings.
 */
export function installDecisionGuidanceShadow(
  ctx: Context,
  decisions: DecisionGuidanceService,
  options: DecisionGuidanceShadowOptions,
): void {
  const triggers = new DecisionTriggerGate()

  ctx.on('agent/pre-step', async ({ agent, turn, step, signal }, next): Promise<PreStepDecision> => {
    const decision = await next()
    const mode = options.mode()
    if (mode === 'off' || decision.kind === 'reject' || signal.aborted) return decision
    const trigger = triggers.consider(agent, turn, step, decision.messages, options)
    if (trigger === undefined) return decision
    const evaluated = await evaluateDecision(
      agent.session,
      mode,
      trigger,
      decision.messages,
      decisions,
      options,
      signal,
    )
    signal.throwIfAborted()
    if (mode === 'shadow' || evaluated === undefined || !evaluated.brief.accepted) return decision
    const content = renderDecisionAdvisory(evaluated.brief)
    appendPluginRecord(agent.session, 'plugin:dsh-jev/decision-advisory', {
      requestSeq: evaluated.requestSeq,
      resultSeq: evaluated.resultSeq,
      strategyVersion: DECISION_GUIDANCE_STRATEGY_VERSION,
      turn,
      step,
      nodeType: trigger.nodeType,
      content,
    })
    return {
      ...decision,
      messages: [
        ...decision.messages,
        createUserMessage({
          content: [{ type: 'text', text: content }],
          source: {
            kind: 'dsh-jev-advisory',
            form: 'snapshot',
            sections: [{ name: 'dsh-jev-advisory', text: content }],
            requestSeq: evaluated.requestSeq,
            resultSeq: evaluated.resultSeq,
          },
        }),
      ],
    }
  }, { prepend: true })

  ctx.on('agent/disposed', ({ agent }) => {
    triggers.dispose(agent)
  })
}

interface SuccessfulEvaluation {
  readonly requestSeq: SessionSeq
  readonly resultSeq: SessionSeq
  readonly brief: JevDecisionBrief
}

async function evaluateDecision(
  session: Session,
  mode: Exclude<DecisionGuidanceMode, 'off'>,
  trigger: DecisionTrigger,
  messages: readonly UserMessage[],
  decisions: DecisionGuidanceService,
  options: DecisionGuidanceShadowOptions,
  signal: AbortSignal,
): Promise<SuccessfulEvaluation | undefined> {
  const input = boundedInput(trigger, messages.length, options.maximumInputCharacters())
  const request = createDecisionGuidanceRequest(trigger.nodeType, input.state, options.model())
  const requestSeq = appendPluginRecord(session, 'plugin:dsh-jev/decision-request', {
    strategyVersion: DECISION_GUIDANCE_STRATEGY_VERSION,
    questionVersion: DECISION_GUIDANCE_QUESTION_VERSION,
    mode,
    turn: trigger.signals.turn,
    step: trigger.signals.step,
    nodeType: trigger.nodeType,
    trigger: { reasons: trigger.reasons, signals: trigger.signals },
    inputSummary: input.summary,
    request,
  })

  try {
    const result = await decideBeforeDeadline(decisions, request, signal, options.deadlineMs())
    const minimumConfidence = options.minimumConfidence()
    let brief: JevDecisionBrief
    try {
      brief = createDecisionBrief(
        trigger.nodeType,
        result,
        minimumConfidence,
      )
    } catch (error: unknown) {
      appendPluginRecord(
        session,
        'plugin:dsh-jev/decision-result',
        failureRecord(requestSeq, error, 'projection', result),
      )
      return undefined
    }
    const resultSeq = appendPluginRecord(session, 'plugin:dsh-jev/decision-result', {
      requestSeq,
      status: 'success',
      brief,
      provider: result.provider,
      model: result.model,
      latencyMs: result.latencyMs,
      usage: result.usage,
      minimumConfidence,
      answers: result.answers,
    })
    return { requestSeq, resultSeq, brief }
  } catch (error: unknown) {
    appendPluginRecord(session, 'plugin:dsh-jev/decision-result', failureRecord(
      requestSeq,
      error,
      failureStage(error),
    ))
    return undefined
  }
}

class DecisionGuidanceDeadlineError extends Error {
  readonly code = 'DECISION_GUIDANCE_DEADLINE_EXCEEDED'
  readonly retryable = true

  /** @param latencyMs - Time elapsed before automatic guidance stopped waiting. */
  constructor(readonly latencyMs: number) {
    super('Automatic Jev guidance exceeded its deadline')
    this.name = 'DecisionGuidanceDeadlineError'
  }
}

/**
 * Wait for one auxiliary decision only until the caller cancels or the configured deadline expires.
 * The deadline aborts cooperative provider work; the race also guarantees fail-open progress when a provider ignores cancellation.
 *
 * @param decisions - Structured decision service.
 * @param request - Exact automatic-guidance request.
 * @param signal - Agent turn cancellation.
 * @param deadlineMs - Maximum end-to-end wait for the auxiliary decision.
 * @returns The provider result received before the deadline.
 */
async function decideBeforeDeadline(
  decisions: DecisionGuidanceService,
  request: DecisionRequest,
  signal: AbortSignal,
  deadlineMs: number,
): Promise<DecisionResult> {
  const startedAt = performance.now()
  const deadline = new AbortController()
  const combined = AbortSignal.any([signal, deadline.signal])
  let timer: ReturnType<typeof setTimeout> | undefined
  let removeCancellation = (): void => {}
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new DecisionGuidanceDeadlineError(Math.max(0, performance.now() - startedAt))
      deadline.abort(error)
      reject(error)
    }, deadlineMs)
  })
  const cancellation = new Promise<never>((_resolve, reject) => {
    const cancel = (): void => {
      reject(new DecisionError('DECISION_CANCELLED', 'Decision request was cancelled by the caller', {
        retryable: false,
        latencyMs: Math.max(0, performance.now() - startedAt),
        cause: signal.reason,
      }))
    }
    if (signal.aborted) cancel()
    else {
      signal.addEventListener('abort', cancel, { once: true })
      removeCancellation = () => { signal.removeEventListener('abort', cancel) }
    }
  })
  try {
    return await Promise.race([
      decisions.decide(request, { signal: combined }),
      timeout,
      cancellation,
    ])
  } catch (error: unknown) {
    if (deadline.signal.aborted && !signal.aborted) {
      const reason = deadline.signal.reason
      if (reason instanceof DecisionGuidanceDeadlineError) throw reason
    }
    throw error
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    removeCancellation()
  }
}

/**
 * Render one accepted brief as bounded, non-authoritative model context.
 * @param brief - Validated brief built only from fixed protocol values.
 * @returns Exact text persisted in both the Advisory record and user message.
 */
export function renderDecisionAdvisory(brief: JevDecisionBrief): string {
  const directions = brief.candidateDirections
    .map(direction => `${direction.focus} (${formatProbability(direction.probability)})`)
    .join(', ')
  return [
    '<jev-decision-advisory version="2">',
    'Non-authoritative analysis guidance. Independently verify it against the user request and available evidence.',
    `Node: ${brief.nodeType}`,
    `Information sufficient: ${String(brief.informationSufficient)} (${formatProbability(brief.informationSufficientProbability)})`,
    `Recommended next analytical action: ${brief.recommendedAction}`,
    `Candidate directions: ${directions}`,
    `Primary focus: ${brief.focus}`,
    ...brief.avoid === undefined ? [] : [`Avoid: ${brief.avoid}`],
    ...brief.riskLevel === undefined
      ? [`Ambiguity: ${brief.ambiguity}; confidence: ${formatProbability(brief.confidence)}`]
      : [`Risk: ${brief.riskLevel}; ambiguity: ${brief.ambiguity}; confidence: ${formatProbability(brief.confidence)}`],
    'This guidance is not evidence and grants no permission to use tools or perform external actions. You may accept, adapt, or reject it.',
    '</jev-decision-advisory>',
  ].join('\n')
}

function formatProbability(value: number): string {
  return value.toFixed(3)
}

function boundedInput(trigger: DecisionTrigger, messageCount: number, limit: number): {
  readonly state: DecisionRequest['state']
  readonly summary: DecisionGuidanceInputSummary
} {
  const textCharacters = Array.from(trigger.text).length
  const userContent = takeCharacters(trigger.text, limit)
  const userCharacters = Array.from(userContent).length
  const toolResultCharacters = trigger.toolResultTextCharacters
  const toolPrefix = userContent.length === 0
    ? '<previous-tool-result-text>\n'
    : '\n\n<previous-tool-result-text>\n'
  const toolSuffix = '\n</previous-tool-result-text>'
  const wrapperCharacters = Array.from(toolPrefix + toolSuffix).length
  const toolBudget = Math.max(0, limit - userCharacters - wrapperCharacters)
  const toolContent = takeCharacters(trigger.toolResultText, toolBudget)
  const includedToolResultCharacters = Array.from(toolContent).length
  const content = toolContent.length === 0 ? userContent : `${userContent}${toolPrefix}${toolContent}${toolSuffix}`
  const includedCharacters = userCharacters + includedToolResultCharacters
  return {
    state: {
      nodeType: trigger.nodeType,
      content: content.length === 0 ? '[No textual input at this node]' : content,
      signals: {
        turn: trigger.signals.turn,
        step: trigger.signals.step,
        previousToolResults: trigger.signals.previousToolResults,
        previousToolFailures: trigger.signals.previousToolFailures,
        previousToolNames: [...trigger.signals.previousToolNames],
      },
    },
    summary: {
      messageCount,
      textCharacters,
      includedCharacters,
      truncated: userCharacters < textCharacters || includedToolResultCharacters < toolResultCharacters,
      toolResultCharacters,
      includedToolResultCharacters,
    },
  }
}

function takeCharacters(value: string, limit: number): string {
  return Array.from(value).slice(0, limit).join('')
}

function failureRecord(
  requestSeq: SessionSeq,
  error: unknown,
  stage: DecisionGuidanceFailureStage,
  result?: DecisionResult,
): DecisionGuidanceFailureRecord {
  const observed = result === undefined ? { responseReceived: false as const } : {
    responseReceived: true as const,
    provider: result.provider,
    model: result.model,
    latencyMs: result.latencyMs,
    usage: result.usage,
  }
  if (error instanceof DecisionError) {
    return {
      requestSeq,
      status: 'failure',
      code: error.code,
      stage,
      retryable: error.retryable,
      responseReceived: false,
      ...error.provider === undefined ? {} : { provider: error.provider },
      ...error.providerCode === undefined ? {} : { providerCode: error.providerCode },
      ...error.latencyMs === undefined ? {} : { latencyMs: error.latencyMs },
    }
  }
  if (error instanceof DecisionGuidanceDeadlineError) {
    return {
      requestSeq,
      status: 'failure',
      code: error.code,
      stage: 'deadline',
      retryable: error.retryable,
      responseReceived: false,
      latencyMs: error.latencyMs,
    }
  }
  if (error instanceof DecisionGuidanceProtocolError) {
    return { requestSeq, status: 'failure', code: error.code, stage, retryable: error.retryable, ...observed }
  }
  return {
    requestSeq,
    status: 'failure',
    code: 'DECISION_GUIDANCE_UNEXPECTED_FAILURE',
    stage,
    retryable: false,
    ...observed,
  }
}

function failureStage(error: unknown): DecisionGuidanceFailureStage {
  if (error instanceof DecisionGuidanceDeadlineError) return 'deadline'
  if (error instanceof DecisionError) return error.code === 'DECISION_CANCELLED' ? 'cancellation' : 'provider'
  return 'unexpected'
}
