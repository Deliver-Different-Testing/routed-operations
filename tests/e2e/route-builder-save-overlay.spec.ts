import { test, expect, type Page, type Request, type Route } from '@playwright/test';
import { mockEverything } from './fixtures/npSession';

// #1018 C2 Route Builder speed, the save half. Every assign or create used to
// hold the "Working..." overlay over the cockpit until the full jobs + runs
// reload had come back, which on a busy day is most of the wait. The save now
// patches the lists from the run(s) the server returns and reloads in the
// background, so the overlay clears at commit.
//
// SCOPE. Every /api call is intercepted. After the save, GET /api/jobs and
// GET /api/runs are held open until the test releases them, so "the overlay
// is gone" can only pass if the page stopped waiting on the reload.

const env = { messageId: 'x', success: true, messages: [] };
const json = (r: Route, data: unknown) =>
  r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });

const job = (id: number) => ({
  bulkJobId: id, jobNumber: `J-${id}`, bookDate: '2031-01-01', bookTime: '09:00:00', jobStatus: 0,
  clientId: 1, clientCode: 'EXMPL', amount: 0, speed: 3, speedName: 'Standard',
  fromCompany: null, fromAddress: null, fromSuburb: null, fromPostCode: null,
  toCompany: null, toAddress: `${id} Sample Street`, toSuburb: 'Otahuhu', toPostCode: 1062,
  size: 0, qty: 1, weight: 0, courierId: null, courierName: null, clientRefa: null, clientRefb: null,
  ourRef: null, notes: null, pickUpLatitude: null, pickUpLongitude: null,
  deliveryLatitude: null, deliveryLongitude: null, prebookJob: false, onHold: false, void: false, done: false,
  bulkRunId: null, runName: null, runOrder: null, multiboxParentId: null, parentId: null, regionId: null,
  barcode: null, okToLeave: null, contact: null, deliverToContact: null, deliverToPhone: null,
  trackingEmail: null, trackingMobile: null, proofOfDeliveryEmail: null, proofOfDeliveryMobile: null,
  scheduleId: null, scheduleName: null, scheduleWindowStart: null, scheduleWindowEnd: null, jobCubicM3: null,
  maxJobsPerRun: null, applyPickupCutoff: null, pickupCutoffHours: null, prefixRunName: null,
  postCodeMergeTo: null, runSequence: 0, bulkJobRunId: 0,
});

const runJob = (id: number, builderIndex: number) => ({
  bulkJobId: id, builderIndex, jobNumber: `J-${id}`, isStart: false, isEnd: false, clientCode: 'EXMPL',
  deliveryDate: '2031-01-01', bookTime: '09:00:00', toAddress: `${id} Sample Street`, toSuburb: 'Otahuhu',
  toPostCode: 1062, courierName: null, speedName: 'Standard', deliveryLatitude: null, amount: 0,
});

const run = (id: number, name: string, jobs: ReturnType<typeof runJob>[] = []) => ({
  id, name, mins: 0, kms: 0, courierId: null, courierName: null, status: 0, revenue: null, payout: null,
  courierPercentage: null, googleRouteResponse: null, despatchDateTime: '2031-01-01', noReroute: false,
  routingMode: 0, finishAtBulkJobId: null, isVoidRun: false, fleet: null, jobs,
});

/** Cockpit lookups plus jobs / runs GETs that can be held open on demand. */
async function mockCockpit(page: Page, initialRuns: unknown[], couriers: unknown[] = []) {
  await mockEverything(page);
  await page.route(/\/api\/regions(\?.*)?$/, (r) => json(r, []));
  await page.route(/\/api\/speeds(\?.*)?$/, (r) => json(r, []));
  await page.route(/\/api\/fleets$/, (r) => json(r, { ...env, fleets: [] }));
  await page.route(/\/api\/couriers$/, (r) => json(r, { ...env, potentialCouriers: couriers }));
  await page.route(/\/api\/jobs\/filters\/clients/, (r) => json(r, { ...env, response: { clients: [] } }));
  await page.route(/\/api\/jobs\/filters\/refs/, (r) => json(r, { ...env, ourRefs: [] }));
  await page.route(/\/api\/vehicle-sizes$/, (r) => json(r, { ...env, response: [] }));

  const gate = { held: false, release: () => {}, heldCalls: 0 };
  let released = Promise.resolve();
  const holdFrom = () => {
    gate.held = true;
    released = new Promise<void>((res) => { gate.release = res; });
  };
  const maybeHold = async () => {
    if (!gate.held) return;
    gate.heldCalls += 1;
    await released;
  };
  await page.route(/\/api\/jobs(\?.*)?$/, async (r) => {
    await maybeHold();
    return json(r, { ...env, bulkJobs: [job(1)] });
  });
  await page.route(/\/api\/runs(\?.*)?$/, async (r) => {
    if (r.request().method() !== 'GET') return r.fallback();
    await maybeHold();
    return json(r, { ...env, response: initialRuns, maxJsonLength: 0 });
  });
  return { gate, holdFrom };
}

