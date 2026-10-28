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
      <Field props={props} state={state} field="decisionMaxOutputTokens" label="decisionMaxOutputTokens" hint="decisionMaxOutputTokensHint" invalid="invalidNumber" disabled={disabled} numeric />
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
              <div><dt>{t('sessionSuccesses')}</dt><dd>{state.latestSessionSummary.successes}</dd></div>
              <div><dt>{t('sessionFailures')}</dt><dd>{state.latestSessionSummary.failures}</dd></div>
              <div><dt>{t('sessionTokens')}</dt><dd>{state.latestSessionSummary.totalTokens}</dd></div>
              <div><dt>{t('sessionLatency')}</dt><dd>{state.latestSessionSummary.totalLatencyMs} ms</dd></div>
            </dl>}
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
