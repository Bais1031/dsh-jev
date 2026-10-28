/** Cordis service, Jev provider, credentials adapter, and tool registration for DeepSeek Harness. */
import { Context, type Volatile } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { Session } from '@deepseek-ai/dsh-session'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import z from '@deepseek-ai/schemastery'
import { JevClient } from './client.js'
import { DecisionError } from './decision-errors.js'
import { DecisionService } from './decision-service.js'
import { decisionProviderName } from './decision-types.js'
import {
  installDecisionGuidanceShadow,
  type DecisionGuidanceMode,
} from './decision-guidance-shadow.js'
import type { DecisionNodeType } from './decision-guidance-protocol.js'
import type {
  DecisionCallOptions,
  DecisionProvider,
  DecisionRequest,
  DecisionResult,
} from './decision-types.js'
import { createJevDecisionTool } from './dsh-tool.js'
import { JevDecisionProvider } from './jev-provider.js'
import type { JevConnectionTestResult, JevLatestSessionSummary } from './remote.js'
import { summarizeDecisionGuidance } from './decision-guidance-summary.js'

const DEFAULT_API_KEY_REF = 'JEV_API_KEY'
const DEFAULT_ENDPOINT = 'https://api.typesafe.ai/v1/systemone'
const DEFAULT_MODEL = 'jev-latest'
const DEFAULT_PROVIDER = 'jev'
const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_MAX_INPUT_BYTES = 1_000_000
const DEFAULT_DECISION_MODE: DecisionGuidanceMode = 'off'
const DEFAULT_DECISION_NODES: readonly DecisionNodeType[] = ['task-intake', 'tool-recovery', 'progress-check']
const DEFAULT_DECISION_COOLDOWN_STEPS = 3
const DEFAULT_DECISION_MAX_CALLS_PER_SESSION = 8
const DEFAULT_DECISION_PROGRESS_CHECK_STEP = 4
const DEFAULT_DECISION_MINIMUM_TASK_INPUT_CHARACTERS = 200
const DEFAULT_DECISION_MAX_INPUT_CHARACTERS = 6_000
const DEFAULT_DECISION_MAX_OUTPUT_TOKENS = 250
const DEFAULT_DECISION_MINIMUM_CONFIDENCE = 0.7
const DEFAULT_DECISION_INCLUDE_TOOL_RESULT_SUMMARIES = false
const DEFAULT_DECISION_TOOL_RESULT_SUMMARY_CHARACTERS = 1_000

