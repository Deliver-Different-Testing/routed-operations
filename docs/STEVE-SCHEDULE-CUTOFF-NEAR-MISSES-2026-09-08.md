---
title: Steve — schedules that differ only by CutoffHours (candidates for further rationalisation)
date: 2026-09-08
audience: Steve, Kevin
status: For review
source: scripts/schedule-rationalisation/output/near_miss_CutoffHours.csv (generated)
related_docs:
  - STEVE-SCHEDULE-RATIONALISATION-KEVIN-2026-09-08.md
---

# Schedules that are the same bar CutoffHours

The generated merge treats two schedules as the same when every column except
`BulkRunScheduleId`, `ClientId`, `Name` and `Description` matches on every day
row. This list is the next layer down: groups of schedules under one name that
would **also** merge if `CutoffHours` were ignored — everything else (window,
speed, region, depot, postcode group, auto-book, storage state …) is identical.

| | |
|---|---|
| Groups | 82 |
| Schedules in those groups | 422 |
| Extra shared schedules if all were merged | 29 (179 → 208) |
| Extra client copies retired | 102 (522 → 624) |

How to read the table:

- **Schedules** = number of Name + ClientId schedules in the group (a default
  schedule counts as one).
- **Cut-off patterns** = the distinct `CutoffHours` values, with how many
  schedules use each. A single number means the same value every day;
  `Mon:65 Tue:17 …` means it differs by weekday (Monday's larger value is the
  weekend lead time). `60/65` means the schedule has two rows for that day
  with different cut-offs.
- Groups 22–28 and similar are a **default schedule with cut-off 0** next to a
  client copy with a real cut-off — those are probably a missing value on the
  default rather than a real difference.

To act on a group: set the outlier schedules' `CutoffHours` to the agreed
value (on the day rows, before migration 001 or after — the merge compares
day rows either way), re-export, re-run the generator and they merge
automatically. Alternatively run the generator with
`--ignore Description,CutoffHours` to merge all of them, keeping the
survivor's cut-off (the majority pattern is not necessarily the survivor's;
check `SurvivorCutoffHours` / `CutoffHoursValues` in `MergedSchedules`).

Full member detail (each schedule, its clients, cut-off by day, row ids) is in
the `NearMiss-CutoffHours` sheet of `schedule-rationalisation.xlsx` and in
`near_miss_CutoffHours.csv`.

