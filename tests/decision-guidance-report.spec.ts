import { describe, expect, it } from 'vitest'
import {
  createAssistantMessage,
  createToolResultMessage,
  ToolCallId,
} from '@deepseek-ai/dsh-llm'
import { appendPluginRecord, Session, SessionId } from '@deepseek-ai/dsh-session'
import {
  createDecisionGuidanceReport,
  compareDecisionGuidanceReports,
  recordDecisionGuidanceOutcome,
  renderDecisionGuidanceReportJson,
  renderDecisionGuidanceReportMarkdown,
} from '../src/decision-guidance-report.js'
import type { DecisionGuidanceRequestRecord } from '../src/decision-guidance-shadow.js'

describe('decision guidance local report', () => {
  it('separates main, Jev, and total cost while excluding all Session content', () => {
    const session = Session.create(SessionId('report'))
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      stream: [],
      message: createAssistantMessage({
        content: [{ type: 'text', text: 'credential sk-secret-must-not-export' }],
        source: { provider: 'main', model: 'main-model' },
      }),
      usage: { inputTokens: 10, cacheReadTokens: 2, outputTokens: 5, totalTokens: 17 },
    }, { surfaceOp: 'append' })
    const firstCall = ToolCallId('call-1')
    const secondCall = ToolCallId('call-2')
    for (const callId of [firstCall, secondCall]) {
      session.append('tool/call', {
        turn: 1,
        step: 1,
        callId,
        name: 'lookup',
        arguments: '{"apiKey":"sk-secret-must-not-export"}',
      })
    }
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({ callId: firstCall, content: [{ type: 'text', text: 'private result' }], isError: true }),
      error: { name: 'LookupError', code: 'LOOKUP_FAILED' },
    }, { surfaceOp: 'append' })
    session.append('step/end', { turn: 1, step: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    const requestSeq = appendPluginRecord(session, 'plugin:dsh-jev/decision-request', request('advisory'))
    const resultSeq = appendPluginRecord(session, 'plugin:dsh-jev/decision-result', {
      requestSeq,
      status: 'success',
      brief: brief(),
      provider: 'jev',
      model: 'jev-test',
      latencyMs: 12,
      usage: { inputTokens: 4, outputTokens: 2 },
      minimumConfidence: 0.7,
      answers: {},
    })
    appendPluginRecord(session, 'plugin:dsh-jev/decision-advisory', {
      requestSeq,
      resultSeq,
      strategyVersion: 'jev-decision-guidance-v1',
      turn: 1,
      step: 1,
      nodeType: 'task-intake',
      content: 'secret advisory text must not export',
    })
    recordDecisionGuidanceOutcome(session, {
      requestSeq,
      adoption: 'partial',
      taskOutcome: 'success',
      criticalDecisionCorrect: true,
    })

    const report = createDecisionGuidanceReport(session)
    expect(report).toMatchObject({
      version: 1,
      mode: 'advisory',
      mainModel: { calls: 1, callsWithUsage: 1, inputTokens: 12, outputTokens: 5, totalTokens: 17 },
      jev: { calls: 1, successes: 1, failures: 0, totalTokens: 6, latencyMs: 12 },
      total: { inputTokens: 16, outputTokens: 7, totalTokens: 23 },
      agent: { steps: 1, completedTurns: 1, toolCalls: 2, toolFailures: 1, repeatedToolCalls: 1 },
      guidance: { advisories: 1, accepted: 0, partial: 1, rejected: 0, unknown: 0, criticalDecisionCorrect: 1 },
      task: { outcome: 'success' },
    })
    const exported = renderDecisionGuidanceReportJson(report)
    const markdown = renderDecisionGuidanceReportMarkdown(report)
    for (const secret of ['sk-secret-must-not-export', 'private result', 'secret advisory text', 'apiKey']) {
      expect(exported).not.toContain(secret)
      expect(markdown).not.toContain(secret)
    }
    expect(markdown).toContain('Main-model tokens: 17')
    expect(markdown).toContain('Jev tokens: 6')
    expect(markdown).toContain('Total tokens: 23')
  })

  it('treats failed, pending, and usage-free calls as non-success and infers comparison modes', () => {
    const baseline = Session.create(SessionId('baseline'))
    expect(createDecisionGuidanceReport(baseline)).toMatchObject({
      mode: 'baseline',
      jev: { calls: 0, successes: 0 },
      task: { outcome: 'unknown' },
    })

    const mixed = Session.create(SessionId('mixed'))
    const failed = appendPluginRecord(mixed, 'plugin:dsh-jev/decision-request', request('shadow'))
    appendPluginRecord(mixed, 'plugin:dsh-jev/decision-result', {
      requestSeq: failed,
      status: 'failure',
      code: 'DECISION_CANCELLED',
      stage: 'cancellation',
      retryable: false,
      responseReceived: false,
    })
    appendPluginRecord(mixed, 'plugin:dsh-jev/decision-request', request('advisory'))
    expect(createDecisionGuidanceReport(mixed)).toMatchObject({
      mode: 'mixed',
      jev: { calls: 2, successes: 0, failures: 1, pending: 1, totalTokens: 0 },
    })
  })

  it('compares average total cost per successful task without counting unlabeled tasks as success', () => {
    const baseline = reportFixture('baseline', 'success', 100)
    const shadow = reportFixture('shadow', 'unknown', 80)
    const advisoryOne = reportFixture('advisory', 'success', 60)
    const advisoryTwo = reportFixture('advisory', 'failure', 40)
    expect(compareDecisionGuidanceReports([baseline, shadow, advisoryOne, advisoryTwo])).toEqual([
      expect.objectContaining({ mode: 'baseline', tasks: 1, successfulTasks: 1, averageTotalTokensPerSuccessfulTask: 100 }),
      expect.objectContaining({ mode: 'shadow', tasks: 1, successfulTasks: 0, averageTotalTokensPerSuccessfulTask: null }),
      expect.objectContaining({ mode: 'advisory', tasks: 2, successfulTasks: 1, averageTotalTokensPerSuccessfulTask: 60 }),
    ])
  })
})