const overlay = (page: Page) => page.getByRole('status').filter({ hasText: /Working\.\.\.|Loading\.\.\./ });

test('Assigning a job clears the overlay before the background reload comes back', async ({ page }) => {
  const { gate, holdFrom } = await mockCockpit(page, [run(20, 'Target')]);
  let assignBody: unknown = null;
  await page.route(/\/api\/runs\/20\/assign-many$/, (r) => {
    assignBody = r.request().postDataJSON();
    holdFrom();
    return json(r, { ...env, response: { result: 'Success', message: '1', runs: [run(20, 'Target', [runJob(1, 0)])] } });
  });

  await page.goto('/routes');
  await page.getByLabel('Select job J-1').check();
  await page.getByRole('button', { name: '+ 1', exact: true }).click();

  await expect.poll(() => assignBody).toEqual({ jobs: [{ jobId: 1, fromRunId: null }], deleteRunId: null });
  // The reload is under way and held; the overlay must already be gone.
  await expect.poll(() => gate.heldCalls).toBeGreaterThan(0);
  await expect(overlay(page)).toHaveCount(0);
  // And the screen already shows the move: the job is no longer offered for selection as unassigned.
  await expect(page.getByLabel('Select job J-1')).toHaveCount(0);
  gate.release();
});

test('Creating a run shows it and clears the overlay before the background reload comes back', async ({ page }) => {
  const { gate, holdFrom } = await mockCockpit(page, []);
  await page.route(/\/api\/runs$/, (r) => {
    if (r.request().method() !== 'POST') return r.fallback();
    holdFrom();
    return json(r, { ...env, response: { result: 'Success', message: '30', runs: [run(30, 'Fast lane')] } });
  });

  await page.goto('/routes');
  await page.getByPlaceholder(/New run name/).fill('Fast lane');
  await page.getByRole('button', { name: '+ Create' }).click();

  await expect.poll(() => gate.heldCalls).toBeGreaterThan(0);
  await expect(overlay(page)).toHaveCount(0);
  await expect(page.getByText('Fast lane', { exact: true })).toBeVisible();
  gate.release();
});

// Courier assign and lock / unlock save through PUT /runs/{id}. They waited on
// the full foreground reload too; now they patch the run from the response.
const courier = { courierId: 500, code: 'C500', firstName: 'Sam', displayName: 'Sam Example', fleet: null };

test('Assigning a courier shows it and clears the overlay before the background reload comes back', async ({ page }) => {
  const { gate, holdFrom } = await mockCockpit(page, [run(20, 'Target')], [courier]);
  let putBody: { courier?: { courierId: number } | null } | null = null;
  await page.route(/\/api\/runs\/20$/, (r) => {
    if (r.request().method() !== 'PUT') return r.fallback();
    putBody = r.request().postDataJSON();
    holdFrom();
    return json(r, { ...env, response: { result: 'Success', message: '20',
      runs: [{ ...run(20, 'Target'), courierId: 500, courierName: 'Sam Example' }] } });
  });

  await page.goto('/routes');
  const box = page.getByRole('row').filter({ hasText: 'Target' }).getByTitle('Type to filter couriers');
  await box.click();
  await page.getByRole('option', { name: 'Sam Example' }).click();

  await expect.poll(() => putBody?.courier?.courierId).toBe(500);
  await expect.poll(() => gate.heldCalls).toBeGreaterThan(0);
  await expect(overlay(page)).toHaveCount(0);
  await expect(box).toHaveValue('Sam Example');
  gate.release();
});

