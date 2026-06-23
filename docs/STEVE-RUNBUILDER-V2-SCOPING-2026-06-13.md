# RouteBuilder (RunBuilder v2) — scoping (rebuild as React + .NET 9 alongside legacy)

**Author:** Steve
**Date:** 13 June 2026 (answers locked 2026-06-14)
**Audience:** Kevin
**Sibling docs:** None — this is the kickoff scoping doc for the RunBuilder v2 rebuild.

> **TL;DR.** The broader product direction is now **Routed Operations**. Release 1 is still a React 19 + **.NET 9** rebuild of RunBuilder as **RouteBuilder**, built **inside this same repo, in `/v2/`, alongside the legacy app at root**, behind DF-Admin-controlled cutover. Legacy code stays at the repo root (untouched, still deployed from GitLab, still working). The new code goes in `/v2/`. **Route Viewer** and **Bulk Uploader** remain in place for the early release stages rather than being rebuilt immediately. **GitLab remains the source of truth** — Kevin clones the built v2 back into a `v2` branch on GitLab. Cutover is controlled by DF Admin per tenant; rollback = DF Admin flips the gate back. Single tenant per deployment (DF's stack-wide rule). This doc captures the scoping inputs, with the 2026-06-23 naming/scope update folded in.

---

## 1. What we have today (the legacy app)

This repo's `master` branch is the live RunBuilder:

- **Stack.** .NET (Razor + MVC `Controllers/Views`), single-tenant per deployment, EF Core against the despatch DB (`DynamicDBContext.cs`, `DynamicDespatchDbContextFactory.cs`). SP-heavy data access throughout.
- **Surface.** Bulk runs / bulk jobs / bulk run settings (`BulkJob.cs`, `BulkRun.cs`, `BulkRunSetting.cs`) + a `PotentialCouriers` matcher. Operates against `tblBulk*` tables only — does not surface jobs from `tucJob` / `tucJobBooking`.
- **Auth.** Hub cookie (`.AspNet.SharedCookie`).
- **Deploy.** Dockerfile-based; staging + prod auto-deploy via GitLab pipelines.
- **Other branches.** `DeliverDifferentMirror` and `backstage` — both materially different working trees; check before merging anything.

Legacy stays live and deployed unchanged until v2 reaches parity for a given tenant and DF Admin flips the cutover.

---

## 2. Parallel-build approach

In **this same repo**:

| Path | Contents | Lifecycle |
|---|---|---|
| `/` (root, legacy) | Everything currently at the repo root — Razor + Controllers + Views + EF Core entities + Dockerfile + appsettings. | Frozen except for prod fixes. Builds + deploys exactly as today from GitLab. |
| `/v2/` | New .NET 9 backend (`/v2/backend`) + React 19 + Vite SPA (`/v2/backend/wwwroot/app/react/`). | The RouteBuilder rebuild lands here, surface by surface. |
| `/docs/` | Scoping + handover docs (this file + follow-ons). | Steve / Kevin. |
| `/.github/workflows/` | Optional v2 CI lane on GitHub during dev; legacy CI continues on GitLab. | Independent. |

**Source of truth.** GitLab stays primary throughout per [[project-gitlab-source-of-truth]]. The flow:
- GitHub should use the broader Routed Operations repo naming for the rebuild (`Deliver-Different-Testing/routed-operations`) so the repo reflects the actual long-term product direction, even though Route Builder is the first release surface.
- Kevin clones the v2 work back into a **`v2` branch on GitLab** as he goes.
- Legacy continues to ship from GitLab master.
- At cutover, v2 graduates from the GitLab `v2` branch into whatever deploy target DF Admin promotes it to.

**Cutover.** Controlled by **DF Admin** per tenant. No tenant-level feature flag table needed — DF Admin owns the switch, can flip back at any time. Rollback = DF Admin reverts the tenant to the legacy deploy.

---

## 3. Decisions (Steve, 2026-06-14 — answers folded in from [the answer doc](https://docs.google.com/document/d/1A9eH3OOFuHDwSMqyFGSyVHeeSVs33K57qmNlz3LTIaQ/edit))

| # | Topic | Decision |
|---|---|---|
| 1 | **Repo layout** | **Put new under `/v2/`.** Legacy stays at repo root — zero churn on legacy CI pipelines. |
| 2 | **Source of truth** | **GitLab stays the source of truth.** Kevin clones built v2 back into a `v2` branch on GitLab as he goes. GitHub is dev convenience (PR + review flow), not the deploy target. |
| 3 | **.NET version** | **.NET 9 (LTS).** Don't chase .NET 10 preview/RC — lower risk during early build. Bump at .NET 10 GA only if there's a concrete reason. |
| 4 | **Backend approach** | **Move away from SP-heavy code to application-layer code.** Use this as the **guideline for the whole build** — every new surface in v2 keeps the data access in EF Core + application services, not stored procedures. This is one of the explicit reasons for the rebuild. |
| 5 | **Frontend** | **DFRNT design style with LH side menu, configurator pattern.** v2 frontend mounts at `wwwroot/app/react/` inside the .NET 9 backend (same shape as `dfrntdrive_configurator`). Re-use design tokens + DFRNT design system. |
| 6 | **Data model** | **Reuse existing tables.** Same despatch DB. **BUT** the v2 surface must also expose jobs from **`tucJob`** and **`tucJobBooking`** alongside the existing `tblBulk*` tables — legacy RunBuilder only sees `tblBulk*`; RouteBuilder fixes that gap. |
| 7 | **Auth + access control** | **Feature-matrix-driven.** All menu items + sub-menu items in RouteBuilder are controlled by the **existing configurator feature matrix** — same machinery the configurator + courier portal use. No bespoke role wiring. |
| 8 | **Mobile / responsive** | **Desktop-first.** Mobile-friendly is a bonus, not a requirement. RouteBuilder is a dispatcher workstation tool. |
| 9 | **Parity bar before cutover** | **DF Admin owns cutover per tenant.** No fixed parity bar — once DF Admin decides a tenant is ready, they flip the switch. Kevin to surface parity status to DF Admin as v2 features land. |
| 10 | **Tenants** | **Single tenant per deployment.** Same as the rest of the DF stack. DB-swap pattern stays. No slug-driven multi-tenant resolver. |

### 3.1 Naming

- **Umbrella product / repo direction is `Routed Operations`.** Kevin should use that as the rebuild repo name and top-level product framing.
- **First release app/module name in v2 is `RouteBuilder`** (not RunBuilder). Replace the legacy name in the v2 UI, package names, project names (`RouteBuilder.csproj` / `RouteBuilder.sln`), Hub menu entries, and DFRNT design system asset references.
- **Legacy remains `runbuilder`.** No history rewrite is required on the legacy repo; this naming change is about the rebuild direction.
- **Stage 1 dependency note:** existing `Route Viewer` and existing `Bulk Uploader` stay in service for early release stages; they do not need to be rebuilt before Route Builder ships.

### 3.2 Jobs surfaced in v2 (per Q6 addendum)

Legacy reads only `tblBulkRun` / `tblBulkJob` / `tblBulkRunSetting`. RouteBuilder must also surface:

- **`tucJob`** — the live job records (standard jobs, not the bulk-import staging set).
- **`tucJobBooking`** — booking-side job records that have not yet promoted to `tucJob` (or that travel via the booking pipeline).

Both should appear in the route-builder UI as candidate jobs to assemble into a run — the dispatcher should see everything in one place, not switch surfaces by source table. Implementation should land a unified job-projection service in the `/v2/backend` application layer (consistent with Q4 — no SPs).

---

## 4. Suggested phasing

| Phase | Scope | Output |
|---|---|---|
| **0 — this doc** | Scope + decisions | §3 answered ✅ |
| **1 — skeleton** | .NET 9 backend skeleton (`/v2/backend`) + React 19 + Vite SPA mounted at `wwwroot/app/react/` + Hub cookie auth + feature-matrix-gated menu; empty Bulk Runs / Jobs page; CI lane on GitHub | Deployable shell, DF Admin can preview |
| **2 — Bulk Runs read** | List + detail view, read-only against existing `tblBulk*` tables — via EF Core + application service, no SP calls | Internal dogfood |
| **3 — Unified job projection** | Surface `tucJob` + `tucJobBooking` jobs alongside `tblBulk*` — single candidate-job feed | Pilot tenant tests in staging |
| **4 — Bulk Runs write** | Create / edit / delete a bulk run; bulk job assignments | Pilot runs side-by-side |
| **5 — Couriers assignment** | Re-implement `PotentialCouriers` matcher in the app layer (no SP); assign couriers to a run | Pilot extends |
| **6 — Settings + reports** | Bulk run settings + reporting surfaces (via DFRNT Reporting Engine nuget per [[project-dfrnt-reporting-engine]] — not legacy `TblReport`) | Parity status visible to DF Admin |
| **7 — Cutover per tenant** | DF Admin flips a tenant from the legacy RunBuilder deployment to the RouteBuilder deployment while existing Route Viewer / Bulk Uploader remain available as needed | Tenants migrate one by one |
| **8 — Routed Operations consolidation** | Fold Bulk Uploader and Route Viewer into Routed Operations only after Route Builder is operationally solid | Product surfaces converge |
| **9 — Legacy retirement** | After last tenant migrates, archive root-level legacy code under `/legacy-archive/` + decommission its deploy | Done |

---

## 5. Next steps

- **Kevin** picks this up. The follow-on doc — `KEVIN-ROUTEBUILDER-PHASE1-SKELETON-2026-06-14.md` (or similar dated) — lays out the actual Phase 1 skeleton: `/v2/backend` bootstrap, EF Core + service-layer template, feature-matrix wiring, frontend mount path, side-menu shell, CI lane.
- **Steve** writes the skeleton spec once Kevin confirms there are no further questions on §3.
- This doc is not blocking any legacy work — RunBuilder legacy continues to deploy from GitLab through the existing pipelines.

---

## 6. References

- Legacy code (this repo, `master`): root-level `RunBuilder.csproj`, `Controllers/`, `Views/`, `BulkJob.cs`, `BulkRun.cs`, `PotentialCouriers.cs`.
- GitLab source of truth: [[project-gitlab-source-of-truth]] — legacy ships from there; v2 clones back into a GitLab `v2` branch.
- Courier portal Phase 1 (the parallel rebuild pattern this mirrors — minus the SMS auth specifics): [`dfrntdrive_configurator/docs/STEVE-COURIER-PORTAL-PHASE1-SMS-AUTH-SHELL-2026-06-13.md`](https://github.com/Deliver-Different-Testing/dfrntdrive_configurator/blob/master/docs/STEVE-COURIER-PORTAL-PHASE1-SMS-AUTH-SHELL-2026-06-13.md).
- Configurator React shell (the conventions to mirror for `/v2/backend/wwwroot/app/react/`): `Deliver-Different-Testing/dfrntdrive_configurator`.
- DFRNT Reporting Engine nuget (Phase 6 reports): [[project-dfrnt-reporting-engine]].
- Owner: **Kevin** (see [[project-dev-team]] — Kevin owns RouteBuilder rebuild + DespatchWeb recurring bookings + runviewer).
