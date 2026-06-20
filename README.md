# RouteBuilder

This repo is the rebuild workspace for the next RouteBuilder implementation.

## Purpose

- Keep the legacy GitLab `runbuilder` clone intact as the reference implementation.
- Move the rebuild work into this GitHub repo so Kevin can clone it back into GitLab when actual development starts.

## Legacy reference

The current legacy reference clone lives at:

`/data/.openclaw/workspace/gitlab-source/runbuilder`

That repo should be treated as the source-of-truth for legacy behaviour and parity checks.

## Starting point in this repo

- `docs/HANDOVER-KEVIN-ROUTEBUILDER-REBUILD-2026-06-14.md`

That handover doc now treats the rebuild correctly as:

1. legacy Runbuilder parity first
2. then new capability for:
   - Quoting
   - Scheduled Routes
   - Polygon Builder