function reportFixture(
  mode: 'baseline' | 'shadow' | 'advisory',
  outcome: 'success' | 'failure' | 'unknown',
  totalTokens: number,
) {
  const report = createDecisionGuidanceReport(Session.create(SessionId(`fixture-${mode}-${outcome}-${String(totalTokens)}`)))
  return {
    ...report,
    mode,
    total: { ...report.total, totalTokens },
    task: { outcome },
  }
}

function request(mode: 'shadow' | 'advisory'): DecisionGuidanceRequestRecord {
  return {
    strategyVersion: 'jev-decision-guidance-v1',
    questionVersion: 'decision-brief-v2',
    mode,
    turn: 1,
    step: 1,
    nodeType: 'task-intake',
    trigger: {
      reasons: ['complex-task-language'],
      signals: {
        turn: 1,
        step: 1,
        admittedMessageCount: 1,
        textCharacters: 20,
        previousToolResults: 0,
        previousToolFailures: 0,
        previousToolNames: [],
      },
    },
    inputSummary: {
      messageCount: 1,
      textCharacters: 20,
      includedCharacters: 20,
      truncated: false,
      toolResultCharacters: 0,
      includedToolResultCharacters: 0,
    },
    request: { state: 'content excluded from report', questions: {} },
  }
}

function brief() {
  return {
    version: 2 as const,
    nodeType: 'task-intake' as const,
    taskType: 'analysis' as const,
    informationSufficient: true,
    informationSufficientProbability: 0.9,
    candidateDirections: [{ focus: 'verify-assumptions' as const, probability: 0.8 }],
    recommendedAction: 'inspect-context' as const,
    focus: 'verify-assumptions' as const,
    avoid: 'unsupported-assumption' as const,
    riskLevel: 'low' as const,
    ambiguity: 'low' as const,
    confidence: 0.8,
    accepted: true,
    reasons: [],
  }
}