test('Locking a run shows it locked and clears the overlay before the background reload comes back', async ({ page }) => {
  // Two runs: RunList only shows the Ready / Locked headers when both groups have members.
  const { gate, holdFrom } = await mockCockpit(page, [run(20, 'Target'), run(21, 'Other')]);
  let putBody: { status?: number } | null = null;
  await page.route(/\/api\/runs\/20$/, (r) => {
    if (r.request().method() !== 'PUT') return r.fallback();
    putBody = r.request().postDataJSON();
    holdFrom();
    return json(r, { ...env, response: { result: 'Success', message: '20', runs: [{ ...run(20, 'Target'), status: 1 }] } });
  });

  await page.goto('/routes');
  await page.getByRole('row').filter({ hasText: 'Target' }).click({ button: 'right' });
  await page.getByRole('button', { name: 'Lock', exact: true }).click();

  await expect.poll(() => putBody?.status).toBe(1);
  await expect.poll(() => gate.heldCalls).toBeGreaterThan(0);
  await expect(overlay(page)).toHaveCount(0);
  await expect(page.getByText(/Locked \(1\)/)).toBeVisible();
  gate.release();
});

// Addendum 7 fix 1. Courier assign and lock are not under the busy overlay, so
// the operator can change the date while the save is in flight. The day the
// operator moved to must win: the save's patch (a run from the old day) and
// any reload with the old filters must not land on top of it.
const NEW_DAY = '2031-01-02';

/** GET jobs / runs answer by date: NEW_DAY has run 40 'NewDay' and job 2, any
 *  other day has run 20 'Target' and job 1. Old-day GETs can be held. */
async function mockByDate(page: Page) {
  const seen: string[] = [];
  const hold = { on: false, release: () => {} };
  let released = Promise.resolve();
  const holdOldDay = () => {
    hold.on = true;
    released = new Promise<void>((res) => { hold.release = res; });
  };
  const dateOf = (r: Route) => new URL(r.request().url()).searchParams.get('date') ?? '';
  await page.route(/\/api\/jobs(\?.*)?$/, async (r) => {
    const d = dateOf(r);
    if (d !== NEW_DAY && hold.on) await released;
    return json(r, { ...env, bulkJobs: d === NEW_DAY ? [job(2)] : [job(1)] });
  });
  await page.route(/\/api\/runs(\?.*)?$/, async (r) => {
    if (r.request().method() !== 'GET') return r.fallback();
    const d = dateOf(r);
    seen.push(d);
    if (d !== NEW_DAY && hold.on) await released;
    return json(r, { ...env, response: d === NEW_DAY ? [run(40, 'NewDay')] : [run(20, 'Target')], maxJsonLength: 0 });
  });
  return { seen, hold, holdOldDay };
}

/** Lets the page finish handling a response it has just received. */
const settle = (page: Page) =>
  page.evaluate(() => new Promise<void>((res) => requestAnimationFrame(() => requestAnimationFrame(() => res()))));

test('Changing the date while a courier assign is saving keeps the new day, not the saved run or an old-day reload', async ({ page }) => {
  await mockCockpit(page, [], [courier]);
  const { seen } = await mockByDate(page);
  let releasePut = () => {};
  const putHeld = new Promise<void>((res) => { releasePut = res; });
  let putSeen = false;
  await page.route(/\/api\/runs\/20$/, async (r) => {
    if (r.request().method() !== 'PUT') return r.fallback();
    putSeen = true;
    await putHeld;
    return json(r, { ...env, response: { result: 'Success', message: '20',
      runs: [{ ...run(20, 'Target'), courierId: 500, courierName: 'Sam Example' }] } });
  });

  await page.goto('/routes');
  await page.getByRole('row').filter({ hasText: 'Target' }).getByTitle('Type to filter couriers').click();
  await page.getByRole('option', { name: 'Sam Example' }).click();
  await expect.poll(() => putSeen).toBe(true);

  // Mid-save: move to the next day and let its load finish.
  await page.getByLabel('Date', { exact: true }).fill(NEW_DAY);
  await expect(page.getByText('NewDay', { exact: true })).toBeVisible();

  // The save commits. Whatever reload follows it must be for the day on screen.
  const before = seen.length;
  const reload = page.waitForResponse((res) => /\/api\/runs\?/.test(res.url()) && res.request().method() === 'GET');
  releasePut();
  await reload;
  await settle(page);

  expect(seen.slice(before)).toEqual([NEW_DAY]);
  await expect(page.getByText('NewDay', { exact: true })).toBeVisible();
  await expect(page.getByText('Target', { exact: true })).toHaveCount(0);
});

