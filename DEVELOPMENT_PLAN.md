# dsh-jev 开发计划

## 产品目标

`dsh-jev` 为 DeepSeek Harness 提供快速、结构化的语义决策能力。确定性规则继续由普通代码处理；边界明确的分类、评分和真假判断交给 Jev；开放式推理与内容生成仍交给大模型。

只有当 Jev 的结果让系统跳过一次大模型调用，或安全地选择更轻量的模型时，路由才算真正节省 token。插件不得把 Jev 用作高风险操作的授权依据。

## 总体结构

```text
用户消息
  -> Jev Router Consumer
  -> DecisionService
  -> Jev Provider
  -> TypeSafe System One API
  -> 概率结果
  -> 确定性路由策略
  -> 快速模型 / 标准模型 / 深度模型 / 询问用户 / 默认回退

Agent
  -> jev_decide 工具
  -> DecisionService
```

第一版使用一个 npm 包交付。只有当 provider、工具、路由器需要独立发布或独立生命周期时，再拆分包。

## 阶段 0：项目骨架

目标：建立独立仓库、TypeScript ESM 构建、测试和发布元数据。

验收条件：

- Node.js `^22.19 || >=24` 下可构建。
- `pnpm test` 和 `pnpm typecheck` 可独立运行。
- 源码、测试和发布产物边界清晰。

## 阶段 1：Jev Wire Client

目标：实现与 TypeSafe System One API 通信的、与 DSH 无关的底层客户端。

范围：

- 支持 Noul、Choice、Score 和单次多问题请求。
- 支持调用方取消、客户端超时、输入大小上限和每次调用传入 API key。
- 对不可信 JSON 做运行时校验，验证答案名称、类型、候选项和评分档位。
- 提供稳定错误码：凭证缺失、认证失败、请求无效、超时、取消、限流、传输失败、服务端失败和响应无效。
- 不内置自动重试；上层策略拥有重试次数和总延迟预算。
- 使用模拟 HTTP 测试，不在常规测试中访问真实 API。

验收条件：

- 三种问题及混合问题请求均有成功测试。
- 超时、调用方取消、429、5xx、网络失败、非 JSON 和协议不匹配均有测试。
- 错误不泄露 API key 或完整上游响应。

## 阶段 2：DecisionService

目标：定义与具体决策模型无关的 DSH 能力接口，并由 Jev provider 实现。

范围：

- Service Definition、Jev Service Provider、Consumer 示例组成完整能力接缝。
- 定义请求、结果、取消、错误和可观测性接口。
- API key 通过 DSH Credentials 在每次操作时解析，不写入配置或 Session。

## 阶段 3：DSH 工具与插件包

目标：让 Agent 可以显式调用 `jev_decide`。

范围：

- 使用 `ctx.tools` 注册工具，使用 `ctx.effect()` 管理生命周期。
- 增加 `cordis.patch.yml` 和 `dsh.bundle.patch` 包元数据。
- 增加中英文 locale、README、安装和卸载说明。
- 记录所有进入模型的输入所需的 Session 事件或请求信息。

验收条件：插件可通过 `dsh plugin --profile web add /home/jzl/projects/dsh-jev` 安装；卸载后不残留注册或后台任务。

## 阶段 4：插件配置页

目标：在 DSH 的 Plugins 页面提供 Jev 配置入口，不新建重复的 Settings 页面。

配置项：

- API key 配置状态与凭证编辑入口。
- 路由模式：`off`、`shadow`、`advisory`、`automatic`。
- Jev 模型、失败回退策略、最低置信度和最低概率差。
- 高级项：API endpoint、超时、最大输入和指标开关。

DSH 自带的 bundle/row 开关负责装载与停用；配置页不再增加含义重复的 `enabled` 开关。

## 阶段 5：Shadow Router

目标：真实模型路线保持不变，只计算和记录 Jev 建议。

初始决策维度：任务类型、复杂度、是否需要最新信息、是否需要工具、是否需要委派、歧义程度和风险等级。

记录策略版本、模型、问题版本、概率、建议、实际路线、延迟和输入摘要。默认不复制完整用户消息。

## 阶段 6：Advisory Router

目标：向用户展示建议路线、原因所对应的结构化信号和置信度，由用户确认是否采用。

重点验证用户覆盖率、错误降级率和可理解性。

## 阶段 7：Automatic Router

目标：仅在低风险、允许自动化、置信度和概率差均超过阈值时自动路由。

失败规则：

- Jev 不可用、超时或响应无效时，回退到用户选择或默认模型，并保持错误可见。
- 删除、付款、发布、凭证和权限变更等高风险操作不得由 Jev 单独授权。
- 无法建立安全后置状态时停止依赖工作，不把捕获异常当成成功。

## 阶段 8：评估与发布

指标：大模型调用减少率、总 token、端到端 P50/P95、错误降级率、升级率、用户覆盖率、Brier/ECE 校准和任务成功率。

发布项：Git 仓库、npm 包、版本标签、兼容范围、隐私说明、升级/卸载说明和示例配置。

## 建议提交顺序

1. 初始化项目与开发计划。
2. 添加公开协议类型。
3. 添加结构化错误。
4. 实现请求构造和 HTTP 调度。
5. 实现响应校验。
6. 添加 Wire Client 测试。
7. 添加 DecisionService。
8. 接入 DSH Credentials 和工具。
9. 增加 bundle patch 与安装文档。
10. 增加配置页。
11. 增加 Shadow/Advisory Router。
12. 用评估门槛启用 Automatic Router。

## 当前进度

- [x] 阶段 0：项目骨架
- [x] 阶段 1：Jev Wire Client
- [ ] 阶段 2：DecisionService
- [ ] 阶段 3：DSH 工具与插件包
- [ ] 阶段 4：插件配置页
- [ ] 阶段 5：Shadow Router
- [ ] 阶段 6：Advisory Router
- [ ] 阶段 7：Automatic Router
- [ ] 阶段 8：评估与发布

## 外部协议依据

- [TypeSafe System One OpenAPI](https://api.typesafe.ai/openapi.json)
- [Introducing System One Models & Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev)
