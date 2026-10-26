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
  readonly routingMode?: 'off' | 'shadow' | 'advisory' | 'automatic'
  readonly fallbackPolicy?: 'default-model' | 'user-selection' | 'fail-closed'
  readonly minimumConfidence?: number
  readonly minimumMargin?: number
  readonly timeoutMs?: number
  readonly maxInputBytes?: number
  readonly metricsEnabled?: boolean
  readonly routerMaxInputCharacters?: number
  readonly fastRoute?: { readonly provider: string; readonly model: string }
  readonly standardRoute?: { readonly provider: string; readonly model: string }
  readonly deepRoute?: { readonly provider: string; readonly model: string }
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

/** Complete page snapshot. */
export interface DshJevConfigCardState extends SettingsFormShell {
  readonly apiKey: SettingsFieldState
  readonly apiKeyConfigured: boolean
  readonly apiKeyWritable: boolean
  readonly apiKeyEnv: SettingsFieldState
  readonly endpoint: SettingsFieldState
  readonly model: SettingsFieldState
  readonly routingMode: SettingsFieldState
  readonly fallbackPolicy: SettingsFieldState
  readonly minimumConfidence: SettingsFieldState
  readonly minimumMargin: SettingsFieldState
  readonly timeoutMs: SettingsFieldState
  readonly maxInputBytes: SettingsFieldState
  readonly metricsEnabled: SettingsFieldState
  readonly routerMaxInputCharacters: SettingsFieldState
  readonly fastRoute: SettingsFieldState
  readonly standardRoute: SettingsFieldState
  readonly deepRoute: SettingsFieldState
}

/** Registration-side callbacks and reactive state for the page. */
export interface DshJevConfigCardFace extends SettingsFormActions {
  readonly hooks: {
    readonly dshJevConfigCard: SnapshotStore<DshJevConfigCardState>
  }
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

  /**
   * @param scope - Shared form scope for the dsh-jev Host entry.
   * @param credentials - Non-secret credential reads and one-way writes.
   */
  constructor(
    private readonly scope: SettingsFormScope<DshJevSettings>,
    private readonly credentials: CredentialAccess,
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
      routingMode: this.form.field('routingMode'),
      fallbackPolicy: this.form.field('fallbackPolicy'),
      minimumConfidence: this.form.field('minimumConfidence'),
      minimumMargin: this.form.field('minimumMargin'),
      timeoutMs: this.form.field('timeoutMs'),
      maxInputBytes: this.form.field('maxInputBytes'),
      metricsEnabled: this.form.field('metricsEnabled'),
      routerMaxInputCharacters: this.form.field('routerMaxInputCharacters'),
      fastRoute: this.form.field('fastRoute'),
      standardRoute: this.form.field('standardRoute'),
      deepRoute: this.form.field('deepRoute'),
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
    return { hooks: { dshJevConfigCard: this.store }, ...this.form.actions() }
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
    this.unsubscribe()
    this.form.dispose()
  }
}

function fieldSpecs(): SettingsFieldSpec[] {
  return [
    textField('apiKeyEnv', text => /^[A-Za-z_][A-Za-z0-9_]*$/.test(text)),
    textField('endpoint', text => isHttpUrl(text)),
    textField('model', text => text.length > 0),
    textField('routingMode', text => ['off', 'shadow', 'advisory', 'automatic'].includes(text)),
    textField('fallbackPolicy', text => ['default-model', 'user-selection', 'fail-closed'].includes(text)),
    numberField('minimumConfidence', value => value >= 0 && value <= 1),
    numberField('minimumMargin', value => value >= 0 && value <= 1),
    numberField('timeoutMs', value => Number.isInteger(value) && value >= 1 && value <= 120_000),
    numberField('maxInputBytes', value => Number.isInteger(value) && value >= 1 && value <= 10_000_000),
    numberField('routerMaxInputCharacters', value => Number.isInteger(value) && value >= 1 && value <= 100_000),
    routeField('fastRoute'),
    routeField('standardRoute'),
    routeField('deepRoute'),
    {
      field: 'metricsEnabled',
      format: value => typeof value === 'boolean' ? String(value) : '',
      parse: (text) => {
        const normalized = text.trim().toLowerCase()
        if (normalized === '') return { kind: 'clear' }
        if (normalized === 'true') return { kind: 'set', value: true }
        if (normalized === 'false') return { kind: 'set', value: false }
        return undefined
      },
    },
  ]
}

function routeField(field: string): SettingsFieldSpec {
  return {
    field,
    format: (value) => {
      if (!isRecord(value) || typeof value.provider !== 'string' || typeof value.model !== 'string') return ''
      return `${value.provider}/${value.model}`
    },
    parse: (text) => {
      const normalized = text.trim()
      if (normalized === '') return { kind: 'clear' }
      const separator = normalized.indexOf('/')
      if (separator < 1 || separator === normalized.length - 1) return undefined
      const provider = normalized.slice(0, separator).trim()
      const model = normalized.slice(separator + 1).trim()
      if (provider.length === 0 || model.length === 0) return undefined
      return {
        kind: 'set',
        value: { provider, model },
      }
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
