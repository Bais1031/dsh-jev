/** Plugins-page form for dsh-jev configuration and credential status. */

import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import {
  SettingsForm,
  SettingsSecretField,
  SettingsValueField,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
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
      <Field props={props} state={state} field="routingMode" label="routingMode" hint="routingModeHint" invalid="invalidMode" disabled={disabled} />
      <Field props={props} state={state} field="fallbackPolicy" label="fallbackPolicy" hint="fallbackPolicyHint" invalid="invalidFallback" disabled={disabled} />
      <Field props={props} state={state} field="minimumConfidence" label="minimumConfidence" hint="minimumConfidenceHint" invalid="invalidProbability" disabled={disabled} numeric />
      <Field props={props} state={state} field="minimumMargin" label="minimumMargin" hint="minimumMarginHint" invalid="invalidProbability" disabled={disabled} numeric />
      <Field props={props} state={state} field="endpoint" label="endpoint" hint="endpointHint" invalid="invalidEndpoint" disabled={disabled} />
      <Field props={props} state={state} field="timeoutMs" label="timeoutMs" hint="timeoutMsHint" invalid="invalidNumber" disabled={disabled} numeric />
      <Field props={props} state={state} field="maxInputBytes" label="maxInputBytes" hint="maxInputBytesHint" invalid="invalidNumber" disabled={disabled} numeric />
      <Field props={props} state={state} field="metricsEnabled" label="metricsEnabled" hint="metricsEnabledHint" invalid="invalidBoolean" disabled={disabled} />
    </SettingsForm>
  )
}

type FieldName = Exclude<keyof DshJevConfigCardState, keyof import('@deepseek-ai/dsh-client-ui-primitives').SettingsFormShell
  | 'apiKey' | 'apiKeyConfigured' | 'apiKeyWritable'>

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
