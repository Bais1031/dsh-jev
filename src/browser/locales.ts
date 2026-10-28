/** Localized copy for the dsh-jev Plugins-page configuration. */

import type { SettingsFormLabels } from '@deepseek-ai/dsh-client-ui-primitives'

/** Locale keys rendered by the dsh-jev configuration page. */
export type DshJevSettingsLocaleKey =
  | 'summary' | 'apiKey' | 'apiKeyHint' | 'apiKeySet' | 'apiKeyUnset'
  | 'apiKeyRef' | 'apiKeyRefHint' | 'model' | 'modelHint'
  | 'endpoint' | 'endpointHint' | 'timeoutMs' | 'timeoutMsHint'
  | 'maxInputBytes' | 'maxInputBytesHint'
  | 'decisionMode' | 'decisionModeHint' | 'decisionNodes' | 'decisionNodesHint'
  | 'decisionCooldownSteps' | 'decisionCooldownStepsHint'
  | 'decisionMaxCallsPerSession' | 'decisionMaxCallsPerSessionHint'
  | 'decisionProgressCheckStep' | 'decisionProgressCheckStepHint'
  | 'decisionMinimumTaskInputCharacters' | 'decisionMinimumTaskInputCharactersHint'
  | 'decisionMaxInputCharacters' | 'decisionMaxInputCharactersHint'
  | 'decisionMaxOutputTokens' | 'decisionMaxOutputTokensHint'
  | 'decisionMinimumConfidence' | 'decisionMinimumConfidenceHint'
  | 'decisionIncludeToolResultSummaries' | 'decisionIncludeToolResultSummariesHint'
  | 'decisionToolResultSummaryCharacters' | 'decisionToolResultSummaryCharactersHint'
  | 'connectionHeading' | 'connectionExplanation' | 'connectionTest' | 'connectionTesting'
  | 'connectionIdle' | 'connectionSuccess' | 'connectionFailure'
  | 'sessionHeading' | 'sessionExplanation' | 'sessionEmpty' | 'sessionCalls'
  | 'sessionSuccesses' | 'sessionFailures' | 'sessionTokens' | 'sessionLatency'
  | 'sessionRefresh' | 'sessionRefreshing'
  | 'sessionFailed'
  | 'privacyHeading' | 'privacyExplanation' | 'fallbackExplanation'
  | 'overridden' | 'reset' | 'readOnly' | 'unavailable' | 'save' | 'saving' | 'saveFailed'
  | 'invalidText' | 'invalidNumber' | 'invalidProbability' | 'invalidMode' | 'invalidNodes'
  | 'invalidEndpoint' | 'invalidCredentialRef' | 'invalidBoolean'

