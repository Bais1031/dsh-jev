/** @module dsh-jev */
export { JevClient } from './client.js'
export { DecisionError, DecisionProviderError } from './decision-errors.js'
export { DecisionService } from './decision-service.js'
export {
  createDecisionBrief,
  createDecisionGuidanceRequest,
  DECISION_GUIDANCE_QUESTION_VERSION,
  DECISION_GUIDANCE_STRATEGY_VERSION,
  DecisionGuidanceProtocolError,
} from './decision-guidance-protocol.js'
export { containsLikelyCredential, DecisionTriggerGate, selectDecisionTrigger } from './decision-guidance-trigger.js'
export { installDecisionGuidanceShadow, renderDecisionAdvisory } from './decision-guidance-shadow.js'
export { summarizeDecisionGuidance } from './decision-guidance-summary.js'
export {
  createDecisionGuidanceReport,
  compareDecisionGuidanceReports,
  recordDecisionGuidanceOutcome,
  renderDecisionGuidanceReportJson,
  renderDecisionGuidanceReportMarkdown,
} from './decision-guidance-report.js'
export { JevError } from './errors.js'
export {
  EVALUATION_DATASET,
  EVALUATION_DATASET_VERSION,
  EVALUATION_MODES,
  evaluateDecisionGuidanceRuns,
  renderEvaluationReportMarkdown,
  runDecisionGuidanceEvaluation,
} from './evaluation.js'
export { decisionProviderName } from './decision-types.js'
export { Config, DshDecisionService } from './dsh-plugin.js'
export { createJevDecisionTool } from './dsh-tool.js'
export { JEV_PROVIDER_NAME, JevDecisionProvider } from './jev-provider.js'
export type {
  DecisionAmbiguity,
  DecisionAvoid,
  DecisionBriefRejectionReason,
  DecisionDirection,
  DecisionFocus,
  DecisionGuidanceProtocolErrorCode,
  DecisionNodeType,
  DecisionRecommendedAction,
  DecisionRisk,
  DecisionTaskType,
  JevDecisionBrief,
} from './decision-guidance-protocol.js'
export type {
  DecisionTrigger,
  DecisionTriggerOptions,
  DecisionTriggerReason,
  DecisionTriggerSignals,
} from './decision-guidance-trigger.js'
export type {
  DecisionGuidanceAdvisoryRecord,
  DecisionGuidanceFailureRecord,
  DecisionGuidanceInputSummary,
  DecisionGuidanceMode,
  DecisionGuidanceRequestRecord,
  DecisionGuidanceResultRecord,
  DecisionGuidanceService,
  DecisionGuidanceShadowOptions,
  DecisionGuidanceSuccessRecord,
} from './decision-guidance-shadow.js'
export type {
  DecisionGuidanceNodeSummary,
  DecisionGuidanceSessionSummary,
  DecisionGuidanceUsageSummary,
} from './decision-guidance-summary.js'
export type {
  DecisionAdoption,
  DecisionGuidanceOutcomeRecord,
  DecisionGuidanceReport,
  DecisionGuidanceReportCohort,
  DecisionReportMode,
  DecisionTaskOutcome,
  DecisionTokenTotals,
} from './decision-guidance-report.js'
export type {
  DecisionErrorCode,
  DecisionErrorOptions,
  DecisionProviderErrorOptions,
} from './decision-errors.js'
export type {
  DecisionAnswer,
  DecisionBooleanAnswer,
  DecisionBooleanQuestion,
  DecisionCallOptions,
  DecisionChoiceAnswer,
  DecisionChoiceQuestion,
  DecisionProvider,
  DecisionProviderCallOptions,
  DecisionProviderName,
  DecisionProviderResult,
  DecisionQuestion,
  DecisionRequest,
  DecisionResult,
  DecisionScoreAnswer,
  DecisionScoreQuestion,
  DecisionServiceOptions,
  DecisionUsage,
  ResolvedDecisionRequest,
} from './decision-types.js'
export type { JevDecisionToolOptions, JevDecisionToolService } from './dsh-tool.js'
export type { Config as DshJevConfig, ConfigInput as DshJevConfigInput } from './dsh-plugin.js'
export type { JevErrorCode, JevErrorOptions } from './errors.js'
export type {
  EvaluationCategory,
  EvaluationEvidenceKind,
  EvaluationExecutor,
  EvaluationGateReason,
  EvaluationMode,
  EvaluationModeSummary,
  EvaluationObservation,
  EvaluationReport,
  EvaluationRunRecord,
  EvaluationScenario,
} from './evaluation.js'
export type { JevApiKeyResolver, JevDecisionProviderOptions } from './jev-provider.js'
export type {
  JevAnswer,
  JevCallOptions,
  JevChoiceAnswer,
  JevChoiceQuestion,
  JevClientOptions,
  JevContent,
  JevNoulAnswer,
  JevNoulQuestion,
  JevQuestion,
  JevRequest,
  JevResponse,
  JevScoreAnswer,
  JevScoreQuestion,
  JevUsage,
  JsonObject,
  JsonValue,
} from './types.js'

export { default } from './dsh-plugin.js'
