import { describe, expect, it, vi } from 'vitest'
import { JevClient, JevError } from '../src/index.js'

const KEY = 'test-key'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

describe('JevClient', () => {
  it('evaluates mixed Noul, Choice, and Score questions', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(jsonResponse({
      model: 'jev-1.14',
      answers: {
        billing: { type: 'noul', noul: 0.98 },
        tone: {
          type: 'choice',
          choice: 'calm',
          confidence: 0.7,
          probabilities: { angry: 0.15, calm: 0.85 },
        },
        urgency: {
          type: 'score',
          score: 1.7,
          confidence: 0.55,
          legend: { 0: 'Can wait', 1: 'This week', 2: 'Today' },
          probabilities: { 0: 0.1, 1: 0.1, 2: 0.8 },
        },
      },
      usage: { input_tokens: 120, output_tokens: 12 },
    }))
    const client = new JevClient({ fetch })

    const result = await client.evaluate({
      state: 'I was charged twice. Please help.',
      questions: {
        billing: { type: 'noul', instructions: 'Is this about billing?' },
        tone: { type: 'choice', criteria: { angry: 'Hostile', calm: 'Polite' } },
        urgency: { type: 'score', criteria: ['Can wait', 'This week', 'Today'] },
      },
    }, { apiKey: KEY })

    expect(result).toEqual({
      model: 'jev-1.14',
      answers: {
        billing: { type: 'noul', noul: 0.98 },
        tone: {
          type: 'choice',
          choice: 'calm',
          confidence: 0.7,
          probabilities: { angry: 0.15, calm: 0.85 },
        },
        urgency: {
          type: 'score',
          score: 1.7,
          confidence: 0.55,
          legend: { 0: 'Can wait', 1: 'This week', 2: 'Today' },
          probabilities: { 0: 0.1, 1: 0.1, 2: 0.8 },
        },
      },
      usage: { inputTokens: 120, outputTokens: 12 },
    })
    const [url, init] = fetch.mock.calls[0] ?? []
    expect(url).toBe('https://api.typesafe.ai/v1/systemone')
    expect(init?.headers).toMatchObject({ authorization: `Bearer ${KEY}` })
    expect(JSON.parse(String(init?.body))).toMatchObject({ model: 'jev-latest' })
  })

  it('requires an operation credential without dispatching', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    const client = new JevClient({ fetch })
    await expect(client.evaluate({ state: 'text', questions: { ok: { type: 'noul' } } }, { apiKey: undefined }))
      .rejects.toMatchObject({ code: 'JEV_CREDENTIAL_MISSING', retryable: false })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects oversized input before dispatching', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    const client = new JevClient({ fetch, maxInputBytes: 20 })
    await expect(client.evaluate({ state: 'too much input', questions: { ok: { type: 'noul' } } }, { apiKey: KEY }))
      .rejects.toMatchObject({ code: 'JEV_BAD_REQUEST' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    [401, 'JEV_AUTH_REJECTED', false],
    [422, 'JEV_BAD_REQUEST', false],
    [429, 'JEV_RATE_LIMITED', true],
    [503, 'JEV_SERVER_ERROR', true],
  ] as const)('maps HTTP %i to %s', async (status, code, retryable) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('hidden upstream body', {
      status,
      headers: status === 429 ? { 'retry-after': '2' } : {},
    }))
    const client = new JevClient({ fetch })
    const promise = client.evaluate({ state: 'text', questions: { ok: { type: 'noul' } } }, { apiKey: KEY })
    await expect(promise).rejects.toMatchObject({ code, retryable })
    if (status === 429) await expect(promise).rejects.toMatchObject({ retryAfterMs: 2_000 })
  })

  it('maps transport failures without exposing their message', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error(`network failed with ${KEY}`))
    const client = new JevClient({ fetch })
    const promise = client.evaluate({ state: 'text', questions: { ok: { type: 'noul' } } }, { apiKey: KEY })
    await expect(promise).rejects.toMatchObject({ code: 'JEV_TRANSPORT_ERROR', retryable: true })
    await expect(promise).rejects.not.toThrow(KEY)
  })

  it('distinguishes timeout from caller cancellation', async () => {
    const pendingFetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (_input, init) => {
      await new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true }))
      throw new Error('unreachable')
    })
    vi.useFakeTimers()
    try {
      const timed = new JevClient({ fetch: pendingFetch, timeoutMs: 5 })
      const timeoutRequest = timed.evaluate(
        { state: 'text', questions: { ok: { type: 'noul' } } },
        { apiKey: KEY },
      )
      const timeoutResult = expect(timeoutRequest).rejects.toMatchObject({
        code: 'JEV_TIMEOUT',
        retryable: true,
      })
      await vi.advanceTimersByTimeAsync(5)
      await timeoutResult
    } finally {
      vi.useRealTimers()
    }

    const controller = new AbortController()
    const cancellable = new JevClient({ fetch: pendingFetch, timeoutMs: 1_000 })
    const request = cancellable.evaluate({ state: 'text', questions: { ok: { type: 'noul' } } }, {
      apiKey: KEY,
      signal: controller.signal,
    })
    controller.abort()
    await expect(request).rejects.toMatchObject({ code: 'JEV_CANCELLED', retryable: false })
  })

  it('rejects malformed JSON and protocol mismatches', async () => {
    const nonJson = new JevClient({ fetch: vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('nope')) })
    await expect(nonJson.evaluate({ state: 'text', questions: { ok: { type: 'noul' } } }, { apiKey: KEY }))
      .rejects.toMatchObject({ code: 'JEV_INVALID_RESPONSE' })

    const wrongType = new JevClient({ fetch: vi.fn<typeof globalThis.fetch>().mockResolvedValue(jsonResponse({
      model: 'jev-latest',
      answers: { ok: { type: 'choice', choice: 'yes', confidence: 1, probabilities: { yes: 1 } } },
      usage: { input_tokens: 1, output_tokens: 1 },
    })) })
    await expect(wrongType.evaluate({ state: 'text', questions: { ok: { type: 'noul' } } }, { apiKey: KEY }))
      .rejects.toMatchObject({ code: 'JEV_INVALID_RESPONSE' })
  })

  it('exposes structured expected failures', () => {
    const error = new JevError('JEV_TIMEOUT', 'timed out', { retryable: true })
    expect(error).toMatchObject({ name: 'JevError', code: 'JEV_TIMEOUT', retryable: true })
  })
})
