# disposable-email-data

Daily-refreshed disposable-email domain list, served from this repo's raw URL for downstream services to fetch + cache.

## Sources

[`refresh.mjs`](./refresh.mjs) merges two inputs into [`domains.json`](./domains.json):

1. **Upstream OSS aggregator** — [`disposable/disposable-email-domains`](https://github.com/disposable/disposable-email-domains) `domains.txt` (which itself pulls from `7c/fakefilter`, `martenson/disposable-email-domains`, and friends).
2. **`custom.json`** — manually-curated additions for abuse domains we've spotted in production before upstream catches up. Edit this file directly; the next refresh preserves entries here.

The output is sorted, deduped, lowercase.

## Consumption

```
https://raw.githubusercontent.com/adastralab-ai/disposable-email-data/main/domains.json
```

Cache in your service (e.g. 6h TTL with stale fallback on fetch failure). The file updates daily at 02:00 UTC via [`daily-refresh.yml`](./.github/workflows/daily-refresh.yml); only real diffs commit.

## Adding a domain manually

```jsonc
// custom.json
[
  "inraud.com",
  "gixpos.com"
]
```

Commit. The next refresh run merges your entry into `domains.json`. If you'd rather not wait, run `node refresh.mjs` locally + commit both files.
