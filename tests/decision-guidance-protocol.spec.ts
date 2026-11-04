import { describe, expect, it } from 'vitest'
import { decisionProviderName, type DecisionAnswer, type DecisionResult } from '../src/decision-types.js'
import {
  createDecisionBrief,
  createDecisionGuidanceRequest,
  DECISION_GUIDANCE_QUESTION_VERSION,
} from '../src/decision-guidance-protocol.js'

describe('decision guidance protocol', () => {
  it('builds one fixed bounded question vocabulary', () => {
    const request = createDecisionGuidanceRequest('task-intake', { content: 'diagnose this' }, 'jev-test')
    expect(request.model).toBe('jev-test')
    expect(Object.keys(request.questions)).toEqual([
      'informationSufficient',
      'recommendedAction',
      'focus',
    ])
    expect(DECISION_GUIDANCE_QUESTION_VERSION).toBe('decision-brief-v3')
  })

  it('adds only the questions needed by later analysis nodes', () => {
    expect(Object.keys(createDecisionGuidanceRequest('progress-check', {}, 'jev-test').questions)).toEqual([
      'recommendedAction', 'focus', 'avoid',
    ])
    expect(Object.keys(createDecisionGuidanceRequest('tool-recovery', {}, 'jev-test').questions)).toEqual([
      'recommendedAction', 'focus', 'avoid', 'risk',
    ])
    expect(Object.keys(createDecisionGuidanceRequest('pre-conclusion', {}, 'jev-test').questions)).toEqual([
      'informationSufficient', 'recommendedAction', 'risk',
    ])
  })

  it('keeps every v3 node request smaller than its v2 serialized baseline', () => {
    const v2Bytes = {
      'task-intake': 1_819,
      'missing-information': 1_819,
      'direction-selection': 1_819,
      'tool-recovery': 2_730,
      'progress-check': 2_414,
      'pre-conclusion': 2_135,
    } as const
    for (const [nodeType, baseline] of Object.entries(v2Bytes)) {
      const request = createDecisionGuidanceRequest(
        nodeType as keyof typeof v2Bytes,
        { content: 'x' },
        'jev-test',
      )
      expect(new TextEncoder().encode(JSON.stringify(request)).byteLength).toBeLessThan(baseline)
    }
  })

  it('projects probabilities into a short ranked brief', () => {
    const brief = createDecisionBrief('direction-selection', result(), 0.7)
    expect(brief).toMatchObject({
      version: 3,
      nodeType: 'direction-selection',
      informationSufficient: true,
      recommendedAction: 'inspect-context',
      focus: 'verify-assumptions',
      confidence: 0.9,
      accepted: true,
      reasons: [],
    })
    expect(brief.candidateDirections).toEqual([
      { focus: 'verify-assumptions', probability: 0.8 },
      { focus: 'inspect-local-context', probability: 0.1 },
      { focus: 'compare-options', probability: 0.05 },
    ])
  })

  it('retains a valid low-confidence brief without accepting it', () => {
    const low = result({
      informationSufficient: { type: 'boolean', value: true, probability: 0.6, confidence: 0.6 },
      recommendedAction: choice('inspect-context', ACTION_PROBABILITIES, 0.6),
      focus: choice('verify-assumptions', FOCUS_PROBABILITIES, 0.6),
    })
    expect(createDecisionBrief('task-intake', low, 0.7)).toMatchObject({
      confidence: 0.6,
      accepted: false,
      reasons: ['confidence-below-threshold'],
    })
  })

  it('retains high-confidence fields without exposing uncertain fields', () => {
    const partial = createDecisionBrief('missing-information', result({
      informationSufficient: { type: 'boolean', value: false, probability: 0.15, confidence: 0.85 },
      recommendedAction: choice('ask-user', ACTION_PROBABILITIES, 0.36),
      ambiguity: choice('high', { low: 0.12, medium: 0.05, high: 0.83 }, 0.74),
    }), 0.7)

    expect(partial).toMatchObject({
      accepted: true,
      confidence: 0.85,
      informationSufficient: false,
      informationSufficientProbability: 0.15,
      ambiguity: 'high',
    })
    expect(partial).not.toHaveProperty('recommendedAction')
    expect(partial).not.toHaveProperty('focus')
  })

  it('accepts a valid result independently of provider-reported output usage', () => {
    expect(createDecisionBrief('task-intake', {
      ...result(),
      usage: { inputTokens: 10, outputTokens: 10_000 },
    }, 0.7)).toMatchObject({ accepted: true })
  })

  it('rejects an answer set outside the fixed protocol vocabulary', () => {
    const invalid = result({
      recommendedAction: choice('unknown', { unknown: 1 }, 1),
    })
    expect(() => createDecisionBrief('task-intake', invalid, 0.7)).toThrow(expect.objectContaining({
      code: 'DECISION_GUIDANCE_INVALID_RESULT',
    }))
  })
})

const TASK_PROBABILITIES = { coding: 0.8, retrieval: 0.05, writing: 0.05, analysis: 0.05, operation: 0.05 }
const ACTION_PROBABILITIES = {
  continue: 0.02,
  'ask-user': 0.03,
  'inspect-context': 0.8,
  search: 0.03,
  'use-tool': 0.04,
  'change-direction': 0.03,
  answer: 0.03,
  stop: 0.02,
}
const FOCUS_PROBABILITIES = {
  'clarify-goal': 0.01,
  'verify-assumptions': 0.8,
  'inspect-local-context': 0.1,
  'gather-external-evidence': 0.01,
  'compare-options': 0.05,
  'recover-tool': 0.01,
  'synthesize-evidence': 0.01,
  'answer-directly': 0.01,
}

function result(overrides: Readonly<Record<string, DecisionAnswer>> = {}): DecisionResult {
  return {
    provider: decisionProviderName('jev'),
    model: 'jev-test',
    latencyMs: 4,
    usage: { inputTokens: 10, outputTokens: 6 },
    answers: {
      taskType: choice('coding', TASK_PROBABILITIES, 0.8),
      informationSufficient: { type: 'boolean', value: true, probability: 0.9, confidence: 0.9 },
      recommendedAction: choice('inspect-context', ACTION_PROBABILITIES, 0.8),
      focus: choice('verify-assumptions', FOCUS_PROBABILITIES, 0.8),
      avoid: choice('unsupported-assumption', {
        'unsupported-assumption': 0.8,
        'broad-search': 0.05,
        'repeat-failed-action': 0.05,
        'premature-conclusion': 0.05,
        'unnecessary-tool': 0.03,
        none: 0.02,
      }, 0.8),
      risk: choice('medium', { low: 0.2, medium: 0.7, high: 0.1 }, 0.7),
      ambiguity: choice('low', { low: 0.8, medium: 0.15, high: 0.05 }, 0.8),
      ...overrides,
    },
  }
}

function choice(value: string, probabilities: Readonly<Record<string, number>>, confidence: number): DecisionAnswer {
  return { type: 'choice', value, confidence, probabilities }
}
