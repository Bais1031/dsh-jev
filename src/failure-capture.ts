/** Explicit local capture of user-corrected main-model failures. */

import type { Context } from '@deepseek-ai/cordis'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { MessageId, UserMessage } from '@deepseek-ai/dsh-llm'
import {
  appendPluginRecord,
  pluginRecordOf,
  type Session,
  type SessionSeq,
} from '@deepseek-ai/dsh-session'

/** Stable error labels accepted by the local failure marker. */
export type FailureCandidateLabel =
  | 'incorrect-conclusion'
  | 'missed-evidence'
  | 'wrong-direction'
  | 'unnecessary-exploration'
  | 'unsafe-action'
  | 'incomplete'

/** Content-free reference from one user correction to the answer it corrects. */
export interface FailureCandidateRecord {
  readonly version: 1
  readonly label: FailureCandidateLabel
  readonly checkpointSeq: SessionSeq
  readonly assistantMessageId: MessageId
  readonly assistantTurn: number
  readonly assistantStep: number
  readonly correctionMessageId: MessageId
  readonly correctionTurn: number
  readonly correctionStep: number
}

declare module '@deepseek-ai/dsh-session/types' {
  interface PluginRecordMap {
    /** Local reference linking an explicit user correction to the preceding Assistant answer. */
    'plugin:dsh-jev/failure-candidate': FailureCandidateRecord
  }
}

/** Live switch controlling explicit local failure capture. */
export interface FailureCaptureOptions {
  readonly enabled: () => boolean
}

const MARKER = '/jev-failure'
const LABELS: ReadonlySet<string> = new Set<FailureCandidateLabel>([
  'incorrect-conclusion',
  'missed-evidence',
  'wrong-direction',
  'unnecessary-exploration',
  'unsafe-action',
  'incomplete',
])

/**
 * Register explicit, content-free capture for accepted user corrections.
 * @param ctx - Plugin context observing admitted Agent input.
 * @param options - Live enablement setting.
 */
export function installFailureCapture(ctx: Context, options: FailureCaptureOptions): void {
  ctx.on('agent/pre-step', async ({ agent, turn, step }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (!options.enabled() || decision.kind === 'reject') return decision
    captureFailureCandidate(agent.session, decision.messages, turn, step)
    return decision
  })
}

/**
 * Record the first valid marker in one admitted batch when it corrects a new Assistant checkpoint.
 * @param session - Session containing the answer checkpoint and receiving the local reference.
 * @param messages - Messages admitted to the current Agent step.
 * @param turn - Current Agent turn.
 * @param step - Current Agent step.
 * @returns The appended record sequence, or `undefined` when no candidate is eligible.
 */
export function captureFailureCandidate(
  session: Session,
  messages: readonly UserMessage[],
  turn: number,
  step: number,
): SessionSeq | undefined {
  const correction = messages
    .filter(message => message.source.kind === 'user')
    .map(message => ({ message, label: markerLabel(message) }))
    .find((candidate): candidate is { readonly message: UserMessage; readonly label: FailureCandidateLabel } => candidate.label !== undefined)
  if (correction === undefined) return undefined

  const events = session.snapshotEvents()
  const checkpoint = events.findLast(event => event.type === 'assistant/message')
  if (checkpoint?.type !== 'assistant/message') return undefined
  const alreadyCaptured = events.some((event) => {
    const record = pluginRecordOf(event)
    return record?.type === 'plugin:dsh-jev/failure-candidate'
      && isFailureCandidateRecord(record.data)
      && record.data.checkpointSeq === checkpoint.seq
  })
  if (alreadyCaptured) return undefined

  return appendPluginRecord(session, 'plugin:dsh-jev/failure-candidate', {
    version: 1,
    label: correction.label,
    checkpointSeq: checkpoint.seq,
    assistantMessageId: checkpoint.data.message.id,
    assistantTurn: checkpoint.data.turn,
    assistantStep: checkpoint.data.step,
    correctionMessageId: correction.message.id,
    correctionTurn: turn,
    correctionStep: step,
  })
}

/** @param value - Durable plugin-record payload. @returns Whether it is a supported failure candidate. */
export function isFailureCandidateRecord(value: unknown): value is FailureCandidateRecord {
  return typeof value === 'object'
    && value !== null
    && 'version' in value && value.version === 1
    && 'label' in value && typeof value.label === 'string' && LABELS.has(value.label)
    && 'checkpointSeq' in value && Number.isSafeInteger(value.checkpointSeq)
    && 'assistantMessageId' in value && typeof value.assistantMessageId === 'string'
    && 'assistantTurn' in value && nonNegativeInteger(value.assistantTurn)
    && 'assistantStep' in value && nonNegativeInteger(value.assistantStep)
    && 'correctionMessageId' in value && typeof value.correctionMessageId === 'string'
    && 'correctionTurn' in value && nonNegativeInteger(value.correctionTurn)
    && 'correctionStep' in value && nonNegativeInteger(value.correctionStep)
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function markerLabel(message: UserMessage): FailureCandidateLabel | undefined {
  const firstLine = message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
    .trimStart()
    .split(/\r?\n/, 1)[0]
    ?.trim()
  if (firstLine === undefined) return undefined
  const match = /^\/jev-failure\s+([a-z-]+)\s*$/.exec(firstLine)
  const label = match?.[1]
  return label !== undefined && LABELS.has(label) ? label as FailureCandidateLabel : undefined
}
