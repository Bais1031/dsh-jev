import { describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createToolResultMessage, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { DecisionTriggerGate, selectDecisionTrigger } from '../src/decision-guidance-trigger.js'
import type { DecisionNodeType } from '../src/decision-guidance-protocol.js'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'test-runtime-context': { readonly kind: 'test-runtime-context' }
  }
}

const ALL_NODES = new Set<DecisionNodeType>([
  'task-intake',
  'missing-information',
  'direction-selection',
  'tool-recovery',
  'progress-check',
  'pre-conclusion',
])

describe('decision guidance trigger selection', () => {
  it('does not select a simple bounded task', () => {
    expect(selectDecisionTrigger(session('simple'), 1, 1, messages('Translate hello.'), ALL_NODES, 4, 200)).toBeUndefined()
  })

  it('does not send task text matching a likely credential pattern to Jev', () => {
    expect(selectDecisionTrigger(
      session('credential'),
      1,
      1,
      messages('Analyze the failure using api_key=sk-eval-secret-never-send'),
      ALL_NODES,
      4,
      1,
    )).toBeUndefined()
  })

  it('selects and measures nodes from direct user messages only', () => {
    const direct = createUserMessage({
      content: [{ type: 'text', text: 'Compare both implementation options.' }],
      source: { kind: 'user' },
    })
    const runtime = createUserMessage({
      content: [{ type: 'text', text: 'Time sampled while preparing this turn.' }],
      source: { kind: 'test-runtime-context' },
    })

    expect(selectDecisionTrigger(session('source-filter'), 1, 1, [runtime, direct], ALL_NODES, 4, 1)).toMatchObject({
      nodeType: 'direction-selection',
      text: 'Compare both implementation options.',
      signals: {
        admittedMessageCount: 1,
        textCharacters: 36,
      },
    })
    expect(selectDecisionTrigger(session('context-only'), 1, 1, [runtime], ALL_NODES, 4, 1)).toBeUndefined()
  })

  it.each([
    ['missing-information', 'Analyze the production API endpoint because the required value is missing; ask which one to use.'],
    ['direction-selection', 'Compare both implementation options and choose one.'],
    ['task-intake', 'Diagnose this production failure and plan the repair.'],
  ] as const)('selects %s from admitted text', (nodeType, text) => {
    expect(selectDecisionTrigger(session(nodeType), 1, 1, messages(text), ALL_NODES, 4, 1)?.nodeType).toBe(nodeType)
  })

  it.each([
    '没有提供当前数据库类型，应该直接规划还是先补充信息？',
    '尚未提供停机窗口，需要澄清后再选择方案。',
    '目标数据库还不清楚，应先询问。',
    '缺乏回滚要求，不能确定迁移路线。',
  ])('selects missing-information before direction-selection for %s', (text) => {
    const padded = `请分析生产数据库迁移约束和潜在风险。${text}${'补充背景。'.repeat(50)}`
    expect(selectDecisionTrigger(session(`missing-zh-${text}`), 1, 1, messages(padded), ALL_NODES, 4, 200)).toMatchObject({
      nodeType: 'missing-information',
      reasons: ['missing-information-language'],
    })
  })

  it.each([
    '现有文档已经提供完整方案。',
    '没有提供商锁定风险。',
    '团队选择继续当前路线。',
  ])('does not misclassify an ordinary statement as missing information: %s', (text) => {
    const selected = selectDecisionTrigger(session(`missing-negative-${text}`), 1, 1, messages(text), ALL_NODES, 4, 200)
    expect(selected?.nodeType).not.toBe('missing-information')
  })

  it('selects tool recovery before other candidates after a failed result', () => {
    const value = session('tool-failure')
    appendToolResult(value, true)
    expect(selectDecisionTrigger(value, 1, 2, [], ALL_NODES, 2, 200)).toMatchObject({
      nodeType: 'tool-recovery',
      reasons: ['failed-tool-result'],
      signals: { previousToolFailures: 1, previousToolNames: ['read_file'] },
    })
  })

  it('keeps a recovery trigger but excludes a tool-result excerpt containing a likely credential', () => {
    const value = session('tool-secret')
    appendToolResult(value, true, 'failure api_key=sk-eval-secret-never-send')
    expect(selectDecisionTrigger(value, 1, 2, [], ALL_NODES, 2, 200, true, 1_000)).toMatchObject({
      nodeType: 'tool-recovery',
      toolResultText: '',
      toolResultTextCharacters: 0,
    })
  })

  it('selects pre-conclusion after successful tool evidence and progress review at its threshold otherwise', () => {
    const successful = session('tool-success')
    appendToolResult(successful, false)
    expect(selectDecisionTrigger(successful, 1, 2, [], ALL_NODES, 2, 200)?.nodeType).toBe('pre-conclusion')
    expect(selectDecisionTrigger(session('progress'), 1, 3, [], ALL_NODES, 3, 200)?.nodeType).toBe('progress-check')
  })

  it('falls through to the next enabled candidate', () => {
    const enabled = new Set<DecisionNodeType>(['task-intake'])
    const selected = selectDecisionTrigger(
      session('enabled'),
      1,
      1,
      messages('Compare the architecture and analyze the risks.'),
      enabled,
      4,
      20,
    )
    expect(selected).toMatchObject({ nodeType: 'task-intake', reasons: ['complex-task-language', 'task-input-size'] })
  })
})

