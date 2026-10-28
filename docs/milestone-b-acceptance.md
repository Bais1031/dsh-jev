# 里程碑 B：决策增强 MVP 验收报告

验收日期：2026-10-27。

里程碑 B 包含阶段 12 至阶段 15。实现提供有界、可重建且不授予权限的 Jev 决策简报，并建立 Baseline、Shadow 和 Advisory 的本地成本报告与可重复评估管线。

## 总结

- 阶段 12：通过。
- 阶段 13：通过。
- 阶段 14：通过。
- 阶段 15：实现与合成管线验收通过；真实数据的 Advisory 发布门禁保持关闭。
- 全量自动化：12 个测试文件、78 个测试通过。
- 生产构建：通过。
- 真实 DSH Web：插件 Host、Typert Remote 和浏览器包加载通过；390×844 配置页无横向溢出，控制台无插件错误。

## 阶段 12：Decision Advisory

实现结果：

- `advisory` 只在确定性关键节点调用 Jev，并把通过协议、输出预算和最低置信度校验的简报加入当前 step。
- 注入内容使用固定协议词汇，包含节点、推荐动作、候选方向、应避免行为、风险、歧义和置信度。
- 简报标明为非权威辅助信息，要求主模型独立验证，并明确不授予工具或外部操作权限。
- 精确注入文本和请求、结果关联写入 Session；同一 turn/step 只注入一次。
- 低置信度、无效结果、输出超限和 provider 失败不改变主请求；取消继续向上传播。

验收证据：成功注入、去重、低置信度忽略、无效结果、输出超限、超时安全记录、取消和有界渲染测试均通过。

## 阶段 13：配置页面重构

实现结果：

- 配置页提供 `off`、`shadow`、`advisory`，endpoint、模型、凭证状态、关键节点、置信度、输入/输出上限、冷却和 Session 调用上限。
- 上一步工具结果纯文本摘录默认关闭；启用后同时受独立字符上限和请求总字符上限控制。工具参数和二进制块不会进入 Jev 请求。
- 当前用户文本匹配疑似凭证时跳过自动分析；工具结果块匹配疑似凭证时排除该摘录。
- “测试连接”通过 Host Typert Remote 使用已保存的凭证发起一个最小请求。浏览器不读取凭证，测试不创建 Agent 或 Session，返回值只包含模型、延迟或结构化错误码。
- 页面显示最近在线 Session 的无内容 Jev 摘要，并解释发送范围、计费、失败回退和各模式行为。
- 配置保存继续使用 DSH 的原子 Settings Form 和 live volatile 字段；卸载会停止发布异步页面结果。

真实浏览器验收：

- 使用真实 `pnpm dsh web --patch apps/web/tests/pin-browse-picker.overlay.yml --no-open` 服务。
- 使用 Chromium 141、390×844 viewport 打开 Plugins → dsh-jev → dsh-jev 配置页。
- `document`、`body` 和全部元素的横向溢出计数均为 0。
- 页面和浏览器控制台错误均为 0。
- “测试连接”、最近 Session、数据与回退区域正确显示；为避免未经用户确认产生真实 Jev 费用，浏览器验收没有点击计费按钮，其 Host 成功与失败行为由自动化测试覆盖。

## 阶段 14：本地指标与报告

实现结果：

- `createDecisionGuidanceReport` 分别聚合主模型、Jev 和合计 token，并计算模型/Jev 延迟、Agent step、已完成 turn、工具调用、工具失败和重复调用。
- 失败、取消、pending 和缺少 usage 的调用不会计为 Jev 成功，也不会伪造 token。
- `recordDecisionGuidanceOutcome` 记录无内容的采纳、任务结果和关键决策标签；普通 turn 完成不会被误判为任务正确。
- `compareDecisionGuidanceReports` 比较 Baseline、Shadow 和 Advisory，并计算每个成功任务的平均总 token。
- JSON 和 Markdown 输出采用固定、无内容字段，不复制 Session 消息、Jev 请求、答案、工具参数或凭证。

验收证据：三类 token 分账、失败与 pending、采纳标签、重复工具计数、三模式聚合、成功任务平均成本以及敏感字符串排除测试均通过。

## 阶段 15：评估数据集与 A/B 验证

实现结果：

- `dsh-jev-eval-v1` 覆盖简单任务、信息不足、多路径诊断、编码调试、工具失败、高风险操作、错误 Jev 建议、Jev 超时、提示注入和敏感数据十类场景。
- 运行器按固定顺序对每个场景执行 Baseline、Shadow、Advisory 和指定重复次数，并拒绝负数、非有限数及非法置信度。
- 报告包含成功率、关键决策正确率、每个成功任务平均总 token、工具调用、重复工具调用、step、延迟、误触发率、高风险违规、Brier Score 和 ECE。
- 发布门禁要求完整配对、成功率不回退、每次重复都观察到关键决策提升、成本或无效探索下降、误触发不超限、无高风险违规且存在校准数据。
- 合成证据始终增加 `real-evidence-required`，不能批准 Advisory 发布。

`pnpm eval` 对 10 个场景、3 个模式、3 次重复运行 90 条确定性记录。受控结果验证全部指标和门禁分支可重复，最终门禁为关闭，唯一原因是 `real-evidence-required`。这不是对真实模型效果的宣称；发布前必须由真实 Harness 执行器产生完整配对数据。

## 执行的验收命令

```sh
pnpm typecheck
pnpm exec vitest run --configLoader runner
pnpm eval
pnpm build
git diff --check
```

Typert Host 清单还使用 DSH 的 `validateTypertManifest` 校验，两个端点分别为 `dsh-jev#dshJev/testConnection` 和 `dsh-jev#dshJev/latestSessionSummary`。

测试期间 Vite 仍会提示已发布的 `@deepseek-ai/dsh-client-ui-primitives` 缺少 `index.js.map`。该提示来自依赖包，不影响测试、构建或浏览器运行；本插件没有产生新的控制台错误。

## 后续门禁

阶段 16 Guided 模式不能仅凭本次合成验收开始发布。下一步需要接入真实 Baseline、Shadow、Advisory 执行器，保存无内容观测记录，运行多次完整配对评估，并确认发布门禁全部通过。
