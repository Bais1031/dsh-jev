/** Content-free local metrics and report rendering for decision-guidance Sessions. */

import { appendPluginRecord, pluginRecordOf, type Session, type SessionSeq } from '@deepseek-ai/dsh-session'
import type { DecisionNodeType } from './decision-guidance-protocol.js'
import { summarizeDecisionGuidance, type DecisionGuidanceNodeSummary } from './decision-guidance-summary.js'

/** Report comparison lane inferred from durable guidance requests. */
export type DecisionReportMode = 'baseline' | 'shadow' | 'advisory' | 'mixed'
/** Evaluator-supplied task result; normal Session completion is not treated as correctness. */
export type DecisionTaskOutcome = 'success' | 'failure' | 'unknown'
/** Evaluator-supplied relationship between one Advisory and the main model's decision. */
export type DecisionAdoption = 'accepted' | 'partial' | 'rejected' | 'unknown'

/** Content-free evaluation label attached locally after a task is judged. */
export interface DecisionGuidanceOutcomeRecord {
  readonly requestSeq?: SessionSeq
  readonly adoption?: Exclude<DecisionAdoption, 'unknown'>
  readonly taskOutcome?: Exclude<DecisionTaskOutcome, 'unknown'>
  readonly criticalDecisionCorrect?: boolean
}

declare module '@deepseek-ai/dsh-session/types' {
  interface PluginRecordMap {
    /** Local, content-free human or evaluator label for report aggregation. */
    'plugin:dsh-jev/decision-outcome': DecisionGuidanceOutcomeRecord
  }
}

/** Token counts from one model family. */
export interface DecisionTokenTotals {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly totalTokens: number
}

/** Complete content-free metrics for one Session. */
export interface DecisionGuidanceReport {
  readonly version: 1
  readonly mode: DecisionReportMode
  readonly mainModel: DecisionTokenTotals & {
    readonly calls: number
    readonly callsWithUsage: number
    readonly latencyMs: number
  }
  readonly jev: DecisionTokenTotals & {
    readonly calls: number
    readonly successes: number
    readonly failures: number
    readonly pending: number
    readonly latencyMs: number
  }
  readonly total: DecisionTokenTotals & { readonly latencyMs: number }
  readonly agent: {
    readonly steps: number
    readonly completedTurns: number
    readonly toolCalls: number
    readonly toolFailures: number
    readonly repeatedToolCalls: number
  }
  readonly guidance: {
    readonly advisories: number
    readonly accepted: number
    readonly partial: number
    readonly rejected: number
    readonly unknown: number
    readonly criticalDecisionCorrect: number
    readonly criticalDecisionIncorrect: number
    readonly criticalDecisionUnlabeled: number
  }
  readonly task: { readonly outcome: DecisionTaskOutcome }
  readonly byNode: Readonly<Partial<Record<DecisionNodeType, DecisionGuidanceNodeSummary>>>
}

/** Aggregate used to compare locally labeled tasks in one mode. */
export interface DecisionGuidanceReportCohort {
  readonly mode: Exclude<DecisionReportMode, 'mixed'>
  readonly tasks: number
  readonly successfulTasks: number
  readonly totalTokens: number
  readonly successfulTaskTokens: number
  readonly averageTotalTokensPerSuccessfulTask: number | null
  readonly toolCalls: number
  readonly repeatedToolCalls: number
}

/**
 * Append one content-free evaluation label.
 * @param session - Session receiving the local label.
 * @param outcome - Adoption, task result, or critical-decision judgment.
 * @returns Sequence number of the durable plugin record.
 */
export function recordDecisionGuidanceOutcome(
  session: Session,
  outcome: DecisionGuidanceOutcomeRecord,
): SessionSeq {
  return appendPluginRecord(session, 'plugin:dsh-jev/decision-outcome', outcome)
}

/**
 * Aggregate model, Jev, Agent, tool, Advisory, and evaluator-label metrics.
 * Request text, tool arguments, provider answers, credentials, and message content are never copied.
 * @param session - Session whose in-memory event log is read locally.
 * @returns JSON-safe, content-free report.
 */
