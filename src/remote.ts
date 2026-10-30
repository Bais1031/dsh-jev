/** Client-safe Typert descriptors for dsh-jev Host operations. */

import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'

/** Safe result of one Host-side Jev connection check. */
export type JevConnectionTestResult = {
  readonly ok: true
  readonly model: string
  readonly latencyMs: number
} | {
  readonly ok: false
  readonly code: string
  readonly retryable: boolean
}

/** Content-free totals for the latest live Agent Session observed by dsh-jev. */
export interface JevLatestSessionSummary {
  readonly sessionId: string
  readonly calls: number
  readonly providerSuccesses: number
  readonly validBriefs: number
  readonly injectedAdvisories: number
  readonly successes: number
  readonly failures: number
  readonly pending: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly totalTokens: number
  readonly totalLatencyMs: number
  readonly latestCall: {
    readonly mode: 'shadow' | 'advisory'
    readonly turn: number
    readonly step: number
    readonly nodeType: 'task-intake' | 'missing-information' | 'direction-selection' | 'tool-recovery' | 'progress-check' | 'pre-conclusion'
    readonly status: 'pending' | 'success' | 'failure'
    readonly responseReceived: boolean
    readonly briefStatus: 'pending' | 'injected' | 'shadow-only' | 'below-confidence' | 'invalid' | 'unavailable'
    readonly reason: string | null
    readonly confidence: number | null
    readonly minimumConfidence: number | null
    readonly code: string | null
  } | null
  readonly latestFailure: {
    readonly code: string
    readonly stage: 'provider' | 'deadline' | 'cancellation' | 'projection' | 'unexpected' | 'unknown'
    readonly retryable: boolean
    readonly responseReceived: boolean
    readonly providerCode?: string
    readonly latencyMs?: number
    readonly turn?: number
    readonly followedBySuccess: boolean
  } | null
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespace$6473684a6576 {
    testConnection: () => Promise<RemoteResult<JevConnectionTestResult>>
    latestSessionSummary: () => Promise<RemoteResult<JevLatestSessionSummary | null>>
  }
  interface TypertRemoteMap {
    'dshJev/testConnection': () => Promise<RemoteResult<JevConnectionTestResult>>
    'dshJev/latestSessionSummary': () => Promise<RemoteResult<JevLatestSessionSummary | null>>
  }
  interface TypertRemoteNamespaceMap {
    dshJev: TypertRemoteNamespace$6473684a6576
  }
}

const connectionResult = z.union([
  z.object({ ok: z.literal(true), model: z.string(), latencyMs: z.number().nonnegative() }),
  z.object({ ok: z.literal(false), code: z.string(), retryable: z.boolean() }),
])

const summary = z.object({
  sessionId: z.string(),
  calls: z.number().int().nonnegative(),
  providerSuccesses: z.number().int().nonnegative(),
  validBriefs: z.number().int().nonnegative(),
  injectedAdvisories: z.number().int().nonnegative(),
  successes: z.number().int().nonnegative(),
  failures: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  totalLatencyMs: z.number().nonnegative(),
  latestCall: z.object({
    mode: z.enum(['shadow', 'advisory']),
    turn: z.number().int().nonnegative(),
    step: z.number().int().nonnegative(),
    nodeType: z.enum(['task-intake', 'missing-information', 'direction-selection', 'tool-recovery', 'progress-check', 'pre-conclusion']),
    status: z.enum(['pending', 'success', 'failure']),
    responseReceived: z.boolean(),
    briefStatus: z.enum(['pending', 'injected', 'shadow-only', 'below-confidence', 'invalid', 'unavailable']),
    reason: z.string().nullable(),
    confidence: z.number().min(0).max(1).nullable(),
    minimumConfidence: z.number().min(0).max(1).nullable(),
    code: z.string().nullable(),
  }).nullable(),
  latestFailure: z.object({
    code: z.string(),
    stage: z.enum(['provider', 'deadline', 'cancellation', 'projection', 'unexpected', 'unknown']),
    retryable: z.boolean(),
    responseReceived: z.boolean(),
    providerCode: z.string().optional(),
    latencyMs: z.number().nonnegative().optional(),
    turn: z.number().int().nonnegative().optional(),
    followedBySuccess: z.boolean(),
  }).nullable(),
})

