# dsh-jev

TypeSafe Jev decision provider and router for DeepSeek Harness. The project is under active development; the current implementation contains the standalone System One HTTP client, provider-independent `DecisionService`, and Jev provider.

See [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md) for the staged plan.

## Development

```sh
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

Normal tests use a mocked HTTP transport and do not require `JEV_API_KEY`.

## Decision service

```ts
import { DecisionService, JEV_PROVIDER_NAME, JevClient, JevDecisionProvider } from 'dsh-jev'

const decisions = new DecisionService({ defaultProvider: JEV_PROVIDER_NAME })
decisions.registerProvider(new JevDecisionProvider({
  client: new JevClient(),
  resolveApiKey: async () => obtainCurrentCredential(),
}))

const result = await decisions.decide({
  state: 'Review and publish this release.',
  questions: {
    task: {
      type: 'choice',
      options: {
        analysis: 'Analyze without changing external state',
        operation: 'Change external state',
      },
    },
    highRisk: {
      type: 'boolean',
      instructions: 'Does this involve publishing, credentials, deletion, or payment?',
    },
  },
})
```

The service resolves credentials for every operation, forwards cancellation, and returns provider, model, latency, token usage, and structured probabilities. It never chooses a fallback provider implicitly. Consumers own fallback and authorization policy.

For boolean answers, `value` uses a `0.5` threshold as a convenience projection. Safety policy should use `probability` and deterministic rules rather than treating `value` as authorization.
