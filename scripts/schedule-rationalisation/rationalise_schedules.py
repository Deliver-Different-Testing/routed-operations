#!/usr/bin/env python3
"""
Rationalise tblBulkRunSchedule into shared, multi-client schedules.

Input : a CSV export of tblBulkRunSchedule (the "Schedule Table" Google Sheet,
        File > Download > CSV). NULLs are the literal string NULL.
Output: CSVs, an .xlsx workbook and SQL Server scripts in --out-dir.

Rules (see docs/STEVE-SCHEDULE-RATIONALISATION-KEVIN-2026-09-08.md):
  * A "schedule" is the set of day rows sharing (Name, ClientId).
  * Names are compared case-insensitively with whitespace collapsed.
  * Two schedules are the SAME schedule when every column other than
    BulkRunScheduleId and ClientId matches on every day row.
  * Groups of identical schedules under one name become ONE shared schedule:
    the default (ClientId NULL) if there is one with that definition,
    otherwise the client copy with the lowest BulkRunScheduleId. The other
    copies are retired and every client is written to the ScheduleClient
    link table.
  * Same name + different definition -> a "variant". The default (or the
    largest client group) keeps the name; the rest get "Name #n" so that a
    name-keyed link table can still address them unambiguously.
  * --scope merged : only groups of 2+ clients (or client copies identical to
                     a default) are converted. Production proposal.
  * --scope all    : every client-specific schedule is converted, including
                     one-client schedules, so the legacy 1-1 ClientId path can
                     be switched off. Staging test.
"""
import argparse
import collections
import csv
import datetime as dt
import os
import re

ID = "BulkRunScheduleId"
NAME = "Name"
CLIENT = "ClientId"
NULL = "NULL"


def norm_name(name: str) -> str:
    return re.sub(r"\s+", " ", name.strip()).casefold()


def sql_str(value: str) -> str:
    return "N'" + value.replace("'", "''") + "'"


def id_list(ids):
    return ", ".join(str(i) for i in sorted(ids))


def chunks(seq, n):
    for i in range(0, len(seq), n):
        yield seq[i : i + n]


