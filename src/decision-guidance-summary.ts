/** Local aggregation for dsh-jev decision-guidance Session records. */

import { pluginRecordOf, type Session } from '@deepseek-ai/dsh-session'
import type { DecisionNodeType } from './decision-guidance-protocol.js'
import type { DecisionGuidanceFailureStage, DecisionGuidanceMode } from './decision-guidance-shadow.js'

/** Aggregated usage for successful Jev calls. */
export interface DecisionGuidanceUsageSummary {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly totalTokens: number
}

/** Per-node counts included in a Session summary. */
export interface DecisionGuidanceNodeSummary {
  readonly calls: number
  readonly successes: number
  readonly failures: number
}

/** Latest safe failure metadata available for the configuration page. */
export interface DecisionGuidanceFailureSummary {
  readonly code: string
  readonly stage: DecisionGuidanceFailureStage | 'unknown'
  readonly retryable: boolean
  readonly responseReceived: boolean
  readonly providerCode?: string
  readonly latencyMs?: number
  readonly turn?: number
  readonly followedBySuccess: boolean
}

/** Latest automatic-guidance attempt without request or answer content. */
export interface DecisionGuidanceLatestCallSummary {
  readonly mode: Exclude<DecisionGuidanceMode, 'off'>
  readonly turn: number
  readonly step: number
  readonly nodeType: DecisionNodeType
  readonly status: 'pending' | 'success' | 'failure'
  readonly responseReceived: boolean
  readonly briefStatus: 'pending' | 'injected' | 'shadow-only' | 'below-confidence' | 'invalid' | 'unavailable'
  readonly reason: string | null
  readonly confidence: number | null
  readonly minimumConfidence: number | null
  readonly code: string | null
}

/** Local call, outcome, token, and latency totals for one Session. */
export interface DecisionGuidanceSessionSummary {
  readonly calls: number
  readonly providerSuccesses: number
  readonly validBriefs: number
  readonly injectedAdvisories: number
  readonly successes: number
  readonly failures: number
  readonly pending: number
  readonly usage: DecisionGuidanceUsageSummary
  readonly totalLatencyMs: number
  readonly latestCall: DecisionGuidanceLatestCallSummary | null
  readonly latestFailure: DecisionGuidanceFailureSummary | null
  readonly byNode: Readonly<Partial<Record<DecisionNodeType, DecisionGuidanceNodeSummary>>>
}

/**
 * Aggregate only current decision-guidance records from one Session.
 * Legacy router records and unrelated plugin records are ignored.
 *
 * @param session - Session containing durable plugin records.
 * @returns Local totals without request content, answers, or credentials.
 */
