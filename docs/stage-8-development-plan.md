# 阶段 8：模型路由迁移

## 结果

`dsh-jev` 不再从插件运行路径修改 DeepSeek Harness 的 provider、模型或 reasoning effort。Jev 的产品职责是提供结构化决策信号，主模型继续使用用户和 DSH 已选择的路线。

## 已移除的行为

- 插件不再注册旧版 `installJevRouter`。
- `advisory` 不再询问用户是否切换模型。
- `automatic` 不再替换 `LlmCallConfig` 或阻止模型请求。
- `fastRoute`、`standardRoute`、`deepRoute`、`fallbackPolicy` 和旧路由阈值不再属于插件配置。
- 插件不再依赖 DSH User Questions 服务。

旧版 `plugin:dsh-jev/router-*` 记录仍可作为普通插件记录保存在历史 Session 中。新代码不会把这些记录解释为决策增强记录，也不会继续写入它们。

## 用户迁移

从 profile 配置中删除以下字段：

```yaml
routingMode:
fallbackPolicy:
minimumConfidence:
minimumMargin:
metricsEnabled:
routerMaxInputCharacters:
fastRoute:
standardRoute:
deepRoute:
```

新的 Shadow 决策配置使用 `decisionMode` 和 `decision*` 字段。旧路由配置不会自动转换成模型切换之外的行为，避免同名设置产生不同但不明显的含义。

## 验收

- 插件入口不注册模型路由监听器。
- 公开包入口不导出旧路由控制器或路由类型。
- Plugins 页面不再显示模型路线或 Automatic 回退字段。
- 包元数据不再依赖 DSH User Questions。
- `pnpm test -- tests/dsh-plugin.spec.ts tests/config-card-controller.spec.ts` 通过。
- `pnpm typecheck` 通过。
- `git diff --check` 通过。
