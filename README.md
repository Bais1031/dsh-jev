# dsh-jev

TypeSafe Jev decision provider and router for DeepSeek Harness. The project is under active development; the current implementation contains the standalone System One HTTP client.

See [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md) for the staged plan.

## Development

```sh
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

Normal tests use a mocked HTTP transport and do not require `JEV_API_KEY`.
