/** Model-facing `jev_decide` tool over the provider-independent decision service. */
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { DecisionError } from './decision-errors.js'
import type {
  DecisionAnswer,
  DecisionBooleanQuestion,
  DecisionCallOptions,
  DecisionQuestion,
  DecisionRequest,
  DecisionResult,
} from './decision-types.js'
import type { JevContent, JsonObject, JsonValue } from './types.js'

/** Minimal service API consumed by the Jev tool. */
export interface JevDecisionToolService {
  /**
   * Evaluate one structured decision request.
   * @param request - Shared state and named questions.
   * @param options - Provider selection and cancellation.
   * @returns Structured decision answers and operation metadata.
   */
  decide(request: DecisionRequest, options?: DecisionCallOptions): Promise<DecisionResult>
}

/** Tool construction options that affect user recovery guidance. */
export interface JevDecisionToolOptions {
  readonly apiKeyRef: string
}

/**
 * Create the model-facing Jev decision tool.
 * @param decisions - Live decision service used for each invocation.
 * @param options - Non-secret configuration references used in diagnostics.
 * @returns A registry-ready DSH tool definition.
 */
export function createJevDecisionTool(
  decisions: JevDecisionToolService,
  options: JevDecisionToolOptions,
): ToolDefinition {
  return defineTool({
    name: 'jev_decide',
    description: 'Make fast structured semantic decisions over shared state. Use for bounded yes/no, choice, and score questions; do not use its output as authorization for high-risk actions.',
    parameters: {
      state: {
        type: 'json',
        required: true,
        description: 'Shared text, object, or array that every question evaluates.',
      },
      questions: {
        type: 'json',
        required: true,
        description: 'Named boolean, choice, or score question objects.',
      },
      model: {
        type: 'string',
        description: 'Optional Jev model name; omit to use the configured model.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          provider: { type: 'string', required: true },
          model: { type: 'string', required: true },
          latencyMs: { type: 'number', required: true },
          answers: { type: 'object', additionalProperties: true, required: true },
          usage: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              inputTokens: { type: 'integer', required: true },
              outputTokens: { type: 'integer', required: true },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: JSON.stringify(value),
      }],
    },
    async execute(args, exec) {
      const request = parseDecisionRequest(args.state, args.questions, args.model)
      try {
        const result = await decisions.decide(request, { signal: exec.signal })
        return decisionResultValue(result)
      } catch (error: unknown) {
        if (!(error instanceof DecisionError)) throw error
        throw new Error(toolErrorMessage(error, options.apiKeyRef), { cause: error })
      }
    },
  })
}

function parseDecisionRequest(state: JsonValue, questions: JsonValue, model: string | undefined): DecisionRequest {
  if (!isContent(state)) throw new Error('jev_decide: state must be a string, object, or array')
  if (!isRecord(questions) || Object.keys(questions).length === 0) {
    throw new Error('jev_decide: questions must be a non-empty object')
  }
  const parsed: Record<string, DecisionQuestion> = {}
  for (const [name, value] of Object.entries(questions)) {
    if (name.length === 0) throw new Error('jev_decide: question names must not be empty')
    defineRecordValue(parsed, name, parseQuestion(name, value))
  }
  return {
    state,
    questions: parsed,
    ...model === undefined ? {} : { model },
  }
}

function parseQuestion(name: string, value: JsonValue): DecisionQuestion {
  if (!isRecord(value) || typeof value.type !== 'string') {
    throw new Error(`jev_decide: questions.${name} must be a question object with a type`)
  }
  const instructions = optionalContent(value.instructions, `questions.${name}.instructions`)
  switch (value.type) {
    case 'boolean': {
      assertKeys(value, ['type', 'instructions', 'criteria'], `questions.${name}`)
      const criteria = parseBooleanCriteria(value.criteria, name)
      return {
        type: 'boolean',
        ...instructions === undefined ? {} : { instructions },
        ...criteria === undefined ? {} : { criteria },
      }
    }
    case 'choice': {
      assertKeys(value, ['type', 'instructions', 'options'], `questions.${name}`)
      const options = parseChoiceOptions(value.options, name)
      return {
        type: 'choice',
        ...instructions === undefined ? {} : { instructions },
        options,
      }
    }
    case 'score': {
      assertKeys(value, ['type', 'instructions', 'levels'], `questions.${name}`)
      const levels = parseScoreLevels(value.levels, name)
      return {
        type: 'score',
        ...instructions === undefined ? {} : { instructions },
        levels,
      }
    }
    default:
      throw new Error(`jev_decide: questions.${name}.type must be boolean, choice, or score`)
  }
}

