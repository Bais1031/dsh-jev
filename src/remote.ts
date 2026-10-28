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
  readonly successes: number
  readonly failures: number
  readonly pending: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly totalTokens: number
  readonly totalLatencyMs: number
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
  successes: z.number().int().nonnegative(),
  failures: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  totalLatencyMs: z.number().nonnegative(),
})

/** Remote descriptors mounted by the browser half and registered by the Host Typert artifact. */
export const TYPERT_REMOTE = createTypertRemoteInfo({
  package: 'dsh-jev',
  methods: {
    'dshJev/testConnection': {
      service: 'decisions',
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
              failures: { type: 'integer' }, pending: { type: 'integer' }, inputTokens: { type: 'integer' },
              outputTokens: { type: 'integer' }, totalTokens: { type: 'integer' }, totalLatencyMs: { type: 'number' },
            }, required: ['sessionId', 'calls', 'successes', 'failures', 'pending', 'inputTokens', 'outputTokens', 'totalTokens', 'totalLatencyMs'], additionalProperties: false },
          ],
        },
      },
    },
  },
}, z)

export default TYPERT_REMOTE
