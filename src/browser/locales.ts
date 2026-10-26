/** Localized copy for the dsh-jev Plugins-page configuration. */

import type { SettingsFormLabels } from '@deepseek-ai/dsh-client-ui-primitives'

/** Locale keys rendered by the dsh-jev configuration page. */
export type DshJevSettingsLocaleKey =
  | 'summary' | 'apiKey' | 'apiKeyHint' | 'apiKeySet' | 'apiKeyUnset'
  | 'apiKeyRef' | 'apiKeyRefHint' | 'model' | 'modelHint'
  | 'routingMode' | 'routingModeHint' | 'fallbackPolicy' | 'fallbackPolicyHint'
  | 'minimumConfidence' | 'minimumConfidenceHint' | 'minimumMargin' | 'minimumMarginHint'
  | 'endpoint' | 'endpointHint' | 'timeoutMs' | 'timeoutMsHint'
  | 'maxInputBytes' | 'maxInputBytesHint' | 'metricsEnabled' | 'metricsEnabledHint'
  | 'overridden' | 'reset' | 'readOnly' | 'unavailable' | 'save' | 'saving' | 'saveFailed'
  | 'invalidText' | 'invalidNumber' | 'invalidProbability' | 'invalidMode'
  | 'invalidFallback' | 'invalidBoolean' | 'invalidEndpoint' | 'invalidCredentialRef'

/** English dictionary. */
export const en: Record<DshJevSettingsLocaleKey, string> = {
  summary: 'Configure Jev credentials, routing policy, thresholds, and request limits.',
  apiKey: 'API key',
  apiKeyHint: 'The key is stored through DSH Credentials and is never read back into this page.',
  apiKeySet: 'Configured',
  apiKeyUnset: 'Not configured',
  apiKeyRef: 'Credential reference',
  apiKeyRefHint: 'Environment-style name used to resolve and store the Jev API key.',
  model: 'Jev model',
  modelHint: 'System One model used for structured decisions.',
  routingMode: 'Routing mode',
  routingModeHint: 'Use off, shadow, advisory, or automatic. Later router stages activate the non-off modes.',
  fallbackPolicy: 'Failure fallback',
  fallbackPolicyHint: 'Use default-model, user-selection, or fail-closed when Jev cannot provide an accepted route.',
  minimumConfidence: 'Minimum confidence',
  minimumConfidenceHint: 'Winning probability from 0 to 1 required before a route can be accepted.',
  minimumMargin: 'Minimum probability gap',
  minimumMarginHint: 'Minimum gap from 0 to 1 between the two highest route probabilities.',
  endpoint: 'API endpoint',
  endpointHint: 'Absolute HTTP or HTTPS System One endpoint.',
  timeoutMs: 'Timeout (ms)',
  timeoutMsHint: 'Whole number from 1 to 120000.',
  maxInputBytes: 'Maximum input bytes',
  maxInputBytesHint: 'Whole number from 1 to 10000000.',
  metricsEnabled: 'Metrics enabled',
  metricsEnabledHint: 'Use true or false. Metrics never store the API key.',
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
  invalidMode: 'Enter off, shadow, advisory, or automatic.',
  invalidFallback: 'Enter default-model, user-selection, or fail-closed.',
  invalidBoolean: 'Enter true or false.',
  invalidEndpoint: 'Enter an absolute HTTP or HTTPS URL.',
  invalidCredentialRef: 'Use letters, numbers, and underscores, starting with a letter or underscore.',
}

/** Simplified Chinese dictionary. */
export const zh: Record<DshJevSettingsLocaleKey, string> = {
  summary: '配置 Jev 凭证、路由策略、阈值和请求限制。',
  apiKey: 'API 密钥',
  apiKeyHint: '密钥通过 DSH Credentials 保存，本页面不会读取密钥原文。',
  apiKeySet: '已配置',
  apiKeyUnset: '未配置',
  apiKeyRef: '凭证引用名',
  apiKeyRefHint: '用于解析和保存 Jev API 密钥的环境变量式名称。',
  model: 'Jev 模型',
  modelHint: '执行结构化决策的 System One 模型。',
  routingMode: '路由模式',
  routingModeHint: '可填 off、shadow、advisory 或 automatic；后续路由阶段会启用非 off 模式。',
  fallbackPolicy: '失败回退策略',
  fallbackPolicyHint: 'Jev 无法给出可接受路线时，可填 default-model、user-selection 或 fail-closed。',
  minimumConfidence: '最低置信度',
  minimumConfidenceHint: '接受路线所需的胜出概率，范围为 0 到 1。',
  minimumMargin: '最低概率差',
  minimumMarginHint: '最高两个路线概率之间所需的最小差值，范围为 0 到 1。',
  endpoint: 'API 地址',
  endpointHint: 'System One 的 HTTP 或 HTTPS 绝对地址。',
  timeoutMs: '超时时间（毫秒）',
  timeoutMsHint: '填写 1 到 120000 之间的整数。',
  maxInputBytes: '最大输入字节数',
  maxInputBytesHint: '填写 1 到 10000000 之间的整数。',
  metricsEnabled: '启用指标',
  metricsEnabledHint: '填写 true 或 false；指标不会保存 API 密钥。',
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
  invalidMode: '请输入 off、shadow、advisory 或 automatic。',
  invalidFallback: '请输入 default-model、user-selection 或 fail-closed。',
  invalidBoolean: '请输入 true 或 false。',
  invalidEndpoint: '请输入 HTTP 或 HTTPS 绝对地址。',
  invalidCredentialRef: '请使用字母、数字和下划线，并以字母或下划线开头。',
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