test('A background reload for the old day that comes back after the new day loaded does not replace it', async ({ page }) => {
  await mockCockpit(page, [], [courier]);
  const { seen, hold, holdOldDay } = await mockByDate(page);
  await page.route(/\/api\/runs\/20$/, (r) => {
    if (r.request().method() !== 'PUT') return r.fallback();
    holdOldDay();
    return json(r, { ...env, response: { result: 'Success', message: '20',
      runs: [{ ...run(20, 'Target'), courierId: 500, courierName: 'Sam Example' }] } });
  });

  await page.goto('/routes');
  const loaded = seen.length;
  await page.getByRole('row').filter({ hasText: 'Target' }).getByTitle('Type to filter couriers').click();
  await page.getByRole('option', { name: 'Sam Example' }).click();
  // The save's background reload (old day) is in flight and held.
  await expect.poll(() => seen.length).toBeGreaterThan(loaded);

  await page.getByLabel('Date', { exact: true }).fill(NEW_DAY);
  await expect(page.getByText('NewDay', { exact: true })).toBeVisible();

  const stale = page.waitForResponse((res) => /\/api\/runs\?/.test(res.url()) && !res.url().includes(NEW_DAY));
  hold.release();
  await stale;
  await settle(page);

  await expect(page.getByText('NewDay', { exact: true })).toBeVisible();
  await expect(page.getByText('Target', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Select job J-2')).toBeVisible();
  await expect(page.getByLabel('Select job J-1')).toHaveCount(0);
});

// Addendum 8 fix 1. GET jobs / runs answer by date like mockByDate, and once
// holding is on every one is held on its own until released. Each held call
// records its date so a test can release one load (a jobs + runs pair) at a
// time, in any order.
async function mockHeldLoads(page: Page) {
  const held: { date: string; request: Request; release: () => void }[] = [];
  const state = { holding: false };
  const dateOf = (r: Route) => new URL(r.request().url()).searchParams.get('date') ?? '';
  const hold = async (r: Route) => {
    if (!state.holding) return;
    await new Promise<void>((res) => held.push({ date: dateOf(r), request: r.request(), release: res }));
  };
  await page.route(/\/api\/jobs(\?.*)?$/, async (r) => {
    const d = dateOf(r);
    await hold(r);
    return json(r, { ...env, bulkJobs: d === NEW_DAY ? [job(2)] : [job(1)] });
  });
  await page.route(/\/api\/runs(\?.*)?$/, async (r) => {
    if (r.request().method() !== 'GET') return r.fallback();
    const d = dateOf(r);
    await hold(r);
    return json(r, { ...env, response: d === NEW_DAY ? [run(40, 'NewDay')] : [run(20, 'Target')], maxJsonLength: 0 });
  });
  /** Release held calls [from, to) and wait for the page to handle them. */
  const release = async (from: number, to: number) => {
    const batch = held.slice(from, to);
    batch.forEach((h) => h.release());
    await Promise.all(batch.map((h) => h.request.response()));
    await settle(page);
  };
  return { held, state, release };
}

/** A courier assign on run 20 whose PUT is held until released. */
async function heldCourierAssign(page: Page) {
  const put = { seen: false, release: () => {} };
  const putHeld = new Promise<void>((res) => { put.release = res; });
  await page.route(/\/api\/runs\/20$/, async (r) => {
    if (r.request().method() !== 'PUT') return r.fallback();
    put.seen = true;
    await putHeld;
    return json(r, { ...env, response: { result: 'Success', message: '20',
      runs: [{ ...run(20, 'Target'), courierId: 500, courierName: 'Sam Example' }] } });
  });
  return put;
}

const loadingOverlay = (page: Page) => page.getByRole('status').filter({ hasText: /Loading\.\.\./ });

// Round 3 probe N1: the save commits while the new day's foreground load is
// still out. The reload it starts is newer, so the foreground load's answer is
// dropped; it must not take the Loading overlay down with it and leave the
// old day's runs on screen under the new date.
test('A save that commits while the new day is loading keeps the Loading overlay up until the new day is shown', async ({ page }) => {
  await mockCockpit(page, [], [courier]);
  const loads = await mockHeldLoads(page);
  const put = await heldCourierAssign(page);

  await page.goto('/routes');
  await expect(page.getByText('Target', { exact: true })).toBeVisible();
  loads.state.holding = true;
  await page.getByRole('row').filter({ hasText: 'Target' }).getByTitle('Type to filter couriers').click();
  await page.getByRole('option', { name: 'Sam Example' }).click();
  await expect.poll(() => put.seen).toBe(true);

  await page.getByLabel('Date', { exact: true }).fill(NEW_DAY);
  await expect.poll(() => loads.held.length).toBe(2);
  await expect(loadingOverlay(page)).toHaveCount(1);

  put.release();
  // The save's reload for the new day is out too.
  await expect.poll(() => loads.held.length).toBe(4);
  expect(loads.held.map((h) => h.date)).toEqual([NEW_DAY, NEW_DAY, NEW_DAY, NEW_DAY]);

  // The superseded foreground load answers first.
  await loads.release(0, 2);
  await page.waitForTimeout(300);
  await expect(loadingOverlay(page)).toHaveCount(1);

  await loads.release(2, 4);
  await expect(loadingOverlay(page)).toHaveCount(0);
  await expect(page.getByText('NewDay', { exact: true })).toBeVisible();
  await expect(page.getByText('Target', { exact: true })).toHaveCount(0);
});

// The other half of N1: only the newest load ends Loading, so when the newest
// is a background reload it has to end it, or the overlay would stay up for
// good. Here the operator types the date back while the overlay is up (it
// blocks clicks, not keys), so the save commits under its own filters and
// patches + reloads in the background while two foreground loads are out.
test('A background reload that supersedes a foreground load ends Loading, and the older loads do not bring it back', async ({ page }) => {
  await mockCockpit(page, [], [courier]);
  const loads = await mockHeldLoads(page);
  const put = await heldCourierAssign(page);

  await page.goto('/routes');
  await expect(page.getByText('Target', { exact: true })).toBeVisible();
  const date = page.getByLabel('Date', { exact: true });
  const today = await date.inputValue();
  loads.state.holding = true;
  await page.getByRole('row').filter({ hasText: 'Target' }).getByTitle('Type to filter couriers').click();
  await page.getByRole('option', { name: 'Sam Example' }).click();
  await expect.poll(() => put.seen).toBe(true);

  await date.fill(NEW_DAY);
  await expect.poll(() => loads.held.length).toBe(2);
  await date.fill(today, { force: true });
  await expect.poll(() => loads.held.length).toBe(4);
  await expect(loadingOverlay(page)).toHaveCount(1);

  put.release();
  await expect.poll(() => loads.held.length).toBe(6);
  expect(loads.held.map((h) => h.date)).toEqual([NEW_DAY, NEW_DAY, today, today, today, today]);

  // The background reload (newest) answers while both foreground loads are out.
  await loads.release(4, 6);
  await expect(loadingOverlay(page)).toHaveCount(0);
  await expect(page.getByText('Target', { exact: true })).toBeVisible();
  await expect(page.getByText('NewDay', { exact: true })).toHaveCount(0);

  // The superseded foreground loads answer late and change nothing.
  await loads.release(0, 4);
  await page.waitForTimeout(300);
  await expect(loadingOverlay(page)).toHaveCount(0);
  await expect(page.getByText('Target', { exact: true })).toBeVisible();
  await expect(page.getByText('NewDay', { exact: true })).toHaveCount(0);
});

// Addendum 7 fix 2: the error strip a failed load left must not outlive a
// later background reload that succeeded.
test('A background reload that succeeds clears the error strip a failed load left', async ({ page }) => {
  await mockCockpit(page, []);
  let failJobs = false;
  await page.route(/\/api\/jobs(\?.*)?$/, (r) => (failJobs
    ? r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Jobs feed down' }) })
    : r.fallback()));
  await page.route(/\/api\/runs$/, (r) => {
    if (r.request().method() !== 'POST') return r.fallback();
    return json(r, { ...env, response: { result: 'Success', message: '30', runs: [run(30, 'Fast lane')] } });
  });
  const strip = page.locator('div.bg-error-bg');

  await page.goto('/routes');
  failJobs = true;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(strip).toBeVisible();

  failJobs = false;
  const reload = page.waitForResponse((res) => /\/api\/runs\?/.test(res.url()) && res.request().method() === 'GET');
  await page.getByPlaceholder(/New run name/).fill('Fast lane');
  await page.getByRole('button', { name: '+ Create' }).click();
  await reload;
  await settle(page);
  await expect(strip).toHaveCount(0);
});

// Addendum 7 fix 4: the other run edits must not wait on the reload either.
// Each holds GET jobs / runs from the moment its write is answered, then
// checks the overlay is gone and the edit already shows.
test('Dragging a job onto a run clears the overlay before the background reload comes back', async ({ page }) => {
  const { gate, holdFrom } = await mockCockpit(page, [run(20, 'Target')]);
  await page.route(/\/api\/runs\/20\/assign-many$/, (r) => {
    holdFrom();
    return json(r, { ...env, response: { result: 'Success', message: '1', runs: [run(20, 'Target', [runJob(1, 0)])] } });
  });

  await page.goto('/routes');
  await page.getByRole('row').filter({ hasText: 'J-1' }).dragTo(page.getByRole('row').filter({ hasText: 'Target' }));

  await expect.poll(() => gate.heldCalls).toBeGreaterThan(0);
  await expect(overlay(page)).toHaveCount(0);
  await expect(page.getByLabel('Select job J-1')).toHaveCount(0);
  gate.release();
});

test('Deleting a run clears the overlay before the background reload comes back', async ({ page }) => {
  const { gate, holdFrom } = await mockCockpit(page, [run(20, 'Target')]);
  await page.route(/\/api\/runs\/20$/, (r) => {
    if (r.request().method() !== 'DELETE') return r.fallback();
    holdFrom();
    return json(r, { ...env, response: { result: 'Success', message: 'Deleted' } });
  });

  await page.goto('/routes');
  await page.getByRole('row').filter({ hasText: 'Target' }).click({ button: 'right' });
  await page.getByRole('button', { name: 'Delete run', exact: true }).click();

  await expect.poll(() => gate.heldCalls).toBeGreaterThan(0);
  await expect(overlay(page)).toHaveCount(0);
  await expect(page.getByText('Target', { exact: true })).toHaveCount(0);
  gate.release();
});

test('Renaming a run clears the overlay before the background reload comes back', async ({ page }) => {
  const { gate, holdFrom } = await mockCockpit(page, [run(20, 'Target')]);
  await page.route(/\/api\/runs\/20$/, (r) => {
    if (r.request().method() !== 'PUT') return r.fallback();
    holdFrom();
    return json(r, { ...env, response: { result: 'Success', message: '20', runs: [run(20, 'Renamed')] } });
  });

  await page.goto('/routes');
  await page.getByRole('row').filter({ hasText: 'Target' }).click({ button: 'right' });
  await page.getByRole('button', { name: 'Rename...', exact: true }).click();
  // The rename box opens focused on the run's name.
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Renamed');
  await page.keyboard.press('Enter');

  await expect.poll(() => gate.heldCalls).toBeGreaterThan(0);
  await expect(overlay(page)).toHaveCount(0);
  await expect(page.getByText('Renamed', { exact: true })).toBeVisible();
  gate.release();
});

test('Voiding a job clears the overlay before the background reload comes back', async ({ page }) => {
  const { gate, holdFrom } = await mockCockpit(page, []);
  await page.route(/\/api\/jobs\/void$/, (r) => {
    holdFrom();
    return json(r, { ...env, response: null });
  });

  await page.goto('/routes');
  await page.getByLabel('Select job J-1').check();
  await page.getByRole('button', { name: 'Void', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Void', exact: true }).click();

  await expect.poll(() => gate.heldCalls).toBeGreaterThan(0);
  await expect(overlay(page)).toHaveCount(0);
  await expect(page.getByLabel('Select job J-1')).toHaveCount(0);
  gate.release();
});

test('Merging a run clears the overlay before the background reload comes back', async ({ page }) => {
  const { gate, holdFrom } = await mockCockpit(page, [run(20, 'Target'), run(21, 'Source', [runJob(1, 0)])]);
  let mergeBody: unknown = null;
  await page.route(/\/api\/runs\/20\/assign-many$/, (r) => {
    mergeBody = r.request().postDataJSON();
    holdFrom();
    return json(r, { ...env, response: { result: 'Success', message: '1', runs: [run(20, 'Target', [runJob(1, 0)])] } });
  });

  await page.goto('/routes');
  await page.getByRole('row').filter({ hasText: 'Source' }).click({ button: 'right' });
  await page.getByRole('button', { name: 'Merge into...', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Merge', exact: true }).click();

  await expect.poll(() => (mergeBody as { deleteRunId?: number } | null)?.deleteRunId).toBe(21);
  await expect.poll(() => gate.heldCalls).toBeGreaterThan(0);
  await expect(overlay(page)).toHaveCount(0);
  await expect(page.getByText('Source', { exact: true })).toHaveCount(0);
  gate.release();
});
