# dsh-jev

[![中文](https://img.shields.io/badge/语言-中文-2f81f7)](./README.md) [![English](https://img.shields.io/badge/Language-English-6e7781)](./README.en.md)

为 DeepSeek Harness 提供 TypeSafe Jev 结构化决策增强。插件在确定性规则识别出的关键分析节点调用 Jev，记录短小、带概率的决策简报，帮助后续评估如何提高主模型决策准确性并减少无效探索。

插件提供 `off`、`shadow` 和 `advisory`。Shadow 只记录分析；Advisory 将通过协议和置信度校验的简报加入当前模型请求。两种模式都不修改 DSH 选择的 provider、模型或 reasoning effort，也不授予工具权限。阶段总览和验收顺序见[开发计划](./DEVELOPMENT_PLAN.md)，完成证据见[里程碑 A](./docs/milestone-a-acceptance.md)和[里程碑 B](./docs/milestone-b-acceptance.md)验收报告。

## 安装

插件尚未发布到 npm。先构建当前源码，再安装到 DSH Web profile：

```sh
pnpm install
pnpm build
dsh plugin --profile web add /home/jzl/projects/dsh-jev
```

从 DSH 源码目录运行时，在 DSH 仓库执行 `pnpm dsh plugin --profile web add /home/jzl/projects/dsh-jev`。其他 profile 必须提供 Credentials、Tools、Agent 和 Session 服务；内置一次性 `headless` profile 会关闭交互式凭证存储，当前不能加载本插件。

Bundle 增加一个 `dsh-jev` 条目。依次打开**插件**、选择 **dsh-jev**，再选择内部的 **dsh-jev** 组件即可配置。通过 DSH Credentials 或 Harness 进程环境设置 `JEV_API_KEY`，不要把密钥原文写入 `cordis.patch.yml`。

## 配置

下面的 profile 配置启用 Advisory，并限制关键节点、调用频率和 Jev 输入输出。把 `decisionMode` 改为 `shadow` 可以只记录简报：

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

`decisionMaxOutputTokens` 是结果接受上限。System One 当前调用接口没有由本插件设置的生成 token 上限，因此超过该值的响应会被记录为失败，但已经产生的上游用量无法撤销。

插件配置使用 live volatile 字段；保存后后续调用读取新值。API 密钥由 DSH Credentials 写入，浏览器不会回读密钥。配置页的“测试连接”通过 Host 使用已保存配置发起一次小型、可能计费的 Jev 请求，不创建 Agent 或 Session；页面只接收模型、延迟或安全错误码。配置页还显示最近在线 Session 的无内容调用摘要、数据范围和失败回退说明。`providerName` 标识已注册的 Decision provider，因此在组件本次装载期间固定。

## 关键节点

本地触发器不调用模型来判断是否需要 Jev，并按优先级选择一个已启用节点：

- `tool-recovery`：上一步存在失败的工具结果。
- `pre-conclusion`：上一步取得成功工具证据，下一步没有新的文本输入。
- `progress-check`：step 达到配置的进展检查阈值。
- `missing-information`：当前文本包含明确的信息缺失或澄清信号。
- `direction-selection`：当前文本包含比较、选择或替代方案信号。
- `task-intake`：首个 step 包含复杂任务信号，或文本达到配置的字符阈值。

触发器对同一个 turn/step 去重，并执行冷却步数和每个在线 Agent Session 的调用上限。简单翻译、格式转换和没有关键节点信号的短任务不会自动调用 Jev。

默认只发送经过总字符上限限制的当前用户文本。启用 `decisionIncludeToolResultSummaries` 后，可以附带紧邻上一步工具结果的有限纯文本；工具参数和二进制块始终排除。当前用户文本匹配疑似凭证时不调用 Jev，工具结果摘录匹配疑似凭证时排除该摘录。

## Shadow 与 Advisory

命中关键节点后，插件先写入可忽略的 `plugin:dsh-jev/decision-request`，其中包含版本、触发原因、非内容信号、输入统计和发送给 Jev 的精确有界请求。随后写入配对的 `plugin:dsh-jev/decision-result`，记录结构化简报或不含凭证的失败、延迟和 token usage。

库使用者可以调用 `summarizeDecisionGuidance(session)`，在本地汇总当前 Session 的调用、结果、Jev token、延迟和节点分布；摘要不返回请求正文或答案。

决策简报使用固定词汇表达任务类型、信息充分度、推荐动作、候选方向、应避免行为、风险、歧义和置信度。协议最多保留三个候选方向，不要求 Jev 输出隐藏思维过程或自由展开的长篇分析。

Shadow 只保存上述记录，不改变主模型输入。Advisory 把通过校验和最低置信度阈值的简报作为带来源的消息加入当前 step；该消息与精确简报记录都进入 Session，因此重放可以重建模型输入。简报要求主模型结合原始证据独立判断，并允许接受、调整或拒绝建议。

Jev 超时、无效响应、低置信度或输出超限不会注入内容，也不会替换或阻止主模型路线；当前 step 只会增加 Jev 调用延迟。简报使用固定协议值，不包含 Jev 自由文本，并明确不能授权工具、删除、付款、发布、凭证访问或权限变更。

把 `decisionMode` 设为 `off` 后，自动触发器不会调用 Jev，也不会写入决策记录；显式 `jev_decide` 工具仍然可用。

## 本地报告与评估

`createDecisionGuidanceReport(session)` 聚合主模型 token、Jev token、总 token、Agent step、工具调用、重复工具调用、延迟、Advisory 采纳标签和任务结果。`renderDecisionGuidanceReportJson` 与 `renderDecisionGuidanceReportMarkdown` 只导出无内容指标，不复制消息、Jev 请求、答案、工具参数或凭证。任务成功和建议采纳必须由评估器通过 `recordDecisionGuidanceOutcome` 明确标注；普通 `turn/end: completed` 不等同于结果正确。

版本化评估集覆盖简单任务、信息不足、多路径诊断、编码调试、工具失败、高风险操作、错误建议、Jev 超时、提示注入和敏感数据。运行可重复的受控验收：

```sh
pnpm eval
```

评估器对相同任务运行 Baseline、Shadow 和 Advisory，输出成功率、关键决策正确率、每个成功任务平均总 token、无效工具调用、step、延迟、误触发率、Brier Score 和 ECE。合成数据只能验证评估管线，不能开放发布门禁；Advisory 必须使用完整、成对、可重复的真实运行数据满足所有条件后才能被批准发布。当前默认仍由用户明确选择模式。

## 显式决策工具

Agent 可以调用 `jev_decide`，一次提交多个具名 Boolean、Choice 和 Score 问题。插件在每次操作时解析凭证，并返回 provider、模型、延迟、token usage 和结构化概率。

Boolean 答案的 `value` 使用 `0.5` 阈值提供便捷投影。安全策略应读取 `probability` 并结合确定性规则，不能把 Jev 的答案用作删除、付款、发布、凭证或权限操作的授权依据。

## 模型路由迁移

旧版 Shadow、Advisory 和 Automatic 模型路由已经移除。插件不再读取 `fastRoute`、`standardRoute`、`deepRoute` 或路由回退字段，也不会更改用户选择的模型。迁移字段和历史 Session 记录规则见[阶段 8 说明](./docs/stage-8-development-plan.md)。

## 开发

```sh
pnpm install
pnpm test
pnpm eval
pnpm typecheck
pnpm build
```

普通测试和 `pnpm eval` 使用模拟或合成 transport，不需要 `JEV_API_KEY`。当前代码包括决策协议、关键节点触发器、Shadow、Advisory、本地指标和三模式评估管线。阶段 16 的 Guided 模式仍未开发；只有真实评估证明成功率不下降、关键决策改善且成本或无效探索下降后才会启用更强干预。

## 插件市场

仓库已按未来 DeepSeek Harness 插件市场发布要求组织，但尚未发布或收录。发布前还需要真实 API 验收、隐私说明、干净 profile 安装、CI、npm/GitHub Release 和市场安装测试。提交要求见 [MARKETPLACE.md](./MARKETPLACE.md)。