export function summarizeDecisionGuidance(session: Session): DecisionGuidanceSessionSummary {
  const requests = new Map<number, SummaryRequestData>()
  const outcomes = new Map<number, { readonly seq: number; readonly data: SummaryResultData }>()
  const advisoryRequests = new Set<number>()
  let inputTokens = 0
  let outputTokens = 0
  let totalLatencyMs = 0
  let latestFailure: DecisionGuidanceFailureSummary | null = null
  let latestFailureSeq = -1
  let latestSuccessSeq = -1

  for (const event of session.snapshotEvents()) {
    const record = pluginRecordOf(event)
    if (record?.type === 'plugin:dsh-jev/decision-request' && isRequestData(record.data)) {
      requests.set(record.seq, record.data)
    } else if (record?.type === 'plugin:dsh-jev/decision-result' && isResultData(record.data)) {
      outcomes.set(record.data.requestSeq, { seq: record.seq, data: record.data })
      if (record.data.usage !== undefined) {
        inputTokens += record.data.usage.inputTokens
        outputTokens += record.data.usage.outputTokens
      }
      if (record.data.status === 'success') {
        totalLatencyMs += record.data.latencyMs
        latestSuccessSeq = record.seq
      } else {
        if (record.data.latencyMs !== undefined) totalLatencyMs += record.data.latencyMs
        const failureTurn = requests.get(record.data.requestSeq)?.turn
        latestFailure = {
          code: record.data.code,
          stage: failureStage(record.data.stage),
          retryable: record.data.retryable,
          responseReceived: record.data.responseReceived ?? false,
          ...record.data.providerCode === undefined ? {} : { providerCode: record.data.providerCode },
          ...record.data.latencyMs === undefined ? {} : { latencyMs: record.data.latencyMs },
          ...failureTurn === undefined ? {} : { turn: failureTurn },
          followedBySuccess: false,
        }
        latestFailureSeq = record.seq
      }
    } else if (record?.type === 'plugin:dsh-jev/decision-advisory' && isAdvisoryData(record.data)) {
      advisoryRequests.add(record.data.requestSeq)
    }
  }

  if (latestFailure !== null && latestSuccessSeq > latestFailureSeq) {
    latestFailure = { ...latestFailure, followedBySuccess: true }
  }

  const mutableByNode = new Map<DecisionNodeType, { calls: number; successes: number; failures: number }>()
  let successes = 0
  let failures = 0
  let providerSuccesses = 0
  for (const [seq, request] of requests) {
    const nodeType = request.nodeType
    const entry = mutableByNode.get(nodeType) ?? { calls: 0, successes: 0, failures: 0 }
    entry.calls += 1
    const outcome = outcomes.get(seq)?.data
    if (outcome?.status === 'success') {
      successes += 1
      providerSuccesses += 1
      entry.successes += 1
    } else if (outcome?.status === 'failure') {
      failures += 1
      if (outcome.responseReceived === true) providerSuccesses += 1
      entry.failures += 1
    }
    mutableByNode.set(nodeType, entry)
  }

  const byNode: Partial<Record<DecisionNodeType, DecisionGuidanceNodeSummary>> = {}
  for (const [nodeType, summary] of mutableByNode) byNode[nodeType] = { ...summary }
  return {
    calls: requests.size,
    providerSuccesses,
    validBriefs: successes,
    injectedAdvisories: advisoryRequests.size,
    successes,
    failures,
    pending: requests.size - successes - failures,
    usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
    totalLatencyMs,
    latestCall: latestCall(requests, outcomes, advisoryRequests),
    latestFailure,
    byNode,
  }
}

interface SummaryRequestData {
  readonly mode: Exclude<DecisionGuidanceMode, 'off'>
  readonly turn: number
  readonly step: number
  readonly nodeType: DecisionNodeType
}

function isRequestData(data: unknown): data is SummaryRequestData {
  return typeof data === 'object'
    && data !== null
    && 'mode' in data
    && (data.mode === 'shadow' || data.mode === 'advisory')
    && 'turn' in data
    && Number.isSafeInteger(data.turn)
    && 'step' in data
    && Number.isSafeInteger(data.step)
    && 'nodeType' in data
    && isDecisionNodeType(data.nodeType)
}

type SummaryResultData = {
  readonly requestSeq: number
  readonly status: 'success'
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number }
  readonly latencyMs: number
  readonly minimumConfidence?: number
  readonly brief: {
    readonly accepted: boolean
    readonly confidence: number
    readonly reasons: readonly string[]
  }
} | {
  readonly requestSeq: number
  readonly status: 'failure'
  readonly code: string
  readonly stage?: string
  readonly retryable: boolean
  readonly responseReceived?: boolean
  readonly providerCode?: string
  readonly latencyMs?: number
  readonly usage?: { readonly inputTokens: number; readonly outputTokens: number }
}

function isResultData(data: unknown): data is SummaryResultData {
  if (typeof data !== 'object' || data === null || !('requestSeq' in data) || !('status' in data)) return false
  if (!Number.isSafeInteger(data.requestSeq)) return false
  if (data.status === 'failure') {
    if (!('code' in data) || typeof data.code !== 'string' || !('retryable' in data) || typeof data.retryable !== 'boolean') {
      return false
    }
    if ('stage' in data && data.stage !== undefined && typeof data.stage !== 'string') return false
    if ('responseReceived' in data && data.responseReceived !== undefined && typeof data.responseReceived !== 'boolean') return false
    if ('providerCode' in data && data.providerCode !== undefined && typeof data.providerCode !== 'string') return false
    if ('latencyMs' in data && data.latencyMs !== undefined && !finiteNonNegative(data.latencyMs)) return false
    return !('usage' in data) || data.usage === undefined || isUsage(data.usage)
  }
  if (data.status !== 'success' || !('usage' in data) || !('latencyMs' in data)) return false
  if (!('brief' in data) || !isBrief(data.brief)) return false
  if ('minimumConfidence' in data && data.minimumConfidence !== undefined && !isProbability(data.minimumConfidence)) return false
  return isUsage(data.usage) && finiteNonNegative(data.latencyMs)
}