| # | Schedule | Window | Schedules | Cut-off patterns (hours, schedules using it) |
|---|---|---|---|---|
| 1 | AKL > CHCH Pre 8am Medical | 06:00-08:00 | 12 | Mon:66 Tue:18 Wed:18 Thu:18 Fri:18 (11); Mon:64 Tue:16 Wed:16 Thu:16 Fri:16 (1) |
| 2 | AKL > Gisborne pre 10am | 06:00-10:00 | 11 | Mon:65 Tue:17 Wed:17 Thu:17 Fri:17 (9); Mon:60 Tue:17 Wed:17 Thu:17 Fri:17 (2) |
| 3 | AKL > Gisborne pre 8am | 06:00-08:00 | 10 | Mon:65 Tue:17 Wed:17 Thu:17 Fri:17 (8); Mon:60 Tue:17 Wed:17 Thu:17 Fri:17 (2) |
| 4 | AKL > HLZ Pre 8am Medical Run | 07:00-20:00 | 7 | Mon:62 Tue:14 Wed:14 Thu:14 Fri:14 (6); Mon:60 Tue:12 Wed:12 Thu:12 Fri:12 (1) |
| 5 | AKL > HLZ Pre 8am Medical Run | 07:00-14:00 | 5 | Mon:62 Tue:14 Wed:14 Thu:14 Fri:14 (4); Mon:60 Tue:12 Wed:12 Thu:12 Fri:12 (1) |
| 6 | AKL > HLZ Pre 8am Medical Run | 07:00-08:00 | 3 | Mon:62 Tue:14 Wed:14 Thu:14 Fri:14 (2); Mon:60 Tue:12 Wed:12 Thu:12 Fri:12 (1) |
| 7 | AKL > Masterton | 09:00-11:00 | 6 | Mon:68 Tue:20 Wed:20 Thu:20 Fri:20 (5); Mon:65 Tue:20 Wed:20 Thu:20 Fri:20 (1) |
| 8 | AKL > Napier pre 10am | 06:00-10:00 | 12 | Mon:65 Tue:17 Wed:17 Thu:17 Fri:17 (9); Mon:60 Tue:17 Wed:17 Thu:17 Fri:17 (2); Mon:67 Tue:17 Wed:17 Thu:17 Fri:17 (1) |
| 9 | AKL > Napier pre 8am | 06:00-08:00 | 11 | Mon:65 Tue:17 Wed:17 Thu:17 Fri:17 (8); Mon:60 Tue:17 Wed:17 Thu:17 Fri:17 (2); Mon:60/65 Tue:17 Wed:17 Thu:17 Fri:17 (1) |
| 10 | AKL > New Plymouth pre 10am | 06:00-10:00 | 15 | Mon:65 Tue:17 Wed:17 Thu:17 Fri:17 (11); Mon:60 Tue:17 Wed:17 Thu:17 Fri:17 (3); Mon:60/65 Tue:17 Wed:17 Thu:17 Fri:17 (1) |
| 11 | AKL > Palmerston North pre 10am | 06:00-10:00 | 12 | Mon:65 Tue:17 Wed:17 Thu:17 Fri:17 (10); Mon:60 Tue:17 Wed:17 Thu:17 Fri:17 (2) |
| 12 | AKL > Palmerston North pre 8am | 06:00-08:00 | 11 | Mon:65 Tue:17 Wed:17 Thu:17 Fri:17 (9); Mon:60 Tue:17 Wed:17 Thu:17 Fri:17 (2) |
| 13 | AKL > TGA Afternoon Medical Run | 15:00-17:00 | 5 | 6 (4); 5 (1) |
| 14 | AKL > TGA Afternoon Medical Run 930am Collection | 14:30-17:00 | 2 | 5 (1); Mon:5 Tue:5 Wed:5 Thu:5 Fri:4 (1) |
| 15 | AKL > TGA Afternoon Medical Run*15:00:00-17:00:00 | 15:00-17:00 | 8 | 6 (6); 5 (2) |
| 16 | AKL > TGA Pre 930am Medical Run | 09:00-11:00 | 3 | Mon:64 Tue:16 Wed:16 Thu:16 Fri:16 (2); Mon:60 Tue:14 Wed:14 Thu:14 Fri:14 (1) |
| 17 | AKL > Whanganui Pre 10am | 06:00-10:00 | 14 | Mon:65 Tue:17 Wed:17 Thu:17 Fri:17 (11); Mon:60/65 Tue:17 Wed:17 Thu:17 Fri:17 (3) |
| 18 | AKL > WLG Pre 10am | 06:00-10:00 | 15 | Mon:65 Tue:17 Wed:17 Thu:17 Fri:17 (12); Mon:60 Tue:17 Wed:17 Thu:17 Fri:17 (2); Mon:66 Tue:18 Wed:18 Thu:18 Fri:18 (1) |
| 19 | AKL > WLG Pre 8am | 06:00-08:00 | 14 | Mon:65 Tue:17 Wed:17 Thu:17 Fri:17 (11); Mon:60 Tue:17 Wed:17 Thu:17 Fri:17 (2); Mon:60/65 Tue:17 Wed:17 Thu:17 Fri:17 (1) |
| 20 | AKL > WRG Pre 8am Medical Run | 07:00-14:00 | 9 | Mon:62 Tue:14 Wed:14 Thu:14 Fri:14 (6); Mon:60 Tue:12 Wed:12 Thu:12 Fri:12 (2); Mon:58 Tue:12 Wed:12 Thu:12 Fri:12 (1) |
| 21 | AKL > WRG Pre 8am Medical Run | 07:00-20:00 | 9 | Mon:62 Tue:14 Wed:14 Thu:14 Fri:14 (8); Mon:60 Tue:12 Wed:12 Thu:12 Fri:12 (1) |
| 22 | AKL > WRG Regional Run | 07:00-09:00 | 2 | Mon:64 Tue:16 Wed:16 Thu:16 Fri:16 (1); 0 (1) |
| 23 | Auckland > Tauranga Regional Run 9-5 Express | 09:00-17:00 | 2 | Mon:63/66 Tue:15/18 Wed:15 Thu:15 Fri:15 (1); 0 (1) |
| 24 | Auckland > Tauranga Run 3-6:30pm | 15:00-18:30 | 2 | 8 (1); 0 (1) |
| 25 | Auckland > Tauranga Run Express 4-6:30 | 16:00-18:30 | 2 | 7 (1); 0 (1) |
| 26 | Auckland > Waikato Afternoon Express | 13:00-18:00 | 2 | 3 (1); 0 (1) |
| 27 | Auckland > Waikato Morning Delivery | 07:00-12:00 | 2 | Mon:64 Tue:16 Wed:16 Thu:16 Fri:16 (1); 0 (1) |
| 28 | Auckland > Waikato Morning Express | 07:00-12:00 | 2 | Mon:61 Tue:13 Wed:13 Thu:13 Fri:13 (1); 0 (1) |
| 29 | Auckland Afternoon Chilled | 13:00-17:00 | 2 | 2 (1); Mon:2 Tue:0 Wed:2 Thu:2 Fri:2 (1) |
| 30 | BOP > Waikato Morning Run | 07:00-12:00 | 3 | Mon:69 Tue:21 Wed:21 Thu:21 Fri:21 (2); 0 (1) |
| 31 | BOP Outer > Auckland Express Run 11-1 | 11:00-13:00 | 3 | Mon:71 Tue:23 Wed:23 Thu:23 Fri:23 (2); 0 (1) |
| 32 | BOP Outer > Auckland Express Run 4-6 | 16:00-18:00 | 2 | Mon:76 Tue:28 Wed:28 Thu:28 Fri:28 (1); 0 (1) |
| 33 | BOP Outer > Auckland Run 12-5pm | 12:00-17:00 | 2 | Mon:72 Tue:24 Wed:24 Thu:24 Fri:24 (1); 0 (1) |
| 34 | BOP Outer > Auckland Run 6-9pm | 18:00-21:00 | 2 | Mon:78 Tue:30 Wed:30 Thu:30 Fri:30 (1); 0 (1) |
| 35 | BOP Regional Home Delivery 5am | 07:00-12:00 | 3 | 16 (2); Mon:64 Tue:16 Wed:16 Thu:16 Fri:16 (1) |
| 36 | Evening Home | 18:00-21:00 | 2 | Mon:3 Tue:3/6 Wed:3 Thu:3 Fri:3 (1); 1 (1) |
| 37 | Friday Afternoon Express | 12:00-17:00 | 2 | 3 (1); 2 (1) |
| 38 | Friday Afternoon Home | 12:00-17:00 | 3 | 22 (1); 6 (1); 3 (1) |
| 39 | Friday Evening Home | 18:00-21:00 | 4 | 3 (2); 4 (1); 12 (1) |
| 40 | Genus Christchurch - Monday Chilled | 08:00-17:00 | 2 | 69 (1); 87 (1) |
| 41 | Hamilton - Waikato Afternoon | 12:00-17:00 | 6 | 3 (5); 1 (1) |
| 42 | Hamilton - Waikato Morning | 07:00-13:00 | 6 | 16 (5); 14 (1) |
| 43 | Hamilton > Auckland Express 11am-1pm | 11:00-13:00 | 3 | Mon:68 Tue:20 Wed:20 Thu:20 Fri:20 (2); 0 (1) |
| 44 | Hamilton > Auckland Express 4pm-6pm | 16:00-18:00 | 4 | 4 (3); 0 (1) |
| 45 | Hamilton Local Chilled | 07:00-17:00 | 2 | 16 (1); 0 (1) |
| 46 | HLZ > AKL Next Day Run | 11:00-13:00 | 19 | 19 (17); Mon:67 Tue:19 Wed:19 Thu:19 Fri:19 (2) |
| 47 | Monday Afternoon Express | 12:00-17:00 | 2 | 3 (1); 2 (1) |
| 48 | Monday Afternoon Home | 12:00-17:00 | 3 | 70 (1); 6 (1); 3 (1) |
| 49 | Monday Evening Home | 18:00-21:00 | 4 | 3 (2); 4 (1); 12 (1) |
| 50 | Pukekohe > AKL Returns | 11:00-13:00 | 5 | Mon:3 Tue:3 Wed:3 Thu:3 Fri:2 (4); 3 (1) |
| 51 | Pukekohe > AKL Run | 11:00-13:00 | 11 | 3 (5); Mon:3 Tue:3 Wed:3 Thu:3 Fri:2 (5); Mon:3 Tue:3 Wed:3 Thu:3 Fri:2/3 (1) |
| 52 | Regional Friday | 08:00-17:00 | 2 | 6 (1); 16 (1) |
| 53 | Regional Thursday | 08:00-17:00 | 2 | 6 (1); 16 (1) |
| 54 | ROT > AKL Next Day Run | 11:00-16:00 | 17 | 20 (15); Mon:74 Tue:26 Wed:26 Thu:26 Fri:26 (1); Mon:68 Tue:20 Wed:20 Thu:20 Fri:20 (1) |
| 55 | Tauranga > Auckland Express Run | 11:00-12:30 | 2 | Mon:68 Tue:20 Wed:20 Thu:20 Fri:20 (1); 0 (1) |
| 56 | Tauranga > Auckland Express Run 4pm-6pm | 16:00-18:00 | 2 | 7 (1); 0 (1) |
| 57 | Tauranga > Auckland Run | 12:00-17:00 | 2 | Mon:69 Tue:21 Wed:21 Thu:21 Fri:21 (1); 0 (1) |
| 58 | Tauranga > Auckland Run 6pm-9pm | 18:00-21:00 | 2 | 9 (1); 0 (1) |
| 59 | Tauranga > BOP Outer Run | 11:00-14:00 | 3 | 1 (2); 0 (1) |
| 60 | Tauranga > Waikato Afternoon Run | 13:00-18:00 | 3 | 4 (1); 0 (1); 3 (1) |
| 61 | Tauranga > Waikato Morning Run | 07:00-12:00 | 4 | Mon:64 Tue:16 Wed:16 Thu:16 Fri:16 (3); 0 (1) |
| 62 | Thursday Afternoon Express | 12:00-17:00 | 2 | 3 (1); 2 (1) |
| 63 | Thursday Afternoon Home | 12:00-17:00 | 3 | 22 (1); 6 (1); 3 (1) |
| 64 | Thursday Evening Home | 18:00-21:00 | 3 | 4 (1); 12 (1); 3 (1) |
| 65 | TRG > AKL Day Run | 16:00-18:00 | 16 | 7 (15); 6 (1) |
| 66 | TRG > AKL Next Day Run | 11:00-13:00 | 16 | 18 (15); Mon:66 Tue:18 Wed:18 Thu:18 Fri:18 (1) |
| 67 | TRG > AKL Next Day Run | 11:00-12:30 | 2 | Mon:67 Tue:19 Wed:19 Thu:19 Fri:19 (1); 18 (1) |
| 68 | Tuesday Afternoon Express | 12:00-17:00 | 2 | 3 (1); 2 (1) |
| 69 | Tuesday Afternoon Home | 12:00-17:00 | 3 | 22 (1); 6 (1); 3 (1) |
| 70 | Tuesday Evening Home | 18:00-21:00 | 3 | 4 (1); 12 (1); 3 (1) |
| 71 | VDAY MORNING | 07:00-15:00 | 2 | 15 (1); 0 (1) |
| 72 | Waikato Local > Auckland Express 11am-1pm | 11:00-13:00 | 2 | 0 (1); Mon:68 Tue:20 Wed:20 Thu:20 Fri:20 (1) |
| 73 | Waikato Local > Auckland Express 4pm-6pm | 16:00-18:00 | 2 | 5 (1); 0 (1) |
| 74 | Waikato Outer > Auckland Express 11am-1pm | 11:00-13:00 | 2 | Mon:68 Tue:20 Wed:20 Thu:20 Fri:20 (1); 0 (1) |
| 75 | Wednesday Afternoon Express | 12:00-17:00 | 2 | 3 (1); 2 (1) |
| 76 | Wednesday Afternoon Home | 12:00-17:00 | 4 | 22 (1); 6 (1); 23 (1); 3 (1) |
| 77 | Wednesday Evening Home | 18:00-21:00 | 4 | 3 (2); 4 (1); 12 (1) |
| 78 | WLG > Whanganui (QC) | 07:00-12:00 | 4 | Mon:61 Tue:37 Wed:37 Thu:37 Fri:37 (3); Mon:61 Tue:13 Wed:13 Thu:13 Fri:13 (1) |
| 79 | Woop Napier Xmas | 09:00-15:00 | 2 | 264 (1); 100 (1) |
| 80 | Woop PN Xmas | 09:00-15:00 | 2 | 264 (1); 100 (1) |
| 81 | Woop Tga Xmas | 09:00-15:00 | 2 | 264 (1); 100 (1) |
| 82 | WRG > AKL Regional Run | 12:00-15:00 | 2 | 3 (1); 0 (1) |