def analyse(rows, scope):
    columns = list(rows[0].keys())
    all_cols = columns
    sig_cols = [c for c in columns if c not in (ID, CLIENT, NAME)]  # Name compared via norm_name
    sig_cols_no_day = [c for c in sig_cols if c != "DayOfWeek"]

    sched = collections.defaultdict(list)
    for r in rows:
        sched[(norm_name(r[NAME]), r[CLIENT])].append(r)

    spellings = collections.defaultdict(collections.Counter)
    first_id = {}
    for r in rows:
        k = norm_name(r[NAME])
        spellings[k][r[NAME]] += 1
        first_id[(k, r[NAME])] = min(first_id.get((k, r[NAME]), r[ID]), r[ID])
    canonical = {k: max(c, key=lambda s: (c[s], -first_id[(k, s)])) for k, c in spellings.items()}

    def signature(rs):
        return frozenset(tuple(r[c] for c in sig_cols) for r in rs)

    def min_id(rs):
        return min(r[ID] for r in rs)

    # ---- data-quality findings ----------------------------------------------
    dq = []
    for k, spell in spellings.items():
        if len(spell) > 1:
            dq.append(("Name spelling differs only by case/whitespace", canonical[k], "",
                       " | ".join(repr(s) for s in spell)))
    for (k, c), rs in sched.items():
        seen = collections.Counter(tuple(r[col] for col in sig_cols) for r in rs)
        dups = [v for v in seen.values() if v > 1]
        if dups:
            dq.append(("Identical duplicate day rows inside one schedule", canonical[k], c,
                       f"{sum(dups) - len(dups)} redundant row(s); ids {id_list(r[ID] for r in rs)}"))
        days = collections.Counter(r["DayOfWeek"] for r in rs)
        if any(v > 1 for v in days.values()) and not dups:
            dq.append(("Multiple differing rows for the same DayOfWeek", canonical[k], c,
                       "days " + ", ".join(f"{d}x{v}" for d, v in sorted(days.items()) if v > 1)))
    defaults = {k: signature(rs) for (k, c), rs in sched.items() if c == NULL}
    for (k, c), rs in sched.items():
        if c != NULL and k in defaults:
            if signature(rs) == defaults[k]:
                dq.append(("Client schedule identical to the default schedule of the same name",
                           canonical[k], c, "client is linked to the default and its copy retired"))
            else:
                dq.append(("Client schedule shares its name with a default schedule",
                           canonical[k], c, "name-keyed lookup is ambiguous; renamed '#n' when converted"))

    # ---- grouping -------------------------------------------------------------
    by_name = collections.defaultdict(dict)  # name key -> sig -> [(client, rows)]
    for (k, c), rs in sched.items():
        if c != NULL:
            by_name[k].setdefault(signature(rs), []).append((c, rs))

    merge_groups, variants, link_rows, retired, renames, survivors = [], [], [], [], [], []
    for k in sorted(by_name):
        groups = dict(by_name[k])
        base = canonical[k]
        ordered = []
        if k in defaults:
            drows = sched[(k, NULL)]
            ordered.append(dict(clients=sorted(groups.pop(defaults[k], []), key=lambda cr: min_id(cr[1])),
                                sig=defaults[k], is_default=True, surv_rows=drows, surv_client=NULL))
        for sig, clients in sorted(groups.items(), key=lambda g: (-len(g[1]), min(min_id(rs) for _, rs in g[1]))):
            clients.sort(key=lambda cr: min_id(cr[1]))
            ordered.append(dict(clients=clients, sig=sig, is_default=False,
                                surv_rows=clients[0][1], surv_client=clients[0][0]))
        for n, g in enumerate(ordered):
            name = base if n == 0 else f"{base} #{n + 1}"
            surv_ids = sorted(r[ID] for r in g["surv_rows"])
            clients = g["clients"]
            if g["is_default"]:
                convert = len(clients) > 0
                retire_clients = clients
            else:
                convert = len(clients) >= 2 or scope == "all"
                retire_clients = clients[1:]
            if len(ordered) > 1:
                diff = []
                if n > 0:
                    other = ordered[0]["sig"]
                    for i, col in enumerate(sig_cols):
                        if sorted(set(t[i] for t in g["sig"])) != sorted(set(t[i] for t in other)):
                            diff.append(col)
                variants.append({
                    "ScheduleName": base, "VariantGroup": n + 1, "ProposedName": name,
                    "IsDefault": "Yes" if g["is_default"] else "No",
                    "ClientCount": len(clients), "ClientIds": ", ".join(c for c, _ in clients),
                    "SurvivorIds": id_list(surv_ids),
                    "DiffersFromMainGroupOn": ", ".join(diff) if n > 0 else "(name holder)",
                    "Converted": "Yes" if convert else "No",
                })
            if not convert:
                continue
            if n > 0:
                renames.append((surv_ids, base, name))
            example = sorted(g["surv_rows"], key=lambda r: r[ID])[0]
            merge_groups.append({
                "ScheduleName": name, "RenamedFrom": base if n > 0 else "",
                "SurvivorIsDefault": "Yes" if g["is_default"] else "No",
                "ClientCount": len(clients), "ClientIds": ", ".join(c for c, _ in clients),
                "SurvivorClientId": g["surv_client"], "SurvivorIds": id_list(surv_ids),
                "RetiredIds": id_list(r[ID] for _, rs in retire_clients for r in rs),
                "Days": ", ".join(sorted(set(r["DayOfWeek"] for r in g["surv_rows"]), key=int)),
                **{c: example[c] for c in sig_cols_no_day},
            })
            for c, _ in clients:
                link_rows.append((name, c))
            for c, rs in retire_clients:
                for r in sorted(rs, key=lambda r: r[ID]):
                    retired.append((r[ID], c, name, g["surv_client"], id_list(surv_ids)))
            if not g["is_default"]:
                for r in g["surv_rows"]:
                    survivors.append((r[ID], g["surv_client"], name))

    return dict(sched=sched, spellings=spellings, canonical=canonical, dq=dq, merge_groups=merge_groups,
                variants=variants, link_rows=link_rows, retired=retired, renames=renames,
                survivors=survivors, by_name=by_name, all_cols=all_cols)


