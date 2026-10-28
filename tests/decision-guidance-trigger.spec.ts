import { describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createToolResultMessage, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { DecisionTriggerGate, selectDecisionTrigger } from '../src/decision-guidance-trigger.js'
import type { DecisionNodeType } from '../src/decision-guidance-protocol.js'

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

  it.each([
    ['missing-information', 'The API endpoint is missing; ask which one to use.'],
    ['direction-selection', 'Compare both implementation options and choose one.'],
    ['task-intake', 'Diagnose this production failure and plan the repair.'],
  ] as const)('selects %s from admitted text', (nodeType, text) => {
    expect(selectDecisionTrigger(session(nodeType), 1, 1, messages(text), ALL_NODES, 4, 200)?.nodeType).toBe(nodeType)
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
      progressCheckStep: () => 4,
      minimumTaskInputCharacters: () => 1,
      includeToolResultSummaries: () => false,
      toolResultSummaryCharacters: () => 1_000,
    }
    expect(gate.consider(agent, 1, 1, messages('a'), options)).toBeDefined()
    expect(gate.consider(agent, 1, 1, messages('a'), options)).toBeUndefined()
    expect(gate.consider(agent, 2, 1, messages('b'), options)).toBeUndefined()
    expect(gate.consider(agent, 3, 1, messages('c'), options)).toBeDefined()
    expect(gate.consider(agent, 4, 1, messages('d'), options)).toBeUndefined()

    gate.dispose(agent)
    expect(gate.consider(agent, 5, 1, messages('e'), options)).toBeDefined()
  })
})

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
