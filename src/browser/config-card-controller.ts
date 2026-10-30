/** Staged settings and credential-status controller for the dsh-jev configuration page. */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import {
  SettingsFormModel,
  type SettingsFieldSpec,
  type SettingsFieldState,
  type SettingsFormActions,
  type SettingsFormScope,
  type SettingsFormShell,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { JevConnectionTestResult, JevLatestSessionSummary } from '../remote.js'

/** Host settings namespace and bundle row id owned by this plugin. */
export const DSH_JEV_NAMESPACE = 'dsh-jev'
/** Credential reference used when configuration does not declare one. */
export const DEFAULT_API_KEY_REF = 'JEV_API_KEY'
const API_KEY_FIELD = 'apiKey'

/** Settings edited by the Plugins-page configuration. */
export interface DshJevSettings {
  readonly apiKeyEnv?: string
  readonly endpoint?: string
  readonly model?: string
  readonly timeoutMs?: number
  readonly maxInputBytes?: number
  readonly decisionMode?: 'off' | 'shadow' | 'advisory'
  readonly decisionNodes?: string[]
  readonly decisionCooldownSteps?: number
  readonly decisionMaxCallsPerSession?: number
  readonly decisionProgressCheckStep?: number
  readonly decisionMinimumTaskInputCharacters?: number
  readonly decisionMaxInputCharacters?: number
  readonly decisionDeadlineMs?: number
  readonly decisionMinimumConfidence?: number
  readonly decisionIncludeToolResultSummaries?: boolean
  readonly decisionToolResultSummaryCharacters?: number
}

/** Non-secret credential information returned to the page. */
export interface CredentialView {
  readonly configured: boolean
  readonly writable: boolean
}

/** Narrow credential operations used by the controller. */
export interface CredentialAccess {
  /** @param refs - Credential references to describe. @returns Non-secret status per reference. */
  describe(refs: string[]): Promise<{ readonly ok: boolean; readonly value?: Readonly<Record<string, CredentialView>> }>
  /** @param ref - Credential reference. @param value - New secret literal. @returns Host acceptance result. */
  set(ref: string, value: string): Promise<{ readonly ok: boolean }>
}

/** Safe Host operations exposed to this page. */
export interface DecisionStatusAccess {
  /** @returns One billable endpoint check using the saved settings and credential. */
  testConnection(): Promise<JevConnectionTestResult>
  /** @returns Content-free totals for the latest live Session, if one has been observed. */
  latestSessionSummary(): Promise<JevLatestSessionSummary | null>
}

/** Current state of the explicit connection check. */
export type ConnectionTestState =
  | { readonly status: 'idle' }
  | { readonly status: 'testing' }
  | { readonly status: 'success'; readonly model: string; readonly latencyMs: number }
  | { readonly status: 'failure'; readonly code: string; readonly retryable: boolean }

/** Complete page snapshot. */
export interface DshJevConfigCardState extends SettingsFormShell {
  readonly apiKey: SettingsFieldState
  readonly apiKeyConfigured: boolean
  readonly apiKeyWritable: boolean
  readonly apiKeyEnv: SettingsFieldState
  readonly endpoint: SettingsFieldState
  readonly model: SettingsFieldState
  readonly timeoutMs: SettingsFieldState
  readonly maxInputBytes: SettingsFieldState
  readonly decisionMode: SettingsFieldState
  readonly decisionNodes: SettingsFieldState
  readonly decisionCooldownSteps: SettingsFieldState
  readonly decisionMaxCallsPerSession: SettingsFieldState
  readonly decisionProgressCheckStep: SettingsFieldState
  readonly decisionMinimumTaskInputCharacters: SettingsFieldState
  readonly decisionMaxInputCharacters: SettingsFieldState
  readonly decisionDeadlineMs: SettingsFieldState
  readonly decisionMinimumConfidence: SettingsFieldState
  readonly decisionIncludeToolResultSummaries: SettingsFieldState
  readonly decisionToolResultSummaryCharacters: SettingsFieldState
  readonly connectionTest: ConnectionTestState
  readonly latestSessionSummary: JevLatestSessionSummary | null
  readonly summaryLoading: boolean
  readonly summaryFailed: boolean
}

/** Registration-side callbacks and reactive state for the page. */
export interface DshJevConfigCardFace extends SettingsFormActions {
  readonly hooks: {
    readonly dshJevConfigCard: SnapshotStore<DshJevConfigCardState>
  }
  testConnection(): void
  refreshSummary(): void
}

interface CredentialState extends CredentialView {
  readonly ref: string
}

/** Bridges one Host configuration scope and the Credentials Remote namespace onto the page. */
export class DshJevConfigCardController {
  private readonly form: SettingsFormModel<DshJevSettings>
  private readonly store: SnapshotStore<DshJevConfigCardState>
  private readonly unsubscribe: () => void
  private credential: CredentialState = { ref: '', configured: false, writable: true }
  private disposed = false
  private connectionGeneration = 0
  private summaryGeneration = 0
  private connectionTest: ConnectionTestState = { status: 'idle' }
  private latestSessionSummary: JevLatestSessionSummary | null = null
  private summaryLoading = false
  private summaryFailed = false

  /**
   * @param scope - Shared form scope for the dsh-jev Host entry.
   * @param credentials - Non-secret credential reads and one-way writes.
   */
  constructor(
    private readonly scope: SettingsFormScope<DshJevSettings>,
    private readonly credentials: CredentialAccess,
    private readonly status: DecisionStatusAccess,
  ) {
    this.form = new SettingsFormModel(scope, fieldSpecs(), [{
      field: API_KEY_FIELD,
      write: async value => await this.writeKey(value),
    }])
    this.store = this.form.bind(() => this.projection())
    this.unsubscribe = scope.subscribe(() => {
      if (this.ref() !== this.credential.ref) void this.readCredential()
    })
    void this.readCredential()
  }

  private projection(): DshJevConfigCardState {
    return {
      ...this.form.shell(),
      apiKey: this.form.field(API_KEY_FIELD),
      apiKeyConfigured: this.credential.configured,
      apiKeyWritable: this.credential.writable,
      apiKeyEnv: this.form.field('apiKeyEnv'),
      endpoint: this.form.field('endpoint'),
      model: this.form.field('model'),
      timeoutMs: this.form.field('timeoutMs'),
      maxInputBytes: this.form.field('maxInputBytes'),
      decisionMode: this.form.field('decisionMode'),
      decisionNodes: this.form.field('decisionNodes'),
      decisionCooldownSteps: this.form.field('decisionCooldownSteps'),
      decisionMaxCallsPerSession: this.form.field('decisionMaxCallsPerSession'),
      decisionProgressCheckStep: this.form.field('decisionProgressCheckStep'),
      decisionMinimumTaskInputCharacters: this.form.field('decisionMinimumTaskInputCharacters'),
      decisionMaxInputCharacters: this.form.field('decisionMaxInputCharacters'),
      decisionDeadlineMs: this.form.field('decisionDeadlineMs'),
      decisionMinimumConfidence: this.form.field('decisionMinimumConfidence'),
      decisionIncludeToolResultSummaries: this.form.field('decisionIncludeToolResultSummaries'),
      decisionToolResultSummaryCharacters: this.form.field('decisionToolResultSummaryCharacters'),
      connectionTest: this.connectionTest,
      latestSessionSummary: this.latestSessionSummary,
      summaryLoading: this.summaryLoading,
      summaryFailed: this.summaryFailed,
    }
  }

  private ref(): string {
    const value = this.scope.getSnapshot().value?.apiKeyEnv
    return value !== undefined && value.length > 0 ? value : DEFAULT_API_KEY_REF
  }

  private async readCredential(): Promise<void> {
    const ref = this.ref()
    if (ref !== this.credential.ref) {
      this.credential = { ref, configured: false, writable: true }
      this.store.set(this.projection())
    }
    const response = await this.credentials.describe([ref])
    if (this.disposed || !response.ok || ref !== this.ref()) return
    const view = response.value?.[ref]
    const next: CredentialState = {
      ref,
      configured: view?.configured ?? false,
      writable: view?.writable ?? true,
    }
    if (next.configured === this.credential.configured && next.writable === this.credential.writable) return
    this.credential = next
    this.store.set(this.projection())
  }

  /**
   * Re-read status when the Host reports a write to the watched reference.
   * @param ref - Reference named by the Host event.
   */
  refreshCredential(ref: string): void {
    if (ref === this.credential.ref) void this.readCredential()
  }

  /** @returns Reactive state and staged-form actions for slot injection. */
  inject(): DshJevConfigCardFace {
    return {
      hooks: { dshJevConfigCard: this.store },
      ...this.form.actions(),
      testConnection: () => { void this.runConnectionTest() },
      refreshSummary: () => { void this.readSummary() },
    }
  }

  private async runConnectionTest(): Promise<void> {
    if (this.disposed || this.connectionTest.status === 'testing') return
    const generation = ++this.connectionGeneration
    this.connectionTest = { status: 'testing' }
    this.store.set(this.projection())
    let result: JevConnectionTestResult
    try {
      result = await this.status.testConnection()
    } catch (_error) {
      result = { ok: false, code: 'CLIENT_REMOTE_UNAVAILABLE', retryable: false }
    }
    if (this.disposed || generation !== this.connectionGeneration) return
    this.connectionTest = result.ok
      ? { status: 'success', model: result.model, latencyMs: result.latencyMs }
      : { status: 'failure', code: result.code, retryable: result.retryable }
    this.store.set(this.projection())
  }

  private async readSummary(): Promise<void> {
    if (this.disposed || this.summaryLoading) return
    const generation = ++this.summaryGeneration
    this.summaryLoading = true
    this.summaryFailed = false
    this.store.set(this.projection())
    try {
      const result = await this.status.latestSessionSummary()
      if (this.disposed || generation !== this.summaryGeneration) return
      this.latestSessionSummary = result
    } catch (_error) {
      if (this.disposed || generation !== this.summaryGeneration) return
      this.summaryFailed = true
    }
    this.summaryLoading = false
    this.store.set(this.projection())
  }

  private async writeKey(value: string): Promise<boolean> {
    const ref = this.ref()
    const result = await this.credentials.set(ref, value)
    if (!result.ok || this.disposed) return false
    await this.readCredential()
    return this.credential.ref === ref && this.credential.configured
  }

  /** Stop subscriptions and prevent pending remote reads from publishing. */
  dispose(): void {
    this.disposed = true
    this.connectionGeneration += 1
    this.summaryGeneration += 1
    this.unsubscribe()
    this.form.dispose()
  }
}

function fieldSpecs(): SettingsFieldSpec[] {
  return [
    textField('apiKeyEnv', text => /^[A-Za-z_][A-Za-z0-9_]*$/.test(text)),
    textField('endpoint', text => isHttpUrl(text)),
    textField('model', text => text.length > 0),
    numberField('timeoutMs', value => Number.isInteger(value) && value >= 1 && value <= 120_000),
    numberField('maxInputBytes', value => Number.isInteger(value) && value >= 1 && value <= 10_000_000),
    textField('decisionMode', text => ['off', 'shadow', 'advisory'].includes(text)),
    listField('decisionNodes', new Set([
      'task-intake', 'missing-information', 'direction-selection', 'tool-recovery', 'progress-check', 'pre-conclusion',
    ])),
    numberField('decisionCooldownSteps', value => Number.isInteger(value) && value >= 0 && value <= 100),
    numberField('decisionMaxCallsPerSession', value => Number.isInteger(value) && value >= 1 && value <= 1_000),
    numberField('decisionProgressCheckStep', value => Number.isInteger(value) && value >= 2 && value <= 1_000),
    numberField('decisionMinimumTaskInputCharacters', value => Number.isInteger(value) && value >= 1 && value <= 100_000),
    numberField('decisionMaxInputCharacters', value => Number.isInteger(value) && value >= 1 && value <= 100_000),
    numberField('decisionDeadlineMs', value => Number.isInteger(value) && value >= 1 && value <= 120_000),
    numberField('decisionMinimumConfidence', value => value >= 0 && value <= 1),
    booleanField('decisionIncludeToolResultSummaries'),
    numberField('decisionToolResultSummaryCharacters', value => Number.isInteger(value) && value >= 1 && value <= 100_000),
  ]
}

function booleanField(field: string): SettingsFieldSpec {
  return {
    field,
    format: value => value === true ? 'true' : value === false ? 'false' : '',
    parse: (text) => {
      const normalized = text.trim().toLowerCase()
      if (normalized === '') return { kind: 'clear' }
      if (normalized === 'true') return { kind: 'set', value: true }
      if (normalized === 'false') return { kind: 'set', value: false }
      return undefined
    },
  }
}

function listField(field: string, allowed: ReadonlySet<string>): SettingsFieldSpec {
  return {
    field,
    format: value => Array.isArray(value) && value.every(item => typeof item === 'string') ? value.join(', ') : '',
    parse: (text) => {
      const values = text.split(',').map(value => value.trim()).filter(value => value.length > 0)
      if (values.length === 0) return { kind: 'clear' }
      if (new Set(values).size !== values.length || values.some(value => !allowed.has(value))) return undefined
      return { kind: 'set', value: values }
    },
  }
}

function textField(field: string, accepts: (text: string) => boolean): SettingsFieldSpec {
  return {
    field,
    format: value => typeof value === 'string' ? value : '',
    parse: (text) => {
      const normalized = text.trim()
      if (normalized === '') return { kind: 'clear' }
      return accepts(normalized) ? { kind: 'set', value: normalized } : undefined
    },
  }
}

function numberField(field: string, accepts: (value: number) => boolean): SettingsFieldSpec {
  return {
    field,
    format: value => typeof value === 'number' ? String(value) : '',
    parse: (text) => {
      const normalized = text.trim()
      if (normalized === '') return { kind: 'clear' }
      const value = Number(normalized)
      return Number.isFinite(value) && accepts(value) ? { kind: 'set', value } : undefined
    },
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch (_error) {
    return false
  }
}
