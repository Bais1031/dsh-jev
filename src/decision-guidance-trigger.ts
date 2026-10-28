/** Deterministic critical-node detection and per-Agent Jev call budgeting. */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import type { DecisionNodeType } from './decision-guidance-protocol.js'

/** Stable facts explaining why a critical node was selected. */
export type DecisionTriggerReason =
  | 'failed-tool-result'
  | 'successful-tool-evidence'
  | 'step-budget-threshold'
  | 'missing-information-language'
  | 'multiple-direction-language'
  | 'complex-task-language'
  | 'task-input-size'

/** Non-content session signals used by the deterministic trigger rules. */
export interface DecisionTriggerSignals {
  readonly turn: number
  readonly step: number
  readonly admittedMessageCount: number
  readonly textCharacters: number
  readonly previousToolResults: number
  readonly previousToolFailures: number
  readonly previousToolNames: readonly string[]
}

/** One admitted critical node reserved against the configured call budget. */
export interface DecisionTrigger {
  readonly nodeType: DecisionNodeType
  readonly reasons: readonly DecisionTriggerReason[]
  readonly signals: DecisionTriggerSignals
  readonly text: string
  readonly toolResultText: string
  readonly toolResultTextCharacters: number
}

/** Live settings used by the trigger gate for each proposed step. */
export interface DecisionTriggerOptions {
  readonly enabledNodes: () => readonly DecisionNodeType[]
  readonly cooldownSteps: () => number
  readonly maximumCallsPerSession: () => number
  readonly progressCheckStep: () => number
  readonly minimumTaskInputCharacters: () => number
  readonly includeToolResultSummaries: () => boolean
  readonly toolResultSummaryCharacters: () => number
}

interface AgentTriggerState {
  ordinal: number
  calls: number
  lastCallOrdinal?: number
  lastTurn?: number
  lastStep?: number
}

/**
 * Select critical nodes once per admitted Agent step and reserve call budget.
 * State is scoped to the live Agent and is removed when the Agent is disposed.
 */
export class DecisionTriggerGate {
  readonly #states = new WeakMap<Agent, AgentTriggerState>()

  /**
   * Evaluate one admitted step without calling a model.
   * @param agent - Live Agent that owns the per-Session budget.
   * @param turn - Current turn number.
   * @param step - Current step number.
   * @param messages - Final messages accepted by downstream pre-step listeners.
   * @param options - Live node selection and budget settings.
   * @returns A reserved critical node, or undefined when no eligible node remains.
   */
  consider(
    agent: Agent,
    turn: number,
    step: number,
    messages: readonly UserMessage[],
    options: DecisionTriggerOptions,
  ): DecisionTrigger | undefined {
    const state = this.#states.get(agent) ?? { ordinal: 0, calls: 0 }
    if (state.lastTurn === turn && state.lastStep === step) return undefined
    state.ordinal += 1
    state.lastTurn = turn
    state.lastStep = step
    this.#states.set(agent, state)

    const trigger = selectDecisionTrigger(
      agent.session,
      turn,
      step,
      messages,
      new Set(options.enabledNodes()),
      options.progressCheckStep(),
      options.minimumTaskInputCharacters(),
      options.includeToolResultSummaries(),
      options.toolResultSummaryCharacters(),
    )
    if (trigger === undefined || state.calls >= options.maximumCallsPerSession()) return undefined
    if (state.lastCallOrdinal !== undefined && state.ordinal - state.lastCallOrdinal <= options.cooldownSteps()) {
      return undefined
    }
    state.calls += 1
    state.lastCallOrdinal = state.ordinal
    return trigger
  }

  /** @param agent - Agent whose completed lifecycle state can be discarded. */
  dispose(agent: Agent): void {
    this.#states.delete(agent)
  }
}

/**
 * Select the highest-priority enabled node from deterministic input and Session facts.
 * @param session - Current in-memory Session log.
 * @param turn - Current turn number.
 * @param step - Current step number.
 * @param messages - Final messages entering the proposed step.
 * @param enabledNodes - Nodes allowed by current configuration.
 * @param progressCheckStep - First step eligible for progress review.
 * @param minimumTaskInputCharacters - Text size that makes task intake eligible without a keyword signal.
 * @returns The selected node and evidence, or undefined for a non-critical step.
 */
