# public-surface-observer

Generic guest-view observation runner for note / BOOTH and other public publication surfaces.

This repository is intentionally public. Its source tree and persisted `latest/` output must therefore avoid linking the repository owner to any managed publication account. Managed account URLs are runtime configuration, not source-controlled configuration.

## What it does

A managed run opens configured public surfaces in fresh unauthenticated Chromium contexts, discovers same-account child pages, and captures public-page state for analysis.

For note articles it extracts the rendered `こちらもおすすめ` neighborhood as structured data:

- rendered rank
- title
- recommendation URL
- public creator name / URL when exposed
- visible price / like count when exposed
- desktop/mobile item count
- desktop/mobile recommendation-order consistency

### Recommendation collection contract

The `こちらもおすすめ` surface is mounted client-side after hydration, below the fold, so a capture can legitimately arrive before it exists. Collection is therefore bounded and explicitly staged:

| bound | value |
| --- | --- |
| settle budget per viewport attempt | 25s |
| of which, waiting for the surface root to mount | 15s |
| attempts per Article (each in a brand-new context) | 2 |
| extra recovery attempts per run | 4 |

Each viewport capture records a `recommendation_settle` report in the runner-local debug bundle with the stage reached — `POPULATED`, `ROOT_WITHOUT_ITEMS` or `ROOT_ABSENT` — plus timings and the sweep log. The persisted public probe carries only the identity-safe part of that: `failure_stage` and an `attempts` log. A failure is never downgraded to "0 recommendations": `collection_status` stays `COLLECTION_FAILED` and `comparison_status` stays `INCOMPARABLE`.

For deeper lifecycle troubleshooting, run `node src/recommendation-trace.mjs --url <public article URL>` **locally or in another non-public execution environment**. Do not pass managed account URLs through public Actions workflow inputs, logs, or artifacts.

The recommendation surface is deliberately recorded as:

```text
surface_model: UNKNOWN
```

It is a bounded anonymous observation, not proof of a platform's internal category, actual reader delivery, impressions, clicks, CTR, or audience size.

## Managed target privacy boundary

`config/seeds.yaml` contains disabled examples only.

Scheduled managed targets are supplied at runtime through the GitHub Actions repository secret:

```text
OBSERVER_SEEDS_YAML
```

The secret uses the same schema as `config/seeds.yaml`. Use generic seed IDs such as `primary-note` / `primary-booth`; do not put an account handle into a seed ID.

Example shape:

```yaml
schema_version: 1
seeds:
  - id: primary-note
    service: note
    account_key: example
    url: https://note.com/example
    enabled: true
    discover_children: true
```

The persisted public output intentionally omits:

- managed seed URLs / account handles
- target creator/shop URLs
- target profile copy and article body text
- screenshots and full visible-text captures

Detailed browser evidence exists only in the ephemeral runner workspace and is not uploaded as a public Actions artifact.

Recommendation items from unrelated public creators may remain in `latest/` because they are the observation payload. Any recommendation back to a managed account is redacted before persistence.

## Commands

```bash
npm install
npx playwright install chromium
npm run seeds:validate
npm test
OBSERVER_SEEDS_YAML="$(cat /path/to/private-seeds.yaml)" npm run observe -- --scope note --persist
npm run observe -- --url https://note.com/example/n/n123456
node src/recommendation-trace.mjs --url https://note.com/example/n/n123456
```

The `--url` and recommendation-trace commands are local CLI tools. The public Actions workflow does **not** accept a managed target URL as an input.

## Output

Local runs write detailed browser evidence under ignored `artifacts/run-*/`.

Managed Actions runs additionally update only identity-safe small-text state:

```text
latest/manifest.json
latest/diff.json
latest/summary.md
```

The workflow does not upload the detailed `artifacts/run-*` directory from this public repository.

## Schedule

`.github/workflows/observe.yml` is scheduled for **Wednesday 04:17 UTC / 13:17 JST**, before the downstream weekly analysis window. If `OBSERVER_SEEDS_YAML` is not configured, the scheduled job exits without overwriting `latest/` with an empty observation.
