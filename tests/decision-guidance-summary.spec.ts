import { describe, expect, it } from 'vitest'
import { appendPluginRecord, Session, SessionId } from '@deepseek-ai/dsh-session'
import type { DecisionGuidanceRequestRecord } from '../src/decision-guidance-shadow.js'
import { summarizeDecisionGuidance } from '../src/decision-guidance-summary.js'

declare module '@deepseek-ai/dsh-session/types' {
  interface PluginRecordMap {
    'plugin:dsh-jev/router-request': { readonly legacy: true }
  }
}

describe('decision-guidance Session summary', () => {
  it('aggregates paired successes, failures, pending calls, usage, latency, and nodes', () => {
    const session = Session.create(SessionId('summary'))
    const success = appendPluginRecord(session, 'plugin:dsh-jev/decision-request', request('task-intake', 1))
    const failure = appendPluginRecord(session, 'plugin:dsh-jev/decision-request', request('tool-recovery', 2))
    appendPluginRecord(session, 'plugin:dsh-jev/decision-request', request('progress-check', 3))
    appendPluginRecord(session, 'plugin:dsh-jev/decision-result', {
      requestSeq: success,
      status: 'success',
      brief: {
        version: 1,
        nodeType: 'task-intake',
        taskType: 'analysis',
        informationSufficient: true,
        informationSufficientProbability: 0.9,
        candidateDirections: [{ focus: 'verify-assumptions', probability: 0.8 }],
        recommendedAction: 'inspect-context',
        focus: 'verify-assumptions',
        avoid: 'unsupported-assumption',
        riskLevel: 'low',
        ambiguity: 'low',
        confidence: 0.8,
        accepted: true,
        reasons: [],
      },
      provider: 'jev',
      model: 'jev-test',
      latencyMs: 12,
      usage: { inputTokens: 10, outputTokens: 4 },
      answers: {},
    })
    appendPluginRecord(session, 'plugin:dsh-jev/decision-result', {
      requestSeq: failure,
      status: 'failure',
      code: 'DECISION_PROVIDER_FAILURE',
      retryable: true,
      latencyMs: 7,
    })

    expect(summarizeDecisionGuidance(session)).toEqual({
      calls: 3,
      successes: 1,
      failures: 1,
      pending: 1,
      usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
      totalLatencyMs: 19,
      byNode: {
        'task-intake': { calls: 1, successes: 1, failures: 0 },
        'tool-recovery': { calls: 1, successes: 0, failures: 1 },
        'progress-check': { calls: 1, successes: 0, failures: 0 },
      },
    })
  })

  it('returns empty totals for a Session without decision records', () => {
    const session = Session.create(SessionId('empty-summary'))
    appendPluginRecord(session, 'plugin:dsh-jev/router-request', { legacy: true })
    expect(summarizeDecisionGuidance(session)).toEqual({
      calls: 0,
      successes: 0,
      failures: 0,
      pending: 0,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      totalLatencyMs: 0,
      byNode: {},
    })
  })
})

function request(nodeType: DecisionGuidanceRequestRecord['nodeType'], step: number): DecisionGuidanceRequestRecord {
  return {
    strategyVersion: 'jev-decision-guidance-v1',
    questionVersion: 'decision-brief-v1',
    mode: 'shadow',
    turn: 1,
    step,
    nodeType,
    trigger: {
      reasons: ['step-budget-threshold'],
      signals: {
        turn: 1,
        step,
        admittedMessageCount: 1,
        textCharacters: 4,
        previousToolResults: 0,
        previousToolFailures: 0,
        previousToolNames: [],
      },
    },
    inputSummary: {
      messageCount: 1,
      textCharacters: 4,
      includedCharacters: 4,
      truncated: false,
      toolResultCharacters: 0,
      includedToolResultCharacters: 0,
    },
    request: {
      model: 'jev-test',
      state: {
        nodeType,
        content: 'test',
        signals: {
          turn: 1,
          step,
          previousToolResults: 0,
          previousToolFailures: 0,
          previousToolNames: [],
        },
      },
      questions: {},
    },
  }
}