describe('DecisionTriggerGate budgets', () => {
  it('deduplicates a step, enforces cooldown, caps calls, and releases Agent state', () => {
    const gate = new DecisionTriggerGate()
    const agent = { session: session('gate') } as Agent
    const options = {
      enabledNodes: () => ['task-intake'] as const,
      cooldownSteps: () => 1,
      maximumCallsPerSession: () => 2,
      maximumTokensPerSession: () => 8_000,
      lowConfidenceBackoffThreshold: () => 2,
      providerFailureBackoffThreshold: () => 2,
      deadlineBackoffThreshold: () => 2,
      backoffAllowsRecoveryNodes: () => true,
      progressCheckStep: () => 4,
      minimumTaskInputCharacters: () => 1,
      includeToolResultSummaries: () => false,
      toolResultSummaryCharacters: () => 1_000,
    }
    expect(gate.consider(agent, 1, 1, messages('Analyze a'), options).kind).toBe('trigger')
    expect(gate.consider(agent, 1, 1, messages('Analyze a'), options)).toEqual({ kind: 'none' })
    expect(gate.consider(agent, 2, 1, messages('Analyze b'), options)).toMatchObject({ kind: 'skip', reason: 'cooldown' })
    expect(gate.consider(agent, 3, 1, messages('Analyze c'), options).kind).toBe('trigger')
    expect(gate.consider(agent, 4, 1, messages('Analyze d'), options)).toMatchObject({ kind: 'skip', reason: 'session-call-limit' })

    gate.dispose(agent)
    expect(gate.consider(agent, 5, 1, messages('Analyze e'), options).kind).toBe('trigger')
  })

  it('stops early nodes after the token budget or consecutive low-confidence results', () => {
    const budgetGate = new DecisionTriggerGate()
    const budgetAgent = { session: session('token-budget') } as Agent
    const budgetOptions = gateOptions({ maximumTokensPerSession: 10 })
    expect(budgetGate.consider(budgetAgent, 1, 1, messages('Analyze production risk a'), budgetOptions).kind).toBe('trigger')
    budgetGate.observe(budgetAgent, { kind: 'success', accepted: true, inputTokens: 8, outputTokens: 3 })
    expect(budgetGate.consider(budgetAgent, 2, 1, messages('Analyze production risk b'), budgetOptions))
      .toMatchObject({ kind: 'skip', reason: 'token-budget' })

    const confidenceGate = new DecisionTriggerGate()
    const confidenceAgent = { session: session('confidence-backoff') } as Agent
    const confidenceOptions = gateOptions({ lowConfidenceBackoffThreshold: 2 })
    for (const turn of [1, 2]) {
      expect(confidenceGate.consider(confidenceAgent, turn, 1, messages(`Analyze production risk ${turn}`), confidenceOptions).kind)
        .toBe('trigger')
      confidenceGate.observe(confidenceAgent, { kind: 'success', accepted: false, inputTokens: 1, outputTokens: 1 })
    }
    expect(confidenceGate.consider(confidenceAgent, 3, 1, messages('Analyze production risk c'), confidenceOptions))
      .toMatchObject({ kind: 'skip', reason: 'low-confidence-backoff' })
  })

  it('tracks provider and deadline backoff separately, excludes cancellation, and resets provider failures on success', () => {
    const gate = new DecisionTriggerGate()
    const agent = { session: session('failure-backoff') } as Agent
    const options = gateOptions({ providerFailureBackoffThreshold: 2, deadlineBackoffThreshold: 2 })
    expect(gate.consider(agent, 1, 1, messages('Analyze production risk a'), options).kind).toBe('trigger')
    gate.observe(agent, { kind: 'failure', stage: 'provider' })
    expect(gate.consider(agent, 2, 1, messages('Analyze production risk b'), options).kind).toBe('trigger')
    gate.observe(agent, { kind: 'failure', stage: 'cancellation' })
    gate.observe(agent, { kind: 'success', accepted: true, inputTokens: 1, outputTokens: 1 })
    expect(gate.consider(agent, 3, 1, messages('Analyze production risk c'), options).kind).toBe('trigger')
    gate.observe(agent, { kind: 'failure', stage: 'deadline' })
    expect(gate.consider(agent, 4, 1, messages('Analyze production risk d'), options).kind).toBe('trigger')
    gate.observe(agent, { kind: 'failure', stage: 'deadline' })
    expect(gate.consider(agent, 5, 1, messages('Analyze production risk e'), options))
      .toMatchObject({ kind: 'skip', reason: 'deadline-backoff' })
  })
})

