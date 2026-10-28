/** Local aggregation for dsh-jev decision-guidance Session records. */

import { pluginRecordOf, type Session } from '@deepseek-ai/dsh-session'
import type { DecisionNodeType } from './decision-guidance-protocol.js'

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

/** Local call, outcome, token, and latency totals for one Session. */
export interface DecisionGuidanceSessionSummary {
  readonly calls: number
  readonly successes: number
  readonly failures: number
  readonly pending: number
  readonly usage: DecisionGuidanceUsageSummary
  readonly totalLatencyMs: number
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
  const requests = new Map<number, DecisionNodeType>()
  const outcomes = new Map<number, 'success' | 'failure'>()
  let inputTokens = 0
  let outputTokens = 0
  let totalLatencyMs = 0

  for (const event of session.snapshotEvents()) {
    const record = pluginRecordOf(event)
    if (record?.type === 'plugin:dsh-jev/decision-request' && isRequestData(record.data)) {
      requests.set(record.seq, record.data.nodeType)
    } else if (record?.type === 'plugin:dsh-jev/decision-result' && isResultData(record.data)) {
      outcomes.set(record.data.requestSeq, record.data.status)
      if (record.data.status === 'success') {
        inputTokens += record.data.usage.inputTokens
        outputTokens += record.data.usage.outputTokens
        totalLatencyMs += record.data.latencyMs
      } else if (record.data.latencyMs !== undefined) {
        totalLatencyMs += record.data.latencyMs
      }
    }
  }

  const mutableByNode = new Map<DecisionNodeType, { calls: number; successes: number; failures: number }>()
  let successes = 0
  let failures = 0
  for (const [seq, nodeType] of requests) {
    const entry = mutableByNode.get(nodeType) ?? { calls: 0, successes: 0, failures: 0 }
    entry.calls += 1
    const outcome = outcomes.get(seq)
    if (outcome === 'success') {
      successes += 1
      entry.successes += 1
    } else if (outcome === 'failure') {
      failures += 1
      entry.failures += 1
    }
    mutableByNode.set(nodeType, entry)
  }

  const byNode: Partial<Record<DecisionNodeType, DecisionGuidanceNodeSummary>> = {}
  for (const [nodeType, summary] of mutableByNode) byNode[nodeType] = { ...summary }
  return {
    calls: requests.size,
    successes,
    failures,
    pending: requests.size - successes - failures,
    usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
    totalLatencyMs,
    byNode,
  }
}

function isRequestData(data: unknown): data is { readonly nodeType: DecisionNodeType } {
  return typeof data === 'object'
    && data !== null
    && 'nodeType' in data
    && isDecisionNodeType(data.nodeType)
}

type SummaryResultData = {
  readonly requestSeq: number
  readonly status: 'success'
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number }
  readonly latencyMs: number
} | {
  readonly requestSeq: number
  readonly status: 'failure'
  readonly latencyMs?: number
}

function isResultData(data: unknown): data is SummaryResultData {
  if (typeof data !== 'object' || data === null || !('requestSeq' in data) || !('status' in data)) return false
  if (!Number.isSafeInteger(data.requestSeq)) return false
  if (data.status === 'failure') {
    return !('latencyMs' in data) || data.latencyMs === undefined || finiteNonNegative(data.latencyMs)
  }
  if (data.status !== 'success' || !('usage' in data) || !('latencyMs' in data)) return false
  const usage = data.usage
  return typeof usage === 'object'
    && usage !== null
    && 'inputTokens' in usage
    && 'outputTokens' in usage
    && finiteNonNegative(usage.inputTokens)
    && finiteNonNegative(usage.outputTokens)
    && finiteNonNegative(data.latencyMs)
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isDecisionNodeType(value: unknown): value is DecisionNodeType {
  return value === 'task-intake'
    || value === 'missing-information'
    || value === 'direction-selection'
    || value === 'tool-recovery'
    || value === 'progress-check'
    || value === 'pre-conclusion'
}
