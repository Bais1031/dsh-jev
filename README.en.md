# dsh-jev

[![中文](https://img.shields.io/badge/语言-中文-2f81f7)](./README.md) [![English](https://img.shields.io/badge/Language-English-6e7781)](./README.en.md)

TypeSafe Jev decision guidance for DeepSeek Harness. The plugin calls Jev at critical analysis nodes selected by deterministic rules and records short probabilistic decision briefs for later evaluation of decision accuracy and unproductive main-model exploration.

The plugin supports `off`, `shadow`, and `advisory`. Shadow only records analysis; Advisory adds briefs that pass protocol and confidence checks to the current model request. Neither mode changes the provider, model, or reasoning effort selected by DSH or grants tool permissions. See the [development plan](./DEVELOPMENT_PLAN.md) for the stages and acceptance order and the [Milestone A](./docs/milestone-a-acceptance.md) and [Milestone B](./docs/milestone-b-acceptance.md) acceptance reports for evidence.

## Installation

The plugin is not published to npm. Build this checkout, then install it into the DSH Web profile:

```sh
pnpm install
pnpm build
dsh plugin --profile web add /home/jzl/projects/dsh-jev
```

When running from the DSH source checkout, run `pnpm dsh plugin --profile web add /home/jzl/projects/dsh-jev` in the DSH repository. Other profiles must provide Credentials, Tools, Agent, and Session services. The stock one-shot `headless` profile disables interactive credential storage and cannot currently load this plugin.

The bundle adds one `dsh-jev` row. Open **Plugins**, select **dsh-jev**, then select its inner **dsh-jev** component to configure it. Set `JEV_API_KEY` through DSH Credentials or the Harness process environment; do not place the key itself in `cordis.patch.yml`.

## Configuration

The following profile configuration enables Advisory and limits critical nodes, call frequency, and Jev input and output. Set `decisionMode` to `shadow` to record briefs without injection:

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
    decisionMode: advisory
    decisionNodes:
      - task-intake
      - tool-recovery
      - progress-check
    decisionCooldownSteps: 3
    decisionMaxCallsPerSession: 8
    decisionProgressCheckStep: 4
    decisionMinimumTaskInputCharacters: 200
    decisionMaxInputCharacters: 6000
    decisionMaxOutputTokens: 250
    decisionMinimumConfidence: 0.7
    decisionIncludeToolResultSummaries: false
    decisionToolResultSummaryCharacters: 1000
```

`decisionMaxOutputTokens` is a result-acceptance limit. The current System One call does not expose a generation-token limit that this plugin can set, so an oversized response is recorded as a failure after its upstream usage has already occurred.

Plugin settings are live volatile fields; later calls read saved values without a restart. The API key field writes through DSH Credentials and the browser never reads the secret back. Test connection asks the Host to make one small, potentially billable Jev request with saved settings; it creates no Agent or Session, and the page receives only the model and latency or a safe error code. The page also shows content-free totals for the latest live Session plus data-scope and fallback explanations. `providerName` identifies the registered Decision provider and remains fixed for the lifetime of the loaded component.

## Critical nodes

The local trigger does not call a model to decide whether Jev is needed. It selects one enabled node in priority order:

- `tool-recovery`: the previous step has a failed tool result.
- `pre-conclusion`: the previous step produced successful tool evidence and the next step has no new text.
- `progress-check`: the step reaches the configured progress threshold.
- `missing-information`: the current text contains an explicit missing-information or clarification signal.
- `direction-selection`: the current text contains comparison, choice, or alternative signals.
- `task-intake`: the first step contains a complex-task signal or reaches the configured character threshold.

The trigger deduplicates one turn/step and enforces a cooldown and per-live-Agent-Session call limit. A short translation, format conversion, or task without a critical-node signal does not call Jev automatically.

By default, only current user text bounded by the total character limit is sent. Enabling `decisionIncludeToolResultSummaries` may add a bounded text-only excerpt from the immediately preceding tool result; tool arguments and binary blocks are always excluded. A current user message matching a likely credential suppresses the Jev call, and a matching tool-result block is excluded from the excerpt.

## Shadow and Advisory

When a critical node is selected, the plugin first writes an ignorable `plugin:dsh-jev/decision-request` with protocol versions, trigger evidence, non-content signals, input statistics, and the exact bounded Jev request. It then writes a paired `plugin:dsh-jev/decision-result` containing either the structured brief or a secret-free failure, latency, and token usage.

Library consumers can call `summarizeDecisionGuidance(session)` to aggregate calls, outcomes, Jev tokens, latency, and node distribution locally. The summary omits request content and answers.

The decision brief uses fixed vocabularies for task type, information sufficiency, recommended action, candidate directions, behavior to avoid, risk, ambiguity, and confidence. The protocol retains at most three candidate directions and does not ask Jev for hidden reasoning or unrestricted prose.

Shadow only stores these records and does not change main-model input. Advisory adds a source-attributed brief that passes validation and the minimum confidence threshold to the current step. Both the message and exact brief record enter the Session, so replay can reconstruct the model input. The brief tells the main model to assess the original evidence independently and permits it to accept, adapt, or reject the advice.

A Jev timeout, invalid response, low confidence, or output-limit rejection injects no content and does not replace or block the main-model route; the current step only incurs Jev call latency. The brief contains fixed protocol values rather than Jev free text and explicitly cannot authorize tools, deletion, payment, publication, credential access, or permission changes.

Set `decisionMode` to `off` to prevent automatic Jev calls and decision records. The explicit `jev_decide` tool remains available.

## Local reports and evaluation

`createDecisionGuidanceReport(session)` aggregates main-model tokens, Jev tokens, total tokens, Agent steps, tool calls, repeated tool calls, latency, Advisory adoption labels, and task outcomes. `renderDecisionGuidanceReportJson` and `renderDecisionGuidanceReportMarkdown` export content-free metrics only; they do not copy messages, Jev requests, answers, tool arguments, or credentials. An evaluator must label task success and adoption explicitly with `recordDecisionGuidanceOutcome`; a normal `turn/end: completed` does not establish correctness.

The versioned evaluation dataset covers simple tasks, missing information, multi-path diagnosis, coding debug, tool failure, high-risk operations, incorrect advice, Jev timeout, prompt injection, and sensitive data. Run its repeatable controlled acceptance with:

```sh
pnpm eval
```

The evaluator runs Baseline, Shadow, and Advisory for the same tasks and reports success rate, critical-decision accuracy, average total tokens per successful task, unproductive tool calls, steps, latency, mis-trigger rate, Brier Score, and ECE. Synthetic evidence validates the evaluation pipeline but cannot open the release gate; Advisory needs complete, paired, repeatable real runs that satisfy every condition. Users still select the active mode explicitly.

## Explicit decision tool

An Agent can call `jev_decide` with multiple named Boolean, Choice, and Score questions. The plugin resolves credentials for every operation and returns provider, model, latency, token usage, and structured probabilities.

For Boolean answers, `value` uses a `0.5` threshold as a convenience projection. Safety policy must read `probability` with deterministic rules and must not use a Jev answer to authorize deletion, payment, publication, credential, or permission operations.

## Model-routing migration

The former Shadow, Advisory, and Automatic model router has been removed. The plugin no longer reads `fastRoute`, `standardRoute`, `deepRoute`, or routing fallback fields, and it never changes the user's selected model. See the [stage 8 migration](./docs/stage-8-development-plan.md) for removed fields and historical Session record behavior.

## Development

```sh
pnpm install
pnpm test
pnpm eval
pnpm typecheck
pnpm build
```

Normal tests and `pnpm eval` use mocked or synthetic transports and do not require `JEV_API_KEY`. The current code contains the decision protocol, critical-node trigger, Shadow, Advisory, local metrics, and the three-mode evaluation pipeline. Stage 16 Guided mode is not implemented; stronger intervention remains disabled until real evaluation shows no success regression, improved critical decisions, and lower cost or unproductive exploration.

## Plugin market

The repository is organized for future DeepSeek Harness plugin-market distribution but is not published or listed. Release still requires real-API qualification, privacy documentation, clean-profile installation, CI, npm/GitHub Release, and market installation tests. See [MARKETPLACE.md](./MARKETPLACE.md) for submission requirements.