/** English dictionary. */
export const en: Record<DshJevSettingsLocaleKey, string> = {
  summary: 'Configure Jev credentials and request limits.',
  apiKey: 'API key',
  apiKeyHint: 'The key is stored through DSH Credentials and is never read back into this page.',
  apiKeySet: 'Configured',
  apiKeyUnset: 'Not configured',
  apiKeyRef: 'Credential reference',
  apiKeyRefHint: 'Environment-style name used to resolve and store the Jev API key.',
  model: 'Jev model',
  modelHint: 'System One model used for structured decisions.',
  endpoint: 'API endpoint',
  endpointHint: 'Absolute HTTP or HTTPS System One endpoint.',
  timeoutMs: 'Timeout (ms)',
  timeoutMsHint: 'Whole number from 1 to 120000.',
  maxInputBytes: 'Maximum input bytes',
  maxInputBytesHint: 'Whole number from 1 to 10000000.',
  decisionMode: 'Decision guidance mode',
  decisionModeHint: 'Use off to disable automatic Jev calls, shadow to record advice, or advisory to add accepted briefs to the main model request.',
  decisionNodes: 'Critical nodes',
  decisionNodesHint: 'Comma-separated node names eligible for Shadow analysis.',
  decisionCooldownSteps: 'Cooldown steps',
  decisionCooldownStepsHint: 'Number of admitted Agent steps required between automatic Jev calls.',
  decisionMaxCallsPerSession: 'Maximum calls per Session',
  decisionMaxCallsPerSessionHint: 'Maximum automatic Jev calls for one live Agent Session.',
  decisionProgressCheckStep: 'Progress-check step',
  decisionProgressCheckStepHint: 'First step number eligible for stalled-progress analysis.',
  decisionMinimumTaskInputCharacters: 'Task-intake character threshold',
  decisionMinimumTaskInputCharactersHint: 'Input size that can trigger intake analysis without a complexity keyword.',
  decisionMaxInputCharacters: 'Decision input characters',
  decisionMaxInputCharactersHint: 'Maximum Unicode characters copied into one automatic Jev request.',
  decisionMaxOutputTokens: 'Decision output-token limit',
  decisionMaxOutputTokensHint: 'Reject a result when Jev reports more output tokens; the upstream call has already incurred that usage.',
  decisionMinimumConfidence: 'Minimum decision confidence',
  decisionMinimumConfidenceHint: 'Minimum joint action and focus confidence reserved for later Advisory use.',
  decisionIncludeToolResultSummaries: 'Include previous tool-result text',
  decisionIncludeToolResultSummariesHint: 'Use true to send a bounded text-only excerpt from the immediately preceding step. Tool arguments and binary content are never included.',
  decisionToolResultSummaryCharacters: 'Tool-result excerpt characters',
  decisionToolResultSummaryCharactersHint: 'Maximum Unicode characters reserved for the optional previous-step tool-result excerpt.',
  connectionHeading: 'Connection check',
  connectionExplanation: 'Uses the saved endpoint, model, and credential for one small billable Jev request. Save pending edits first. No Agent or Session is created.',
  connectionTest: 'Test connection',
  connectionTesting: 'Testing…',
  connectionIdle: 'Not tested',
  connectionSuccess: 'Connected',
  connectionFailure: 'Connection failed',
  sessionHeading: 'Latest live Session',
  sessionExplanation: 'Content-free local totals for automatic Jev calls observed by this plugin instance.',
  sessionEmpty: 'No live Agent Session has been observed.',
  sessionCalls: 'Calls',
  sessionSuccesses: 'Succeeded',
  sessionFailures: 'Failed',
  sessionTokens: 'Jev tokens',
  sessionLatency: 'Jev latency',
  sessionRefresh: 'Refresh summary',
  sessionRefreshing: 'Refreshing…',
  sessionFailed: 'The local Session summary is currently unavailable.',
  privacyHeading: 'Data and fallback',
  privacyExplanation: 'Automatic guidance sends bounded user text and, only when enabled, bounded text from the previous tool result. Likely credentials suppress task analysis or the affected tool excerpt; saved credentials, tool arguments, and binary blocks are excluded.',
  fallbackExplanation: 'Off makes no automatic calls. Shadow records guidance without changing the main request. Advisory injects only a valid, accepted brief; provider and protocol failures leave the main request unchanged.',
  overridden: 'Overridden',
  reset: 'Reset to default',
  readOnly: 'This deployment stores settings read-only.',
  unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
  save: 'Save',
  saving: 'Saving…',
  saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
  invalidText: 'Enter a value, or reset to use the default.',
  invalidNumber: 'Enter a whole number within the stated range.',
  invalidProbability: 'Enter a number from 0 to 1.',
  invalidMode: 'Enter off, shadow, or advisory.',
  invalidNodes: 'Enter unique supported node names separated by commas.',
  invalidEndpoint: 'Enter an absolute HTTP or HTTPS URL.',
  invalidCredentialRef: 'Use letters, numbers, and underscores, starting with a letter or underscore.',
  invalidBoolean: 'Enter true or false.',
}