/** Plain Loader input accepted before Schemastery creates live references. */
export interface ConfigInput {
  readonly apiKeyEnv?: string
  readonly endpoint?: string
  readonly model?: string
  readonly providerName?: string
  readonly timeoutMs?: number
  readonly maxInputBytes?: number
  readonly decisionMode?: DecisionGuidanceMode
  readonly decisionNodes?: DecisionNodeType[]
  readonly decisionCooldownSteps?: number
  readonly decisionMaxCallsPerSession?: number
  readonly decisionProgressCheckStep?: number
  readonly decisionMinimumTaskInputCharacters?: number
  readonly decisionMaxInputCharacters?: number
  readonly decisionMaxOutputTokens?: number
  readonly decisionMinimumConfidence?: number
  readonly decisionIncludeToolResultSummaries?: boolean
  readonly decisionToolResultSummaryCharacters?: number
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
  /** Automatic guidance mode; milestone A supports only disabled and Shadow observation. */
  readonly decisionMode?: Volatile<DecisionGuidanceMode>
  /** Critical analysis nodes eligible for deterministic triggering. */
  readonly decisionNodes?: Volatile<DecisionNodeType[]>
  /** Number of admitted steps required between Jev calls. */
  readonly decisionCooldownSteps?: Volatile<number>
  /** Maximum automatic Jev calls admitted for one live Agent Session. */
  readonly decisionMaxCallsPerSession?: Volatile<number>
  /** First step number eligible for a progress-check trigger. */
  readonly decisionProgressCheckStep?: Volatile<number>
  /** Task text size that can trigger intake analysis without a keyword signal. */
  readonly decisionMinimumTaskInputCharacters?: Volatile<number>
  /** Maximum Unicode characters copied into one automatic decision request. */
  readonly decisionMaxInputCharacters?: Volatile<number>
  /** Maximum provider-reported output tokens accepted as a valid brief. */
  readonly decisionMaxOutputTokens?: Volatile<number>
  /** Minimum joint action/focus confidence accepted for later Advisory use. */
  readonly decisionMinimumConfidence?: Volatile<number>
  /** Whether automatic guidance may include bounded text from the immediately preceding tool result. */
  readonly decisionIncludeToolResultSummaries?: Volatile<boolean>
  /** Maximum previous-step tool-result characters eligible for one automatic request. */
  readonly decisionToolResultSummaryCharacters?: Volatile<number>
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
  decisionMode: z.union(['off', 'shadow', 'advisory'] as const).default(DEFAULT_DECISION_MODE).volatile(),
  decisionNodes: z.array(z.union([
    'task-intake',
    'missing-information',
    'direction-selection',
    'tool-recovery',
    'progress-check',
    'pre-conclusion',
  ] as const)).min(1).default([...DEFAULT_DECISION_NODES]).volatile(),
  decisionCooldownSteps: z.natural().default(DEFAULT_DECISION_COOLDOWN_STEPS).volatile(),
  decisionMaxCallsPerSession: z.natural().min(1).default(DEFAULT_DECISION_MAX_CALLS_PER_SESSION).volatile(),
  decisionProgressCheckStep: z.natural().min(2).default(DEFAULT_DECISION_PROGRESS_CHECK_STEP).volatile(),
  decisionMinimumTaskInputCharacters: z.natural().min(1).max(100_000).default(DEFAULT_DECISION_MINIMUM_TASK_INPUT_CHARACTERS).volatile(),
  decisionMaxInputCharacters: z.natural().min(1).max(100_000).default(DEFAULT_DECISION_MAX_INPUT_CHARACTERS).volatile(),
  decisionMaxOutputTokens: z.natural().min(1).max(10_000).default(DEFAULT_DECISION_MAX_OUTPUT_TOKENS).volatile(),
  decisionMinimumConfidence: z.number().min(0).max(1).default(DEFAULT_DECISION_MINIMUM_CONFIDENCE).volatile(),
  decisionIncludeToolResultSummaries: z.boolean().default(DEFAULT_DECISION_INCLUDE_TOOL_RESULT_SUMMARIES).volatile(),
  decisionToolResultSummaryCharacters: z.natural().min(1).max(100_000).default(DEFAULT_DECISION_TOOL_RESULT_SUMMARY_CHARACTERS).volatile(),
})

/** Cordis-owned decision capability with one default Jev provider and the `jev_decide` tool. */
export class DshDecisionService extends TypertRemoteService {
  static inject = ['credentials', 'tools']
  static Config = Config

