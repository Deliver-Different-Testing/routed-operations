#!/usr/bin/env python3
"""
Rationalise tblBulkRunSchedule into shared, multi-client schedules.

Runs AFTER sql/001_schedule_header_and_id_keyed_links.sql, which gives every
schedule (one per Name + ClientId) its own ScheduleId in
tblBulkRunScheduleHeader and a link row per client. This script finds
schedules that are identical copies of each other and generates SQL that
re-points their link rows to one surviving ScheduleId and retires the copies.

Input : a CSV export of tblBulkRunSchedule (the "Schedule Table" Google Sheet,
        File > Download > CSV). NULLs are the literal string NULL. The export
        is only used to find the groups; the SQL resolves ScheduleIds at run
        time from the BulkRunScheduleId of each schedule's lowest day row.
Output: CSVs, an .xlsx workbook and SQL Server scripts in --out-dir.

Rules (see docs/STEVE-SCHEDULE-RATIONALISATION-KEVIN-2026-09-08.md):
  * A "schedule" is the set of day rows sharing (Name, ClientId).
  * Names are compared case-insensitively with whitespace collapsed.
  * Two schedules are the SAME schedule when every column other than
    BulkRunScheduleId, ClientId, Name and the --ignore columns (default:
    Description, which holds some incorrect data) matches on every day row.
    The survivor's value of an ignored column is kept; the other values
    are listed per merge group so they can be checked.
  * Same name + same definition -> ONE schedule: the default (ClientId NULL)
    if there is one with that definition, otherwise the copy with the lowest
    BulkRunScheduleId. Every client is linked to the survivor; the other
    copies (header + day rows) are retired.
  * Same name + different definition -> separate schedules that happen to
    share a name. With ScheduleId as the key that is allowed; they are
    listed in the Variants sheet so someone can give them clearer names.
  * --staging adds a snapshot, removes the retired rows' zone rows, clears
    the legacy ClientId on every day row, and writes a restore script.
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


def analyse(rows, ignore=()):
    columns = list(rows[0].keys())
    ignore = [c for c in ignore if c in columns]
    sig_cols = [c for c in columns if c not in (ID, CLIENT, NAME, *ignore)]  # Name compared via norm_name
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
                           canonical[k], c, "distinct ScheduleId; consider a clearer name"))

    # ---- grouping -------------------------------------------------------------
    by_name = collections.defaultdict(dict)  # name key -> sig -> [(client, rows)]
    for (k, c), rs in sched.items():
        if c != NULL:
            by_name[k].setdefault(signature(rs), []).append((c, rs))

    merge_groups, variants, link_rows, retired_rows, merges = [], [], [], [], []
    for k in sorted(by_name):
        groups = dict(by_name[k])
        base = canonical[k]
        ordered = []
        if k in defaults:
            ordered.append(dict(clients=sorted(groups.pop(defaults[k], []), key=lambda cr: min_id(cr[1])),
                                sig=defaults[k], is_default=True, surv_rows=sched[(k, NULL)], surv_client=NULL))
        for sig, clients in sorted(groups.items(), key=lambda g: (-len(g[1]), min(min_id(rs) for _, rs in g[1]))):
            clients.sort(key=lambda cr: min_id(cr[1]))
            ordered.append(dict(clients=clients, sig=sig, is_default=False,
                                surv_rows=clients[0][1], surv_client=clients[0][0]))
        for n, g in enumerate(ordered):
            surv_ids = sorted(r[ID] for r in g["surv_rows"])
            clients = g["clients"]
            retire_clients = clients if g["is_default"] else clients[1:]
            convert = len(retire_clients) > 0
            if len(ordered) > 1:
                diff = []
                if n > 0:
                    other = ordered[0]["sig"]
                    for i, col in enumerate(sig_cols):
                        if sorted(set(t[i] for t in g["sig"])) != sorted(set(t[i] for t in other)):
                            diff.append(col)
                variants.append({
                    "ScheduleName": base, "VariantGroup": n + 1,
                    "IsDefault": "Yes" if g["is_default"] else "No",
                    "ClientCount": len(clients), "ClientIds": ", ".join(c for c, _ in clients),
                    "SurvivorRowIds": id_list(surv_ids),
                    "DiffersFromGroup1On": ", ".join(diff) if n > 0 else "(group 1)",
                    "CopiesMerged": len(retire_clients),
                })
            if not convert:
                continue
            example = sorted(g["surv_rows"], key=lambda r: r[ID])[0]
            ignored_vals = {}
            for col in ignore:
                vals = collections.Counter(r[col] for _, rs in clients for r in rs)
                if g["is_default"]:
                    vals.update(r[col] for r in g["surv_rows"])
                ignored_vals[f"{col}Values"] = " | ".join(f"{v} (x{n})" for v, n in vals.most_common())
            merge_groups.append({
                "ScheduleName": base,
                "SurvivorIsDefault": "Yes" if g["is_default"] else "No",
                "ClientCount": len(clients), "ClientIds": ", ".join(c for c, _ in clients),
                "SurvivorLegacyClientId": g["surv_client"], "SurvivorRowIds": id_list(surv_ids),
                "RetiredRowIds": id_list(r[ID] for _, rs in retire_clients for r in rs),
                "Days": ", ".join(sorted(set(r["DayOfWeek"] for r in g["surv_rows"]), key=int)),
                **{c: example[c] for c in sig_cols_no_day},
                **{f"Survivor{c}": example[c] for c in ignore},
                **ignored_vals,
            })
            for c, _ in clients:
                link_rows.append((base, c, surv_ids[0]))
            for c, rs in retire_clients:
                rids = sorted(r[ID] for r in rs)
                merges.append((surv_ids[0], rids[0], c, base))  # survivor row, retired schedule's first row
                for rid in rids:
                    retired_rows.append((rid, c, base, g["surv_client"], surv_ids[0]))

    return dict(sched=sched, canonical=canonical, dq=dq, merge_groups=merge_groups, variants=variants,
                link_rows=link_rows, retired_rows=retired_rows, merges=merges, by_name=by_name,
                all_cols=columns, ignore=ignore)


def write_sql(path, a, args, created_utc_s, staging):
    S, L, H = args.schedule_table, args.link_table, args.header_table
    tag = created_utc_s[:10].replace("-", "")
    snaps = {t: f"{t}_PreMerge_{tag}" for t in (S, H, L, "dbo.BulkZoneSchedule")}
    out = []
    w = out.append
    w(f"-- Schedule merge{' (STAGING)' if staging else ''}: fold identical client copies into one ScheduleId.")
    w(f"-- Columns ignored in the comparison: {', '.join(a['ignore']) or '(none)'} (survivor's value kept).")
    w(f"-- Generated {created_utc_s} by scripts/schedule-rationalisation/rationalise_schedules.py")
    w(f"-- Requires sql/001_schedule_header_and_id_keyed_links.sql to have run (header {H}, link {L}).")
    w("-- Runs inside a transaction and ROLLS BACK unless @Commit = 1.")
    w("SET NOCOUNT ON; SET XACT_ABORT ON;")
    w("DECLARE @Commit bit = 0;                -- 1 = keep the changes")
    w(f"DECLARE @By nvarchar(100) = {sql_str(args.created_by)};")
    if staging:
        w("DECLARE @DisableLegacyClientId bit = 1; -- 1 = NULL ClientId on every day row: the link table becomes the only client->schedule path")
        w("DECLARE @RetireDependants bit = 1;      -- 1 = remove BulkZoneSchedule rows of retired day rows (snapshotted first)")
    w("BEGIN TRAN;")
    w("")
    if staging:
        w("-- 0. Snapshots for restore_merge_staging.sql.")
        for t, sn in snaps.items():
            w(f"IF OBJECT_ID('{sn}', 'U') IS NULL SELECT * INTO {sn} FROM {t};")
        w("")
    w("-- 1. Merge pairs: one row per retired schedule, identified by day-row ids from the export.")
    w("--    SurvivorRowId / RetiredRowId are the lowest BulkRunScheduleId of each schedule; the")
    w("--    ScheduleIds are resolved from them at run time so the script survives re-numbering.")
    w("CREATE TABLE #Merge (SurvivorRowId int, RetiredRowId int PRIMARY KEY, ClientId int, ScheduleName nvarchar(200));")
    for chunk in chunks(a["merges"], 500):
        w("INSERT INTO #Merge (SurvivorRowId, RetiredRowId, ClientId, ScheduleName) VALUES")
        w(",\n".join(f"({sv}, {rt}, {c}, {sql_str(nm)})" for sv, rt, c, nm in chunk) + ";")
    w("")
    w("SELECT m.*, sv.ScheduleId AS SurvivorScheduleId, rt.ScheduleId AS RetiredScheduleId")
    w("INTO #Map")
    w(f"FROM #Merge m JOIN {S} sv ON sv.BulkRunScheduleId = m.SurvivorRowId JOIN {S} rt ON rt.BulkRunScheduleId = m.RetiredRowId;")
    w("")
    w("-- 2. Safety checks. Every SELECT must return 0 rows before @Commit is set to 1.")
    w("--    a) every pair resolved to two different, live schedules")
    w("SELECT m.* FROM #Merge m LEFT JOIN #Map p ON p.RetiredRowId = m.RetiredRowId WHERE p.RetiredRowId IS NULL OR p.SurvivorScheduleId = p.RetiredScheduleId;")
    w(f"SELECT p.* FROM #Map p JOIN {H} h ON h.ScheduleId IN (p.SurvivorScheduleId, p.RetiredScheduleId) WHERE h.RetiredUtc IS NOT NULL;")
    w("--    b) the retired schedule still belongs to the client we expect (export not stale)")
    w(f"SELECT p.* FROM #Map p JOIN {H} h ON h.ScheduleId = p.RetiredScheduleId WHERE ISNULL(h.LegacyClientId, -1) <> p.ClientId;")
    w("--    c) retired schedules that own zone / linehaul rows (NOT compared by this script - the survivor may differ)")
    if staging:
        w("--       (staging: reported here, removed in step 4 when @RetireDependants = 1)")
    w(f"SELECT z.* FROM dbo.BulkZoneSchedule z JOIN {S} s ON s.BulkRunScheduleId = z.ScheduleId JOIN #Map p ON p.RetiredScheduleId = s.ScheduleId;")
    w(f"-- SELECT l.* FROM dbo.tblBulkScheduleLinehaul l JOIN {S} s ON s.BulkRunScheduleId = l.<schedule id column> JOIN #Map p ON p.RetiredScheduleId = s.ScheduleId;")
    w("")
    w("-- 3. Re-point link rows from the retired schedule to the survivor.")
    w(f"INSERT INTO {L} (ScheduleId, ClientId, CreatedUtc, CreatedBy)")
    w(f"SELECT p.SurvivorScheduleId, l.ClientId, '{created_utc_s}', @By")
    w(f"FROM {L} l JOIN #Map p ON p.RetiredScheduleId = l.ScheduleId")
    w(f"WHERE NOT EXISTS (SELECT 1 FROM {L} x WHERE x.ScheduleId = p.SurvivorScheduleId AND x.ClientId = l.ClientId);")
    w(f"DELETE l FROM {L} l JOIN #Map p ON p.RetiredScheduleId = l.ScheduleId;")
    w("")
    w("-- 4. Retire the copies: header marked, day rows removed (the survivor's rows are identical).")
    if staging:
        w(f"IF @RetireDependants = 1 DELETE z FROM dbo.BulkZoneSchedule z JOIN {S} s ON s.BulkRunScheduleId = z.ScheduleId JOIN #Map p ON p.RetiredScheduleId = s.ScheduleId;")
    w(f"DELETE s FROM {S} s JOIN #Map p ON p.RetiredScheduleId = s.ScheduleId;")
    w(f"UPDATE h SET RetiredUtc = '{created_utc_s}', RetiredBy = @By FROM {H} h JOIN #Map p ON p.RetiredScheduleId = h.ScheduleId;")
    if staging:
        w("")
        w("-- 5. Disable the legacy 1-1 path. LegacyClientId stays on the header for reference.")
        w(f"IF @DisableLegacyClientId = 1 UPDATE {S} SET ClientId = NULL WHERE ClientId IS NOT NULL;")
    w("")
    w(f"-- {6 if staging else 5}. Result.")
    w(f"SELECT (SELECT COUNT(*) FROM #Map) AS SchedulesRetired, (SELECT COUNT(*) FROM {H} WHERE RetiredUtc IS NULL) AS LiveSchedules,")
    w(f"       (SELECT COUNT(*) FROM {S}) AS DayRows, (SELECT COUNT(*) FROM {L}) AS LinkRows;")
    w("DROP TABLE #Map; DROP TABLE #Merge;")
    w("IF @Commit = 1 COMMIT TRAN ELSE ROLLBACK TRAN;")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")

    if staging:
        cols = ", ".join(a["all_cols"] + ["ScheduleId"])
        r = [
            f"-- Restore staging from the snapshots taken by rationalise_schedules_staging.sql ({tag}).",
            "-- Drop the IDENTITY_INSERT lines for a table that has no identity column.",
            "SET NOCOUNT ON; SET XACT_ABORT ON;",
            "DECLARE @Commit bit = 0;",
            "BEGIN TRAN;",
            f"IF OBJECT_ID('{snaps[S]}', 'U') IS NULL THROW 50000, 'snapshot tables missing - nothing to restore from', 1;",
            f"DELETE FROM {L};",
            f"INSERT INTO {L} (ScheduleId, ClientId, CreatedUtc, CreatedBy) SELECT ScheduleId, ClientId, CreatedUtc, CreatedBy FROM {snaps[L]};",
            f"UPDATE h SET h.RetiredUtc = p.RetiredUtc, h.RetiredBy = p.RetiredBy FROM {H} h JOIN {snaps[H]} p ON p.ScheduleId = h.ScheduleId;",
            f"SET IDENTITY_INSERT {S} ON;",
            f"INSERT INTO {S} ({cols})",
            f"  SELECT {cols} FROM {snaps[S]} p WHERE NOT EXISTS (SELECT 1 FROM {S} s WHERE s.BulkRunScheduleId = p.BulkRunScheduleId);",
            f"SET IDENTITY_INSERT {S} OFF;",
            f"UPDATE s SET s.ClientId = p.ClientId FROM {S} s JOIN {snaps[S]} p ON p.BulkRunScheduleId = s.BulkRunScheduleId WHERE ISNULL(s.ClientId, -1) <> ISNULL(p.ClientId, -1);",
            "SET IDENTITY_INSERT dbo.BulkZoneSchedule ON;",
            "INSERT INTO dbo.BulkZoneSchedule (Id, Zone, ScheduleId, Active)",
            f"  SELECT Id, Zone, ScheduleId, Active FROM {snaps['dbo.BulkZoneSchedule']} p WHERE NOT EXISTS (SELECT 1 FROM dbo.BulkZoneSchedule z WHERE z.Id = p.Id);",
            "SET IDENTITY_INSERT dbo.BulkZoneSchedule OFF;",
            "-- " + " ".join(f"DROP TABLE {sn};" for sn in snaps.values()) + "  -- once you are happy",
            "IF @Commit = 1 COMMIT TRAN ELSE ROLLBACK TRAN;",
        ]
        with open(os.path.join(os.path.dirname(path), "restore_merge_staging.sql"), "w", encoding="utf-8") as f:
            f.write("\n".join(r) + "\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("csv", help="tblBulkRunSchedule export (CSV)")
    ap.add_argument("--out-dir", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "output"))
    ap.add_argument("--staging", action="store_true", help="also snapshot, clear legacy ClientId, write restore script")
    ap.add_argument("--created-by", default="steve@urgent.co.nz")
    ap.add_argument("--link-table", default="dbo.tblBulkRunScheduleClient")
    ap.add_argument("--header-table", default="dbo.tblBulkRunScheduleHeader")
    ap.add_argument("--schedule-table", default="dbo.tblBulkRunSchedule")
    ap.add_argument("--created-utc", help="override run timestamp, e.g. 2026-09-08T00:00:00Z")
    ap.add_argument("--ignore", default="Description",
                    help="comma-separated columns NOT compared when deciding two schedules are the same (default: Description)")
    args = ap.parse_args()
    ignore = [c.strip() for c in args.ignore.split(",") if c.strip()]

    created_utc_s = args.created_utc or dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    os.makedirs(args.out_dir, exist_ok=True)
    with open(args.csv, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    for r in rows:
        r[ID] = int(r[ID])

    a = analyse(rows, ignore)
    link_table = [(n, c, created_utc_s, args.created_by) for n, c, _ in a["link_rows"]]
    link_by_row = [(sv, c, n) for n, c, sv in a["link_rows"]]

    def write_csv(fname, header, data):
        with open(os.path.join(args.out_dir, fname), "w", newline="", encoding="utf-8") as f:
            wr = csv.writer(f)
            wr.writerow(header)
            wr.writerows(data)

    mg_cols = list(a["merge_groups"][0].keys())
    v_cols = list(a["variants"][0].keys())
    ret_hdr = ["RetiredBulkRunScheduleId", "RetiredClientId", "ScheduleName", "SurvivorLegacyClientId", "SurvivorRowId"]
    write_csv("schedule_clients.csv", ["ScheduleName", "ClientId", "CreatedUtc", "CreatedBy"], link_table)
    write_csv("schedule_clients_by_row.csv", ["SurvivorBulkRunScheduleId", "ClientId", "ScheduleName"], link_by_row)
    write_csv("merge_groups.csv", mg_cols, [[g[c] for c in mg_cols] for g in a["merge_groups"]])
    write_csv("retired_schedule_rows.csv", ret_hdr, a["retired_rows"])
    write_csv("variants.csv", v_cols, [[v[c] for c in v_cols] for v in a["variants"]])
    write_csv("data_quality.csv", ["Check", "ScheduleName", "ClientId", "Detail"], a["dq"])

    sched = a["sched"]
    n_client = sum(1 for k in sched if k[1] != NULL)
    n_default = sum(1 for k in sched if k[1] == NULL)
    summary = [
        ("Columns ignored when comparing schedules", ", ".join(a["ignore"]) or "(none)"),
        ("Source rows (tblBulkRunSchedule)", len(rows)),
        ("Schedules = ScheduleIds after migration 001", n_client + n_default),
        ("  default schedules (ClientId NULL)", n_default),
        ("  client-specific schedules (Name + ClientId)", n_client),
        ("Names shared by 2+ clients", sum(1 for m in a["by_name"].values() if sum(len(v) for v in m.values()) > 1)),
        ("Shared schedules after merge (survivors with 2+ clients)", len(a["merge_groups"])),
        ("  of which the survivor is a default schedule", sum(1 for g in a["merge_groups"] if g["SurvivorIsDefault"] == "Yes")),
        ("Client schedules retired into a survivor", len(a["merges"])),
        ("Schedules remaining after merge", n_client + n_default - len(a["merges"])),
        ("Client schedules that stay one-client", n_client - len(link_table)),
        ("Link rows after merge (clients on shared schedules)", len(link_table)),
        ("Day rows retired", len(a["retired_rows"])),
        ("Day rows remaining", len(rows) - len(a["retired_rows"])),
        ("Names with differing definitions (variants, kept as separate ScheduleIds)",
         len(set(v["ScheduleName"] for v in a["variants"]))),
        ("Data-quality findings", len(a["dq"])),
        ("CreatedUtc used", created_utc_s),
        ("CreatedBy used", args.created_by),
    ]
    write_csv("summary.csv", ["Metric", "Value"], summary)

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
    sheet("Summary", ["Metric", "Value"], summary, {"Metric": 70, "Value": 28},
          notes=["Schedule rationalisation - generated by scripts/schedule-rationalisation/rationalise_schedules.py",
                 f"Source: 'Schedule Table' Google Sheet export, run {created_utc_s}",
                 "Step 1 (sql/001) gives every Name + ClientId schedule its own ScheduleId and a link row.",
                 "Step 2 (this) merges schedules with the same name and identical day rows on every column except "
                 f"BulkRunScheduleId/ClientId/Name/{'/'.join(a['ignore'])} into one ScheduleId; the default or the lowest id survives.",
                 "Ignored columns keep the survivor's value; the other values seen in the group are listed in MergedSchedules."])
    sheet("ScheduleClients", ["ScheduleName", "ClientId", "CreatedUtc", "CreatedBy"], link_table,
          {"ScheduleName": 48, "ClientId": 12, "CreatedUtc": 22, "CreatedBy": 24},
          notes=["Clients attached to each shared schedule after the merge, in the link-table shape.",
                 "The SQL keys these on ScheduleId (resolved from SurvivorBulkRunScheduleId in the next sheet); the name is for reading."])
    sheet("ScheduleClientsByRow", ["SurvivorBulkRunScheduleId", "ClientId", "ScheduleName"], link_by_row,
          {"ScheduleName": 48},
          notes=["Same rows keyed by the survivor's lowest day-row id, which the SQL turns into the ScheduleId at run time."])
    sheet("MergedSchedules", mg_cols, [[g[c] for c in mg_cols] for g in a["merge_groups"]],
          {"ScheduleName": 44, "ClientIds": 40, "SurvivorRowIds": 34, "RetiredRowIds": 60},
          notes=["One row per surviving shared schedule. SurvivorRowIds = day rows that stay; RetiredRowIds = identical copies removed.",
                 "SurvivorDescription is what the shared schedule will carry; DescriptionValues lists every value seen across the merged copies (x count)."])
    sheet("Variants", v_cols, [[v[c] for c in v_cols] for v in a["variants"]],
          {"ScheduleName": 44, "ClientIds": 40, "SurvivorRowIds": 34, "DiffersFromGroup1On": 50},
          notes=["Names whose definitions are NOT identical across clients (or vs the default). Each group keeps its own ScheduleId;",
                 "nothing is renamed, but these are the schedules worth giving clearer names in the UI."])
    sheet("RetiredRows", ret_hdr, a["retired_rows"], {"ScheduleName": 44},
          notes=["Every tblBulkRunSchedule row that is removed because its schedule is an identical copy of the survivor."])
    sheet("DataQuality", ["Check", "ScheduleName", "ClientId", "Detail"], a["dq"],
          {"Check": 62, "ScheduleName": 44, "Detail": 80},
          notes=["Findings that were NOT auto-fixed."])
    wb.save(os.path.join(args.out_dir, "schedule-rationalisation.xlsx"))

    write_sql(os.path.join(args.out_dir, "rationalise_schedules.sql"), a, args, created_utc_s, staging=False)
    write_sql(os.path.join(args.out_dir, "rationalise_schedules_staging.sql"), a, args, created_utc_s, staging=True)

    for m, v in summary:
        print(f"{m}: {v}")


if __name__ == "__main__":
    main()