function gateOptions(overrides: {
  readonly maximumTokensPerSession?: number
  readonly lowConfidenceBackoffThreshold?: number
  readonly providerFailureBackoffThreshold?: number
  readonly deadlineBackoffThreshold?: number
} = {}) {
  return {
    enabledNodes: () => ['task-intake'] as const,
    cooldownSteps: () => 0,
    maximumCallsPerSession: () => 20,
    maximumTokensPerSession: () => overrides.maximumTokensPerSession ?? 8_000,
    lowConfidenceBackoffThreshold: () => overrides.lowConfidenceBackoffThreshold ?? 20,
    providerFailureBackoffThreshold: () => overrides.providerFailureBackoffThreshold ?? 20,
    deadlineBackoffThreshold: () => overrides.deadlineBackoffThreshold ?? 20,
    backoffAllowsRecoveryNodes: () => false,
    progressCheckStep: () => 4,
    minimumTaskInputCharacters: () => 1,
    includeToolResultSummaries: () => false,
    toolResultSummaryCharacters: () => 1_000,
  }
}

function session(id: string): Session {
  return Session.create(SessionId(id))
}

function messages(text: string) {
  return [createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })]
}

function appendToolResult(value: Session, isError: boolean, text = 'result'): void {
  const callId = ToolCallId('call-1')
  value.append('tool/call', { turn: 1, step: 1, callId, name: 'read_file', arguments: '{}' })
  value.append('tool/result', {
    turn: 1,
    step: 1,
    message: createToolResultMessage({ callId, content: [{ type: 'text', text }], isError }),
    ...isError ? { error: { name: 'ReadError', code: 'READ_FAILED' } } : {},
  }, { surfaceOp: 'append' })
}