def write_sql(path, a, args, created_utc_s, staging):
    S, L = args.schedule_table, args.link_table
    tag = created_utc_s[:10].replace("-", "")
    snap = f"{S}_PreRationalise_{tag}"
    zsnap = f"dbo.BulkZoneSchedule_PreRationalise_{tag}"
    link_table = [(n, c, created_utc_s, args.created_by) for n, c in a["link_rows"]]
    renamed = {new for _i, _o, new in a["renames"]}
    out = []
    w = out.append

    def emit_retired(data, indent=""):
        for chunk in chunks(data, 500):
            w(f"{indent}INSERT INTO #Retired (BulkRunScheduleId, ScheduleName, SurvivorClientId) VALUES")
            w(",\n".join(f"{indent}({rid}, {sql_str(nm)}, {sc})" for rid, _c, nm, sc, _s in chunk) + ";")

    def emit_links(data, indent=""):
        for chunk in chunks(data, 500):
            w(f"{indent}INSERT INTO {L} (ScheduleName, ClientId, CreatedUtc, CreatedBy) VALUES")
            w(",\n".join(f"{indent}({sql_str(n)}, {c}, '{u}', {sql_str(b)})" for n, c, u, b in chunk) + ";")

    w(f"-- Schedule rationalisation ({'STAGING: convert every client schedule' if staging else 'production proposal: merge duplicate client copies'})")
    w(f"-- Generated {created_utc_s} by scripts/schedule-rationalisation/rationalise_schedules.py --scope {args.scope}")
    w(f"-- Schedule table: {S}   Link table: {L}  (script parameters)")
    w("-- Runs inside a transaction and ROLLS BACK unless @Commit = 1.")
    w("SET NOCOUNT ON; SET XACT_ABORT ON;")
    w("DECLARE @Commit bit = 0;               -- 1 = keep the changes")
    if staging:
        w("DECLARE @DisableLegacyClientId bit = 1; -- 1 = NULL ClientId on surviving client rows so clients resolve ONLY via the link table")
        w("DECLARE @RetireDependants bit = 1;      -- 1 = also remove BulkZoneSchedule rows of retired schedule rows (snapshotted first)")
    else:
        w("DECLARE @RenameVariants bit = 0;       -- 1 = apply step 2 (only needed while the link table is keyed by name)")
    w("BEGIN TRAN;")
    w("")
    if staging:
        w("-- 0. Snapshot the tables we touch so restore_schedules_staging.sql can put everything back.")
        w(f"IF OBJECT_ID('{snap}', 'U') IS NULL SELECT * INTO {snap} FROM {S};")
        w(f"IF OBJECT_ID('{zsnap}', 'U') IS NULL SELECT * INTO {zsnap} FROM dbo.BulkZoneSchedule;")
        w("")
    w("-- 1. Retired rows staged in a temp table so the checks and the delete use one list.")
    w("CREATE TABLE #Retired (BulkRunScheduleId int PRIMARY KEY, ScheduleName nvarchar(200), SurvivorClientId int);")
    if staging:
        emit_retired(a["retired"])
        w("")
        w("-- 2. Link every client to its schedule (shared schedules, one-client schedules and defaults alike).")
        emit_links(link_table)
        w("")
        w("-- 3. Rename variant survivors so every definition has a unique name.")
        for ids, old, new in a["renames"]:
            w(f"UPDATE {S} SET Name = {sql_str(new)} WHERE BulkRunScheduleId IN ({id_list(ids)}); -- was {old!r}")
    else:
        plain_ret = [r for r in a["retired"] if r[2] not in renamed]
        var_ret = [r for r in a["retired"] if r[2] in renamed]
        emit_retired(plain_ret)
        w("")
        w("-- 2. Link every client to its shared schedule (groups whose name is already unique).")
        emit_links([l for l in link_table if l[0] not in renamed])
        w("")
        w("-- 2b. Variant groups: a definition that shares its name with a different definition used by other")
        w("--     clients or by a default. The rename, the link rows and the retirements are applied together,")
        w("--     and only when @RenameVariants = 1.")
        w("IF @RenameVariants = 1 BEGIN")
        for ids, old, new in a["renames"]:
            w(f"  UPDATE {S} SET Name = {sql_str(new)} WHERE BulkRunScheduleId IN ({id_list(ids)}); -- was {old!r}")
        emit_links([l for l in link_table if l[0] in renamed], "  ")
        emit_retired(var_ret, "  ")
        w("END")
    w("")
    w("-- 4. Normalise spelling of surviving rows to the canonical name used in the link table.")
    for k, spell in sorted(a["spellings"].items()):
        for s in spell:
            if s != a["canonical"][k]:
                w(f"UPDATE {S} SET Name = {sql_str(a['canonical'][k])} WHERE Name = {sql_str(s)} "
                  f"AND BulkRunScheduleId NOT IN (SELECT BulkRunScheduleId FROM #Retired);")
    w("")
    w("-- 5. Safety checks. Each must return 0 rows before @Commit is set to 1.")
    w("--    a) every retired id still exists")
    w(f"SELECT r.* FROM #Retired r LEFT JOIN {S} s ON s.BulkRunScheduleId = r.BulkRunScheduleId WHERE s.BulkRunScheduleId IS NULL;")
    w("--    b) retired schedule rows that own zone / linehaul rows (NOT compared by this script - the survivor may differ)")
    if staging:
        w("--       (in staging these are reported, then removed by step 7 when @RetireDependants = 1)")
    w("SELECT z.* FROM dbo.BulkZoneSchedule z JOIN #Retired r ON r.BulkRunScheduleId = z.ScheduleId;")
    w("-- SELECT l.* FROM dbo.tblBulkScheduleLinehaul l JOIN #Retired r ON r.BulkRunScheduleId = l.<schedule id column>;")
    w("--    c) a link row whose name still matches more than one surviving definition")
    w(f"SELECT l.ScheduleName, COUNT(DISTINCT ISNULL(s.ClientId, -1)) AS Definitions FROM {L} l JOIN {S} s ON s.Name = l.ScheduleName")
    w("  AND s.BulkRunScheduleId NOT IN (SELECT BulkRunScheduleId FROM #Retired) GROUP BY l.ScheduleName HAVING COUNT(DISTINCT ISNULL(s.ClientId, -1)) > 1;")
    w("")
    w("-- 6. Retire the duplicate client copies.")
    if staging:
        w("IF @RetireDependants = 1 DELETE z FROM dbo.BulkZoneSchedule z JOIN #Retired r ON r.BulkRunScheduleId = z.ScheduleId;")
    w(f"DELETE s FROM {S} s JOIN #Retired r ON r.BulkRunScheduleId = s.BulkRunScheduleId;")
    if staging:
        w("")
        w("-- 7. Disable the legacy 1-1 path: surviving client rows lose their ClientId, so the only way a client")
        w(f"--    reaches a schedule is through {L}. (Original ClientId values are in {snap}.)")
        w("IF @DisableLegacyClientId = 1 BEGIN")
        for chunk in chunks(sorted(set(sid for sid, _c, _n in a["survivors"])), 500):
            w(f"  UPDATE {S} SET ClientId = NULL WHERE BulkRunScheduleId IN ({id_list(chunk)});")
        w("END")
        w(f"-- After this, every remaining row in {S} has ClientId NULL. 'Default' schedules are the ones with no")
        w(f"-- rows in {L}; every other schedule is reachable only by its link rows.")
    w("")
    w("DROP TABLE #Retired;")
    w("IF @Commit = 1 COMMIT TRAN ELSE ROLLBACK TRAN;")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")

    if staging:
        cols = ", ".join(a["all_cols"])
        r = [
            f"-- Restore staging from the snapshot taken by rationalise_schedules_staging.sql ({tag}).",
            "-- Puts back retired rows, original Name/ClientId on surviving rows, zone rows, and removes the link rows.",
            "-- Drop the two IDENTITY_INSERT lines per table if that table has no identity column.",
            "SET NOCOUNT ON; SET XACT_ABORT ON;",
            "DECLARE @Commit bit = 0;",
            "BEGIN TRAN;",
            f"IF OBJECT_ID('{snap}', 'U') IS NULL THROW 50000, 'snapshot table missing - nothing to restore from', 1;",
            f"DELETE FROM {L} WHERE CreatedBy = {sql_str(args.created_by)} AND CreatedUtc = '{created_utc_s}';",
            f"SET IDENTITY_INSERT {S} ON;",
            f"INSERT INTO {S} ({cols})",
            f"  SELECT {cols} FROM {snap} p WHERE NOT EXISTS (SELECT 1 FROM {S} s WHERE s.BulkRunScheduleId = p.BulkRunScheduleId);",
            f"SET IDENTITY_INSERT {S} OFF;",
            f"UPDATE s SET s.Name = p.Name, s.ClientId = p.ClientId FROM {S} s JOIN {snap} p ON p.BulkRunScheduleId = s.BulkRunScheduleId",
            "  WHERE s.Name <> p.Name OR ISNULL(s.ClientId, -1) <> ISNULL(p.ClientId, -1);",
            "SET IDENTITY_INSERT dbo.BulkZoneSchedule ON;",
            "INSERT INTO dbo.BulkZoneSchedule (Id, Zone, ScheduleId, Active)",
            f"  SELECT Id, Zone, ScheduleId, Active FROM {zsnap} p WHERE NOT EXISTS (SELECT 1 FROM dbo.BulkZoneSchedule z WHERE z.Id = p.Id);",
            "SET IDENTITY_INSERT dbo.BulkZoneSchedule OFF;",
            f"-- DROP TABLE {snap}; DROP TABLE {zsnap};  -- once you are happy",
            "IF @Commit = 1 COMMIT TRAN ELSE ROLLBACK TRAN;",
        ]
        with open(os.path.join(os.path.dirname(path), "restore_schedules_staging.sql"), "w", encoding="utf-8") as f:
            f.write("\n".join(r) + "\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("csv", help="tblBulkRunSchedule export (CSV)")
    ap.add_argument("--out-dir", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "output"))
    ap.add_argument("--scope", choices=["merged", "all"], default="merged")
    ap.add_argument("--created-by", default="steve@urgent.co.nz")
    ap.add_argument("--link-table", default="dbo.tblBulkRunScheduleClient",
                    help="name of Kevin's schedule/client link table")
    ap.add_argument("--schedule-table", default="dbo.tblBulkRunSchedule")
    ap.add_argument("--created-utc", help="override run timestamp, e.g. 2026-09-08T00:00:00Z")
    args = ap.parse_args()

    created_utc_s = args.created_utc or dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    os.makedirs(args.out_dir, exist_ok=True)
    with open(args.csv, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    for r in rows:
        r[ID] = int(r[ID])

    a = analyse(rows, args.scope)
    suffix = "" if args.scope == "merged" else "_staging"
    link_table = [(n, c, created_utc_s, args.created_by) for n, c in a["link_rows"]]

    def write_csv(fname, header, data):
        with open(os.path.join(args.out_dir, fname), "w", newline="", encoding="utf-8") as f:
            wr = csv.writer(f)
            wr.writerow(header)
            wr.writerows(data)

    mg_cols = list(a["merge_groups"][0].keys())
    v_cols = list(a["variants"][0].keys())
    ret_hdr = ["RetiredBulkRunScheduleId", "RetiredClientId", "ScheduleName", "SurvivorClientId", "SurvivorIds"]
    write_csv(f"schedule_clients{suffix}.csv", ["ScheduleName", "ClientId", "CreatedUtc", "CreatedBy"], link_table)
    write_csv(f"merge_groups{suffix}.csv", mg_cols, [[g[c] for c in mg_cols] for g in a["merge_groups"]])
    write_csv(f"retired_schedule_rows{suffix}.csv", ret_hdr, a["retired"])
    write_csv(f"variants{suffix}.csv", v_cols, [[v[c] for c in v_cols] for v in a["variants"]])
    write_csv(f"data_quality{suffix}.csv", ["Check", "ScheduleName", "ClientId", "Detail"], a["dq"])

    sched = a["sched"]
    n_client = sum(1 for k in sched if k[1] != NULL)
    summary = [
        ("Scope", args.scope),
        ("Source rows (tblBulkRunSchedule)", len(rows)),
        ("Default schedules (ClientId NULL)", sum(1 for k in sched if k[1] == NULL)),
        ("Client-specific schedules (Name + ClientId)", n_client),
        ("Names shared by 2+ clients", sum(1 for m in a["by_name"].values() if sum(len(v) for v in m.values()) > 1)),
        ("Shared schedules created / kept", len(a["merge_groups"])),
        ("  of which the survivor is a default schedule", sum(1 for g in a["merge_groups"] if g["SurvivorIsDefault"] == "Yes")),
        ("Client schedules converted to link rows", len(link_table)),
        ("Client schedules still 1-1 (not converted)", n_client - len(link_table)),
        ("Link-table rows (ScheduleClient)", len(link_table)),
        ("Schedule rows retired", len(a["retired"])),
        ("Schedule rows remaining", len(rows) - len(a["retired"])),
        ("Surviving client rows whose ClientId is cleared (staging only)", len(a["survivors"]) if args.scope == "all" else 0),
        ("Names whose definitions differ across clients/default (variants)", len(set(v["ScheduleName"] for v in a["variants"]))),
        ("Schedules renamed to 'Name #n'", len(a["renames"])),
        ("Data-quality findings", len(a["dq"])),
        ("CreatedUtc used", created_utc_s),
        ("CreatedBy used", args.created_by),
    ]
    write_csv(f"summary{suffix}.csv", ["Metric", "Value"], summary)

    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    hdr_font = Font(name="Arial", bold=True, color="FFFFFF")
    hdr_fill = PatternFill("solid", fgColor="1F4E78")
    body = Font(name="Arial")

    def sheet(title, header, data, widths=None, notes=None):
        ws = wb.create_sheet(title)
        r0 = 1
        for line in notes or []:
            ws.cell(row=r0, column=1, value=line).font = Font(name="Arial", italic=True)
            r0 += 1
        if notes:
            r0 += 1
        for j, h in enumerate(header, 1):
            c = ws.cell(row=r0, column=j, value=h)
            c.font, c.fill = hdr_font, hdr_fill
        for i, row in enumerate(data, r0 + 1):
            for j, v in enumerate(row, 1):
                ws.cell(row=i, column=j, value=v).font = body
        ws.freeze_panes = ws.cell(row=r0 + 1, column=1)
        ws.auto_filter.ref = f"A{r0}:{get_column_letter(len(header))}{r0 + len(data)}"
        for j, h in enumerate(header, 1):
            wdt = (widths or {}).get(h) or min(60, max(len(str(h)), *(len(str(r[j - 1])) for r in data[:500])) + 2)
            ws.column_dimensions[get_column_letter(j)].width = wdt

    wb.remove(wb.active)
    sheet("Summary", ["Metric", "Value"], summary, {"Metric": 62, "Value": 28},
          notes=["Schedule rationalisation - generated by scripts/schedule-rationalisation/rationalise_schedules.py",
                 f"Source: 'Schedule Table' Google Sheet export, scope '{args.scope}', run {created_utc_s}",
                 "Rules: same name (case/whitespace-insensitive) + identical day rows on every column except "
                 "BulkRunScheduleId/ClientId -> one shared schedule; the default or the lowest id survives; others retired."])
    sheet("ScheduleClients", ["ScheduleName", "ClientId", "CreatedUtc", "CreatedBy"], link_table,
          {"ScheduleName": 48, "ClientId": 12, "CreatedUtc": 22, "CreatedBy": 24},
          notes=["Rows for Kevin's schedule/client link table - one row per client attached to a schedule.",
                 "CreatedUtc/CreatedBy are the values this run was generated with; change with --created-by / --created-utc."])
    sheet("MergedSchedules", mg_cols, [[g[c] for c in mg_cols] for g in a["merge_groups"]],
          {"ScheduleName": 44, "ClientIds": 40, "SurvivorIds": 34, "RetiredIds": 60},
          notes=["One row per schedule that clients are linked to. SurvivorIds = the tblBulkRunSchedule rows that stay; "
                 "RetiredIds = duplicate rows of the other clients to remove.",
                 "RenamedFrom is set when this definition is a variant of a name used by other clients or a default and "
                 "needs the '#n' name to stay unique."])
    sheet("Variants", v_cols, [[v[c] for c in v_cols] for v in a["variants"]],
          {"ScheduleName": 44, "ProposedName": 48, "ClientIds": 40, "SurvivorIds": 34, "DiffersFromMainGroupOn": 50},
          notes=["Names whose definitions are NOT identical across clients (or vs the default). Group 1 keeps the name; "
                 "other groups get a '#n' suffix. Converted = whether this run links/renames the group."])
    sheet("RetiredRows", ret_hdr, a["retired"], {"ScheduleName": 44, "SurvivorIds": 34},
          notes=["Every tblBulkRunSchedule row that becomes redundant once its client is linked to the surviving schedule."])
    sheet("DataQuality", ["Check", "ScheduleName", "ClientId", "Detail"], a["dq"],
          {"Check": 62, "ScheduleName": 44, "Detail": 80},
          notes=["Findings that were NOT auto-fixed. They mostly show why a name-keyed link table is fragile."])
    wb.save(os.path.join(args.out_dir, f"schedule-rationalisation{suffix}.xlsx"))

    write_sql(os.path.join(args.out_dir, f"rationalise_schedules{suffix}.sql"), a, args, created_utc_s,
              staging=(args.scope == "all"))

    for m, v in summary:
        print(f"{m}: {v}")


if __name__ == "__main__":
    main()
