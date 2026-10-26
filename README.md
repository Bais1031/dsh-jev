# dsh-jev

[![中文](https://img.shields.io/badge/语言-中文-2f81f7)](./README.md) [![English](https://img.shields.io/badge/Language-English-6e7781)](./README.en.md)

为 DeepSeek Harness 提供 TypeSafe Jev 结构化决策和模型路由。当前实现包含 System One HTTP 客户端、与 provider 无关的 `DecisionService`、`jev_decide` 工具、插件页配置，以及 Shadow、Advisory 和 Automatic 三种路由模式。

阶段 0 至阶段 7 已在本地实现。阶段 8 包含真实 API 验收、本地指标、概率校准、发布文档、CI、npm 发布和插件市场验收。请参阅[阶段总览](./DEVELOPMENT_PLAN.md)和[阶段 8 详细计划](./docs/stage-8-development-plan.md)。

## 在 DeepSeek Harness 中安装

插件尚未发布到 npm。请先构建，再把当前源码目录安装到 profile：

```sh
pnpm install
pnpm build
dsh plugin --profile web add /home/jzl/projects/dsh-jev
```

从 DSH 源码目录运行时，请在 DSH 仓库中执行 `pnpm dsh plugin --profile web add /home/jzl/projects/dsh-jev`。其他 profile 必须提供 DSH Credentials 和 Tools 服务；内置的一次性 `headless` profile 会主动关闭交互式凭证存储，因此不能加载本插件。

Bundle 会增加一个 `dsh-jev` 条目，Plugin Manager 可以停用、启用、更新、卸载和配置该条目。依次打开**插件**、选择 **dsh-jev**，再选择内部的 **dsh-jev** 组件条目，即可进入配置表单。请通过 DSH Credentials 或 Harness 进程环境设置 `JEV_API_KEY`，不要把密钥原文写入 `cordis.patch.yml`。

## 配置

配置表单可以在不重启 DSH 的情况下修改凭证引用、endpoint、模型、超时、输入限制、路由模式、回退策略、路由阈值和阶段 8 指标预留项。无论该预留项取何值，必要的路由审计记录都会保留。在阶段 8.2 完成前，指标开关不会聚合或显示统计数据。API 密钥由 DSH Credentials 写入，浏览器不会回读密钥。Provider 名称用于标识已注册的决策 provider，因此在组件本次装载期间保持固定。

默认 Bundle 配置使用 `JEV_API_KEY`、`jev-latest` 和 TypeSafe System One endpoint。下面是一份包含可选层级路线的完整 profile 配置示例：

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

如果当前 DSH 进程在插件重新构建或更新之前已经启动，请重启一次，使进程加载最新配置 schema 和客户端 Bundle。

插件激活后，Agent 可以调用 `jev_decide`，一次提交多个具名 Boolean、Choice 和 Score 问题。工具调用和结果使用普通 DSH Session 日志。插件在每次操作时解析凭证，工具参数和结果都不会包含凭证值。

## Shadow 路由

把**路由模式**设为 `shadow` 后，插件会在每个新接纳的 Agent step 前评估路由建议。Shadow 模式不会修改 DSH 选择的 provider、模型或 reasoning effort。插件在请求前记录一条可忽略的 `plugin:dsh-jev/router-request`，再记录配对的 `plugin:dsh-jev/router-result`，其中包含任务信号、概率、建议、实际路线、延迟和 token usage。Provider 失败会记录为不含凭证的结构化故障，实际路线保持不变。

路由器只发送当前已接纳用户批次中的文本，并受**路由输入字符上限**约束。插件会记录发送给 Jev 的精确有界请求，使辅助模型调用可以从 Session 重建。把路由模式设为 `off` 后，路由器不会产生调用和记录，但显式的 `jev_decide` 工具仍可使用。

## Advisory 和 Automatic 路由

可以把一个或多个**快速路线**、**标准路线**和**深度路线**配置为 `provider/model`。在 `advisory` 模式下，Jev 通过 DSH 问题界面展示已配置的推荐路线、置信度、概率差和风险。只有用户选择推荐路线后，当前 step 才会切换路线；拒绝、取消、问题界面不可用或推荐层级未配置时，插件都会保留当前路线。

在 `automatic` 模式下，只有当推荐路线和风险分类都满足两个阈值、风险为 `low`、歧义不为 `high`，并且目标路线已配置时，插件才会应用该路线。此操作只改变模型路线，不会授权工具、删除、付款、发布、凭证访问、权限变更或其他外部操作。

**失败回退策略**控制 Automatic 模式的回退行为：

- `default-model` 保留 DSH 已选择的路线。
- `user-selection` 在 Jev 返回建议且目标路线已配置时请求用户确认；其他情况保留用户的当前路线。
- `fail-closed` 在记录原因后停止模型请求。

每个 Advisory 提示、用户选择结果、Automatic 应用和回退都会写入不含凭证的可忽略 `plugin:dsh-jev/*` Session 记录。

## 开发

```sh
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

普通测试使用模拟 HTTP transport，不需要 `JEV_API_KEY`。

剩余工作拆分为独立验收的阶段 8 增量：

1. 真实 API 验收和“测试连接”操作。
2. 本地指标以及 JSON 和 Markdown 报告。
3. 带标签的评估数据和概率校准。
4. 隐私、升级、卸载、故障排查和双语发布文档。
5. CI、干净 profile 安装和 Headless 支持决策。
6. npm 和 GitHub 发布。
7. 社区目录提交和市场安装验收。

[阶段 8 开发计划](./docs/stage-8-development-plan.md)是这些增量范围和验收条件的唯一详细计划。

## DecisionService

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

Service 会在每次操作时解析凭证，传播取消信号，并返回 provider、模型、延迟、token usage 和结构化概率。它不会隐式选择回退 provider；回退和授权策略由 consumer 负责。

对于 Boolean 答案，`value` 使用 `0.5` 阈值提供便捷投影。安全策略应使用 `probability` 和确定性规则，不能把 `value` 当作授权依据。

## 插件市场

仓库已按未来 DeepSeek Harness 插件市场发布要求组织，但尚未列出或发布。请参阅[阶段 8 开发计划](./docs/stage-8-development-plan.md)了解发布顺序，并参阅 [MARKETPLACE.md](./MARKETPLACE.md)了解 `awesome-dsh-plugin` 提交清单。