function isBrief(value: unknown): value is { readonly accepted: boolean; readonly confidence: number; readonly reasons: readonly string[] } {
  return typeof value === 'object'
    && value !== null
    && 'accepted' in value
    && typeof value.accepted === 'boolean'
    && 'confidence' in value
    && isProbability(value.confidence)
    && 'reasons' in value
    && Array.isArray(value.reasons)
    && value.reasons.every(reason => typeof reason === 'string')
}

function isAdvisoryData(data: unknown): data is { readonly requestSeq: number } {
  return typeof data === 'object'
    && data !== null
    && 'requestSeq' in data
    && Number.isSafeInteger(data.requestSeq)
}

function latestCall(
  requests: ReadonlyMap<number, SummaryRequestData>,
  outcomes: ReadonlyMap<number, { readonly seq: number; readonly data: SummaryResultData }>,
  advisoryRequests: ReadonlySet<number>,
): DecisionGuidanceLatestCallSummary | null {
  const entry = [...requests.entries()].at(-1)
  if (entry === undefined) return null
  const [requestSeq, request] = entry
  const outcome = outcomes.get(requestSeq)?.data
  const safeRequest = {
    mode: request.mode,
    turn: request.turn,
    step: request.step,
    nodeType: request.nodeType,
  }
  if (outcome === undefined) {
    return {
      ...safeRequest,
      status: 'pending',
      responseReceived: false,
      briefStatus: 'pending',
      reason: null,
      confidence: null,
      minimumConfidence: null,
      code: null,
    }
  }
  if (outcome.status === 'failure') {
    return {
      ...safeRequest,
      status: 'failure',
      responseReceived: outcome.responseReceived ?? false,
      briefStatus: outcome.stage === 'projection' ? 'invalid' : 'unavailable',
      reason: failureReason(outcome.stage),
      confidence: null,
      minimumConfidence: null,
      code: outcome.providerCode ?? outcome.code,
    }
  }
  const injected = advisoryRequests.has(requestSeq)
  const briefStatus = injected
    ? 'injected'
    : request.mode === 'shadow'
    ? 'shadow-only'
    : outcome.brief.accepted
    ? 'unavailable'
    : 'below-confidence'
  return {
    ...safeRequest,
    status: 'success',
    responseReceived: true,
    briefStatus,
    reason: briefStatus === 'below-confidence'
      ? outcome.brief.reasons[0] ?? 'confidence-below-threshold'
      : briefStatus === 'shadow-only'
      ? 'shadow-mode'
      : null,
    confidence: outcome.brief.confidence,
    minimumConfidence: outcome.minimumConfidence ?? null,
    code: null,
  }
}

function failureReason(stage: string | undefined): string {
  if (stage === 'projection') return 'invalid-result'
  if (stage === 'deadline') return 'deadline'
  if (stage === 'provider') return 'provider-failure'
  if (stage === 'cancellation') return 'cancelled'
  return 'unexpected'
}

function isUsage(value: unknown): value is { readonly inputTokens: number; readonly outputTokens: number } {
  return typeof value === 'object'
    && value !== null
    && 'inputTokens' in value
    && 'outputTokens' in value
    && finiteNonNegative(value.inputTokens)
    && finiteNonNegative(value.outputTokens)
}

function failureStage(value: string | undefined): DecisionGuidanceFailureSummary['stage'] {
  return value === 'provider'
    || value === 'deadline'
    || value === 'cancellation'
    || value === 'projection'
    || value === 'unexpected'
    ? value
    : 'unknown'
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isProbability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

function isDecisionNodeType(value: unknown): value is DecisionNodeType {
  return value === 'task-intake'
    || value === 'missing-information'
    || value === 'direction-selection'
    || value === 'tool-recovery'
    || value === 'progress-check'
    || value === 'pre-conclusion'
}
