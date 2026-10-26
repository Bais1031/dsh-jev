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

When running DSH from its source checkout, use `pnpm dsh plugin --profile web add /home/jzl/projects/dsh-jev` from the DSH repository. A different profile must provide the DSH Credentials and Tools services; the stock one-shot `headless` profile intentionally disables the interactive credential store and cannot load this plugin.

The bundle adds one `dsh-jev` row. Plugin Manager can disable, enable, update, remove, and configure that row. Open **Plugins**, select **dsh-jev**, then select the inner **dsh-jev** component row to open its configuration form. Set `JEV_API_KEY` through DSH Credentials or the Harness environment; do not place the key itself in `cordis.patch.yml`.

## Configuration

The configuration form can update the credential reference, endpoint, model, timeout, input limits, routing mode, fallback policy, routing thresholds, and the stage 8 metrics reservation without restarting DSH. Required routing audit records remain enabled regardless of that reserved setting. The API key field writes to DSH Credentials and is never read back into the browser. The provider name is intentionally fixed for the lifetime of the loaded component because it identifies the registered decision provider.

The default bundle configuration uses `JEV_API_KEY`, `jev-latest`, and the TypeSafe System One endpoint. A complete profile example with optional tier routes is:

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
    routerMaxInputCharacters: 4000
    fastRoute:
      provider: deepseek-official
      model: deepseek-flash
    standardRoute:
      provider: deepseek-official
      model: deepseek-chat
    deepRoute:
      provider: deepseek-official
      model: deepseek-reasoner
```

If an older DSH process was already running when this plugin was rebuilt or updated, restart that process once so it loads the current configuration schema and client bundle.

After activation, Agents can call `jev_decide` with named Boolean, Choice, and Score questions. Tool calls and results use the normal DSH Session log. Credential values are resolved for each operation and are never included in tool arguments or results.

## Shadow routing

Set **Routing mode** to `shadow` to evaluate routing advice before each newly admitted Agent step. Shadow mode never changes the provider, model, or reasoning effort selected by DSH. It records an ignorable `plugin:dsh-jev/router-request` entry before dispatch and a paired `plugin:dsh-jev/router-result` entry with the task signals, probabilities, recommendation, actual route, latency, and token use. Provider failures are recorded as structured, secret-free failures and the original route continues.

The router sends only text from the current admitted user batch, bounded by **Router input characters**. Its exact bounded Jev request is recorded so the auxiliary model call remains reconstructable. Set the routing mode to `off` to prevent router calls and records; the explicit `jev_decide` tool remains available.

## Advisory and automatic routing

Configure one or more concrete **Fast route**, **Standard route**, and **Deep route** values as `provider/model`. In `advisory` mode, Jev presents its configured recommendation, confidence, probability gap, and risk through the DSH question UI. The route changes for that step only when the user chooses the recommended route; declining, cancelling, an unavailable question UI, or an unconfigured tier keeps the current route.

In `automatic` mode, a configured route is applied only when the recommendation and risk classifications meet both thresholds, risk is `low`, and ambiguity is not `high`. The operation changes only the model route; it never authorizes tools, deletion, payment, publication, credential access, permission changes, or other external actions.

Automatic fallback behavior is controlled by **Failure fallback**:

- `default-model` keeps the route DSH had already selected.
- `user-selection` asks for confirmation when Jev returned a recommendation with a configured target; otherwise it keeps the user's current route.
- `fail-closed` stops the model request after recording the reason.

Every Advisory prompt, answer outcome, automatic application, and fallback is recorded as an ignorable `plugin:dsh-jev/*` Session entry without credentials.

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
