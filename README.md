# dsh-jev

TypeSafe Jev decision provider and router for DeepSeek Harness. The project is under active development; the current implementation contains the standalone System One HTTP client, provider-independent `DecisionService`, and Jev provider.

See [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md) for the staged plan.

## Install in DeepSeek Harness

The plugin is not published to npm yet. Build it, then install this checkout into a profile:

```sh
pnpm install
pnpm build
dsh plugin --profile web add /home/jzl/projects/dsh-jev
```

When running DSH from its source checkout, use `pnpm dsh plugin --profile web add /home/jzl/projects/dsh-jev` from the DSH repository. Replace `web` with the profile that will load the plugin.

The bundle adds one `dsh-jev` row. Plugin Manager can disable, enable, update, or remove that row. Set `JEV_API_KEY` through DSH Credentials or the Harness environment; do not place the key itself in `cordis.patch.yml`.

## Configuration

The default bundle configuration uses `JEV_API_KEY`, `jev-latest`, and the TypeSafe System One endpoint. A profile override replaces the row, so keep every field you still need:

```yaml
- id: dsh-jev
  name: dsh-jev
  config:
    apiKeyEnv: JEV_API_KEY
    endpoint: https://api.typesafe.ai/v1/systemone
    model: jev-latest
    providerName: jev
    timeoutMs: 10000
    maxInputBytes: 1000000
```

After activation, Agents can call `jev_decide` with named Boolean, Choice, and Score questions. Tool calls and results use the normal DSH Session log. Credential values are resolved for each operation and are never included in tool arguments or results.

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

## Plugin market

The repository is structured for future DeepSeek Harness market distribution, but it is not listed or published yet. See [MARKETPLACE.md](./MARKETPLACE.md) for the release and `awesome-dsh-plugin` submission checklist.
