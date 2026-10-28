# dsh-jev 开发计划

## 产品目标

`dsh-jev` 是 DeepSeek Harness 的 Jev 决策增强插件。插件在少量关键分析节点调用 Jev，向主模型提供短小、结构化、带置信度的决策简报，帮助主模型选择更有效的分析方向。

插件解决两个可测量的问题：提高关键决策的准确性；在任务成功率不下降的前提下，减少主模型的无效探索和每个成功任务的总 token 成本。

Jev 不选择或切换主模型，不替代主模型完成开放式推理，不执行工具，不授予权限，也不替代高风险操作所需的用户确认。主模型保留最终判断权。

## 成功标准

插件必须同时报告效果和成本，不能只统计主模型 token。总 token 包括主模型与 Jev 的全部输入和输出。

正式启用决策注入前必须通过对照评估。Advisory 模式只有在任务成功率不低于 Baseline，且每个成功任务的平均总 token 或无效工具调用显著下降时，才满足发布条件。

核心指标包括：

- 任务成功率和关键决策正确率。
- 主模型、Jev 及两者合计的输入和输出 token。
- Agent step、工具调用、重复工具调用和无新增证据步骤的数量。
- Jev 调用次数、触发原因、延迟、采纳率、纠正率和错误引导率。
- 端到端 P50/P95 延迟和每个成功任务的总成本。

## 目标处理流程

```text
用户任务
  -> 本地确定性触发器判断是否到达关键分析节点
  -> 非关键节点：主模型正常工作，不调用 Jev
  -> 关键节点：构造有界、脱敏的 Jev 请求
  -> Jev 返回结构化决策简报
  -> 校验格式、置信度、风险和调用预算
  -> Shadow：只记录，不影响主模型
  -> Advisory：把合格简报作为辅助上下文提供给主模型
  -> 主模型独立判断并继续分析或使用工具
  -> 记录结果、token、延迟和任务效果
```

确定性规则负责判断是否触发 Jev，不能为了决定“是否调用 Jev”再调用一个模型。单次请求必须限制输入字符数和输出 token；每个 step 和 Session 必须限制调用次数，并设置冷却步数。

## 决策增强模式

- `off`：不自动调用 Jev；显式 `jev_decide` 工具仍可使用。
- `shadow`：在关键节点调用并记录 Jev，但不向主模型提供结果。
- `advisory`：将通过校验的 Jev 决策简报注入当前模型请求，由主模型决定是否采用。
- `guided`：在 Advisory 评估通过后，允许 Jev 建议追问、重新评估、停止重复探索或进行高风险确认，但不获得工具权限。

第一版决策增强功能只交付 `off`、`shadow` 和 `advisory`。`guided` 必须在 Advisory 的准确性、安全性和总成本评估通过后开发。

## 已完成的基础能力

阶段 0 至阶段 4 仍是决策增强功能可复用的基础。

- [x] 阶段 0：TypeScript ESM 项目、测试、构建和发布元数据。
- [x] 阶段 1：TypeSafe System One API Wire Client、运行时响应校验和结构化错误。
- [x] 阶段 2：与具体 provider 解耦的 `DecisionService`。
- [x] 阶段 3：DSH Credentials、Cordis Service 和显式 `jev_decide` 工具。
- [x] 阶段 4：DSH Plugins 配置页面及配置持久化。

阶段 5 至阶段 7 已实现模型路由，但不再代表产品目标。重构期间保留其代码和测试作为迁移依据；新安装默认不得自动切换模型。

- [x] 阶段 5：旧版 Shadow Router。
- [x] 阶段 6：旧版 Advisory Router。
- [x] 阶段 7：旧版 Automatic Router。

## 阶段 8：范围收敛与迁移设计

目标：停止扩展模型路由，明确 Jev、主模型和 DSH 的职责，并确定旧配置和 Session 记录的迁移方式。

开发内容：

- 审查 `router.ts`、插件配置、Session 事件和现有测试。
- 复用 Jev Client、Credentials、配置页面、结构化校验、Shadow 记录和失败回退能力。
- 将 `fastRoute`、`standardRoute`、`deepRoute` 和自动模型切换标记为旧版功能。
- 定义旧配置的兼容期限、默认行为和移除版本。
- 定义 `router-request/result` 到 `decision-request/result` 的读取与写入策略。
- 更新产品说明，明确插件不会在新模式中更改用户选择的模型。

验收条件：

- 新旧功能的运行条件和配置含义没有歧义。
- 新安装默认不启用模型切换。
- 已安装用户有明确的配置迁移路径。
- Session 兼容策略经过测试，旧记录不会被误解为决策增强记录。

## 阶段 9：Jev 决策协议

目标：定义短小、可校验、可度量的决策简报，避免生成长篇分析。

建议协议：

