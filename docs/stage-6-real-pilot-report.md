# 阶段六真实配对试点评估报告

## Summary

本次评估使用 `deepseek-official/deepseek-flash`、`low` reasoning effort 和真实 Jev Provider，对六个固定任务分别运行 Baseline、Shadow 和 Advisory，共完成 18 次核心运行。所有模式均为 6/6 成功且关键决策正确；简单任务没有调用 Jev，所有 Jev 请求成功，高风险任务没有执行外部操作。Advisory 没有降低 token、Agent step 或重复工具调用，因此准确性非回归和安全门禁通过，成本与无效探索门禁未通过。

## 测量方法

- 六个任务覆盖简单任务、方向选择、信息不足、工具失败恢复、工具证据检查和高风险操作。
- 每个任务在新的 Session 中运行 Baseline、Shadow 和 Advisory；运行顺序按任务交错，减少固定顺序偏差。
- 主模型、reasoning effort、插件阈值、工具环境和问题文本在三条路线中保持一致。
- 每条任务预先定义一个固定决策标签；报告只保留标签、token、step、工具调用、Jev 状态和延迟等无内容指标。
- 证据检查任务的首次 Advisory token 明显偏高，因此按预定规则追加两次 Baseline 和两次 Advisory 定向复测；总运行数为 22。

## 核心结果

| 模式 | 成功 | 关键决策正确 | 总 token | 每个成功任务 token | 平均时延 | 平均 step | 工具调用 | 重复工具调用 | Jev 调用 | Jev token |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Baseline | 6/6 | 6/6 | 99,044 | 16,507.3 | 5,101.5 ms | 1.33 | 2 | 0 | 0 | 0 |
| Shadow | 6/6 | 6/6 | 104,538 | 17,423.0 | 8,131.5 ms | 1.33 | 2 | 0 | 6 | 5,645 |
| Advisory | 6/6 | 6/6 | 111,907 | 18,651.2 | 8,779.8 ms | 1.33 | 2 | 0 | 6 | 5,644 |

Shadow 相对 Baseline 每个成功任务增加约 5.5% token。Advisory 相对 Baseline 增加约 13.0%，没有减少 Agent step、工具调用或重复工具调用。六条 Advisory Jev 请求全部成功并产生六条注入记录；简单任务在调用前记录 `simple-task` 并保持零 Jev usage。

## 定向复测

工具证据检查任务在每种模式下共获得三次结果。Baseline 三次总 token 为 24,652、30,344 和 30,410，平均 28,468.7；Advisory 三次为 32,505、32,552 和 32,540，平均 32,532.3。Advisory 平均高 14.3%，平均时延从 1,865.7 ms 增加到 5,219.7 ms；三次运行的决策、step 和工具调用均相同，因此额外成本和等待没有换来可测量的探索减少。

该任务在 Advisory 中分别于 `task-intake` 和 `pre-conclusion` 调用并注入 Jev。两个节点都返回有效简报，但 Baseline 已能在一次工具读取后正确结论；第二次关键节点没有改善决策，反而增加 Jev token 和主模型上下文。

## 验收结果

| 条件 | 结果 | 证据 |
|---|---|---|
| 简单任务不调用 Jev | 通过 | Shadow 和 Advisory 均为零调用、零 Jev token |
| Advisory 成功率不低于 Baseline | 通过 | 两者均为 6/6 |
| 关键决策准确率不下降 | 通过 | 三种模式均为 6/6；Baseline 已达到上限，不能据此证明准确率提升 |
| Advisory 降低总 token | 未通过 | 每个成功任务 token 增加约 13.0% |
| Advisory 减少无效 step 或重复工具调用 | 未通过 | 平均 step 相同，重复工具调用均为零 |
| Provider 故障保持 fail-open | 未触发 | 核心运行和定向复测的 16 条真实 Jev 调用均成功，没有产生真实故障样本；既有自动化故障测试继续覆盖 fail-open |
| 高风险操作安全 | 通过 | 三种模式均选择停止并确认，没有外部操作 |

## 结论

阶段六的机制、安全和准确性非回归验收通过，但产品价值验收未通过。当前样本不能证明 Jev 提高准确率，因为 Baseline 已全部正确；真实数据明确表明 Advisory 在这些任务上增加 token，且没有减少 step 或重复工具调用。插件应保持用户显式选择和保守触发，不应宣称已经节省 token，也不应以本次结果开放更强的 Guided 干预。

下一轮修改应优先消除同一任务中价值重叠的多节点调用，并增加只有 Baseline 容易走错或无效探索的高区分度任务。完成修改后只复测受影响任务，不重复整套简单场景。

后续[高难任务小范围复测](./stage-6-hard-task-retest-report.md)先筛选四个候选任务，再对两个出现额外探索的任务族完成十二次配对运行。复测仍未发现 Baseline 准确率错误；Advisory 平均总 token 增加约 4.1%，step 和工具调用没有改善，因此没有改变本报告的产品价值结论。

随后进行的[真实失败 Session 筛选](./stage-6-real-failure-session-screening-report.md)检查了本机 18 份原始 Session 文件。七份文件包含可重放任务事件，但没有一份同时包含主模型错误和后续纠正证据，因此评估按预注册停止条件在付费调用前结束。该结果只说明当前缺少合格样本，不改变阶段六未通过产品价值验收的结论。

## Dev Note

这是一次小样本真实试点评估，不构成统计显著性声明。完整的无内容机器结果保存在本次工作环境的 `/tmp/dsh-jev-stage6-results.json` 和 `/tmp/dsh-jev-stage6-repeat-results.json`；临时 Session 包含任务与模型回答，不属于可发布报告。
