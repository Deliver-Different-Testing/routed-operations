# Medical sealed box: who scans what, and where

_For Kenneth and the Medical team - 23 Oct 2026. Driver app, Medical tenant._

One box, five stops. At every stop you do at most two scans: **scan the box in** when it arrives, **scan the box out** when it leaves. That is the whole method. The app works out which run comes next.

## Three rules

1. **Scan in before you scan out.** The app only lets a box leave a stop it has arrived at. If you skip the arrival scan, the next scan says "Wrong location".
2. **Never mark a run complete in DespatchWeb.** It changes the run's own job and nothing else; the samples stay where they were. Only scans move samples.
3. **Open the right run.** The pickup scan happens from the run's master job, and that job has to be assigned to you. If it is not, ask dispatch to assign it before you scan.

## Before the first box

- A location QR code posted at every stop: Oakland depot, Oakland Airport, Burbank Airport, Burbank depot. Inwards starts by scanning it.
- The masters for the Oakland to Oak Airport run and the flight run assigned to the Oakland-side driver; the Bur Airport to Burbank run assigned to the Burbank driver; the route 15 master assigned to the lab driver.

## The stops

### 1. Origin depot (Hayward, Reno, Sacramento)
- **More > Tote Packing.** Location = your depot. Scan a tote, then scan every sample into it.
- Open the run's master job, tap **PICKUP**, scan the tote: "Picked up". Tap **Done** to depart.

### 2. Oakland depot
- **More > Linehaul Inwards.** Scan the Oakland location QR, then scan each arriving tote: "Leg complete".
- Pack the airfreight box: **More > Tote Packing**, Location = Oakland, scan the box's barcode as the tote, scan every sample into it. Seal it. From here nobody opens it until the lab.
- Open the **Oakland to Oak Airport** master, tap **PICKUP**, scan the box, tap **Done**.

### 3. Oakland Airport
- **More > Linehaul Inwards.** Scan the airport location QR, then the box: "Tote continues on Oak to Burbank".
- Open the **Oak to Burbank** (flight) master, tap **PICKUP**, scan the box, tap **Done**. That Done is the box consigned on the flight, and it is what the overseer sees.

### 4. Burbank Airport
- **More > Linehaul Inwards.** Scan the location QR, then the box: "Tote continues on Bur Airport to Burbank".
- Open the **Bur Airport to Burbank** master, tap **PICKUP**, scan the box, tap **Done**.

### 5. Burbank depot
- **More > Linehaul Inwards.** Scan the location QR, then the box: "Tote continues to final mile".

### 6. Lab (route 15)
- Open the **route 15** master, tap **PICKUP**, scan the box, tap **Done**.
- At the lab, tap **DELIVER**. Depending on how the route is set up you either scan the whole box once, or scan each sample out of it. Enter the name of the person receiving, then signature as usual.

## What the screen is telling you

| Message | Meaning | What to do |
|---|---|---|
| Wrong location | The box's next stop is not where you are, usually because an earlier arrival scan was skipped | Read the expected location on screen; do the missing inwards scan, or hand it to the right stop |
| Wrong run | You opened a master for a different run | Close it and open the run named in the last inwards message |
| Tote completed | This tote was already closed | It is finished; nothing more to scan |
| Leg complete, with no "continues" line | The box closed at this stop | Expected at the origin depot and Oakland. Anywhere else, tell dispatch before moving the box |
| A sample was never scanned at its origin | The app has it still at the first depot and will refuse it everywhere downstream | It cannot be fixed by scanning later; tell dispatch |

## When each part is live

- Stops 1, 2 and 6 as a normal delivery per sample: today.
- Stops 3, 4 and 5 as one box with no repack: after Kevin's hop continuation reaches Medical (before next week's test).
- Stop 6 scanning the whole box or each sample from the route master: driver app 4.0 (Garry). Until then the lab delivery is the usual per-sample delivery.
