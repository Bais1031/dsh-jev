# 里程碑 A 验收报告

验收日期：2026-10-27

范围：阶段 8 至阶段 11。里程碑只交付安全观测能力；自动模式仅有 `off` 和 `shadow`，不向主模型注入 Jev 结果，不修改 provider、model、reasoning effort 或工具权限。

## 总结

| 阶段 | 结果 | 主要证据 |
| --- | --- | --- |
| 8 范围收敛与迁移设计 | 通过 | 删除旧路由运行时与配置；旧记录名称与新决策记录隔离；迁移说明完成 |
| 9 Jev 决策协议 | 通过 | 固定版本问题集、受限词汇、运行时校验、最多三个候选方向、输入与结果接纳上限 |
| 10 关键节点触发器 | 通过 | 六类确定性节点、简单任务跳过、同一 turn/step 去重、冷却和在线 Agent Session 预算 |
| 11 Decision Shadow | 通过 | 成对 Session 记录、安全失败、取消传播、原路线对象保持不变、Session 摘要 API |

## 阶段 8

- 删除 `router.ts`、路由测试、fast/standard/deep 路线配置和 User Questions 依赖。
- 新安装默认 `decisionMode: off`，不存在自动模型切换路径。
- `router-request/result` 与 `decision-request/result` 使用不同记录类型；摘要测试验证旧路由记录不会被解释为新决策记录。
- `docs/stage-8-development-plan.md` 记录旧配置处理方式和行为变化。

## 阶段 9

- `jev-decision-guidance-v1` 策略和 `decision-brief-v1` 问题集固定版本。
- 协议只使用 Jev Boolean/Choice 输出，投影为任务类型、信息充分度、最多三个候选方向、下一动作、重点、避免项、风险、歧义和置信度。
- 非法答案、未知词汇和超出接纳上限的结果转为结构化失败，不进入任何主模型输入。
- 输入按 Unicode 字符截断。Jev API 当前没有生成 token 参数，因此 `decisionMaxOutputTokens` 是响应接纳上限；固定结构化问题限制响应内容，但该字段不承诺减少已经发生的上游计费。

## 阶段 10

- 触发器不调用其他模型，按固定优先级识别 `task-intake`、`missing-information`、`direction-selection`、`tool-recovery`、`progress-check` 和 `pre-conclusion`。
- 同一 turn/step 固定最多调用一次；冷却步数、在线 Agent Session 调用上限、进度节点和输入阈值可配置。
- 工具信号只读取名称、成功/失败和计数，不复制工具参数或结果内容。
- Agent 释放时删除触发状态；简单翻译、格式转换和无关键节点信号的短任务不触发。

## 阶段 11

- Shadow 在下游确定实际 `LlmCallConfig` 后运行，并返回同一个对象引用；Jev 结果不会进入主模型消息或配置。
- 每次尝试先写 `plugin:dsh-jev/decision-request`，再写配对的 `plugin:dsh-jev/decision-result`。
- Provider、协议和未知失败只记录安全结构化字段。API key、错误正文和原始上游响应不会进入失败记录。
- Provider 失败继续使用原路线；用户取消会记录取消结果并继续向上传播取消，不会被 Shadow 吞掉。
- `summarizeDecisionGuidance(session)` 汇总调用、成功、失败、未配对请求、Jev token、延迟和节点分布，不返回请求正文或答案。

## 自动化验收

最终验收命令：

```sh
pnpm test
pnpm typecheck
pnpm build
pnpm pack --dry-run
git diff --check
```

最终结果：9 个测试文件、57 个测试全部通过；类型检查、构建、npm 打包预检和差异格式检查均通过。测试使用模拟 HTTP transport，不需要真实 API key。测试期间依赖包 `@deepseek-ai/dsh-client-ui-primitives` 缺少发布的 source map 会产生 Vite 警告，但不影响测试、类型检查或构建结果。

## 未包含内容

- 不证明 Jev 已提高任务准确率或节省总 token；这些结论需要阶段 14–15 的指标和对照评估。
- 不包含 Advisory 上下文注入、Guided 干预或自动模型路由。
- 不包含真实 Jev API、Web/Desktop 人工界面、npm 发布或插件市场安装验收；这些属于后续阶段或需要外部凭证与发布操作。
