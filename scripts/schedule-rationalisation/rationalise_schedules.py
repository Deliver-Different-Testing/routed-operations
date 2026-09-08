#!/usr/bin/env python3
"""
Rationalise tblBulkRunSchedule into shared, multi-client schedules.

Input : a CSV export of tblBulkRunSchedule (the "Schedule Table" Google Sheet,
        File > Download > CSV). NULLs are the literal string NULL.
Output: CSVs, an .xlsx workbook and a SQL Server script in --out-dir.

Rules (see docs/STEVE-SCHEDULE-RATIONALISATION-2026-09-08.md):
  * A "schedule" is the set of day rows sharing (Name, ClientId).
  * Names are compared case-insensitively with whitespace collapsed.
  * Two client schedules are the SAME schedule when every column other than
    BulkRunScheduleId and ClientId matches on every day row.
  * Same name + same definition + >= 2 clients  -> one merged schedule.
    The schedule with the lowest BulkRunScheduleId survives, the others are
    retired, and every client is written to the ScheduleClient link table.
  * Same name + different definition -> a "variant". The largest group keeps
    the name; the rest get a proposed suffixed name so that a name-keyed link
    table can still address them unambiguously.
  * Default schedules (ClientId NULL) are never merged or retired.
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("csv", help="tblBulkRunSchedule export (CSV)")
    ap.add_argument("--out-dir", default=os.path.join(os.path.dirname(__file__), "output"))
    ap.add_argument("--created-by", default="steve@urgent.co.nz")
    ap.add_argument("--link-table", default="dbo.tblBulkRunScheduleClient",
                    help="name of Kevin's schedule/client link table")
    ap.add_argument("--schedule-table", default="dbo.tblBulkRunSchedule")
    args = ap.parse_args()

    created_utc = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
    created_utc_s = created_utc.strftime("%Y-%m-%dT%H:%M:%SZ")
    os.makedirs(args.out_dir, exist_ok=True)

    with open(args.csv, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    for r in rows:
        r[ID] = int(r[ID])
    columns = list(rows[0].keys())
    sig_cols = [c for c in columns if c not in (ID, CLIENT)]
    sig_cols_no_day = [c for c in sig_cols if c != "DayOfWeek"]

    # ---- schedules: (name key, client) -> rows -------------------------------
    sched = collections.defaultdict(list)
    for r in rows:
        sched[(norm_name(r[NAME]), r[CLIENT])].append(r)

    # canonical spelling per name key: most frequent raw spelling, tie -> lowest id
    spellings = collections.defaultdict(collections.Counter)
    first_id = {}
    for r in rows:
        k = norm_name(r[NAME])
        spellings[k][r[NAME]] += 1
        first_id.setdefault((k, r[NAME]), r[ID])
        first_id[(k, r[NAME])] = min(first_id[(k, r[NAME])], r[ID])
    canonical = {
        k: max(c, key=lambda s: (c[s], -first_id[(k, s)])) for k, c in spellings.items()
    }

    def signature(rs):
        return frozenset(tuple(r[c] for c in sig_cols) for r in rs)

    def min_id(rs):
        return min(r[ID] for r in rs)

    # ---- data-quality findings ----------------------------------------------
    dq = []  # (Check, ScheduleName, ClientId, Detail)
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
                           canonical[k], c, "client could use the default"))
            else:
                dq.append(("Client schedule shares its name with a default schedule",
                           canonical[k], c, "name-keyed lookup is ambiguous"))

    # ---- grouping -------------------------------------------------------------
    by_name = collections.defaultdict(list)  # name key -> [(client, sig, rows)]
    for (k, c), rs in sched.items():
        if c != NULL:
            by_name[k].append((c, signature(rs), rs))

    merge_groups = []   # dicts
    variants = []       # dicts
    link_rows = []      # (ScheduleName, ClientId)
    retired = []        # (RetiredId, RetiredClientId, ScheduleName, SurvivorClientId, SurvivorIds)
    renames = []        # (ids, old name, new name)
    for k in sorted(by_name):
        members = by_name[k]
        groups = collections.defaultdict(list)
        for c, s, rs in members:
            groups[s].append((c, rs))
        ordered = sorted(groups.items(),
                         key=lambda g: (-len(g[1]), min(min_id(rs) for _, rs in g[1])))
        base = canonical[k]
        for n, (s, clients) in enumerate(ordered):
            name = base if n == 0 else f"{base} #{n + 1}"
            clients.sort(key=lambda cr: min_id(cr[1]))
            surv_c, surv_rows = clients[0]
            surv_ids = sorted(r[ID] for r in surv_rows)
            if n > 0 and len(clients) > 1:
                renames.append((surv_ids, canonical[k], name))
            if len(ordered) > 1:
                # fields that differ between this group and the name-holder group
                other = ordered[0][0]
                diff = []
                for i, col in enumerate(sig_cols):
                    a = sorted(set(t[i] for t in s))
                    b = sorted(set(t[i] for t in other))
                    if a != b:
                        diff.append(col)
                variants.append({
                    "ScheduleName": canonical[k],
                    "VariantGroup": n + 1,
                    "ProposedName": name,
                    "ClientCount": len(clients),
                    "ClientIds": ", ".join(c for c, _ in clients),
                    "SurvivorIds": id_list(surv_ids),
                    "DiffersFromMainGroupOn": ", ".join(diff) if n > 0 else "(name holder)",
                    "MergedIntoSharedSchedule": "Yes" if len(clients) > 1 else "No",
                })
            if len(clients) < 2:
                continue
            example = sorted(surv_rows, key=lambda r: r[ID])[0]
            merge_groups.append({
                "ScheduleName": name,
                "RenamedFrom": canonical[k] if n > 0 else "",
                "ClientCount": len(clients),
                "ClientIds": ", ".join(c for c, _ in clients),
                "SurvivorClientId": surv_c,
                "SurvivorIds": id_list(surv_ids),
                "RetiredIds": id_list(r[ID] for c, rs in clients[1:] for r in rs),
                "Days": ", ".join(sorted(set(r["DayOfWeek"] for r in surv_rows), key=int)),
                **{c: example[c] for c in sig_cols_no_day if c not in (NAME,)},
            })
            for c, rs in clients:
                link_rows.append((name, c))
            for c, rs in clients[1:]:
                for r in sorted(rs, key=lambda r: r[ID]):
                    retired.append((r[ID], c, name, surv_c, id_list(surv_ids)))

    # ---- write CSVs -------------------------------------------------------------
    def write_csv(fname, header, data):
        with open(os.path.join(args.out_dir, fname), "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(header)
            w.writerows(data)

    link_table = [(n, c, created_utc_s, args.created_by) for n, c in link_rows]
    write_csv("schedule_clients.csv", ["ScheduleName", "ClientId", "CreatedUtc", "CreatedBy"], link_table)
    mg_cols = list(merge_groups[0].keys())
    write_csv("merge_groups.csv", mg_cols, [[g[c] for c in mg_cols] for g in merge_groups])
    write_csv("retired_schedule_rows.csv",
              ["RetiredBulkRunScheduleId", "RetiredClientId", "ScheduleName", "SurvivorClientId", "SurvivorIds"], retired)
    v_cols = list(variants[0].keys())
    write_csv("variants.csv", v_cols, [[v[c] for c in v_cols] for v in variants])
    write_csv("data_quality.csv", ["Check", "ScheduleName", "ClientId", "Detail"], dq)

    # ---- summary ---------------------------------------------------------------
    n_client_scheds = sum(1 for k in sched if k[1] != NULL)
    n_default_scheds = sum(1 for k in sched if k[1] == NULL)
    summary = [
        ("Source rows (tblBulkRunSchedule)", len(rows)),
        ("Default schedules (ClientId NULL)", n_default_scheds),
        ("Client-specific schedules (Name + ClientId)", n_client_scheds),
        ("Names shared by 2+ clients", len([k for k, m in by_name.items() if len(m) > 1])),
        ("Merged shared schedules created", len(merge_groups)),
        ("Client schedules folded into a shared schedule", len(link_rows)),
        ("Link-table rows (ScheduleClient)", len(link_rows)),
        ("Schedule rows retired", len(retired)),
        ("Schedule rows remaining", len(rows) - len(retired)),
        ("Names whose clients have differing definitions (variants)",
         len(set(v["ScheduleName"] for v in variants))),
        ("Shared schedules that need a new '#n' name (variant groups)", len(renames)),
        ("Client schedules in a variant group of one (left as-is)",
         sum(1 for v in variants if v["MergedIntoSharedSchedule"] == "No")),
        ("Data-quality findings", len(dq)),
        ("CreatedUtc used", created_utc_s),
        ("CreatedBy used", args.created_by),
    ]
    write_csv("summary.csv", ["Metric", "Value"], summary)

    # ---- xlsx ------------------------------------------------------------------
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    hdr_font = Font(name="Arial", bold=True, color="FFFFFF")
    hdr_fill = PatternFill("solid", fgColor="1F4E78")
    body = Font(name="Arial")

    def sheet(title, header, data, widths=None, notes=None):
        ws = wb.create_sheet(title)
        r0 = 1
        if notes:
            for line in notes:
                ws.cell(row=r0, column=1, value=line).font = Font(name="Arial", italic=True)
                r0 += 1
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
            w = (widths or {}).get(h) or min(60, max(len(str(h)), *(len(str(r[j - 1])) for r in data[:500])) + 2)
            ws.column_dimensions[get_column_letter(j)].width = w
        return ws

    wb.remove(wb.active)
    sheet("Summary", ["Metric", "Value"], summary, {"Metric": 60, "Value": 28},
          notes=["Schedule rationalisation - generated by scripts/schedule-rationalisation/rationalise_schedules.py",
                 f"Source: 'Schedule Table' Google Sheet export, run {created_utc_s}",
                 "Rules: same name (case/whitespace-insensitive) + identical day rows on every column except "
                 "BulkRunScheduleId/ClientId -> one shared schedule; lowest id survives; others retired."])
    sheet("ScheduleClients", ["ScheduleName", "ClientId", "CreatedUtc", "CreatedBy"], link_table,
          {"ScheduleName": 48, "ClientId": 12, "CreatedUtc": 22, "CreatedBy": 24},
          notes=["Rows for Kevin's schedule/client link table - one row per client attached to a shared schedule.",
                 "CreatedUtc/CreatedBy are the values this run was generated with; change with --created-by."])
    sheet("MergedSchedules", mg_cols, [[g[c] for c in mg_cols] for g in merge_groups],
          {"ScheduleName": 44, "ClientIds": 40, "SurvivorIds": 34, "RetiredIds": 60},
          notes=["One row per shared schedule created. SurvivorIds = the tblBulkRunSchedule rows that stay; "
                 "RetiredIds = duplicate rows of the other clients to remove.",
                 "RenamedFrom is set when this definition is a variant of a name used by other clients and "
                 "needs the suffixed name to stay unique."])
    sheet("Variants", v_cols, [[v[c] for c in v_cols] for v in variants],
          {"ScheduleName": 44, "ProposedName": 48, "ClientIds": 40, "SurvivorIds": 34, "DiffersFromMainGroupOn": 50},
          notes=["Names used by several clients whose definitions are NOT identical. Group 1 keeps the name; "
                 "other groups get a proposed '#n' suffix. Review before applying the renames in the SQL script."])
    sheet("RetiredRows", ["RetiredBulkRunScheduleId", "RetiredClientId", "ScheduleName", "SurvivorClientId", "SurvivorIds"],
          retired, {"ScheduleName": 44, "SurvivorIds": 34},
          notes=["Every tblBulkRunSchedule row that becomes redundant once its client is linked to the shared schedule."])
    sheet("DataQuality", ["Check", "ScheduleName", "ClientId", "Detail"], dq,
          {"Check": 62, "ScheduleName": 44, "Detail": 80},
          notes=["Findings that were NOT auto-fixed. They mostly show why a name-keyed link table is fragile."])
    wb.save(os.path.join(args.out_dir, "schedule-rationalisation.xlsx"))

    # ---- SQL -------------------------------------------------------------------
    S, L = args.schedule_table, args.link_table
    out = []
    w = out.append
    w("-- Schedule rationalisation: shared multi-client schedules")
    w(f"-- Generated {created_utc_s} by scripts/schedule-rationalisation/rationalise_schedules.py")
    w(f"-- Schedule table: {S}   Link table: {L}  (rename below if Kevin's table is called something else)")
    w("-- The script runs inside a transaction and ROLLS BACK unless @Commit = 1.")
    w("SET NOCOUNT ON; SET XACT_ABORT ON;")
    w("DECLARE @Commit bit = 0;          -- 1 = keep the changes")
    w("DECLARE @RenameVariants bit = 0;  -- 1 = apply step 3 (only needed while the link table is keyed by name)")
    w("BEGIN TRAN;")
    w("")
    renamed_names = {new for _ids, _old, new in renames}
    plain_ret = [r for r in retired if r[2] not in renamed_names]
    var_ret = [r for r in retired if r[2] in renamed_names]
    plain_links = [l for l in link_table if l[0] not in renamed_names]
    var_links = [l for l in link_table if l[0] in renamed_names]

    def emit_retired(data, indent=""):
        for chunk in chunks(data, 500):
            w(f"{indent}INSERT INTO #Retired (BulkRunScheduleId, ScheduleName, SurvivorClientId) VALUES")
            w(",\n".join(f"{indent}({rid}, {sql_str(nm)}, {sc})" for rid, _c, nm, sc, _s in chunk) + ";")

    def emit_links(data, indent=""):
        for chunk in chunks(data, 500):
            w(f"{indent}INSERT INTO {L} (ScheduleName, ClientId, CreatedUtc, CreatedBy) VALUES")
            w(",\n".join(f"{indent}({sql_str(n)}, {c}, '{u}', {sql_str(b)})" for n, c, u, b in chunk) + ";")

    w("-- 0. Retired rows staged in a temp table so the checks and the delete use one list.")
    w("CREATE TABLE #Retired (BulkRunScheduleId int PRIMARY KEY, ScheduleName nvarchar(200), SurvivorClientId int);")
    emit_retired(plain_ret)
    w("")
    w("-- 1. Link every client to its shared schedule (groups whose name is already unique).")
    emit_links(plain_links)
    w("")
    w("-- 2. Variant groups: a definition that shares its name with a different definition used by other")
    w("--    clients. The shared schedule needs a distinct name, so the rename, the link rows and the")
    w("--    retirements for these groups are applied together, and only when @RenameVariants = 1.")
    w("IF @RenameVariants = 1 BEGIN")
    for ids, old, new in renames:
        w(f"  UPDATE {S} SET Name = {sql_str(new)} WHERE BulkRunScheduleId IN ({id_list(ids)}); -- was {old!r}")
    emit_links(var_links, "  ")
    emit_retired(var_ret, "  ")
    w("END")
    w("")
    w("-- 3. Safety checks. Each must return 0 rows before @Commit is set to 1.")
    w("--    a) every retired id still exists")
    w(f"SELECT r.* FROM #Retired r LEFT JOIN {S} s ON s.BulkRunScheduleId = r.BulkRunScheduleId WHERE s.BulkRunScheduleId IS NULL;")
    w("--    b) retired schedules that own zone / linehaul rows (NOT compared by this script - the survivor may differ)")
    w("SELECT z.* FROM BulkZoneSchedule z JOIN #Retired r ON r.BulkRunScheduleId = z.ScheduleId;")
    w("SELECT l.* FROM tblBulkScheduleLinehaul l JOIN #Retired r ON r.BulkRunScheduleId = l.ScheduleId;")
    w("--    c) a link row whose name matches more than one definition (name still ambiguous)")
    w(f"SELECT l.ScheduleName, COUNT(DISTINCT s.ClientId) AS Definitions FROM {L} l JOIN {S} s ON s.Name = l.ScheduleName")
    w("  AND s.BulkRunScheduleId NOT IN (SELECT BulkRunScheduleId FROM #Retired) GROUP BY l.ScheduleName HAVING COUNT(DISTINCT s.ClientId) > 1;")
    w("")
    w("-- 4. Normalise spelling of surviving rows to the canonical name used in the link table.")
    for k, spell in sorted(spellings.items()):
        for s in spell:
            if s != canonical[k]:
                w(f"UPDATE {S} SET Name = {sql_str(canonical[k])} WHERE Name = {sql_str(s)} "
                  f"AND BulkRunScheduleId NOT IN (SELECT BulkRunScheduleId FROM #Retired);")
    w("")
    w("-- 5. Retire the duplicate client copies.")
    w(f"DELETE s FROM {S} s JOIN #Retired r ON r.BulkRunScheduleId = s.BulkRunScheduleId;")
    w("")
    w("DROP TABLE #Retired;")
    w("IF @Commit = 1 COMMIT TRAN ELSE ROLLBACK TRAN;")
    with open(os.path.join(args.out_dir, "rationalise_schedules.sql"), "w", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")

    for m, v in summary:
        print(f"{m}: {v}")


if __name__ == "__main__":
    main()
