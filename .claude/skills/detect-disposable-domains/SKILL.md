---
name: detect-disposable-domains
description: Daily disposable-email blocklist maintenance. Refresh the project's vendored OSS disposable list (the cheap path that resolves most cases) and only propose manual blocklist additions for the residual abuse the OSS list still misses. Use when the user wants to keep the disposable-email defenses current — typically run daily via /loop or a cron.
---

# Maintain the disposable-email blocklist

Most of the time, daily abuse can be neutralised by re-pulling the upstream OSS disposable-domain list. Big aggregators (`disposable/disposable-email-domains`, which itself pulls from `7c/fakefilter` and friends) catch new `temp-mail.org` rotation domains within a day or two. Run the project's refresh script every day; the manual `custom.ts` blocklist exists only for the residual handful of domains that have hit production but haven't reached upstream yet.

This skill is read-only against the database, refreshes a checked-in vendored list, and opens at most one draft PR. It never auto-merges.

## Project-specific setup (ask the user on first run)

The skill is generic; the project's blocklist file path, schema names, and DB connection differ per project. Confirm or read from a sibling skill / project doc:

- **OSS-list refresh script**: the file that re-fetches upstream and rewrites the local snapshot (e.g. `refresh.mjs` next to `domains.json`).
- **Custom blocklist file**: where the project's manually-curated additions live (e.g. `custom.ts`/`custom.json`).
- **Users table**: name and the columns for `id`, `email`, `created_at`.
- **Optional corroborating tables**:
  - A device-fingerprint / abuse-flag table (rows here strongly correlate with bot accounts).
  - A credit/quota table (presence of a row means the account activated).
- **DB connection**: `POSTGRES_URL` / equivalent in a project env file. Default to `.env.local` first, fall back to `.env.development`. Never bake credentials into the skill.
- **Internal email domain(s)** to exclude (`@yourcompany.com`).

If a sibling project skill / `AGENTS.md` already pins these, read from there. Otherwise ask the user once and remember for the session.

## Inputs

- Time window (default `12 hours`) — only inspect users created within this window.
- Minimum suspicious-signup count per domain to flag as a candidate (default `2`).

## Pipeline

### 1. Decide mode: `refresh+analysis` vs `analysis-only`

For this repository (`adastralab-ai/disposable-email-data`), run in **analysis-only** mode.

- Do **not** run refresh scripts.
- Do **not** fetch/pull upstream list sources for this task.
- Treat current `domains.json` as read-only input for filtering.
- Only open a PR if residual domains should be added to `custom.json`.

General rule: if a repo has scheduled automation that already refreshes upstream vendored lists, this skill should stay analysis-only for manual/cron runs.

### 2. Pull recent signups

```sql
SELECT
  id,
  email,
  lower(split_part(email, '@', 2)) AS domain,
  created_at
FROM <users_table>
WHERE created_at >= now() - interval '<TIME_WINDOW>'
  AND email IS NOT NULL;
```

### 3. Filter known-good domains

Drop rows whose domain is:

- In the freshly-refreshed OSS disposable list (`domains.json`). Most candidates die here after step 1.
- In the project's manually-curated `custom.ts`/`custom.json`.
- In the project hard-exclusion allowlist (`slam.colegia.org` must always be excluded from promotion/blocking).
- A well-known mainstream provider: `gmail.com`, `googlemail.com`, `outlook.com`, `hotmail.com`, `live.com`, `yahoo.com`, `icloud.com`, `me.com`, `mac.com`, `proton.me`, `protonmail.com`, `tutanota.com`, `zoho.com`, `aol.com`, `qq.com`, `163.com`, `126.com`, `sina.com`, `foxmail.com`.
- The internal company domain.

If the residual is empty, jump to step 7 (PR-or-skip on the refresh diff alone).

### 4. Score residual candidate domains

For each remaining domain, compute these signals:

- **Local-part pattern match**: count of users on this domain whose local part matches `^[a-z]{4,8}\d{3,5}$` — a common bot-generator template (`hakewat785`, `fitina7059`). High match ratio → high suspicion.
- **Burst signup**: how many signups landed within a 1-hour window? Multiple signups same hour from a non-mainstream domain is anomalous.
- **Device-restriction overlap** (if the project has such a table): are users from this domain already flagged by a device-fingerprint rule? Strong corroboration.
- **Activation overlap**: how many users from this domain already touched the credit/quota table? Bots always activate.

