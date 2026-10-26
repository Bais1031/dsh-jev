/** Cordis service, Jev provider, credentials adapter, and tool registration for DeepSeek Harness. */
import { Context, Service, type Volatile } from '@deepseek-ai/cordis'
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
import type {} from '@deepseek-ai/dsh-user-questions'
import {
  installJevRouter,
  type RouterAdvisoryChoice,
  type RouterAdvisoryPrompt,
  type RouterMode,
  type RouterRouteTarget,
  type RouterTier,
} from './router.js'

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
const DEFAULT_ROUTER_MAX_INPUT_CHARACTERS = 4_000

/** User-selected router operating mode. */
export type RoutingMode = RouterMode

/** Route used when Jev cannot return an acceptable decision. */
export type FallbackPolicy = 'default-model' | 'user-selection' | 'fail-closed'

/** Concrete DSH model route assigned to one Jev recommendation tier. */
export interface ModelRouteConfig {
  readonly provider: string
  readonly model: string
}

/** Plain Loader input accepted before Schemastery creates live references. */
export interface ConfigInput {
  readonly apiKeyEnv?: string
  readonly endpoint?: string
  readonly model?: string
  readonly providerName?: string
  readonly timeoutMs?: number
  readonly maxInputBytes?: number
  readonly routingMode?: RoutingMode
  readonly fallbackPolicy?: FallbackPolicy
  readonly minimumConfidence?: number
  readonly minimumMargin?: number
  readonly metricsEnabled?: boolean
  readonly routerMaxInputCharacters?: number
  readonly fastRoute?: ModelRouteConfig
  readonly standardRoute?: ModelRouteConfig
  readonly deepRoute?: ModelRouteConfig
}

/** DSH plugin configuration. Every deployment-varying transport choice is configurable. */
export interface Config {
  /** Credential reference resolved from `ctx.credentials` for every operation. */
  readonly apiKeyEnv?: Volatile<string>
  /** Absolute TypeSafe System One endpoint. */
  readonly endpoint?: Volatile<string>
  /** Default Jev model sent when a tool request omits `model`. */
  readonly model?: Volatile<string>
  /** Decision provider name registered in `ctx.decisions`. */
  readonly providerName?: string
  /** HTTP request timeout in milliseconds. */
  readonly timeoutMs?: Volatile<number>
  /** Maximum serialized request size in UTF-8 bytes. */
  readonly maxInputBytes?: Volatile<number>
  /** Router operating mode applied to each newly admitted Agent step. */
  readonly routingMode?: Volatile<RoutingMode>
  /** Route used when Jev is unavailable or below an acceptance threshold. */
  readonly fallbackPolicy?: Volatile<FallbackPolicy>
  /** Minimum winning probability required for an accepted route. */
  readonly minimumConfidence?: Volatile<number>
  /** Minimum gap between the two highest route probabilities. */
  readonly minimumMargin?: Volatile<number>
  /** Reserved switch for aggregate evaluation metrics introduced in stage 8. */
  readonly metricsEnabled?: Volatile<boolean>
  /** Maximum Unicode characters copied into one routing analysis. */
  readonly routerMaxInputCharacters?: Volatile<number>
  /** Concrete model route used for a `fast` recommendation. */
  readonly fastRoute?: Volatile<ModelRouteConfig | undefined>
  /** Concrete model route used for a `standard` recommendation. */
  readonly standardRoute?: Volatile<ModelRouteConfig | undefined>
  /** Concrete model route used for a `deep` recommendation. */
  readonly deepRoute?: Volatile<ModelRouteConfig | undefined>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    decisions: DshDecisionService
  }
}

