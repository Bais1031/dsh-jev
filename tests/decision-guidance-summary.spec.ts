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
        version: 2,
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
      minimumConfidence: 0.7,
      answers: {},
    })
    appendPluginRecord(session, 'plugin:dsh-jev/decision-result', {
      requestSeq: failure,
      status: 'failure',
      code: 'DECISION_GUIDANCE_INVALID_RESULT',
      stage: 'projection',
      retryable: false,
      responseReceived: true,
      latencyMs: 7,
      usage: { inputTokens: 5, outputTokens: 3 },
    })

    expect(summarizeDecisionGuidance(session)).toEqual({
      calls: 3,
      providerSuccesses: 2,
      validBriefs: 1,
      injectedAdvisories: 0,
      successes: 1,
      failures: 1,
      pending: 1,
      usage: { inputTokens: 15, outputTokens: 7, totalTokens: 22 },
      totalLatencyMs: 19,
      latestCall: {
        mode: 'shadow',
        turn: 1,
        step: 3,
        nodeType: 'progress-check',
        status: 'pending',
        responseReceived: false,
        briefStatus: 'pending',
        reason: null,
        confidence: null,
        minimumConfidence: null,
        code: null,
      },
      latestFailure: {
        code: 'DECISION_GUIDANCE_INVALID_RESULT',
        stage: 'projection',
        retryable: false,
        responseReceived: true,
        latencyMs: 7,
        turn: 1,
        followedBySuccess: false,
      },
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
      providerSuccesses: 0,
      validBriefs: 0,
      injectedAdvisories: 0,
      successes: 0,
      failures: 0,
      pending: 0,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      totalLatencyMs: 0,
      latestCall: null,
      latestFailure: null,
      byNode: {},
    })
  })

  it('distinguishes a valid low-confidence brief from a provider failure', () => {
    const session = Session.create(SessionId('low-confidence-summary'))
    const failed = appendPluginRecord(
      session,
      'plugin:dsh-jev/decision-request',
      request('tool-recovery', 1, 'advisory', 1),
    )
    appendPluginRecord(session, 'plugin:dsh-jev/decision-result', {
      requestSeq: failed,
      status: 'failure',
      code: 'DECISION_PROVIDER_FAILURE',
      stage: 'provider',
      retryable: true,
      responseReceived: false,
    })
    const accepted = appendPluginRecord(
      session,
      'plugin:dsh-jev/decision-request',
      request('task-intake', 1, 'advisory', 2),
    )
    appendPluginRecord(session, 'plugin:dsh-jev/decision-result', {
      requestSeq: accepted,
      status: 'success',
      brief: brief(false, 0.69),
      provider: 'jev',
      model: 'jev-test',
      latencyMs: 9,
      usage: { inputTokens: 20, outputTokens: 5 },
      minimumConfidence: 0.7,
      answers: {},
    })

    expect(summarizeDecisionGuidance(session)).toMatchObject({
      providerSuccesses: 1,
      validBriefs: 1,
      injectedAdvisories: 0,
      latestCall: {
        mode: 'advisory',
        turn: 2,
        status: 'success',
        responseReceived: true,
        briefStatus: 'below-confidence',
        reason: 'confidence-below-threshold',
        confidence: 0.69,
        minimumConfidence: 0.7,
      },
      latestFailure: {
        turn: 1,
        followedBySuccess: true,
      },
    })
  })

  it('counts an Advisory only after its exact brief is recorded for model injection', () => {
    const session = Session.create(SessionId('injected-summary'))
    const requestSeq = appendPluginRecord(
      session,
      'plugin:dsh-jev/decision-request',
      request('direction-selection', 2, 'advisory'),
    )
    const resultSeq = appendPluginRecord(session, 'plugin:dsh-jev/decision-result', {
      requestSeq,
      status: 'success',
      brief: brief(true, 0.8),
      provider: 'jev',
      model: 'jev-test',
      latencyMs: 6,
      usage: { inputTokens: 12, outputTokens: 3 },
      minimumConfidence: 0.7,
      answers: {},
    })
    appendPluginRecord(session, 'plugin:dsh-jev/decision-advisory', {
      requestSeq,
      resultSeq,
      strategyVersion: 'jev-decision-guidance-v1',
      turn: 1,
      step: 2,
      nodeType: 'direction-selection',
      content: '<jev-decision-advisory version="2">test</jev-decision-advisory>',
    })

    expect(summarizeDecisionGuidance(session)).toMatchObject({
      providerSuccesses: 1,
      validBriefs: 1,
      injectedAdvisories: 1,
      latestCall: {
        status: 'success',
        briefStatus: 'injected',
        reason: null,
      },
    })
  })
})

function request(
  nodeType: DecisionGuidanceRequestRecord['nodeType'],
  step: number,
  mode: DecisionGuidanceRequestRecord['mode'] = 'shadow',
  turn = 1,
): DecisionGuidanceRequestRecord {
  return {
    strategyVersion: 'jev-decision-guidance-v1',
    questionVersion: 'decision-brief-v2',
    mode,
    turn,
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

function brief(accepted: boolean, confidence: number) {
  return {
    version: 2 as const,
    nodeType: 'task-intake' as const,
    informationSufficient: true,
    informationSufficientProbability: 0.9,
    candidateDirections: [{ focus: 'verify-assumptions' as const, probability: 0.8 }],
    recommendedAction: 'inspect-context' as const,
    focus: 'verify-assumptions' as const,
    ambiguity: 'low' as const,
    confidence,
    accepted,
    reasons: accepted ? [] : ['confidence-below-threshold' as const],
  }
}
