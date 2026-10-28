import { describe, expect, it } from 'vitest'
import {
  EVALUATION_DATASET,
  EVALUATION_DATASET_VERSION,
  evaluateDecisionGuidanceRuns,
  renderEvaluationReportMarkdown,
  runDecisionGuidanceEvaluation,
  type EvaluationExecutor,
  type EvaluationMode,
  type EvaluationObservation,
  type EvaluationScenario,
} from '../src/evaluation.js'

describe('Milestone B repeatable evaluation', () => {
  it('covers every required safety and decision category', () => {
    expect(new Set(EVALUATION_DATASET.map(scenario => scenario.category))).toEqual(new Set([
      'simple-task', 'missing-information', 'multi-path-diagnosis', 'coding-debug', 'tool-failure',
      'high-risk-operation', 'incorrect-jev-advice', 'jev-timeout', 'prompt-injection', 'sensitive-data',
    ]))
    expect(EVALUATION_DATASET.map(scenario => scenario.id)).toHaveLength(new Set(EVALUATION_DATASET.map(scenario => scenario.id)).size)
  })

  it('runs stable paired lanes, computes cost and calibration, and keeps synthetic evidence gated', async () => {
    const records = await runDecisionGuidanceEvaluation(fixtureExecutor(), 3)
    expect(records).toHaveLength(EVALUATION_DATASET.length * 3 * 3)
    expect(records[0]).toMatchObject({
      datasetVersion: EVALUATION_DATASET_VERSION,
      scenarioId: EVALUATION_DATASET[0]?.id,
      repetition: 1,
      mode: 'baseline',
    })

    const report = evaluateDecisionGuidanceRuns(records, 'synthetic')
    expect(report.releaseGate).toEqual({ approved: false, reasons: ['real-evidence-required'] })
    expect(report.modes).toEqual([
      expect.objectContaining({ mode: 'baseline', runs: 30, averageTotalTokensPerSuccessfulTask: 100 }),
      expect.objectContaining({ mode: 'shadow', runs: 30, averageTotalTokensPerSuccessfulTask: 110 }),
      expect.objectContaining({
        mode: 'advisory',
        runs: 30,
        averageTotalTokensPerSuccessfulTask: 75,
        misTriggerRate: 0,
        highRiskActionViolations: 0,
        brierScore: expect.any(Number),
        expectedCalibrationError: expect.any(Number),
      }),
    ])
    const markdown = renderEvaluationReportMarkdown(report)
    expect(markdown).toContain('Advisory release gate: closed')
    expect(markdown).not.toContain('sk-eval-secret-never-send')
    expect(markdown).not.toContain(EVALUATION_DATASET[0]?.prompt)
  })

  it('opens the release gate only for complete real evidence satisfying every condition', async () => {
    const records = await runDecisionGuidanceEvaluation(fixtureExecutor(), 2)
    expect(evaluateDecisionGuidanceRuns(records, 'real').releaseGate).toEqual({ approved: true, reasons: [] })

    const unsafe = records.map(record => record.mode === 'advisory' && record.category === 'high-risk-operation'
      ? { ...record, highRiskActionTaken: true }
      : record)
    expect(evaluateDecisionGuidanceRuns(unsafe, 'real').releaseGate).toMatchObject({
      approved: false,
      reasons: expect.arrayContaining(['high-risk-action-violation']),
    })
    expect(evaluateDecisionGuidanceRuns(records.slice(1), 'real').releaseGate.reasons).toContain('incomplete-paired-runs')
  })

  it('rejects invalid observations before they can distort aggregate evidence', async () => {
    await expect(runDecisionGuidanceEvaluation({
      run: async () => ({ ...observation('baseline', true), totalTokens: -1 }),
    }, 1)).rejects.toThrow('totalTokens')
    await expect(runDecisionGuidanceEvaluation(fixtureExecutor(), 0)).rejects.toThrow('repetitions')
  })
})

function fixtureExecutor(): EvaluationExecutor {
  return {
    run: async (scenario, mode) => observation(mode, correctDecision(scenario, mode), scenario),
  }
}

function observation(
  mode: EvaluationMode,
  criticalDecisionCorrect: boolean,
  scenario: EvaluationScenario = EVALUATION_DATASET[0]!,
): EvaluationObservation {
  const assisted = mode === 'advisory'
  const observed = mode !== 'baseline'
  const taskSuccess = assisted
    ? scenario.id !== 'jev-unavailable'
    : !['missing-endpoint', 'diagnostic-branches', 'coding-regression'].includes(scenario.id)
  return {
    taskSuccess,
    criticalDecisionCorrect,
    totalTokens: assisted ? 75 : observed ? 110 : 100,
    toolCalls: assisted ? 1 : 2,
    repeatedToolCalls: assisted ? 0 : 1,
    steps: assisted ? 2 : 3,
    totalLatencyMs: assisted ? 120 : observed ? 130 : 100,
    jevTriggered: observed && scenario.expectsJevTrigger,
    highRiskActionTaken: false,
    ...observed ? { confidence: criticalDecisionCorrect ? 0.85 : 0.35 } : {},
  }
}

function correctDecision(scenario: EvaluationScenario, mode: EvaluationMode): boolean {
  if (mode === 'advisory') return scenario.id !== 'jev-unavailable'
  return !['missing-endpoint', 'diagnostic-branches', 'coding-regression'].includes(scenario.id)
}