/** Simplified Chinese dictionary. */
export const zh: Record<DshJevSettingsLocaleKey, string> = {
  summary: '配置 Jev 凭证和请求限制。',
  apiKey: 'API 密钥',
  apiKeyHint: '密钥通过 DSH Credentials 保存，本页面不会读取密钥原文。',
  apiKeySet: '已配置',
  apiKeyUnset: '未配置',
  apiKeyRef: '凭证引用名',
  apiKeyRefHint: '用于解析和保存 Jev API 密钥的环境变量式名称。',
  model: 'Jev 模型',
  modelHint: '执行结构化决策的 System One 模型。',
  endpoint: 'API 地址',
  endpointHint: 'System One 的 HTTP 或 HTTPS 绝对地址。',
  timeoutMs: '超时时间（毫秒）',
  timeoutMsHint: '填写 1 到 120000 之间的整数。',
  maxInputBytes: '最大输入字节数',
  maxInputBytesHint: '填写 1 到 10000000 之间的整数。',
  decisionMode: '决策增强模式',
  decisionModeHint: 'off 禁止自动调用 Jev；shadow 只记录建议；advisory 把通过校验的简报加入主模型请求。',
  decisionNodes: '关键节点',
  decisionNodesHint: '填写允许进行 Shadow 分析的节点名，以英文逗号分隔。',
  decisionCooldownSteps: '冷却步数',
  decisionCooldownStepsHint: '两次自动 Jev 调用之间必须经过的 Agent step 数量。',
  decisionMaxCallsPerSession: '每个 Session 最大调用数',
  decisionMaxCallsPerSessionHint: '一个在线 Agent Session 允许的自动 Jev 调用上限。',
  decisionProgressCheckStep: '进展检查起始 step',
  decisionProgressCheckStepHint: '允许触发停滞进展分析的第一个 step 编号。',
  decisionMinimumTaskInputCharacters: '任务入口字符阈值',
  decisionMinimumTaskInputCharactersHint: '没有复杂任务关键词时，可触发入口分析的输入长度。',
  decisionMaxInputCharacters: '决策输入字符上限',
  decisionMaxInputCharactersHint: '一次自动 Jev 请求最多复制的 Unicode 字符数。',
  decisionMaxOutputTokens: '决策输出 token 上限',
  decisionMaxOutputTokensHint: 'Jev 报告的输出超过上限时拒绝结果；上游调用此时已经产生用量。',
  decisionMinimumConfidence: '最低决策置信度',
  decisionMinimumConfidenceHint: '为后续 Advisory 使用预留的动作和方向联合置信度下限。',
  decisionIncludeToolResultSummaries: '包含上一步工具结果文本',
  decisionIncludeToolResultSummariesHint: '设为 true 后，可发送紧邻上一步工具结果的有限纯文本摘录；不会包含工具参数或二进制内容。',
  decisionToolResultSummaryCharacters: '工具结果摘录字符上限',
  decisionToolResultSummaryCharactersHint: '为可选的上一步工具结果摘录保留的最大 Unicode 字符数。',
  connectionHeading: '连接测试',
  connectionExplanation: '使用已保存的地址、模型和凭证发起一次小型、可能计费的 Jev 请求。请先保存待处理修改；测试不会创建 Agent 或 Session。',
  connectionTest: '测试连接',
  connectionTesting: '测试中…',
  connectionIdle: '尚未测试',
  connectionSuccess: '连接成功',
  connectionFailure: '连接失败',
  sessionHeading: '最近的在线 Session',
  sessionExplanation: '本插件实例观测到的自动 Jev 调用本地汇总，不含对话内容。',
  sessionEmpty: '尚未观测到在线 Agent Session。',
  sessionCalls: '调用数',
  sessionSuccesses: '成功数',
  sessionFailures: '失败数',
  sessionTokens: 'Jev token',
  sessionLatency: 'Jev 延迟',
  sessionRefresh: '刷新汇总',
  sessionRefreshing: '刷新中…',
  sessionFailed: '当前无法读取本地 Session 汇总。',
  privacyHeading: '数据范围与回退',
  privacyExplanation: '自动增强只发送有限用户文本；仅在明确启用时附带有限的上一步工具结果纯文本。检测到疑似凭证时会跳过任务分析或对应工具摘录；已保存凭证、工具参数和二进制内容不会发送。',
  fallbackExplanation: 'off 不自动调用；shadow 只记录且不改变主请求；advisory 只注入通过校验且被接受的简报。提供方或协议失败时，主请求保持不变。',
  overridden: '已覆盖',
  reset: '恢复默认',
  readOnly: '本部署的设置为只读。',
  unavailable: '该插件当前未加载，暂时无法配置。',
  save: '保存',
  saving: '保存中…',
  saveFailed: '本部署没有接受这些值，已保留供你修改。',
  invalidText: '请输入内容，或恢复默认值。',
  invalidNumber: '请输入指定范围内的整数。',
  invalidProbability: '请输入 0 到 1 之间的数字。',
  invalidMode: '请输入 off、shadow 或 advisory。',
  invalidNodes: '请输入互不重复的受支持节点名，并用英文逗号分隔。',
  invalidEndpoint: '请输入 HTTP 或 HTTPS 绝对地址。',
  invalidCredentialRef: '请使用字母、数字和下划线，并以字母或下划线开头。',
  invalidBoolean: '请输入 true 或 false。',
}

/**
 * Build the shared settings-frame labels from the active dictionary.
 * @param t - Locale reader bound to this page's namespace.
 * @returns Complete labels for `SettingsForm`.
 */
export function formLabels(t: (key: DshJevSettingsLocaleKey) => string): SettingsFormLabels {
  return {
    unavailable: t('unavailable'),
    readOnly: t('readOnly'),
    saveFailed: t('saveFailed'),
    save: t('save'),
    saving: t('saving'),
  }
}