export function createDecisionGuidanceReport(session: Session): DecisionGuidanceReport {
  const guidance = summarizeDecisionGuidance(session)
  const modes = new Set<'shadow' | 'advisory'>()
  const seenTools = new Set<string>()
  const advisoryRequests = new Set<number>()
  const adoptions = new Map<number, Exclude<DecisionAdoption, 'unknown'>>()
  let taskOutcome: DecisionTaskOutcome = 'unknown'
  let criticalCorrect = 0
  let criticalIncorrect = 0
  let mainCalls = 0
  let mainCallsWithUsage = 0
  let mainInputTokens = 0
  let mainOutputTokens = 0
  let mainTotalTokens = 0
  let mainLatencyMs = 0
  let steps = 0
  let completedTurns = 0
  let toolCalls = 0
  let toolFailures = 0
  let repeatedToolCalls = 0
  let openStep: { readonly turn: number; readonly step: number; readonly time: number } | undefined

  for (const event of session.snapshotEvents()) {
    if (event.type === 'step/start') {
      openStep = { turn: event.data.turn, step: event.data.step, time: event.time }
    } else if (event.type === 'step/end') {
      steps += 1
      if (openStep?.turn === event.data.turn && openStep.step === event.data.step) openStep = undefined
    } else if (event.type === 'turn/end' && event.data.reason.kind === 'completed') {
      completedTurns += 1
    } else if (event.type === 'assistant/message') {
      mainCalls += 1
      if (openStep?.turn === event.data.turn && openStep.step === event.data.step) {
        mainLatencyMs += Math.max(0, event.time - openStep.time)
        openStep = undefined
      }
      const usage = event.data.usage
      if (usage !== undefined) {
        const input = nonNegative(usage.inputTokens)
          + nonNegative(usage.cacheReadTokens)
          + nonNegative(usage.cacheWriteTokens)
        const output = nonNegative(usage.outputTokens)
        const derivedTotal = input + output
        const total = nonNegative(usage.totalTokens)
        mainCallsWithUsage += 1
        mainInputTokens += input
        mainOutputTokens += output
        mainTotalTokens += total >= derivedTotal ? total : derivedTotal
      }
    } else if (event.type === 'tool/call') {
      toolCalls += 1
      const key = `${String(event.data.turn)}\u0000${event.data.name}\u0000${event.data.arguments}`
      if (seenTools.has(key)) repeatedToolCalls += 1
      seenTools.add(key)
    } else if (event.type === 'tool/result' && event.data.message.isError === true) {
      toolFailures += 1
    }

    const record = pluginRecordOf(event)
    if (record?.type === 'plugin:dsh-jev/decision-request' && isModeData(record.data)) modes.add(record.data.mode)
    else if (record?.type === 'plugin:dsh-jev/decision-advisory' && isAdvisoryData(record.data)) {
      advisoryRequests.add(record.data.requestSeq)
    } else if (record?.type === 'plugin:dsh-jev/decision-outcome' && isOutcomeData(record.data)) {
      if (record.data.requestSeq !== undefined && record.data.adoption !== undefined) {
        adoptions.set(record.data.requestSeq, record.data.adoption)
      }
      if (record.data.taskOutcome !== undefined) taskOutcome = record.data.taskOutcome
      if (record.data.criticalDecisionCorrect === true) criticalCorrect += 1
      else if (record.data.criticalDecisionCorrect === false) criticalIncorrect += 1
    }
  }

  const adoptionTotals = { accepted: 0, partial: 0, rejected: 0 }
  for (const requestSeq of advisoryRequests) {
    const adoption = adoptions.get(requestSeq)
    if (adoption !== undefined) adoptionTotals[adoption] += 1
  }
  const jevTokens = guidance.usage
  return {
    version: 1,
    mode: reportMode(modes),
    mainModel: {
      calls: mainCalls,
      callsWithUsage: mainCallsWithUsage,
      inputTokens: mainInputTokens,
      outputTokens: mainOutputTokens,
      totalTokens: mainTotalTokens,
      latencyMs: mainLatencyMs,
    },
    jev: {
      calls: guidance.calls,
      successes: guidance.successes,
      failures: guidance.failures,
      pending: guidance.pending,
      inputTokens: jevTokens.inputTokens,
      outputTokens: jevTokens.outputTokens,
      totalTokens: jevTokens.totalTokens,
      latencyMs: guidance.totalLatencyMs,
    },
    total: {
      inputTokens: mainInputTokens + jevTokens.inputTokens,
      outputTokens: mainOutputTokens + jevTokens.outputTokens,
      totalTokens: mainTotalTokens + jevTokens.totalTokens,
      latencyMs: mainLatencyMs + guidance.totalLatencyMs,
    },
    agent: { steps, completedTurns, toolCalls, toolFailures, repeatedToolCalls },
    guidance: {
      advisories: advisoryRequests.size,
      ...adoptionTotals,
      unknown: advisoryRequests.size - adoptionTotals.accepted - adoptionTotals.partial - adoptionTotals.rejected,
      criticalDecisionCorrect: criticalCorrect,
      criticalDecisionIncorrect: criticalIncorrect,
      criticalDecisionUnlabeled: Math.max(0, guidance.calls - criticalCorrect - criticalIncorrect),
    },
    task: { outcome: taskOutcome },
    byNode: guidance.byNode,
  }
}

/** @param report - Content-free report. @returns Stable pretty-printed JSON. */
export function renderDecisionGuidanceReportJson(report: DecisionGuidanceReport): string {
  return `${JSON.stringify(report, null, 2)}\n`
}

