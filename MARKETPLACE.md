# Plugin market readiness

`dsh-jev` is being prepared for the DeepSeek Harness plugin markets. Market listing is a release activity, not part of local plugin activation.

## Implemented package requirements

- `package.json` declares `dsh.bundle.patch` through `cordis.patch.yml`.
- `engines.dsh` states the supported Harness range.
- Author, repository, homepage, description, keywords, license, and Node engine metadata are present.
- The bundle contributes one stable row id, `dsh-jev`, so Plugin Manager can enable, disable, update, or remove the whole plugin.
- Credentials are referenced by name and resolved from DSH Credentials for each operation; the API key is not stored in bundle configuration.
- Normal tests use mock HTTP and do not require network access or a real credential.
- The Plugins page exposes live transport, routing, threshold, fallback, and tier-route configuration.
- Shadow, Advisory, and Automatic modes record their decisions and preserve the documented safety fallbacks.

## Required before listing

- Remove `private: true`, confirm the `dsh-jev` npm name, and publish a stable npm version containing built `lib/` artifacts.
- Inspect the packed tarball and verify installation into a clean Web profile without running an install script.
- Either support the stock Headless profile's launch-time credentials or declare Headless unsupported consistently in package and market metadata.
- Create the matching Git tag and release notes. Git-source fallback needs either committed build artifacts, an explicitly allowed `prepare` build, or a prebuilt release archive; npm remains the preferred installation source.
- Add bilingual title and description, category, labels, and optional curated screenshots to the `awesome-dsh-plugin` entry.
- Submit the plugin entry to `awesome-dsh-plugin`, not to the `dsh-market` application repository. Its catalogs update from that curated list, normally on their scheduled refresh.
- Verify the resulting catalog entry through the DSH Discover page and the `dsh-plugin-catalog` format-1 index.

## Installation sources

The community catalog prefers a verified npm package, then a prebuilt GitHub Release archive, and only then a Git source checkout. The npm package should therefore contain ready-to-run JavaScript and declarations and should not depend on a consumer allowing build scripts.

Useful catalog source:

```text
https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json
```

## Security notes for the listing

- State that TypeSafe receives the state and questions sent to `jev_decide`.
- State that Jev probabilities do not authorize deletion, payment, publishing, credential changes, or permission changes.
- Document the `JEV_API_KEY` credential reference and confirm that logs and Session events never include its value.
- Do not add telemetry or remote reporting without an explicit configuration field and documentation update.