  private readonly decisions: DecisionService
  private readonly lifecycle = new AbortController()
  private readonly operations = new Set<Promise<DecisionResult>>()
  private latestSession: Session | undefined

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
    installDecisionGuidanceShadow(ctx, this, {
      mode: () => config.decisionMode?.get() ?? DEFAULT_DECISION_MODE,
      model: () => config.model?.get() ?? DEFAULT_MODEL,
      enabledNodes: () => config.decisionNodes?.get() ?? DEFAULT_DECISION_NODES,
      cooldownSteps: () => config.decisionCooldownSteps?.get() ?? DEFAULT_DECISION_COOLDOWN_STEPS,
      maximumCallsPerSession: () => config.decisionMaxCallsPerSession?.get() ?? DEFAULT_DECISION_MAX_CALLS_PER_SESSION,
      progressCheckStep: () => config.decisionProgressCheckStep?.get() ?? DEFAULT_DECISION_PROGRESS_CHECK_STEP,
      minimumTaskInputCharacters: () => config.decisionMinimumTaskInputCharacters?.get() ?? DEFAULT_DECISION_MINIMUM_TASK_INPUT_CHARACTERS,
      maximumInputCharacters: () => config.decisionMaxInputCharacters?.get() ?? DEFAULT_DECISION_MAX_INPUT_CHARACTERS,
      maximumOutputTokens: () => config.decisionMaxOutputTokens?.get() ?? DEFAULT_DECISION_MAX_OUTPUT_TOKENS,
      minimumConfidence: () => config.decisionMinimumConfidence?.get() ?? DEFAULT_DECISION_MINIMUM_CONFIDENCE,
      includeToolResultSummaries: () => config.decisionIncludeToolResultSummaries?.get() ?? DEFAULT_DECISION_INCLUDE_TOOL_RESULT_SUMMARIES,
      toolResultSummaryCharacters: () => config.decisionToolResultSummaryCharacters?.get() ?? DEFAULT_DECISION_TOOL_RESULT_SUMMARY_CHARACTERS,
    })
    ctx.on('agent/pre-step', ({ agent }, next) => {
      this.latestSession = agent.session
      return next()
    }, { prepend: true })
    ctx.on('agent/disposed', ({ agent }) => {
      if (this.latestSession === agent.session) this.latestSession = undefined
    })
  }

  /**
   * Test the configured endpoint and credential with one minimal structured Jev request.
   * The operation creates no Agent or Session and returns no credential or provider response text.
   *
   * @param signal - Remote caller cancellation.
   * @returns Safe connection metadata or a structured provider failure.
   */
  async remoteTestConnection(signal: AbortSignal): Promise<JevConnectionTestResult> {
    try {
      const result = await this.decide({
        state: 'dsh-jev connection check',
        questions: { reachable: { type: 'boolean', instructions: 'Is this a connection-check request?' } },
      }, { signal })
      return { ok: true, model: result.model, latencyMs: result.latencyMs }
    } catch (error: unknown) {
      signal.throwIfAborted()
      if (error instanceof DecisionError) {
        return { ok: false, code: error.code, retryable: error.retryable }
      }
      return { ok: false, code: 'DECISION_CONNECTION_UNEXPECTED_FAILURE', retryable: false }
    }
  }

  /**
   * Read content-free totals for the latest live Agent Session observed by this plugin instance.
   * @returns The local summary, or null before any live Agent step is observed.
   */
  remoteLatestSessionSummary(): Promise<JevLatestSessionSummary | null> {
    if (this.latestSession === undefined) return Promise.resolve(null)
    const summary = summarizeDecisionGuidance(this.latestSession)
    return Promise.resolve({
      sessionId: this.latestSession.id,
      calls: summary.calls,
      successes: summary.successes,
      failures: summary.failures,
      pending: summary.pending,
      inputTokens: summary.usage.inputTokens,
      outputTokens: summary.usage.outputTokens,
      totalTokens: summary.usage.totalTokens,
      totalLatencyMs: summary.totalLatencyMs,
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

markRemoteMethod(
  DshDecisionService.prototype,
  'remoteTestConnection',
  'testConnection',
  DshDecisionService.prototype.remoteTestConnection,
)
markRemoteMethod(
  DshDecisionService.prototype,
  'remoteLatestSessionSummary',
  'latestSessionSummary',
  DshDecisionService.prototype.remoteLatestSessionSummary,
)

function markRemoteMethod<Args extends unknown[], Result>(
  prototype: DshDecisionService,
  methodName: string,
  exportName: string,
  method: (this: DshDecisionService, ...args: Args) => Result,
): void {
  const initializers: Array<(this: DshDecisionService) => void> = []
  Remote(exportName)(method, {
    kind: 'method',
    name: methodName,
    static: false,
    private: false,
    access: {
      has: object => methodName in object,
      get: () => method,
    },
    addInitializer: initializer => { initializers.push(initializer) },
    metadata: {},
  })
  const receiver = Object.create(prototype) as DshDecisionService
  for (const initializer of initializers) initializer.call(receiver)
}

export default DshDecisionService