function parseBooleanCriteria(
  value: JsonValue | undefined,
  name: string,
): DecisionBooleanQuestion['criteria'] | undefined {
  if (value === undefined || value === null) return value
  if (!isRecord(value)) throw new Error(`jev_decide: questions.${name}.criteria must be an object or null`)
  assertKeys(value, ['true', 'false'], `questions.${name}.criteria`)
  const trueValue = optionalContent(value.true, `questions.${name}.criteria.true`)
  const falseValue = optionalContent(value.false, `questions.${name}.criteria.false`)
  return {
    ...trueValue === undefined ? {} : { true: trueValue },
    ...falseValue === undefined ? {} : { false: falseValue },
  }
}

function parseChoiceOptions(value: JsonValue | undefined, name: string): Readonly<Record<string, JevContent | null>> {
  if (!isRecord(value)) throw new Error(`jev_decide: questions.${name}.options must be an object`)
  const entries = Object.entries(value)
  if (entries.length < 1 || entries.length > 255) {
    throw new Error(`jev_decide: questions.${name}.options must contain 1 to 255 entries`)
  }
  const options: Record<string, JevContent | null> = {}
  for (const [option, description] of entries) {
    if (option.length === 0) throw new Error(`jev_decide: questions.${name}.options contains an empty name`)
    if (description !== null && !isContent(description)) {
      throw new Error(`jev_decide: questions.${name}.options.${option} must be a string, object, array, or null`)
    }
    defineRecordValue(options, option, description)
  }
  return options
}

function parseScoreLevels(value: JsonValue | undefined, name: string): readonly JevContent[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) {
    throw new Error(`jev_decide: questions.${name}.levels must contain 1 to 10 entries`)
  }
  const levels: JevContent[] = []
  for (const level of value) {
    if (!isContent(level)) {
      throw new Error(`jev_decide: questions.${name}.levels entries must be strings, objects, or arrays`)
    }
    levels.push(level)
  }
  return levels
}

function optionalContent(value: JsonValue | undefined, path: string): JevContent | null | undefined {
  if (value === undefined || value === null) return value
  if (!isContent(value)) throw new Error(`jev_decide: ${path} must be a string, object, array, or null`)
  return value
}

function decisionResultValue(result: DecisionResult): {
  provider: string
  model: string
  latencyMs: number
  answers: JsonObject
  usage: { inputTokens: number; outputTokens: number }
} {
  const answers: JsonObject = {}
  for (const [name, answer] of Object.entries(result.answers)) defineRecordValue(answers, name, answerValue(answer))
  return {
    provider: result.provider,
    model: result.model,
    latencyMs: result.latencyMs,
    answers,
    usage: result.usage,
  }
}

function answerValue(answer: DecisionAnswer): JsonObject {
  switch (answer.type) {
    case 'boolean':
      return {
        type: 'boolean',
        value: answer.value,
        probability: answer.probability,
        confidence: answer.confidence,
      }
    case 'choice':
      return {
        type: 'choice',
        value: answer.value,
        confidence: answer.confidence,
        probabilities: numberRecord(answer.probabilities),
      }
    case 'score':
      return {
        type: 'score',
        value: answer.value,
        confidence: answer.confidence,
        levels: contentRecord(answer.levels),
        probabilities: numberRecord(answer.probabilities),
      }
    default:
      return assertNever(answer)
  }
}

function numberRecord(values: Readonly<Record<string, number>>): JsonObject {
  const result: JsonObject = {}
  for (const [name, value] of Object.entries(values)) defineRecordValue(result, name, value)
  return result
}

function contentRecord(values: Readonly<Record<string, JevContent>>): JsonObject {
  const result: JsonObject = {}
  for (const [name, value] of Object.entries(values)) defineRecordValue(result, name, value)
  return result
}

function toolErrorMessage(error: DecisionError, apiKeyRef: string): string {
  switch (error.providerCode) {
    case 'JEV_CREDENTIAL_MISSING':
      return `Jev is not configured. Add the ${apiKeyRef} credential and retry.`
    case 'JEV_AUTH_REJECTED':
      return `TypeSafe rejected ${apiKeyRef}. Update the credential and retry.`
    case 'JEV_RATE_LIMITED':
      return 'TypeSafe rate-limited the Jev request. Retry later or use another decision path.'
    case 'JEV_TIMEOUT':
      return 'The Jev request timed out. Retry or use another decision path.'
    case 'JEV_INVALID_RESPONSE':
      return 'TypeSafe returned an invalid Jev response. Do not use this decision; retry or use another path.'
    default:
      if (error.code === 'DECISION_CANCELLED') return 'The Jev decision was cancelled.'
      return 'The Jev decision failed. Retry or use another decision path.'
  }
}

function assertKeys(value: Readonly<Record<string, JsonValue>>, allowed: readonly string[], path: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`jev_decide: ${path}.${key} is not supported`)
  }
}

function isRecord(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isContent(value: JsonValue): value is JevContent {
  return typeof value === 'string' || Array.isArray(value) || isRecord(value)
}

function defineRecordValue<T>(target: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  })
}

function assertNever(value: never): never {
  throw new Error(`Unsupported decision answer: ${String(value)}`)
}
