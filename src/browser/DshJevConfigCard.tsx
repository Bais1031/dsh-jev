/** Plugins-page form for dsh-jev configuration and credential status. */

import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import {
  Button,
  SettingsForm,
  SettingsSecretField,
  SettingsValueField,
  StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { CSSProperties } from 'react'
import type { DshJevConfigCardFace, DshJevConfigCardState } from './config-card-controller.js'
import { formLabels, type DshJevSettingsLocaleKey } from './locales.js'

/** Props supplied by the slot renderer. */
export type DshJevConfigCardProps =
  PropsRuntime<'plugins.row.config'>
  & PropsLocale<'dshJev.settings'>
  & InjectFace<DshJevConfigCardFace>

/**
 * Render the row summary or its staged configuration form.
 * @param props - Slot view, localized copy, reactive state, and form actions.
 * @returns Summary text or a settings form.
 */
export function DshJevConfigCard(props: DshJevConfigCardProps) {
  const { t } = props
  const state = props.useDshJevConfigCard(snapshot => snapshot)
  if (props.view === 'summary') return t('summary')
  const disabled = !state.writable || state.saving
  return (
    <SettingsForm labels={formLabels(t)} state={state} onSave={props.save} onDiscard={props.discard}>
      <SettingsSecretField
        id="plugin-config-dsh-jev-api-key"
        label={t('apiKey')}
        hint={t('apiKeyHint')}
        disabled={!state.apiKeyWritable || state.saving}
        text={state.apiKey.text}
        configured={state.apiKeyConfigured}
        stateLabel={state.apiKeyConfigured ? t('apiKeySet') : t('apiKeyUnset')}
        onEdit={text => { props.edit('apiKey', text) }}
      />
      <Field props={props} state={state} field="apiKeyEnv" label="apiKeyRef" hint="apiKeyRefHint" invalid="invalidCredentialRef" disabled={disabled} />
      <Field props={props} state={state} field="model" label="model" hint="modelHint" invalid="invalidText" disabled={disabled} />
      <Field props={props} state={state} field="endpoint" label="endpoint" hint="endpointHint" invalid="invalidEndpoint" disabled={disabled} />
      <Field props={props} state={state} field="timeoutMs" label="timeoutMs" hint="timeoutMsHint" invalid="invalidNumber" disabled={disabled} numeric />
      <Field props={props} state={state} field="maxInputBytes" label="maxInputBytes" hint="maxInputBytesHint" invalid="invalidNumber" disabled={disabled} numeric />
      <Field props={props} state={state} field="decisionMode" label="decisionMode" hint="decisionModeHint" invalid="invalidMode" disabled={disabled} />
      <Field props={props} state={state} field="decisionNodes" label="decisionNodes" hint="decisionNodesHint" invalid="invalidNodes" disabled={disabled} />
      <Field props={props} state={state} field="decisionCooldownSteps" label="decisionCooldownSteps" hint="decisionCooldownStepsHint" invalid="invalidNumber" disabled={disabled} numeric />
      <Field props={props} state={state} field="decisionMaxCallsPerSession" label="decisionMaxCallsPerSession" hint="decisionMaxCallsPerSessionHint" invalid="invalidNumber" disabled={disabled} numeric />
      <Field props={props} state={state} field="decisionProgressCheckStep" label="decisionProgressCheckStep" hint="decisionProgressCheckStepHint" invalid="invalidNumber" disabled={disabled} numeric />
      <Field props={props} state={state} field="decisionMinimumTaskInputCharacters" label="decisionMinimumTaskInputCharacters" hint="decisionMinimumTaskInputCharactersHint" invalid="invalidNumber" disabled={disabled} numeric />
      <Field props={props} state={state} field="decisionMaxInputCharacters" label="decisionMaxInputCharacters" hint="decisionMaxInputCharactersHint" invalid="invalidNumber" disabled={disabled} numeric />
      <Field props={props} state={state} field="decisionDeadlineMs" label="decisionDeadlineMs" hint="decisionDeadlineMsHint" invalid="invalidNumber" disabled={disabled} numeric />
      <Field props={props} state={state} field="decisionMinimumConfidence" label="decisionMinimumConfidence" hint="decisionMinimumConfidenceHint" invalid="invalidProbability" disabled={disabled} numeric />
      <Field props={props} state={state} field="decisionIncludeToolResultSummaries" label="decisionIncludeToolResultSummaries" hint="decisionIncludeToolResultSummariesHint" invalid="invalidBoolean" disabled={disabled} />
      <Field props={props} state={state} field="decisionToolResultSummaryCharacters" label="decisionToolResultSummaryCharacters" hint="decisionToolResultSummaryCharactersHint" invalid="invalidNumber" disabled={disabled} numeric />
      <section style={styles.section} aria-labelledby="dsh-jev-connection-heading">
        <h3 id="dsh-jev-connection-heading" style={styles.heading}>{t('connectionHeading')}</h3>
        <p style={styles.explanation}>{t('connectionExplanation')}</p>
        <div style={styles.actionRow}>
          <Button
            variant="outline"
            size="sm"
            disabled={state.connectionTest.status === 'testing' || state.dirty}
            onClick={props.testConnection}
          >{state.connectionTest.status === 'testing' ? t('connectionTesting') : t('connectionTest')}</Button>
          <ConnectionStatus state={state} t={t} />
        </div>
      </section>
      <section style={styles.section} aria-labelledby="dsh-jev-session-heading">
        <h3 id="dsh-jev-session-heading" style={styles.heading}>{t('sessionHeading')}</h3>
        <p style={styles.explanation}>{t('sessionExplanation')}</p>
        {state.summaryFailed
          ? <p style={styles.statusText} role="alert">{t('sessionFailed')}</p>
          : state.latestSessionSummary === null
          ? <p style={styles.statusText} role="status">{t('sessionEmpty')}</p>
          : <dl style={styles.metrics}>
              <div><dt>{t('sessionCalls')}</dt><dd>{state.latestSessionSummary.calls}</dd></div>
              <div><dt>{t('sessionProviderSuccesses')}</dt><dd>{state.latestSessionSummary.providerSuccesses}</dd></div>
              <div><dt>{t('sessionValidBriefs')}</dt><dd>{state.latestSessionSummary.validBriefs}</dd></div>
              <div><dt>{t('sessionInjectedAdvisories')}</dt><dd>{state.latestSessionSummary.injectedAdvisories}</dd></div>
              <div><dt>{t('sessionFailures')}</dt><dd>{state.latestSessionSummary.failures}</dd></div>
              <div><dt>{t('sessionTokens')}</dt><dd>{state.latestSessionSummary.totalTokens}</dd></div>
              <div><dt>{t('sessionLatency')}</dt><dd>{state.latestSessionSummary.totalLatencyMs} ms</dd></div>
            </dl>}
        {state.latestSessionSummary?.latestCall === undefined || state.latestSessionSummary.latestCall === null
          ? null
          : <LatestCall call={state.latestSessionSummary.latestCall} t={t} />}
        {state.latestSessionSummary === null || state.latestSessionSummary.latestFailure === null
          ? null
          : <LatestFailure failure={state.latestSessionSummary.latestFailure} t={t} />}
        <Button variant="outline" size="sm" disabled={state.summaryLoading} onClick={props.refreshSummary}>
          {state.summaryLoading ? t('sessionRefreshing') : t('sessionRefresh')}
        </Button>
      </section>
      <section style={styles.section} aria-labelledby="dsh-jev-privacy-heading">
        <h3 id="dsh-jev-privacy-heading" style={styles.heading}>{t('privacyHeading')}</h3>
        <p style={styles.explanation}>{t('privacyExplanation')}</p>
        <p style={styles.explanation}>{t('fallbackExplanation')}</p>
      </section>
    </SettingsForm>
  )
}

function LatestCall({ call, t }: {
  call: NonNullable<NonNullable<DshJevConfigCardState['latestSessionSummary']>['latestCall']>
  t: (key: DshJevSettingsLocaleKey) => string
}) {
  const status = {
    pending: 'callStatusPending',
    success: 'callStatusSuccess',
    failure: 'callStatusFailure',
  } as const
  const briefStatus = {
    pending: 'briefStatusPending',
    injected: 'briefStatusInjected',
    'shadow-only': 'briefStatusShadowOnly',
    'below-confidence': 'briefStatusBelowConfidence',
    invalid: 'briefStatusInvalid',
    unavailable: 'briefStatusUnavailable',
  } as const
  const state = call.status === 'pending' ? 'ongoing' : call.status === 'success' ? 'done' : 'error'
  return (
    <p style={styles.statusText} role="status">
      <span style={styles.status}>
        <StateDot state={state} />
        <span>
          {t('sessionLatestCall')}: {t(status[call.status])} · {t('sessionMode')}: {call.mode} · {t('sessionTurn')}: {call.turn}
          <br />
          {t('sessionJevResponse')}: {call.responseReceived ? t('sessionResponseReceived') : t('sessionNoResponse')}
          {' · '}{t('sessionBrief')}: {t(briefStatus[call.briefStatus])}
          {call.reason === null ? null : <> · {t('sessionReason')}: {reasonText(call.reason, t)} (<code>{call.reason}</code>)</>}
          {call.confidence === null ? null : <> · {t('sessionConfidence')}: {call.confidence.toFixed(3)}</>}
          {call.minimumConfidence === null ? null : <> · {t('sessionThreshold')}: {call.minimumConfidence.toFixed(3)}</>}
          {call.code === null ? null : <> · <code>{call.code}</code></>}
        </span>
      </span>
    </p>
  )
}

function reasonText(reason: string, t: (key: DshJevSettingsLocaleKey) => string): string {
  const reasons: Readonly<Record<string, DshJevSettingsLocaleKey>> = {
    'confidence-below-threshold': 'reasonConfidenceBelowThreshold',
    'invalid-result': 'reasonInvalidResult',
    deadline: 'reasonDeadline',
    'provider-failure': 'reasonProviderFailure',
    cancelled: 'reasonCancelled',
    'shadow-mode': 'reasonShadowMode',
    unexpected: 'reasonUnexpected',
  }
  const key = reasons[reason]
  return key === undefined ? reason : t(key)
}

function LatestFailure({ failure, t }: {
  failure: NonNullable<NonNullable<DshJevConfigCardState['latestSessionSummary']>['latestFailure']>
  t: (key: DshJevSettingsLocaleKey) => string
}) {
  const stage = {
    provider: 'failureStageProvider',
    deadline: 'failureStageDeadline',
    cancellation: 'failureStageCancellation',
    projection: 'failureStageProjection',
    unexpected: 'failureStageUnexpected',
    unknown: 'failureStageUnknown',
  } as const
  return (
    <p style={styles.statusText} role="alert">
      <span style={styles.status}>
        <StateDot state="error" />
        <span>
          {t(failure.followedBySuccess ? 'sessionHistoricalFailure' : 'sessionLatestFailure')}: <code>{failure.code}</code>
          {failure.turn === undefined ? null : <> · {t('sessionTurn')}: {failure.turn}</>}
          {failure.providerCode === undefined ? null : <> · <code>{failure.providerCode}</code></>}
          {' · '}{t('sessionFailureStage')}: {t(stage[failure.stage])}
          {' · '}{failure.responseReceived ? t('sessionResponseReceived') : t('sessionNoResponse')}
          {failure.latencyMs === undefined ? null : <> · {failure.latencyMs} ms</>}
          {failure.followedBySuccess ? <> · {t('sessionFollowedBySuccess')}</> : null}
        </span>
      </span>
    </p>
  )
}

function ConnectionStatus({ state, t }: {
  state: DshJevConfigCardState
  t: (key: DshJevSettingsLocaleKey) => string
}) {
  const result = state.connectionTest
  if (result.status === 'idle') return <span style={styles.status}><StateDot state="idle" />{t('connectionIdle')}</span>
  if (result.status === 'testing') return <span style={styles.status} role="status"><StateDot state="ongoing" />{t('connectionTesting')}</span>
  if (result.status === 'success') {
    return <span style={styles.status} role="status"><StateDot state="done" />{t('connectionSuccess')} · {result.model} · {result.latencyMs} ms</span>
  }
  return <span style={styles.status} role="alert"><StateDot state="error" />{t('connectionFailure')} · {result.code}</span>
}

const styles = {
  section: {
    minWidth: 0,
    padding: '16px 0',
    borderBottom: '0.5px solid var(--dsw-alias-border-l2)',
  },
  heading: {
    margin: 0,
    color: 'var(--dsw-alias-label-primary)',
    fontSize: 14,
    lineHeight: '20px',
  },
  explanation: {
    margin: '4px 0 0',
    color: 'var(--dsw-alias-label-secondary)',
    fontSize: 12,
    lineHeight: '18px',
    overflowWrap: 'anywhere',
  },
  statusText: {
    margin: '8px 0',
    color: 'var(--dsw-alias-label-secondary)',
    fontSize: 12,
    lineHeight: '18px',
  },
  actionRow: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 8,
    marginTop: 12,
  },
  status: {
    display: 'inline-flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 8,
    color: 'var(--dsw-alias-label-secondary)',
    fontSize: 12,
    lineHeight: '18px',
    overflowWrap: 'anywhere',
  },
  metrics: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(104px, 1fr))',
    gap: 8,
    margin: '12px 0',
  },
} satisfies Record<string, CSSProperties>

type FieldName = Exclude<keyof DshJevConfigCardState, keyof import('@deepseek-ai/dsh-client-ui-primitives').SettingsFormShell
  | 'apiKey' | 'apiKeyConfigured' | 'apiKeyWritable' | 'connectionTest' | 'latestSessionSummary' | 'summaryLoading' | 'summaryFailed'>

function Field({ props, state, field, label, hint, invalid, disabled, numeric = false }: {
  props: DshJevConfigCardProps
  state: DshJevConfigCardState
  field: FieldName
  label: DshJevSettingsLocaleKey
  hint: DshJevSettingsLocaleKey
  invalid: DshJevSettingsLocaleKey
  disabled: boolean
  numeric?: boolean
}) {
  return (
    <SettingsValueField
      id={`plugin-config-dsh-jev-${field}`}
      label={props.t(label)}
      hint={props.t(hint)}
      overriddenLabel={props.t('overridden')}
      resetLabel={props.t('reset')}
      invalidLabel={props.t(invalid)}
      disabled={disabled}
      numeric={numeric}
      {...state[field]}
      onEdit={text => { props.edit(field, text) }}
      onReset={() => { props.resetField(field) }}
    />
  )
}
