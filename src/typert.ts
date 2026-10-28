/** Host Typert manifest discovered from the dsh-jev Loader entry. */

import { TYPERT_REMOTE } from './remote.js'

/** Reflection and invocation metadata registered by dsh-typert-loader. */
export const TYPERT = {
  package: 'dsh-jev',
  face: 'host',
  schemas: [],
  get invocations() { return TYPERT_REMOTE.descriptors },
  model: {
    services: [{
      description: 'Host service for Jev decisions, connection checks, and local summaries.',
      summary: 'Host service for Jev decisions, connection checks, and local summaries.',
      tags: [],
      jsDoc: '/** Host service for Jev decisions, connection checks, and local summaries. */',
      key: 'decisions',
      exportName: 'DshDecisionService',
      members: [
        {
          kind: 'method',
          name: 'remoteTestConnection',
          signature: "@Remote('testConnection') remoteTestConnection(signal: AbortSignal): Promise<JevConnectionTestResult>",
          summary: 'Test the configured Jev endpoint and credential without creating Agent work.',
          jsDoc: '/** Test the configured Jev endpoint and credential without creating Agent work. */',
        },
        {
          kind: 'method',
          name: 'remoteLatestSessionSummary',
          signature: "@Remote('latestSessionSummary') remoteLatestSessionSummary(): Promise<JevLatestSessionSummary | null>",
          summary: 'Read content-free totals for the latest live Agent Session observed by dsh-jev.',
          jsDoc: '/** Read content-free totals for the latest live Agent Session observed by dsh-jev. */',
        },
      ],
      types: [],
    }],
    events: [],
    objects: [],
  },
} as const