/** @param report - Content-free report. @returns Compact Markdown suitable for a local artifact. */
export function renderDecisionGuidanceReportMarkdown(report: DecisionGuidanceReport): string {
  return [
    '# dsh-jev Decision Guidance Report',
    '',
    `- Mode: ${report.mode}`,
    `- Task outcome: ${report.task.outcome}`,
    `- Main-model tokens: ${String(report.mainModel.totalTokens)} (${String(report.mainModel.inputTokens)} input, ${String(report.mainModel.outputTokens)} output)`,
    `- Jev tokens: ${String(report.jev.totalTokens)} (${String(report.jev.inputTokens)} input, ${String(report.jev.outputTokens)} output)`,
    `- Total tokens: ${String(report.total.totalTokens)}`,
    `- Agent steps: ${String(report.agent.steps)}`,
    `- Tool calls: ${String(report.agent.toolCalls)} (${String(report.agent.repeatedToolCalls)} repeated, ${String(report.agent.toolFailures)} failed)`,
    `- Jev calls: ${String(report.jev.calls)} (${String(report.jev.successes)} succeeded, ${String(report.jev.failures)} failed, ${String(report.jev.pending)} pending)`,
    `- Advisory adoption: ${String(report.guidance.accepted)} accepted, ${String(report.guidance.partial)} partial, ${String(report.guidance.rejected)} rejected, ${String(report.guidance.unknown)} unknown`,
    `- Total observed latency: ${String(report.total.latencyMs)} ms`,
    '',
  ].join('\n')
}

/**
 * Compare locally generated Baseline, Shadow, and Advisory reports.
 * Mixed-mode Sessions are excluded because they cannot be assigned to one experimental lane.
 * @param reports - Content-free per-Session reports with evaluator task labels.
 * @returns One aggregate for each mode represented by at least one report.
 */
export function compareDecisionGuidanceReports(
  reports: readonly DecisionGuidanceReport[],
): readonly DecisionGuidanceReportCohort[] {
  const lanes = new Map<Exclude<DecisionReportMode, 'mixed'>, {
    tasks: number
    successfulTasks: number
    totalTokens: number
    successfulTaskTokens: number
    toolCalls: number
    repeatedToolCalls: number
  }>()
  for (const report of reports) {
    if (report.mode === 'mixed') continue
    const lane = lanes.get(report.mode) ?? {
      tasks: 0,
      successfulTasks: 0,
      totalTokens: 0,
      successfulTaskTokens: 0,
      toolCalls: 0,
      repeatedToolCalls: 0,
    }
    lane.tasks += 1
    lane.totalTokens += report.total.totalTokens
    lane.toolCalls += report.agent.toolCalls
    lane.repeatedToolCalls += report.agent.repeatedToolCalls
    if (report.task.outcome === 'success') {
      lane.successfulTasks += 1
      lane.successfulTaskTokens += report.total.totalTokens
    }
    lanes.set(report.mode, lane)
  }
  return (['baseline', 'shadow', 'advisory'] as const).flatMap((mode) => {
    const lane = lanes.get(mode)
    if (lane === undefined) return []
    return [{
      mode,
      ...lane,
      averageTotalTokensPerSuccessfulTask: lane.successfulTasks === 0
        ? null
        : lane.successfulTaskTokens / lane.successfulTasks,
    }]
  })
}

function reportMode(modes: ReadonlySet<'shadow' | 'advisory'>): DecisionReportMode {
  if (modes.size === 0) return 'baseline'
  if (modes.size > 1) return 'mixed'
  return modes.has('advisory') ? 'advisory' : 'shadow'
}

function nonNegative(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : 0
}

function isModeData(data: unknown): data is { readonly mode: 'shadow' | 'advisory' } {
  return typeof data === 'object' && data !== null && 'mode' in data
    && (data.mode === 'shadow' || data.mode === 'advisory')
}

function isAdvisoryData(data: unknown): data is { readonly requestSeq: number } {
  return typeof data === 'object' && data !== null && 'requestSeq' in data && Number.isSafeInteger(data.requestSeq)
}

type ReportOutcomeData = {
  readonly requestSeq?: number
  readonly adoption?: Exclude<DecisionAdoption, 'unknown'>
  readonly taskOutcome?: Exclude<DecisionTaskOutcome, 'unknown'>
  readonly criticalDecisionCorrect?: boolean
}

function isOutcomeData(data: unknown): data is ReportOutcomeData {
  if (typeof data !== 'object' || data === null) return false
  if ('requestSeq' in data && data.requestSeq !== undefined && !Number.isSafeInteger(data.requestSeq)) return false
  if ('adoption' in data && data.adoption !== undefined
    && data.adoption !== 'accepted' && data.adoption !== 'partial' && data.adoption !== 'rejected') return false
  if ('taskOutcome' in data && data.taskOutcome !== undefined
    && data.taskOutcome !== 'success' && data.taskOutcome !== 'failure') return false
  return !('criticalDecisionCorrect' in data)
    || data.criticalDecisionCorrect === undefined
    || typeof data.criticalDecisionCorrect === 'boolean'
}
