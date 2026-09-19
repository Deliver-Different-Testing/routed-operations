---
name: add-md-to-project-dashboard
description: >-
  Adds a spec/handover MD (or any work item) to a developer's tab on DFRNT
  Project Dash (project-dashboard.steve-b8b.workers.dev) — Garry, Kevin,
  Kerran, or Jacob. Use when Steve asks to "add this to [dev]'s dashboard",
  "put this on [dev]'s project dash", or "add this as an item on his list"
  after writing or pushing a spec/implementation doc. Triggers: "project
  dashboard", "project dash", "add to Garry's/Kevin's/Kerran's/Jacob's list",
  "add this project", "forward work".
version: 1
---

# Add an item to DFRNT Project Dash

Credentials and background: see memory `project_dashboard_dfrnt.md` (Cloudflare Access service token + dev keys). If that memory is missing or the token is rejected (see Troubleshooting), stop and ask Steve rather than guessing new credentials.

## The correct call — one POST, nothing else

```bash
CID="<CF-Access-Client-Id from memory>"
CSEC="<CF-Access-Client-Secret from memory>"
BASE="https://project-dashboard.steve-b8b.workers.dev"
DEV="garry"   # or kevin / kerran / jacob

curl -s -X POST \
  -H "CF-Access-Client-Id: $CID" -H "CF-Access-Client-Secret: $CSEC" \
  -H "Content-Type: application/json; charset=utf-8" \
  --data-binary "@payload.json" \
  "$BASE/api/forward-work/$DEV/items"
```

`payload.json` (write this to a file first — see **Encoding gotcha** below):
```json
{
  "itemKey": "short-kebab-case-slug",
  "title": "Human-readable title",
  "summary": "One or two sentences — what it is and why it matters.",
  "date": "YYYY-MM-DD",
  "url": "https://github.com/.../the-doc.md",
  "createdBy": "Steve (via EasyEA)"
}
```

A `201` with the item echoed back means success. Verify by re-fetching:
```bash
curl -s -H "CF-Access-Client-Id: $CID" -H "CF-Access-Client-Secret: $CSEC" \
  "$BASE/api/forward-work/$DEV/items"
```
Confirm your `itemKey` is in the returned array. That's the only verification needed — no further steps.

To remove a wrongly-added item: `DELETE $BASE/api/forward-work/$DEV/items/{itemKey}`.

## Encoding gotcha — always POST from a file

Passing the JSON body inline in a `curl -d '...'` argument on this (Windows/Git Bash) shell mangles non-ASCII characters — an em dash (—) in a title came out as `�`. **Always write the payload to a JSON file first** (e.g. with the Write tool) and send it with `--data-binary "@payload.json"`. Cheapest fix: just use a plain hyphen (`-`) instead of an em dash in titles/summaries and this stops mattering.

## Wrong turn to avoid — do NOT use the state/order endpoints for new items

There's a *different* pair of endpoints on this same app:
- `GET/PUT /api/forward-work/{dev}` (body: `{status, notes, projectType, sprintStartDate, sprintEndDate, updatedBy}` per key)
- `PUT /api/forward-work/{dev}/order` (reorders that board)

These back a **separate status-tracking board** (the "Not started / In progress / Blocked / In review / Done" columns), not the items list. Writing a brand-new key here **succeeds silently but never renders** in the UI — it inflates the raw state count without showing up anywhere, which is confusing to debug after the fact. If you ever need to update the *status* of an existing tracked project, this is the right pair of endpoints — but for **adding a new item to a dev's list, always use `POST .../items`**, never this pair.

## Troubleshooting

- **302 redirect to `steve-b8b.cloudflareaccess.com/...`**: the service token isn't authorized. In Zero Trust → Access controls → Applications → the app scoped to the `project-dashboard` Worker → Policies tab, there must be a policy with Action = `Service Auth`, Include → Selector = `Service Token`, Value including this token's name. (There's a pre-existing legacy policy scoped to a different token named `Urgent Connection API` — add a new token as an *additional* Value or policy, don't replace it.)
- **Item posted but Steve says it's not showing**: don't guess further — ask him to hard-refresh and check the count badges (Not started/In progress/etc. sum) against the header total for a mismatch, which flags a write that isn't being rendered (see Wrong turn above). Confirming via a fresh `GET .../items` call is more reliable than asking him to eyeball the page.