```ts
interface JevDecisionBrief {
  version: 1
  nodeType:
    | "task-intake"
    | "missing-information"
    | "direction-selection"
    | "tool-recovery"
    | "progress-check"
    | "pre-conclusion"
  taskType: string
  informationSufficient: boolean
  hypotheses: Array<{
    label: string
    probability: number
  }>
  recommendedAction:
    | "continue"
    | "ask-user"
    | "inspect-context"
    | "search"
    | "use-tool"
    | "change-direction"
    | "answer"
    | "stop"
  focus: string[]
  avoid: string[]
  riskLevel: "low" | "medium" | "high"
  ambiguity: "low" | "medium" | "high"
  confidence: number
}
```

协议限制最多三个候选方向，并限制 `focus`、`avoid`、字段长度和整体输出 token。插件拒绝超长响应、未知字段组合、无效概率和无法识别的协议版本。决策简报只提供辅助信号，不声明未经主模型验证的事实。

验收条件：

- Schema 有运行时校验和完整单元测试。
- 非法响应不会进入主模型上下文。
- 单次 Jev 调用的输入和输出均有硬上限。
- Jev 请求不要求输出隐藏思维过程。
- 错误和日志不包含 API key 或未经允许的敏感内容。

## 阶段 10：关键节点触发器

目标：只在可能改变分析方向的节点调用 Jev。

第一批节点包括：

- `task-intake`：多步诊断、方案比较、架构设计、多工具协作或明显高风险任务的入口。
- `missing-information`：缺少关键参数、目标冲突或证据不足，主模型可能开始猜测。
- `direction-selection`：存在多个排查、实现或工具方向，需要确定优先级。
- `tool-recovery`：同类工具连续失败、结果矛盾或重复操作没有新增信息。
- `progress-check`：连续多步没有新增证据，或已接近配置的 step/token 预算。
- `pre-conclusion`：高风险或证据复杂的任务准备形成最终结论。

简单翻译、格式转换、明确的单步操作和普通闲聊默认不触发。触发器使用 Session 状态、工具结果类型、失败计数、重复动作和可配置阈值，不依赖额外模型调用。

建议配置：

```yaml
decisionGuidance:
  mode: shadow
  enabledNodes:
    - task-intake
    - tool-recovery
    - progress-check
  cooldownSteps: 3
  maxCallsPerStep: 1
  maxCallsPerSession: 8
  minConfidence: 0.70
  inputCharacterLimit: 6000
  outputTokenLimit: 250
```

验收条件：

- 简单任务不会调用 Jev。
- 同一节点不会因模型重试而重复调用。
- 冷却时间、单步上限和 Session 上限均可配置并有测试。
- `off` 模式不产生后台 Jev 请求或决策记录。
- 每种触发原因都能从 Session 记录中确定。

## 阶段 11：Decision Shadow

目标：在不改变主模型输入和行为的情况下验证 Jev 建议。

每次调用记录节点类型、触发原因、经过限制的请求、结构化建议、置信度、概率、Jev token、延迟和失败信息。后续记录主模型实际动作、工具调用和任务结果，以便比较 Jev 建议与实际路线。

验收条件：

- Shadow 结果不会进入主模型请求。
- Jev 超时、无效响应和服务不可用不会阻断主模型。
- Session 可以重建发送给 Jev 的模型可见输入。
- 日志和导出不包含凭证。
- 单次 Session 可以生成 Jev 调用与成本摘要。

## 阶段 12：Decision Advisory

目标：把合格的 Jev 决策简报作为辅助上下文提供给主模型，同时保留主模型的最终判断权。

注入文本必须明确标记为 Jev 辅助信息，包含节点、推荐动作、候选方向、应避免的方向、风险和置信度，并要求主模型结合原始证据独立判断。低置信度、格式无效、超出预算或包含不允许内容的结果不能注入。

验收条件：

- 所有进入主模型的 Jev 内容都写入 Session，并可在重放时重建。
- 每份简报只在对应节点注入一次，不在后续请求中无界重复。
- 主模型可以接受、部分接受或拒绝建议。
- Jev 不可用时，主模型按原始流程继续。
- 决策简报不会授予工具或外部操作权限。
- 测试覆盖成功注入、低置信度忽略、校验失败、超时和取消。

## 阶段 13：配置页面重构

目标：让用户配置决策增强，而不是配置模型强弱路线。

配置页面提供：

- 总开关和 `off`、`shadow`、`advisory` 模式。
- Jev endpoint、模型、凭证状态和“测试连接”操作。
- 可启用的关键节点。
- 最低置信度、输入字符上限和输出 token 上限。
- 每个 step 与 Session 的调用上限和冷却步数。
- 是否允许发送经过限制的工具结果摘要。
- 当前 Session 的调用次数和成本摘要。
- 数据发送范围、隐私和失败回退说明。

旧版模型路由配置进入清楚标记的兼容区域，并在迁移期限结束后移除。

验收条件：

- 用户可以在保存前理解哪些数据会发送给 Jev。
- 无效配置在最早可判断的位置显示可操作错误。
- “测试连接”不创建 Agent 任务，也不泄露凭证。
- 配置持久化、重新加载、关闭插件和 390px 小屏布局通过浏览器验收。
- 浏览器控制台没有插件产生的错误。