/** Remote descriptors mounted by the browser half and registered by the Host Typert artifact. */
export const TYPERT_REMOTE = createTypertRemoteInfo({
  package: 'dsh-jev',
  methods: {
    'dshJev/testConnection': {
      service: 'decisions',
      implementation: 'remoteTestConnection',
      description: 'Test the configured Jev endpoint and credential without creating Agent work.',
      invocation: { kind: 'direct' },
      parameters: [],
      cancellation: { parameter: 'signal' },
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-jev#JevConnectionTestResult',
        create: () => connectionResult,
        jsonSchema: {
          oneOf: [
            { type: 'object', properties: { ok: { const: true }, model: { type: 'string' }, latencyMs: { type: 'number' } }, required: ['ok', 'model', 'latencyMs'], additionalProperties: false },
            { type: 'object', properties: { ok: { const: false }, code: { type: 'string' }, retryable: { type: 'boolean' } }, required: ['ok', 'code', 'retryable'], additionalProperties: false },
          ],
        },
      },
    },
    'dshJev/latestSessionSummary': {
      service: 'decisions',
      implementation: 'remoteLatestSessionSummary',
      description: 'Read content-free decision totals for the latest live Agent Session observed by dsh-jev.',
      invocation: { kind: 'direct' },
      parameters: [],
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-jev#JevLatestSessionSummary|null',
        create: () => summary.nullable(),
        jsonSchema: {
          oneOf: [
            { type: 'null' },
            { type: 'object', properties: {
              sessionId: { type: 'string' }, calls: { type: 'integer' }, successes: { type: 'integer' },
              providerSuccesses: { type: 'integer' }, validBriefs: { type: 'integer' }, injectedAdvisories: { type: 'integer' },
              failures: { type: 'integer' }, pending: { type: 'integer' }, inputTokens: { type: 'integer' },
              outputTokens: { type: 'integer' }, totalTokens: { type: 'integer' }, totalLatencyMs: { type: 'number' },
              latestCall: {
                oneOf: [
                  { type: 'null' },
                  { type: 'object', properties: {
                    mode: { enum: ['shadow', 'advisory'] }, turn: { type: 'integer' }, step: { type: 'integer' },
                    nodeType: { enum: ['task-intake', 'missing-information', 'direction-selection', 'tool-recovery', 'progress-check', 'pre-conclusion'] },
                    status: { enum: ['pending', 'success', 'failure'] }, responseReceived: { type: 'boolean' },
                    briefStatus: { enum: ['pending', 'injected', 'shadow-only', 'below-confidence', 'invalid', 'unavailable'] },
                    reason: { type: ['string', 'null'] }, confidence: { type: ['number', 'null'] },
                    minimumConfidence: { type: ['number', 'null'] }, code: { type: ['string', 'null'] },
                  }, required: ['mode', 'turn', 'step', 'nodeType', 'status', 'responseReceived', 'briefStatus', 'reason', 'confidence', 'minimumConfidence', 'code'], additionalProperties: false },
                ],
              },
              latestFailure: {
                oneOf: [
                  { type: 'null' },
                  { type: 'object', properties: {
                    code: { type: 'string' }, stage: { enum: ['provider', 'deadline', 'cancellation', 'projection', 'unexpected', 'unknown'] },
                    retryable: { type: 'boolean' }, responseReceived: { type: 'boolean' }, providerCode: { type: 'string' }, latencyMs: { type: 'number' },
                    turn: { type: 'integer' }, followedBySuccess: { type: 'boolean' },
                  }, required: ['code', 'stage', 'retryable', 'responseReceived', 'followedBySuccess'], additionalProperties: false },
                ],
              },
            }, required: ['sessionId', 'calls', 'providerSuccesses', 'validBriefs', 'injectedAdvisories', 'successes', 'failures', 'pending', 'inputTokens', 'outputTokens', 'totalTokens', 'totalLatencyMs', 'latestCall', 'latestFailure'], additionalProperties: false },
          ],
        },
      },
    },
  },
}, z)

export default TYPERT_REMOTE
