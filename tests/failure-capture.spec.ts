import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { describe, expect, it } from 'vitest'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { pluginRecordOf, Session, SessionId } from '@deepseek-ai/dsh-session'
import { captureFailureCandidate, installFailureCapture } from '../src/failure-capture.js'
import { summarizeDecisionGuidance } from '../src/decision-guidance-summary.js'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'test-runtime-context': { readonly kind: 'test-runtime-context' }
  }
}

describe('explicit natural-failure capture', () => {
  it('links a supported correction marker to the preceding Assistant checkpoint without copying content', () => {
    const session = sessionWithAnswer('incorrect answer with private detail')
    const correction = createUserMessage({
      content: [{ type: 'text', text: '/jev-failure wrong-direction\nThe answer should compare the two options first.' }],
      source: { kind: 'user' },
    })

    const seq = captureFailureCandidate(session, [correction], 2, 1)
    const record = session.snapshotEvents()
      .map(pluginRecordOf)
      .find(candidate => candidate?.seq === seq)

    expect(record).toMatchObject({
      type: 'plugin:dsh-jev/failure-candidate',
      data: {
        version: 1,
        label: 'wrong-direction',
        assistantTurn: 1,
        assistantStep: 1,
        correctionMessageId: correction.id,
        correctionTurn: 2,
        correctionStep: 1,
      },
    })
    expect(JSON.stringify(record)).not.toContain('private detail')
    expect(JSON.stringify(record)).not.toContain('compare the two options')
  })

  it('ignores unknown labels, runtime messages, and corrections without a prior answer', () => {
    const session = sessionWithAnswer('answer')
    const unknown = createUserMessage({
      content: [{ type: 'text', text: '/jev-failure typo\nCorrection.' }],
      source: { kind: 'user' },
    })
    const runtime = createUserMessage({
      content: [{ type: 'text', text: '/jev-failure incomplete\nCorrection.' }],
      source: { kind: 'test-runtime-context' },
    })
    expect(captureFailureCandidate(session, [unknown, runtime], 2, 1)).toBeUndefined()

    const empty = Session.create(SessionId('no-answer'))
    const valid = createUserMessage({
      content: [{ type: 'text', text: '/jev-failure incomplete\nMissing the conclusion.' }],
      source: { kind: 'user' },
    })
    expect(captureFailureCandidate(empty, [valid], 1, 1)).toBeUndefined()
  })

  it('deduplicates one answer checkpoint and becomes pairing-ready after two distinct answers', () => {
    const session = sessionWithAnswer('first answer')
    const first = correction('incorrect-conclusion')
    expect(captureFailureCandidate(session, [first], 2, 1)).toBeDefined()
    expect(captureFailureCandidate(session, [correction('missed-evidence')], 2, 2)).toBeUndefined()
    expect(summarizeDecisionGuidance(session)).toMatchObject({
      failureCandidates: 1,
      failurePairReady: false,
    })

    appendAnswer(session, 'second answer', 2, 2)
    expect(captureFailureCandidate(session, [correction('missed-evidence')], 3, 1)).toBeDefined()
    expect(summarizeDecisionGuidance(session)).toMatchObject({
      failureCandidates: 2,
      failurePairReady: true,
    })
  })

  it('captures only admitted input while the live setting is enabled', async () => {
    const ctx = new Context()
    let enabled = false
    installFailureCapture(ctx, { enabled: () => enabled })
    const session = sessionWithAnswer('answer')
    const agent = { session } as Agent
    const message = correction('incorrect-conclusion')
    const enter = () => Promise.resolve({ kind: 'enter' as const, messages: [message] })
    try {
      await ctx.waterfall(ctx as never, 'agent/pre-step', {
        agent, messages: [message], turn: 2, step: 1, signal: new AbortController().signal,
      }, enter)
      expect(summarizeDecisionGuidance(session).failureCandidates).toBe(0)

      enabled = true
      await ctx.waterfall(ctx as never, 'agent/pre-step', {
        agent, messages: [message], turn: 2, step: 1, signal: new AbortController().signal,
      }, enter)
      expect(summarizeDecisionGuidance(session)).toMatchObject({
        failureCandidates: 1,
        failurePairReady: false,
      })
    } finally {
      await ctx.fiber.dispose()
    }
  })
})

function sessionWithAnswer(text: string): Session {
  const session = Session.create(SessionId('failure-capture'))
  appendAnswer(session, text, 1, 1)
  return session
}

function appendAnswer(session: Session, text: string, turn: number, step: number): void {
  session.append('assistant/message', {
    turn,
    step,
    stream: [],
    message: createAssistantMessage({
      content: [{ type: 'text', text }],
      source: { provider: 'main', model: 'main-model' },
    }),
  }, { surfaceOp: 'append' })
}

function correction(label: 'incorrect-conclusion' | 'missed-evidence') {
  return createUserMessage({
    content: [{ type: 'text', text: `/jev-failure ${label}\nCorrected evidence.` }],
    source: { kind: 'user' },
  })
}