export function selectDecisionTrigger(
  session: Session,
  turn: number,
  step: number,
  messages: readonly UserMessage[],
  enabledNodes: ReadonlySet<DecisionNodeType>,
  progressCheckStep: number,
  minimumTaskInputCharacters: number,
  includeToolResultSummaries = false,
  toolResultSummaryCharacters = 0,
): DecisionTrigger | undefined {
  const text = messageText(messages)
  if (containsLikelyCredential(text)) return undefined
  const previous = previousToolSignals(
    session,
    turn,
    step,
    includeToolResultSummaries ? toolResultSummaryCharacters : -1,
  )
  const signals: DecisionTriggerSignals = {
    turn,
    step,
    admittedMessageCount: messages.length,
    textCharacters: Array.from(text).length,
    previousToolResults: previous.results,
    previousToolFailures: previous.failures,
    previousToolNames: previous.names,
  }
  const candidates: Array<{ nodeType: DecisionNodeType; reasons: DecisionTriggerReason[] }> = []
  if (previous.failures > 0) {
    candidates.push({ nodeType: 'tool-recovery', reasons: ['failed-tool-result'] })
  }
  if (step > 1 && previous.results > 0 && previous.failures === 0 && text.length === 0) {
    candidates.push({ nodeType: 'pre-conclusion', reasons: ['successful-tool-evidence'] })
  }
  if (step >= progressCheckStep) {
    candidates.push({ nodeType: 'progress-check', reasons: ['step-budget-threshold'] })
  }
  if (MISSING_INFORMATION_PATTERN.test(text)) {
    candidates.push({ nodeType: 'missing-information', reasons: ['missing-information-language'] })
  }
  if (DIRECTION_SELECTION_PATTERN.test(text)) {
    candidates.push({ nodeType: 'direction-selection', reasons: ['multiple-direction-language'] })
  }
  if (step === 1) {
    const reasons: DecisionTriggerReason[] = []
    if (COMPLEX_TASK_PATTERN.test(text)) reasons.push('complex-task-language')
    if (signals.textCharacters >= minimumTaskInputCharacters) reasons.push('task-input-size')
    if (reasons.length > 0) candidates.push({ nodeType: 'task-intake', reasons })
  }
  const selected = candidates.find(candidate => enabledNodes.has(candidate.nodeType))
  return selected === undefined ? undefined : {
    ...selected,
    signals,
    text,
    toolResultText: previous.text,
    toolResultTextCharacters: previous.textCharacters,
  }
}

const MISSING_INFORMATION_PATTERN = /(?:不确定|不知道|缺少|未提供|需要澄清|信息不足|unclear|unknown|missing|not provided|need clarification|which one)/iu
const DIRECTION_SELECTION_PATTERN = /(?:比较|对比|选择|取舍|方案|路线|还是|versus|\bvs\.?\b|compare|choose|trade-?off|alternative|option)/iu
const COMPLEX_TASK_PATTERN = /(?:分析|诊断|排查|调试|设计|架构|规划|审查|调查|analy[sz]e|diagnos|debug|design|architect|plan|review|investigat)/iu
const LIKELY_CREDENTIAL_PATTERN = /(?:\bsk-[a-z0-9_-]{8,}\b|\bbearer\s+[a-z0-9._~+/-]{8,}=?|\b(?:api[_-]?key|access[_-]?token|password|secret)\s*[:=]\s*\S+|-----BEGIN [A-Z ]*PRIVATE KEY-----)/iu

/** @param text - Candidate model-visible text. @returns Whether fixed credential patterns require skipping external analysis. */
export function containsLikelyCredential(text: string): boolean {
  return LIKELY_CREDENTIAL_PATTERN.test(text)
}

function messageText(messages: readonly UserMessage[]): string {
  const segments: string[] = []
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === 'text' && block.text.length > 0) segments.push(block.text)
    }
  }
  return segments.join('\n\n')
}

function previousToolSignals(session: Session, turn: number, step: number, textLimit: number): {
  readonly results: number
  readonly failures: number
  readonly names: readonly string[]
  readonly text: string
  readonly textCharacters: number
} {
  if (step <= 1) return { results: 0, failures: 0, names: [], text: '', textCharacters: 0 }
  const previousStep = step - 1
  const namesByCall = new Map<string, string>()
  let results = 0
  let failures = 0
  const names = new Set<string>()
  const text: string[] = []
  let remaining = textLimit
  let textCharacters = 0
  for (const event of session.snapshotEvents()) {
    if (event.type === 'tool/call' && event.data.turn === turn && event.data.step === previousStep) {
      namesByCall.set(event.data.callId, event.data.name)
    } else if (event.type === 'tool/result' && event.data.turn === turn && event.data.step === previousStep) {
      results += 1
      if (event.data.message.isError) failures += 1
      const name = namesByCall.get(event.data.message.source.callId)
      if (name !== undefined) names.add(name)
      for (const block of event.data.message.content) {
        if (block.type !== 'text' || block.text.length === 0) continue
        if (containsLikelyCredential(block.text)) continue
        if (textLimit >= 0) textCharacters += Array.from(block.text).length
        if (remaining > 0) {
          const excerpt = Array.from(block.text).slice(0, remaining).join('')
          if (excerpt.length > 0) text.push(excerpt)
          remaining -= Array.from(excerpt).length
        }
      }
    }
  }
  return { results, failures, names: [...names].sort(), text: text.join('\n'), textCharacters }
}
