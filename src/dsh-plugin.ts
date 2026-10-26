/** Cordis service, Jev provider, credentials adapter, and tool registration for DeepSeek Harness. */
import { Context, Service } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import z from '@deepseek-ai/schemastery'
import { JevClient } from './client.js'
import { DecisionError } from './decision-errors.js'
import { DecisionService } from './decision-service.js'
import { decisionProviderName } from './decision-types.js'
import type {
  DecisionCallOptions,
  DecisionProvider,
  DecisionRequest,
  DecisionResult,
} from './decision-types.js'
import { createJevDecisionTool } from './dsh-tool.js'
import { JevDecisionProvider } from './jev-provider.js'

const DEFAULT_API_KEY_REF = 'JEV_API_KEY'
const DEFAULT_ENDPOINT = 'https://api.typesafe.ai/v1/systemone'
const DEFAULT_MODEL = 'jev-latest'
const DEFAULT_PROVIDER = 'jev'
const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_MAX_INPUT_BYTES = 1_000_000
const DEFAULT_ROUTING_MODE = 'off'
const DEFAULT_FALLBACK_POLICY = 'default-model'
const DEFAULT_MINIMUM_CONFIDENCE = 0.85
const DEFAULT_MINIMUM_MARGIN = 0.2
const DEFAULT_METRICS_ENABLED = true

/** User-selected router operating mode. */
export type RoutingMode = 'off' | 'shadow' | 'advisory' | 'automatic'

/** Route used when Jev cannot return an acceptable decision. */
export type FallbackPolicy = 'default-model' | 'user-selection' | 'fail-closed'

/** DSH plugin configuration. Every deployment-varying transport choice is configurable. */
export interface Config {
  /** Credential reference resolved from `ctx.credentials` for every operation. */
  readonly apiKeyEnv?: string
  /** Absolute TypeSafe System One endpoint. */
  readonly endpoint?: string
  /** Default Jev model sent when a tool request omits `model`. */
  readonly model?: string
  /** Decision provider name registered in `ctx.decisions`. */
  readonly providerName?: string
  /** HTTP request timeout in milliseconds. */
  readonly timeoutMs?: number
  /** Maximum serialized request size in UTF-8 bytes. */
  readonly maxInputBytes?: number
  /** Router operating mode. Later stages consume modes other than `off`. */
  readonly routingMode?: RoutingMode
  /** Route used when Jev is unavailable or below an acceptance threshold. */
  readonly fallbackPolicy?: FallbackPolicy
  /** Minimum winning probability required for an accepted route. */
  readonly minimumConfidence?: number
  /** Minimum gap between the two highest route probabilities. */
  readonly minimumMargin?: number
  /** Whether the router records aggregate decision metrics. */
  readonly metricsEnabled?: boolean
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    decisions: DshDecisionService
  }
}

/** Cordis configuration schema used by Loader and future plugin settings UI. */
export const Config: z<Config> = z.object({
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_REF),
  endpoint: z.string().default(DEFAULT_ENDPOINT),
  model: z.string().default(DEFAULT_MODEL),
  providerName: z.string().default(DEFAULT_PROVIDER),
  timeoutMs: z.natural().min(1).default(DEFAULT_TIMEOUT_MS),
  maxInputBytes: z.natural().min(1).default(DEFAULT_MAX_INPUT_BYTES),
  routingMode: z.union(['off', 'shadow', 'advisory', 'automatic'] as const).default(DEFAULT_ROUTING_MODE),
  fallbackPolicy: z.union(['default-model', 'user-selection', 'fail-closed'] as const).default(DEFAULT_FALLBACK_POLICY),
  minimumConfidence: z.number().min(0).max(1).default(DEFAULT_MINIMUM_CONFIDENCE),
  minimumMargin: z.number().min(0).max(1).default(DEFAULT_MINIMUM_MARGIN),
  metricsEnabled: z.boolean().default(DEFAULT_METRICS_ENABLED),
})

/** Cordis-owned decision capability with one default Jev provider and the `jev_decide` tool. */
export class DshDecisionService extends Service {
  static inject = ['credentials', 'tools']
  static Config = Config

  private readonly decisions: DecisionService
  private readonly lifecycle = new AbortController()
  private readonly operations = new Set<Promise<DecisionResult>>()

  /**
   * Publish `ctx.decisions`, register Jev, and contribute the model-facing tool.
   * @param ctx - Plugin context carrying credentials and tool registries.
   * @param config - Endpoint, model, credential reference, and request limits.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'decisions')
    const apiKeyRef = credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_REF)
    const providerName = decisionProviderName(config.providerName ?? DEFAULT_PROVIDER)
    this.decisions = new DecisionService({ defaultProvider: providerName })
    const provider = new JevDecisionProvider({
      name: providerName,
      client: new JevClient({
        endpoint: config.endpoint ?? DEFAULT_ENDPOINT,
        model: config.model ?? DEFAULT_MODEL,
        timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxInputBytes: config.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES,
      }),
      resolveApiKey: async () => (await ctx.credentials.resolve(apiKeyRef))?.value,
    })

    this.registerProvider(provider)
    ctx.tools.register(createJevDecisionTool(this, { apiKeyRef }))
    ctx.effect(() => async () => {
      this.lifecycle.abort(new Error('dsh-jev service disposed'))
      await Promise.allSettled([...this.operations])
    }, 'dsh-jev drain')
  }

  /**
   * Register a provider for the calling Cordis context's lifetime.
   * @param provider - Named structured-decision implementation.
   * @returns The exact idempotent registration disposer.
   */
  registerProvider(provider: DecisionProvider): () => void {
    return this.ctx.effect(() => this.decisions.registerProvider(provider), 'decisions.registerProvider()')
  }

  /**
   * Evaluate one decision while coupling it to caller cancellation and service disposal.
   *
   * Disposal stops admission, aborts admitted operations, and waits for their
   * settlement before the owning plugin fiber finishes unloading.
   *
   * @param request - Shared state and named decision questions.
   * @param options - Optional provider selection and caller cancellation.
   * @returns Structured answers with provider, model, latency, and token usage.
   */
  decide(request: DecisionRequest, options: DecisionCallOptions = {}): Promise<DecisionResult> {
    if (this.lifecycle.signal.aborted) {
      return Promise.reject(new DecisionError('DECISION_CANCELLED', 'Decision service is disposed', {
        retryable: false,
        cause: this.lifecycle.signal.reason,
      }))
    }
    const signal = options.signal === undefined
      ? this.lifecycle.signal
      : AbortSignal.any([this.lifecycle.signal, options.signal])
    const operation = this.decisions.decide(request, {
      ...options.provider === undefined ? {} : { provider: options.provider },
      signal,
    })
    const tracked = operation.then(
      (result) => {
        this.operations.delete(tracked)
        return result
      },
      (error: unknown) => {
        this.operations.delete(tracked)
        throw error
      },
    )
    this.operations.add(tracked)
    return tracked
  }
}

export default DshDecisionService