/** Cordis configuration schema used by Loader and future plugin settings UI. */
export const Config: z<ConfigInput, Config> = z.object({
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_REF).volatile(),
  endpoint: z.string().default(DEFAULT_ENDPOINT).volatile(),
  model: z.string().default(DEFAULT_MODEL).volatile(),
  providerName: z.string().default(DEFAULT_PROVIDER),
  timeoutMs: z.natural().min(1).default(DEFAULT_TIMEOUT_MS).volatile(),
  maxInputBytes: z.natural().min(1).default(DEFAULT_MAX_INPUT_BYTES).volatile(),
  routingMode: z.union(['off', 'shadow', 'advisory', 'automatic'] as const).default(DEFAULT_ROUTING_MODE).volatile(),
  fallbackPolicy: z.union(['default-model', 'user-selection', 'fail-closed'] as const).default(DEFAULT_FALLBACK_POLICY).volatile(),
  minimumConfidence: z.number().min(0).max(1).default(DEFAULT_MINIMUM_CONFIDENCE).volatile(),
  minimumMargin: z.number().min(0).max(1).default(DEFAULT_MINIMUM_MARGIN).volatile(),
  metricsEnabled: z.boolean().default(DEFAULT_METRICS_ENABLED).volatile(),
  routerMaxInputCharacters: z.natural().min(1).max(100_000).default(DEFAULT_ROUTER_MAX_INPUT_CHARACTERS).volatile(),
  fastRoute: z.union([modelRouteSchema(), z.const(undefined)]).volatile(),
  standardRoute: z.union([modelRouteSchema(), z.const(undefined)]).volatile(),
  deepRoute: z.union([modelRouteSchema(), z.const(undefined)]).volatile(),
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
    const providerName = decisionProviderName(config.providerName ?? DEFAULT_PROVIDER)
    this.decisions = new DecisionService({ defaultProvider: providerName })
    const provider = new JevDecisionProvider({
      name: providerName,
      client: () => new JevClient({
        endpoint: config.endpoint?.get() ?? DEFAULT_ENDPOINT,
        model: config.model?.get() ?? DEFAULT_MODEL,
        timeoutMs: config.timeoutMs?.get() ?? DEFAULT_TIMEOUT_MS,
        maxInputBytes: config.maxInputBytes?.get() ?? DEFAULT_MAX_INPUT_BYTES,
      }),
      resolveApiKey: async () => {
        const apiKeyRef = credentialRef(config.apiKeyEnv?.get() ?? DEFAULT_API_KEY_REF)
        return (await ctx.credentials.resolve(apiKeyRef))?.value
      },
    })

    this.registerProvider(provider)
    ctx.tools.register(createJevDecisionTool(this, {
      apiKeyRef: () => credentialRef(config.apiKeyEnv?.get() ?? DEFAULT_API_KEY_REF),
    }))
    ctx.effect(() => async () => {
      this.lifecycle.abort(new Error('dsh-jev service disposed'))
      await Promise.allSettled([...this.operations])
    }, 'dsh-jev drain')
    installJevRouter(ctx, this, {
      mode: () => config.routingMode?.get() ?? DEFAULT_ROUTING_MODE,
      model: () => config.model?.get() ?? DEFAULT_MODEL,
      maximumInputCharacters: () => config.routerMaxInputCharacters?.get() ?? DEFAULT_ROUTER_MAX_INPUT_CHARACTERS,
      minimumConfidence: () => config.minimumConfidence?.get() ?? DEFAULT_MINIMUM_CONFIDENCE,
      minimumMargin: () => config.minimumMargin?.get() ?? DEFAULT_MINIMUM_MARGIN,
      fallbackPolicy: () => config.fallbackPolicy?.get() ?? DEFAULT_FALLBACK_POLICY,
      routeTarget: tier => routeTarget(config, tier),
      askUser: async (agent, prompt, signal) => await askForAdvisoryRoute(ctx, agent, prompt, signal),
    })
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

function modelRouteSchema(): z<Partial<ModelRouteConfig>, ModelRouteConfig> {
  return z.object({
    provider: z.string().min(1).required(),
    model: z.string().min(1).required(),
  })
}

function routeTarget(config: Config, tier: Exclude<RouterTier, 'ask-user'>): RouterRouteTarget | undefined {
  return config[`${tier}Route`]?.get()
}

async function askForAdvisoryRoute(
  ctx: Context,
  agent: import('@deepseek-ai/dsh-agent').Agent,
  prompt: RouterAdvisoryPrompt,
  signal: AbortSignal,
): Promise<RouterAdvisoryChoice> {
  const questions = ctx.get('userQuestions')
  if (questions === undefined) throw codedError('ADVISORY_INTERACTION_UNAVAILABLE')
  const answer = await questions.ask({
    agent,
    signal,
    questions: [{
      id: 'dsh-jev-route',
      question: prompt.question,
      detail: prompt.detail,
      options: [
        { label: prompt.recommendedLabel, description: `Use the configured ${prompt.recommendation.tier} route for this step.` },
        { label: prompt.currentLabel, description: 'Keep the route DeepSeek Harness already selected.' },
      ],
    }],
  })
  const selected = answer.answers.find(item => item.id === 'dsh-jev-route')?.selected
  if (selected?.includes(prompt.recommendedLabel) === true) return 'recommended'
  if (selected?.includes(prompt.currentLabel) === true) return 'current'
  throw codedError('ADVISORY_INVALID_ANSWER')
}

function codedError(code: string): Error & { readonly code: string } {
  return Object.assign(new Error(code), { code })
}

export default DshDecisionService