## 阶段 14：本地指标与报告

目标：计算 Jev 带来的完整成本和可观察效果。

插件按 Session 和节点类型聚合主模型 token、Jev token、总 token、调用次数、工具次数、重复操作、Agent step、延迟、建议采纳情况和任务结果。报告支持 JSON 和 Markdown，指标默认只保存在本地。

验收条件：

- 报告明确区分主模型、Jev 和总 token。
- 失败、取消和无 token usage 的调用不会被计算为成功。
- 可以比较 `baseline`、`shadow` 和 `advisory`。
- 可以回答每个成功任务的平均总成本是否下降。
- 导出内容经过凭证和敏感字段检查。

## 阶段 15：评估数据集与 A/B 验证

目标：用可重复实验判断 Jev 是否提高准确性并减少无效探索。

数据集覆盖简单任务、信息不足、多路径诊断、编码调试、工具失败、高风险操作、错误 Jev 建议、Jev 超时、提示注入和敏感数据。相同任务分别运行 Baseline、Shadow 和 Advisory，并记录成功率、关键决策、总 token、工具次数、步骤数和总延迟。

发布 Advisory 的最低条件：

- 任务成功率不低于 Baseline。
- 关键决策正确率的提升可以重复观察。
- 每个成功任务的平均总 token 或无效工具调用下降。
- 简单任务的误触发率低于预设阈值。
- Jev 错误建议不会自动触发高风险操作。
- Brier Score、ECE 或其他校准指标能够解释置信度阈值。

未达到条件时，插件保持 Shadow 默认模式，并根据失败数据调整协议或触发器；不得用个别成功案例替代整体评估。

## 阶段 16：Guided 模式

目标：在 Advisory 通过阶段 15 后，提供有上限、可回退的流程建议。

Guided 可以建议主模型先向用户追问、停止重复调用、在预算耗尽前重新评估、检查矛盾证据或在高风险结论前请求确认。Guided 不能批准工具权限、执行危险操作、覆盖用户明确指令或把 Jev 输出视为事实。

验收条件：

- 每种干预都有次数上限、冷却时间和失败回退。
- Jev 不可用时不破坏 DSH 的基本任务流程。
- 高风险操作仍由 DSH 权限机制和用户确认管理。
- Session 可以解释触发节点、建议内容和实际采用结果。
- Guided 的任务成功率和总成本通过独立对照评估。

## 阶段 17：文档、发布与插件市场

目标：在功能和评估通过后交付可重复安装、可升级和可卸载的版本。

发布内容包括中英文 README、工作原理、配置说明、隐私说明、成本计算、失败回退、旧路由迁移、故障排查、已知限制和评估结果。发布流程包括 CI、干净环境安装、Web/Desktop 验收、Headless 支持决策、npm 包内容检查、Git tag、GitHub Release 和插件市场安装测试。

验收条件：

- 文档不再把模型路由描述为插件的主要能力。
- 安装、升级、禁用和卸载路径均经过实际测试。
- npm 包不包含凭证、测试私有数据或不需要的构建文件。
- 插件市场安装版本通过配置、连接、Shadow 和 Advisory 验收。
- 最终报告列出实际执行的检查；未执行的外部发布操作明确标记为待完成。

## 实施里程碑

### 里程碑 A：安全观测

完成阶段 8 至阶段 11。插件建立新协议和关键节点触发器，只在 Shadow 模式收集数据，不改变主模型行为。

### 里程碑 B：决策增强 MVP

完成阶段 12 至阶段 15。插件能够向主模型提供决策简报，并用 Baseline、Shadow 和 Advisory 对照结果验证准确性与总成本。

### 里程碑 C：产品化

完成阶段 16 和阶段 17。只有 Advisory 达到发布条件后才开发 Guided，随后完成发布和插件市场验收。

每个阶段必须独立验收。验收未通过时，不进入依赖该结果的下一阶段。

## 当前进度

- [x] 阶段 0–4：可复用基础能力。
- [x] 阶段 5–7：旧版模型路由实现，等待迁移。
- [x] 阶段 8：范围收敛与迁移设计。
- [x] 阶段 9：Jev 决策协议。
- [x] 阶段 10：关键节点触发器。
- [x] 阶段 11：Decision Shadow。
- [x] 阶段 12：Decision Advisory。
- [x] 阶段 13：配置页面重构。
- [x] 阶段 14：本地指标与报告。
- [x] 阶段 15：评估数据集与 A/B 验证。合成验收只证明评估管线可重复，Advisory 的真实数据发布门禁仍保持关闭。
- [ ] 阶段 16：Guided 模式。
- [ ] 阶段 17：文档、发布与插件市场。

## 外部协议依据

- [TypeSafe System One OpenAPI](https://api.typesafe.ai/openapi.json)
- [Introducing System One Models & Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev)
