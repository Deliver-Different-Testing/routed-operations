import { useEffect, useMemo } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { useAuth } from '../../context/AuthContext';
import type { ScheduleDto } from '../../services/clientsService';
import type { WizardAction, WizardState } from './wizardState';

interface Props {
  open: boolean;
  state: WizardState;
  dispatch: (action: WizardAction) => void;
  onBack: () => void;
  onNext: () => void;
  onCancel: () => void;
  /** True while the wizard is firing /import for the current bucket. */
  importing?: boolean;
}

/**
 * SchedulePickerModal - Step 6. Book date, service (speed), schedule
 * (routed only) and book time. Shared between Routed and On-Demand paths;
 * conditional rendering branches on state.importType.
 *
 * Mirrors BulkImportHyper's Step 6 (`components/home/homeView.html:512-631`
 * with the loadSchedules / onSpeedChanged handlers at
 * `homeControl.js:534-892`). Client settings (speeds + schedules) are
 * cached on wizard state from MapColumnsModal - no re-fetch here.
 */
export function SchedulePickerModal({
  open,
  state,
  dispatch,
  onBack,
  onNext,
  onCancel,
  importing = false,
}: Props) {
  const auth = useAuth();
  const isUs = auth.isUsTenant || state.client?.isUsTenant || false;
  const isRouted = state.importType === 'routed';
  const isOnDemand = state.importType === 'onDemand';

  const settings = state.clientSettings;
  const allSpeeds = settings?.speeds ?? [];
  const schedules = settings?.schedules ?? [];

  // Per-depot iteration - use the current bucket to filter schedules by
  // depotId AND surface the bucket name in the modal title (matches
  // BulkImportHyper homeView.html:514 `<h3>{{import.depot.name}}</h3>`).
  // Only real buckets (depotId > 0) that the operator ticked participate.
  const includedDepots = useMemo(
    () =>
      state.depots.filter(
        (d) => d.depotId !== 0 && state.selectedRegions.has(String(d.depotId))
      ),
    [state.depots, state.selectedRegions]
  );
  // Prefer the cursor position; fall back to the first ticked bucket so the
  // filter still narrows to a real depot even if state.currentDepotIndex is
  // stale (e.g. operator reopened the wizard after SET_CURRENT_DEPOT never
  // reran because SelectRegions closed too quickly).
  const currentDepot =
    includedDepots[state.currentDepotIndex] ?? includedDepots[0] ?? null;
  const depotCountLabel =
    includedDepots.length > 1
      ? ` (${state.currentDepotIndex + 1} of ${includedDepots.length})`
      : '';

  // Compute dayOfWeek from bookDate in the same way BulkImportHyper does:
  // JS Date.getDay() returns 0..6 (Sun=0). Legacy maps Sunday to 7 so the
  // schedule table (Mon=1..Sun=7) matches. Uses local time (input type=date
  // parses YYYY-MM-DD as midnight local, which is what the operator picked).
  const dayOfWeek = useMemo(() => {
    if (!state.bookDate) return null;
    const [y, m, d] = state.bookDate.split('-').map(Number);
    if (!y || !m || !d) return null;
    const dow = new Date(y, m - 1, d).getDay();
    return dow === 0 ? 7 : dow;
  }, [state.bookDate]);

  // Service list. Legacy `onJobTypeChanged()` at homeControl.js:559-598 does
  // NOT filter `client.speeds`. It walks the schedules matching the current
  // (depot, dayOfWeek) and PUSHES each schedule's speed onto a dedup set.
  // The set is what the operator sees in the Service dropdown - so system
  // schedules (ClientId IS NULL, e.g. "Sunday 12-6pm AKL" pointing at
  // SpeedId=95 "Home Delivery") surface even when 95 is NOT in the client's
  // TblClientAvailableSpeeds. Filtering client.speeds discards them and the
  // operator ends up seeing a fake "full list" they cannot actually book.
  //
  // On-demand doesn't use schedules, so it falls back to the full speed list.
  // For routed, do NOT fall back to allSpeeds when currentDepot or dayOfWeek
  // aren't yet resolved. The client's full 70-ish speed catalogue is NOT the
  // list the operator can actually book - only the subset with a matching
  // (depot, dayOfWeek) schedule works. Showing the full list mid-race lets
  // the operator pick a service that will then fail with "No schedules for
  // this date + service." at the next step. Matches legacy where the Service
  // dropdown for routed only ever surfaced schedule-backed speeds.
  const speeds = useMemo(() => {
    if (isOnDemand) return allSpeeds;
    if (!currentDepot || dayOfWeek == null) return [];
    // US "Valid ZIP - Rate By Distance" bucket (depotId === -1) has no real
    // schedule rows tied to it because those jobs price by distance rather
    // than by a fixed run. Fall back to the full client speed list so the
    // operator can still pick a service to rate the batch. Matches legacy
    // where the coverage-only Step 6 offered `client.speeds` unfiltered.
    if (currentDepot.depotId === -1) return allSpeeds;
    const byId = new Map<number, { id: number; name: string }>();
    for (const s of schedules) {
      if (s.depotId !== currentDepot.depotId) continue;
      if (s.dayOfWeek !== dayOfWeek) continue;
      if (s.speed?.id == null) continue;
      if (byId.has(s.speed.id)) continue;
      // Prefer the schedule's speed name; fall back to allSpeeds if the
      // schedule row didn't carry a name (defensive - backend backfills it).
      const fromAll = allSpeeds.find((a) => a.id === s.speed!.id);
      byId.set(s.speed.id, {
        id: s.speed.id,
        name: s.speed.name || fromAll?.name || `Speed ${s.speed.id}`,
      });
    }
    const list = Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
    // Zero matches means the depot has NO schedules for this day-of-week.
    // Show nothing so the operator picks a different day rather than picking
    // a service that will yield "No schedules for this date + service."
    return list;
  }, [isOnDemand, currentDepot, dayOfWeek, schedules, allSpeeds]);

  // Filtered schedule list for Routed. Depot iteration hasn't landed yet
  // (see spec Section 3 post-MVP), so when the wizard doesn't have a
  // specific depot id we fall back to filtering by dayOfWeek + speedId
  // across all depots. If a real depot has been captured on wizard state
  // in the future, plumb it in here as an additional filter.
  //
  // Also filter out schedules whose cutoff has already passed for the
  // chosen BookDate. The server-side check at BulkImportJobFactory.cs
  // rejects with "Schedule cutoff exceeded" so pre-filtering here saves
  // the operator a round-trip. Cutoff = startTime - cutoffHours.
  const filteredSchedules = useMemo<ScheduleDto[]>(() => {
    if (!isRouted) return [];
    if (dayOfWeek == null || state.speedId === 0) return [];
    const [y, m, d] = (state.bookDate || '').split('-').map(Number);
    const bookDateOnly = y && m && d ? new Date(y, m - 1, d) : null;
    const now = new Date();
    const isSameDay = bookDateOnly != null
      && bookDateOnly.getFullYear() === now.getFullYear()
      && bookDateOnly.getMonth() === now.getMonth()
      && bookDateOnly.getDate() === now.getDate();
    return schedules
      // Include depotId filter when a real depot is in play (per-depot
      // iteration). Ports homeControl.js:750-758 `depotId === depot.id`
      // clause. When no depot is available (edge case: legacy state or
      // unmatched bucket) fall back to day+speed only.
      .filter((s) => s.dayOfWeek === dayOfWeek && s.speed?.id === state.speedId)
      .filter((s) => (currentDepot ? s.depotId === currentDepot.depotId : true))
      .filter((s) => {
        // Cutoff only applies to today. Future dates always available.
        if (!isSameDay || bookDateOnly == null) return true;
        if (!s.startTime) return true;
        const [sh, sm] = s.startTime.split(':').map(Number);
        if (Number.isNaN(sh) || Number.isNaN(sm)) return true;
        const scheduleStart = new Date(
          bookDateOnly.getFullYear(),
          bookDateOnly.getMonth(),
          bookDateOnly.getDate(),
          sh,
          sm
        );
        const cutoffMs = (s.cutoffHours || 0) * 3600 * 1000;
        const cutoffMoment = new Date(scheduleStart.getTime() - cutoffMs);
        return now <= cutoffMoment;
      })
      .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
  }, [isRouted, schedules, dayOfWeek, state.speedId, state.bookDate, currentDepot]);

  // When the current depot changes (per-depot iteration advances), clear
  // per-depot picks so the auto-select effect can re-pick from the new
  // filtered lists. Legacy resetDepotOptions at homeControl.js:488-531
  // clears speed, speedId, schedule, scheduleId, and (indirectly via the
  // book-date change) bookTime. Speed cannot stay sticky between depots
  // because the filtered service list changes per (depot, dayOfWeek) so
  // the previous pick may not even be a valid option for the new depot.
  useEffect(() => {
    if (!open || !currentDepot) return;
    dispatch({ type: 'SET_SPEED_ID', speedId: 0 });
    dispatch({ type: 'SET_SCHEDULE_ID', scheduleId: null });
    dispatch({ type: 'SET_BOOK_TIME', time: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentDepot?.depotId]);

  // Auto-select the single speed when only one is available. Also clears a
  // stale speedId when it's no longer in the filtered list (e.g. operator
  // changed the book date and the previously-picked service no longer runs
  // on the new day-of-week for this depot).
  useEffect(() => {
    if (!open) return;
    if (state.speedId !== 0) {
      const stillValid = speeds.some((s) => s.id === state.speedId);
      if (!stillValid && speeds.length > 0) {
        // Not in the filtered list anymore. If exactly one option remains,
        // pick it; otherwise reset so the operator picks explicitly.
        if (speeds.length === 1) {
          dispatch({ type: 'SET_SPEED_ID', speedId: speeds[0].id });
        } else {
          dispatch({ type: 'SET_SPEED_ID', speedId: 0 });
          dispatch({ type: 'SET_SCHEDULE_ID', scheduleId: null });
        }
      }
      return;
    }
    if (speeds.length === 1) {
      dispatch({ type: 'SET_SPEED_ID', speedId: speeds[0].id });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, speeds.length, speeds.map((s) => s.id).join(',')]);

  // Auto-select the single filtered schedule and stamp its start time onto
  // bookTime. Mirrors homeControl.js:754-771 (routed only).
  useEffect(() => {
    if (!open || !isRouted) return;
    if (filteredSchedules.length === 1) {
      const only = filteredSchedules[0];
      if (state.scheduleId !== only.id) {
        dispatch({ type: 'SET_SCHEDULE_ID', scheduleId: only.id });
      }
    } else if (state.scheduleId != null) {
      // Selected schedule no longer in the filtered list (e.g. book date
      // or speed changed). Clear it.
      const stillValid = filteredSchedules.some((s) => s.id === state.scheduleId);
      if (!stillValid) dispatch({ type: 'SET_SCHEDULE_ID', scheduleId: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isRouted, filteredSchedules.map((s) => s.id).join(',')]);

  // For routed, derive bookTime from the picked schedule's startTime.
  useEffect(() => {
    if (!open || !isRouted) return;
    if (state.scheduleId == null) return;
    const s = filteredSchedules.find((x) => x.id === state.scheduleId);
    if (!s || !s.startTime) return;
    // startTime is a HH:mm:ss (or HH:mm) TimeSpan string. Take the first
    // five chars for the input[type=time] which wants HH:mm.
    const hhmm = s.startTime.slice(0, 5);
    if (state.bookTime !== hhmm) {
      dispatch({ type: 'SET_BOOK_TIME', time: hhmm });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isRouted, state.scheduleId, filteredSchedules.length]);

  // For on-demand, default bookTime to the next 15-min slot on modal open
  // when the field is empty. Matches homeControl.js:setDefaultTime (849-860).
  useEffect(() => {
    if (!open || !isOnDemand) return;
    if (state.bookTime) return;
    const now = new Date();
    const minutes = Math.ceil(now.getMinutes() / 15) * 15;
    now.setMinutes(minutes);
    now.setSeconds(0);
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    dispatch({ type: 'SET_BOOK_TIME', time: `${hh}:${mm}` });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isOnDemand]);

  // Book date guards: >= today, <= today+30. Uses local yyyy-MM-dd to
  // match input[type=date] semantics.
  const { minDate, maxDate } = useMemo(() => {
    const today = new Date();
    const iso = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${dd}`;
    };
    const max = new Date();
    max.setDate(max.getDate() + 30);
    return { minDate: iso(today), maxDate: iso(max) };
  }, []);

// P1-9 pre-populate bookDate + bookTime from the first mapped row in
  // the current depot bucket (on-demand only). Legacy sortByDepot at
  // homeControl.js:3030-3053 does the same when it builds each depot.
  // Runs once per (depot + open) transition so the operator can override.
  useEffect(() => {
    if (!open || !isOnDemand || !currentDepot || !state.parsed) return;
    if (state.bookDate !== '' && state.bookTime !== '') return;
    const dateCol = state.mapping.bookDate;
    const timeCol = state.mapping.bookTime;
    if (!dateCol && !timeCol) return;
    for (const idx of currentDepot.jobIndexes) {
      const row = state.parsed.rows[idx];
      if (!row) continue;
      if (dateCol && state.bookDate === '') {
        const rawDate = String(row[dateCol] ?? '').trim();
        if (rawDate) {
          // Accept ISO yyyy-MM-dd; also accept mm/dd/yyyy or dd/mm/yyyy
          // as best-effort. Normalise to yyyy-MM-dd for the input.
          const iso = normalizeDateForInput(rawDate);
          if (iso) dispatch({ type: 'SET_BOOK_DATE', date: iso });
        }
      }
      if (timeCol && state.bookTime === '') {
        const rawTime = String(row[timeCol] ?? '').trim();
        const m = rawTime.match(/^([0-1]?\d|2[0-3]):([0-5]\d)/);
        if (m) {
          const hh = m[1].padStart(2, '0');
          dispatch({ type: 'SET_BOOK_TIME', time: `${hh}:${m[2]}` });
        }
      }
      if (state.bookDate !== '' && state.bookTime !== '') break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isOnDemand, currentDepot?.depotId]);

  // Hide "Nationwide Doc" when the current depot name contains "auckland"
  // (matches homeControl.js:isDepotAuckland at 959-962). Case-insensitive
  // substring.
  const hideNationwideDoc = !!currentDepot
    && currentDepot.depotName.toLowerCase().includes('auckland');

  // US coverage-only bucket rate-by-distance: no schedule row exists, so
  // don't block Next on scheduleId. The wizard's afterSchedulePicker will
  // route this bucket through the RateByDistanceModal acknowledgement.
  const isCoverageOnly = currentDepot?.depotId === -1;
  const nextDisabled = useMemo(() => {
    if (!state.bookDate) return true;
    if (state.speedId === 0) return true;
    if (isRouted && !isCoverageOnly && state.scheduleId == null) return true;
    if ((isOnDemand || isCoverageOnly) && !state.bookTime) return true;
    return false;
  }, [state.bookDate, state.speedId, state.scheduleId, state.bookTime, isRouted, isOnDemand, isCoverageOnly]);

  // P2-7 silent rewind: on-demand bookTime that lands in the past gets
  // bumped to now+15min. Legacy homeControl.js:3273-3289 does the same
  // without complaining to the operator. Only applies when bookDate === today.
  const handleNext = () => {
    if (isOnDemand && state.bookDate && state.bookTime) {
      const [y, m, d] = state.bookDate.split('-').map(Number);
      const [hh, mm] = state.bookTime.split(':').map(Number);
      const picked = new Date(y, m - 1, d, hh, mm);
      const now = new Date();
      const sameDay =
        picked.getFullYear() === now.getFullYear()
        && picked.getMonth() === now.getMonth()
        && picked.getDate() === now.getDate();
      if (sameDay && picked.getTime() < now.getTime()) {
        const bumped = new Date(now.getTime() + 15 * 60 * 1000);
        // Round to next 15-min slot for consistency with setDefaultTime.
        const rounded = new Date(bumped);
        const roundedMin = Math.ceil(bumped.getMinutes() / 15) * 15;
        rounded.setMinutes(roundedMin);
        rounded.setSeconds(0);
        const h = String(rounded.getHours()).padStart(2, '0');
        const mi = String(rounded.getMinutes()).padStart(2, '0');
        dispatch({ type: 'SET_BOOK_TIME', time: `${h}:${mi}` });
      }
    }
    onNext();
  };

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={
        currentDepot
          ? `${currentDepot.depotName}${depotCountLabel}`
          : `Book Date, Service & Schedule${depotCountLabel}`
      }
      size="xl"
      loading={importing}
      loadingMessage="Importing jobs for this depot..."
      footer={
        <div className="flex justify-between items-center">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <div className="flex gap-2">
            <Button variant="neutral" onClick={onBack}>
              Back
            </Button>
            <Button variant="primary" onClick={handleNext} disabled={nextDisabled}>
              Next
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="text-xs text-text-secondary">
          Import Type:{' '}
          <span className="font-semibold text-text-primary">
            {isRouted ? (isUs ? 'Routed' : 'Scheduled') : 'On-Demand'}
          </span>
        </div>

        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1" htmlFor="sp-book-date">
            Book Date
          </label>
          <input
            id="sp-book-date"
            type="date"
            value={state.bookDate}
            min={minDate}
            max={maxDate}
            onChange={(e) => dispatch({ type: 'SET_BOOK_DATE', date: e.target.value })}
            className="w-full text-sm border border-border rounded px-2 py-1.5"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1" htmlFor="sp-speed">
            Service
          </label>
          <select
            id="sp-speed"
            value={state.speedId === 0 ? '' : String(state.speedId)}
            onChange={(e) => {
              const v = e.target.value;
              dispatch({ type: 'SET_SPEED_ID', speedId: v ? Number(v) : 0 });
              // Clear schedule when speed changes so the auto-select effect
              // can pick a fresh one from the new filtered list.
              dispatch({ type: 'SET_SCHEDULE_ID', scheduleId: null });
            }}
            className="w-full text-sm border border-border rounded px-2 py-1.5 bg-surface-white"
            disabled={isRouted && speeds.length === 0}
          >
            <option value="">
              {isRouted && speeds.length === 0
                ? 'No services for this date + depot.'
                : 'Select a service...'}
            </option>
            {speeds.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        {isRouted && !isCoverageOnly && (
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1" htmlFor="sp-schedule">
              Schedule
            </label>
            <select
              id="sp-schedule"
              value={state.scheduleId == null ? '' : String(state.scheduleId)}
              onChange={(e) => {
                const v = e.target.value;
                dispatch({ type: 'SET_SCHEDULE_ID', scheduleId: v ? Number(v) : null });
              }}
              className="w-full text-sm border border-border rounded px-2 py-1.5 bg-surface-white"
              disabled={state.speedId === 0 || filteredSchedules.length === 0}
            >
              <option value="">
                {state.speedId === 0
                  ? 'Pick a service first...'
                  : filteredSchedules.length === 0
                    ? 'No schedules for this date + service.'
                    : 'Select a schedule...'}
              </option>
              {filteredSchedules.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name ?? `Schedule ${s.id}`}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1" htmlFor="sp-book-time">
            Book Time
          </label>
          <input
            id="sp-book-time"
            type="time"
            value={state.bookTime}
            onChange={(e) => dispatch({ type: 'SET_BOOK_TIME', time: e.target.value })}
            readOnly={isRouted && !isCoverageOnly}
            className={`w-full text-sm border border-border rounded px-2 py-1.5 ${
              isRouted && !isCoverageOnly ? 'bg-surface-cream text-text-muted' : ''
            }`}
          />
          {isRouted && !isCoverageOnly && (
            <p className="text-[11px] text-text-muted mt-1">
              Derived from the selected schedule's start time.
            </p>
          )}
          {isCoverageOnly && (
            <p className="text-[11px] text-text-muted mt-1">
              Rate-by-Distance bucket: pick the time you want this batch booked for.
            </p>
          )}
        </div>

        {!isUs && isOnDemand && (
          <div className="border border-border rounded p-3 space-y-2 bg-surface-cream">
            <div className="text-xs font-medium text-text-secondary">On-Demand Options</div>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={state.options.onHold}
                onChange={(e) => dispatch({ type: 'SET_ON_HOLD', value: e.target.checked })}
              />
              On Hold
            </label>
            {!hideNationwideDoc && (
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={state.options.nationwideDoc}
                  onChange={(e) => dispatch({ type: 'SET_NATIONWIDE_DOC', value: e.target.checked })}
                />
                Nationwide Doc
              </label>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

/**
 * Best-effort normalisation of a spreadsheet date string into
 * input[type=date] format (yyyy-MM-dd). Accepts:
 *   - ISO already: 2026-01-15
 *   - US mm/dd/yyyy: 1/15/2026
 *   - NZ dd/mm/yyyy: 15/01/2026  (ambiguous with US - assumes NZ order for
 *     value >12 in first component)
 *   - Excel serial dates are NOT handled here (server parse converts them).
 * Returns null if the value cannot be interpreted as a valid date.
 */
function normalizeDateForInput(raw: string): string | null {
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const y = iso[1];
    const m = iso[2].padStart(2, '0');
    const d = iso[3].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const slash = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (slash) {
    const first = Number(slash[1]);
    const second = Number(slash[2]);
    let year = Number(slash[3]);
    if (year < 100) year += 2000;
    // If first > 12 it must be a day (dd/mm/yyyy). If second > 12 it must
    // be a day (mm/dd/yyyy). Otherwise ambiguous - default to mm/dd/yyyy
    // (US) since that is the more common export convention.
    let day: number, month: number;
    if (first > 12 && second <= 12) {
      day = first;
      month = second;
    } else {
      month = first;
      day = second;
    }
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return null;
}