### 5. Cross-check with a 3rd-party validator

For every residual candidate, hit `https://api.usercheck.com/domain/<domain>`. It is public, no auth, returns JSON with the fields we care about:

```json
{"disposable": true, "public_domain": false, "relay_domain": false, "did_you_mean": null}
```

- `disposable: true` → strong promote signal.
- `public_domain: true` → mainstream provider; never promote (acts as an extra safety net on top of the hardcoded allowlist).
- `did_you_mean: "gmail.com"` → likely a typo, not a disposable provider; skip.

The free tier rate-limits at roughly 5 requests/minute and returns `{"status":429,"error":"Too many requests"}` when exceeded. Pace requests (e.g. 15s sleep between calls) and on 429 fall back to the local heuristics for that domain. For higher-volume projects, set `USERCHECK_API_KEY` and pass it as a bearer token (raises the limit). `check-mail.org` / Kickbox / ZeroBounce remain as alternatives if `usercheck.com` is unreachable.

### 6. Pick winners and update `custom` blocklist

A domain is a "promote-to-blocklist" candidate when it satisfies AT LEAST ONE of:

- Any signup whose local part matches the bot-generator pattern (`^[a-z]{4,8}\d{3,5}$`), AND domain is not a mainstream provider. **Do not gate on signup count** — even one bot-pattern email on a non-mainstream domain is enough. Real users almost never look like `fecon28826`.
- ≥ 1 device-restriction record from this domain.
- 3rd-party validator returns `disposable: true`.

Skip domains that look like real businesses: no pattern match + no device-restriction signal + no validator hit.

Append candidates to the project's blocklist file in alphabetical order. Do NOT remove existing entries — only add.

### 7. Commit and open the PR

**All changes go through a PR. Never commit or push directly to `main`** — even a "trivial" `domains.json` refresh. Always work on a dedicated branch and let review happen on GitHub.

**Each run = its own new PR.** Don't pile a follow-up run onto an open earlier PR — branch off the latest `main` so the reviewer can merge runs independently and so partial merges (rebase / squash that drops a tail commit) don't silently lose later runs' candidates.

Branch name: `<user-prefix>-disposable-update-<YYYY-MM-DD>-<HHMM>` (UTC). The `HHMM` suffix differentiates multiple same-day runs. If a branch with the same minute somehow already exists, append `-2`, `-3`, etc.

Three possible outcomes:

| Mode | Step 6 candidates | Action |
|---|---|---|
| analysis-only | empty | Log `nothing to do` and exit. No branch, no PR. |
| analysis-only | non-empty | One commit: `custom.json` additions only. Open draft PR titled `feat: update disposable-email blocklist`. |
| refresh+analysis (only for repos without auto-refresh) | depends | Follow the regular refresh + custom update flow. |

PR body for the third case:

```
Closes #

Daily run. Upstream OSS list refreshed in commit 1. Commit 2 adds residual
domains the upstream still hasn't picked up.

| Domain | Signups (window) | Pattern matches | Device-flagged | 3rd-party |
|---|---|---|---|---|
| inraud.com | 12 | 12 (100%) | 8 | disposable |
| ...

## Reviewer notes

Verify each `custom.ts` addition isn't a real business (Google search, visit
https://check-mail.org/domain/<domain>/, scan recent users in admin). Drop
entries that look legit before merging.
```

Open as **draft**. Tag the invoker as reviewer.

## Idempotence

Each run targets a unique `<YYYY-MM-DD>-<HHMM>` branch, so collisions are rare in practice. If a branch with the exact same minute already exists, append `-2`/`-3`/... rather than force-updating it. Never force-push over someone else's commits.

Re-running within the same minute when nothing changed (no upstream diff, no new candidates) should still log `nothing to do` and exit without opening a second PR.

## Safety

- Never commit or push directly to `main`. Every change — refresh diff, `custom` additions — must land on a daily branch and go through a draft PR.
- In analysis-only mode, never modify `domains.json`.
- Never edit the OSS-mirrored list directly; only via the project's refresh script (refresh+analysis repos only).
- Never auto-merge.
- Never bypass the mainstream-provider allowlist — false positives there block real users.
- DB query is `SELECT` only. Never write to the production DB from this skill.
