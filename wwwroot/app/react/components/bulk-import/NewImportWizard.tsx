import { useEffect, useReducer, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import {
  bulkImportService,
  type BulkImportJobCreateDto,
  type BulkImportRequest,
} from '../../services/bulkImportService';
import { templatesService } from '../../services/templatesService';
import { NewImportModal } from './NewImportModal';
import { MapColumnsModal } from './MapColumnsModal';
import { FixZipCodesModal } from './FixZipCodesModal';
import { FixAddressesModal } from './FixAddressesModal';
import { SelectRegionsModal } from './SelectRegionsModal';
import { SchedulePickerModal } from './SchedulePickerModal';
import { RateByDistanceModal } from './RateByDistanceModal';
import { KmRatedReviewModal } from './KmRatedReviewModal';
import { BookPickupModal } from './BookPickupModal';
import { ImportSummaryModal } from './ImportSummaryModal';
import { initialWizardState, wizardReducer, type WizardState } from './wizardState';

interface Props {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

/**
 * Compose the picker's yyyy-MM-dd + HH:mm into a local-timezone ISO string
 * (no trailing Z). The server-side timezone conversion at BulkService
 * accepts both UTC and unspecified-Kind values and converts to tenant local
 * itself, so shipping a local wall-clock ISO string avoids the "tomorrow
 * 00:00 UTC lands yesterday afternoon in NZ" gotcha the old
 * `nextBusinessDayIsoDate()` had.
 */
function composeBookDateTime(bookDate: string, bookTime: string | null): string {
  if (!bookDate) return '';
  const time = bookTime && bookTime.length >= 4 ? bookTime : '00:00';
  // Force seconds for consistency with the .NET DateTime parser.
  const hhmmss = time.length === 5 ? `${time}:00` : time;
  return `${bookDate}T${hhmmss}`;
}

/**
 * NewImportWizard - drives the seven-step Bulk Import flow. Owns the wizard
 * state via useReducer and renders exactly one modal at a time. Both routed
 * and on-demand paths now walk through SchedulePickerModal so every batch
 * carries an operator-picked speedId + bookDate + bookTime (and scheduleId
 * for routed). US-routed with rate-by-distance rows makes one more stop at
 * RateByDistanceModal for the origin-recap acknowledgement before the
 * final /bulk-import/import call.
 */
export function NewImportWizard({ open, onClose, onImported }: Props) {
  const auth = useAuth();
  const toast = useToast();
  const [state, dispatch] = useReducer(wizardReducer, undefined, initialWizardState);
  const [importing, setImporting] = useState(false);
  const isUs = auth.isUsTenant || state.client?.isUsTenant || false;
  // Authoritative accumulator for per-depot results. React state is stale
  // inside handlers that dispatch mid-flight (P0-5): if a handler dispatches
  // ADD_PER_DEPOT_RESULT then immediately reads state.perDepotResults in the
  // same tick, the read misses the new item. The ref is written synchronously
  // by every caller so summaries always see the full list.
  const perDepotResultsRef = useRef<Array<{ depotId: number; imported: number; failed: number }>>([]);
  // Mirror ref for failedImportJobs so back-to-back dispatches inside the
  // km-rated upload + fireImportForCurrentDepot chain don't drop rows.
  // Reading state.failedImportJobs from the closure right after dispatching
  // SET_FAILED_IMPORT_JOBS returns the PREVIOUS array (React batches state
  // updates); the ref is the source of truth for the "current known failed
  // rows" that the merge should append to.
  const failedImportJobsRef = useRef<BulkImportJobCreateDto[]>([]);

  function reset() {
    dispatch({ type: 'RESET' });
    perDepotResultsRef.current = [];
    failedImportJobsRef.current = [];
  }

  function handleClose() {
    reset();
    onClose();
  }

  // Belt-and-braces reset when the parent flips `open` false via any path
  // that isn't handleClose (e.g. a hypothetical outer effect closing the
  // wizard mid-summary). Without this, state.step could stay at 'summary'
  // or 'bookPickup' and the next open would render NOTHING because every
  // sub-modal gates on `open && state.step === X`.
  useEffect(() => {
    if (!open && state.step !== 'newImport') {
      reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ---------------------------------------------------------------------------
  // Per-depot iteration (spec Section 6).
  //
  // Buckets are computed in SelectRegionsModal and stashed on state.depots.
  // The operator ticks which real buckets to process; SchedulePicker walks
  // through them one-at-a-time via state.currentDepotIndex. After each
  // per-depot import completes:
  //   - success + km-rated rows: pivot to KmRatedReviewModal for that bucket
  //   - success (no km-rated): accumulate result, advance cursor, either
  //     re-open picker for next bucket OR finish
  //   - failure: toast + stay on current step
  //
  // Km-rated review: the second-pass import (isKmRatedJobs=true) is fired
  // via fireImportForCurrentDepot with state.kmRatedConfirmed=true and only
  // the selected rows. After success it advances just like a first-pass.
  //
  // Pickup accumulation: keep the earliest-cutoff pickupJob across all
  // per-depot responses (matches homeControl.js:3226-3229). When the loop
  // finishes and any pickup was returned AND the client has
  // createBulkHomeDeliveryPickup, advance to BookPickupModal; else close.
  // ---------------------------------------------------------------------------

  function includedBuckets() {
    // Real depots (id > 0) + US coverage-only bucket (id === -1) both
    // participate in the per-depot loop. Unmatched (id === 0) is excluded.
    return state.depots.filter(
      (d) => d.depotId !== 0 && state.selectedRegions.has(String(d.depotId))
    );
  }

  async function saveTemplateIfRequested() {
    if (
      state.options.saveAsTemplate &&
      state.options.templateName.trim() &&
      state.options.templateId == null
    ) {
      const mappings = Object.entries(state.mapping)
        .filter(([, v]) => !!v)
        .map(([urgentField, importField]) => ({ urgentField, importField }));
      if (mappings.length > 0) {
        try {
          await templatesService.createTemplate(state.options.templateName.trim(), mappings);
          toast.show('Template saved.', 'success');
        } catch (tplErr) {
          toast.show(`Template save failed: ${(tplErr as Error).message}`, 'warning');
        }
      }
    }
  }

  // Build the /import payload for a specific depot cursor. When
  // isKmRatedSecondPass is true, we ship state.kmRatedRows filtered by the
  // operator's selection (matches BulkImportHyper's re-fire path).
  function buildDepotPayload(
    depotIndex: number,
    isKmRatedSecondPass: boolean
  ): BulkImportRequest | null {
    if (!state.client || !state.parsed) return null;
    const included = includedBuckets();
    const bucket = included[depotIndex];
    let jobs: BulkImportJobCreateDto[];
    if (isKmRatedSecondPass) {
      jobs = state.kmRatedRows.filter((_, i) => state.kmRatedSelected.has(i));
    } else if (bucket) {
      // Project only the rows belonging to this bucket.
      const all = buildJobs(state, isUs);
      const set = new Set(bucket.jobIndexes);
      jobs = all.filter((_, i) => set.has(i));
    } else {
      // No bucket iteration (edge case: everything went to unmatched / empty).
      jobs = buildJobs(state, isUs);
    }
    // Forward the previously-returned pickupJob back into the second-pass
    // /import so BulkImportJobFactory can accumulate PickupJob.Quantity += qty
    // (legacy homeControl.js:3377). First-pass calls leave it null.
    const pickupForwarding = state.pickupJobPayload?.pickupJob
      ? { pickupJob: state.pickupJobPayload.pickupJob }
      : null;
    return {
      clientId: state.client.id,
      bookDate: composeBookDateTime(state.bookDate, state.bookTime || null),
      scheduleId: state.importType === 'onDemand' ? null : state.scheduleId,
      speedId: state.speedId,
      isKmRatedJobs: isKmRatedSecondPass,
      importAsCompleted: state.options.importAsCompleted,
      jobType: state.importType === 'onDemand' ? 'ondemand' : 'routed',
      pickupJob: pickupForwarding,
      jobs,
      routeFromClientSite: state.options.routeStartsFromClientSite,
      originLocationId: state.options.originLocation,
    };
  }

  // Advance to the next bucket, or finish the wizard (either open pickup or
  // close). Called after a successful per-depot import (with no km-rated
  // rows returned) or after a Skip on the km-rated review.
  //
  // `justAddedResult` and `justAddedPickup` carry the values dispatched in
  // the caller's same tick so the summary + pickup gate see the freshest
  // data (React state is stale within the current handler after a dispatch).
  async function advanceOrFinish(
    nextIndex: number,
    justAddedResult?: { imported: number; failed: number },
    justAddedPickup?: WizardState['pickupJobPayload']
  ) {
    const included = includedBuckets();
    if (nextIndex < included.length) {
      dispatch({ type: 'SET_CURRENT_DEPOT', index: nextIndex });
      // Reset km-rated state between buckets so the review modal doesn't
      // stick.
      dispatch({ type: 'SET_KMRATED', rows: [] });
      dispatch({ type: 'SET_KMRATED_CONFIRMED', value: false });
      dispatch({ type: 'GOTO', step: 'schedulePicker' });
      return;
    }
    // Loop finished. Save template, decide pickup vs close. Use the ref
    // (P0-5) - state.perDepotResults is stale mid-tick.
    await saveTemplateIfRequested();
    const allResults = perDepotResultsRef.current;
    const totalImported = allResults.reduce((s, r) => s + r.imported, 0);
    const totalFailed = allResults.reduce((s, r) => s + r.failed, 0);
    const summary =
      totalFailed > 0
        ? `Imported ${totalImported} job${totalImported === 1 ? '' : 's'} (${totalFailed} failed).`
        : `Imported ${totalImported} job${totalImported === 1 ? '' : 's'}.`;
    toast.show(summary, totalFailed > 0 ? 'warning' : 'success');
    onImported();
    // Advance to pickup step if we have one attached AND the client opted
    // in. Otherwise advance to Summary when there are failed / skipped rows
    // (matches BulkImportHyper's "Unimported Jobs" block), else close.
    const effectivePickup = justAddedPickup ?? state.pickupJobPayload;
    const hasPickup =
      !!effectivePickup?.pickupJob
      && (state.clientSettings?.createBulkHomeDeliveryPickup ?? false);
    if (hasPickup) {
      dispatch({ type: 'GOTO', step: 'bookPickup' });
    } else if (totalFailed > 0 || state.failedImportJobs.length > 0) {
      dispatch({ type: 'GOTO', step: 'summary' });
    } else {
      handleClose();
    }
  }

  // Fire ONE /import call for the current depot cursor. isKmRatedSecondPass
  // switches to the re-fire payload (isKmRatedJobs=true + selected rows).
  async function fireImportForCurrentDepot(isKmRatedSecondPass: boolean) {
    const payload = buildDepotPayload(state.currentDepotIndex, isKmRatedSecondPass);
    if (!payload) return;
    const included = includedBuckets();
    const bucket = included[state.currentDepotIndex];
    setImporting(true);
    try {
      const { response } = await bulkImportService.import(payload);
      if (!response.success) {
        const firstMsg = response.messages?.[0]?.message;
        toast.show(`Import failed: ${firstMsg ?? 'unknown error'}`, 'error');
        return;
      }
      // Accumulate earliest-cutoff pickup across depots (matches
      // homeControl.js:3226-3229 collapse).
      let effectivePickup = state.pickupJobPayload;
      if (response.pickupJob?.pickupJob) {
        const existing = state.pickupJobPayload;
        if (
          !existing?.pickupJob?.time
          || (response.pickupJob.pickupJob.time
            && response.pickupJob.pickupJob.time < existing.pickupJob.time)
        ) {
          dispatch({ type: 'SET_PICKUP_JOB', payload: response.pickupJob });
          effectivePickup = response.pickupJob;
        }
      }
      // Km-rated review branch: server returned rows to confirm.
      if (!isKmRatedSecondPass && response.jobs && response.jobs.length > 0) {
        dispatch({ type: 'SET_KMRATED', rows: response.jobs });
        dispatch({ type: 'GOTO', step: 'kmRatedReview' });
        return;
      }
      // First-pass success (no km-rated) OR second-pass success. Record
      // result for this bucket and advance.
      const imported = payload.jobs.length - (response.jobs?.length ?? 0);
      const failedRowsThisPass = response.jobs ?? [];
      const result = {
        depotId: bucket?.depotId ?? 0,
        imported,
        failed: failedRowsThisPass.length,
      };
      dispatch({ type: 'ADD_PER_DEPOT_RESULT', result });
      perDepotResultsRef.current = [...perDepotResultsRef.current, result];
      // Accumulate server-rejected rows into failedImportJobs so the summary
      // (ImportSummaryModal) + its CSV export can list them. Silently
      // dropping these was the audit finding for `NewImportWizard.tsx:249`.
      // Merge against the ref (not state) because a preceding
      // KmRatedReviewModal.handleUpload dispatch is still batched at this
      // point and the closure would spread the pre-merge value.
      if (failedRowsThisPass.length > 0) {
        const merged = [...failedImportJobsRef.current, ...failedRowsThisPass];
        failedImportJobsRef.current = merged;
        dispatch({ type: 'SET_FAILED_IMPORT_JOBS', jobs: merged });
      }
      await advanceOrFinish(state.currentDepotIndex + 1, result, effectivePickup);
    } catch (e) {
      toast.show(`Import failed: ${(e as Error).message}`, 'error');
    } finally {
      setImporting(false);
    }
  }

  // From SchedulePicker.onNext, decide whether to detour through the
  // Rate-by-Distance acknowledgement modal. Fires only when the CURRENT
  // depot is the US coverage-only bucket (depotId === -1) - those rows
  // rate by distance and legacy shows an origin-recap step for them.
  function afterSchedulePicker() {
    const included = includedBuckets();
    const current = included[state.currentDepotIndex];
    const isCoverageOnly = isUs && current?.depotId === -1;
    if (isCoverageOnly) {
      dispatch({ type: 'GOTO', step: 'rateByDistance' });
      return;
    }
    fireImportForCurrentDepot(false);
  }

  function afterRateByDistance() {
    fireImportForCurrentDepot(false);
  }

  function onKmRatedUpload(deselectedRows: BulkImportJobCreateDto[]) {
    // Merge the operator's deselected rows into failedImportJobsRef BEFORE
    // firing the second-pass /import. If we dispatched instead, the
    // fireImport call one line later would spread state.failedImportJobs
    // still holding the pre-merge value (React batches state updates
    // across handlers). The ref is the immediately-visible source of truth
    // the fireImport merge reads from.
    if (deselectedRows.length > 0) {
      const merged = [...failedImportJobsRef.current, ...deselectedRows];
      failedImportJobsRef.current = merged;
      dispatch({ type: 'SET_FAILED_IMPORT_JOBS', jobs: merged });
    }
    // Mark the second-pass flag on state (used by fireImport payload build).
    dispatch({ type: 'SET_KMRATED_CONFIRMED', value: true });
    fireImportForCurrentDepot(true);
  }

  function onKmRatedSkip() {
    // Skip does NOT call /import - just record the current bucket's rows as
    // "considered but not booked" and advance. Also copy the whole
    // kmRatedRows list into failedImportJobs so the ImportSummaryModal +
    // CSV export list each skipped row (not just the count). Merge with
    // any rows from prior depots since the reducer replaces the array.
    const included = includedBuckets();
    const bucket = included[state.currentDepotIndex];
    const result = {
      depotId: bucket?.depotId ?? 0,
      imported: 0,
      failed: state.kmRatedRows.length,
    };
    dispatch({ type: 'ADD_PER_DEPOT_RESULT', result });
    perDepotResultsRef.current = [...perDepotResultsRef.current, result];
    if (state.kmRatedRows.length > 0) {
      const merged = [...failedImportJobsRef.current, ...state.kmRatedRows];
      failedImportJobsRef.current = merged;
      dispatch({ type: 'SET_FAILED_IMPORT_JOBS', jobs: merged });
    }
    advanceOrFinish(state.currentDepotIndex + 1, result, state.pickupJobPayload);
  }

  return (
    <>
      <NewImportModal
        open={open && state.step === 'newImport'}
        state={state}
        dispatch={dispatch}
        onCancel={handleClose}
      />
      <MapColumnsModal
        open={open && state.step === 'mapColumns'}
        state={state}
        dispatch={dispatch}
        onBack={() => dispatch({ type: 'GOTO', step: 'newImport' })}
        onNext={() => dispatch({ type: 'GOTO', step: 'fixZips' })}
        onCancel={handleClose}
      />
      <FixZipCodesModal
        open={open && state.step === 'fixZips'}
        state={state}
        dispatch={dispatch}
        onBack={() => dispatch({ type: 'GOTO', step: 'mapColumns' })}
        onNext={() => dispatch({ type: 'GOTO', step: 'fixAddresses' })}
        onCancel={handleClose}
      />
      <FixAddressesModal
        open={open && state.step === 'fixAddresses'}
        state={state}
        dispatch={dispatch}
        onBack={() => dispatch({ type: 'GOTO', step: 'fixZips' })}
        onNext={() => dispatch({ type: 'GOTO', step: 'selectRegions' })}
        onCancel={handleClose}
      />
      <SelectRegionsModal
        open={open && state.step === 'selectRegions'}
        state={state}
        dispatch={dispatch}
        onBack={() => dispatch({ type: 'GOTO', step: 'fixAddresses' })}
        onNext={() => dispatch({ type: 'GOTO', step: 'schedulePicker' })}
        onCancel={handleClose}
      />
      <SchedulePickerModal
        open={open && state.step === 'schedulePicker'}
        state={state}
        dispatch={dispatch}
        onBack={() => dispatch({ type: 'GOTO', step: 'selectRegions' })}
        onNext={afterSchedulePicker}
        onCancel={handleClose}
        importing={importing}
      />
      <RateByDistanceModal
        open={open && state.step === 'rateByDistance'}
        state={state}
        onBack={() => dispatch({ type: 'GOTO', step: 'schedulePicker' })}
        onNext={afterRateByDistance}
        onCancel={handleClose}
        importing={importing}
      />
      <KmRatedReviewModal
        open={open && state.step === 'kmRatedReview'}
        state={state}
        dispatch={dispatch}
        onUploadSelected={onKmRatedUpload}
        onSkip={onKmRatedSkip}
        onCancel={handleClose}
        importing={importing}
      />
      <BookPickupModal
        open={open && state.step === 'bookPickup'}
        state={state}
        onClose={handleClose}
        onBooked={() =>
          // After pickup booked, if there were failed jobs advance to
          // summary; otherwise close (matches legacy which shows the
          // unimported list AFTER pickup confirmation).
          state.failedImportJobs.length > 0
            || perDepotResultsRef.current.some((r) => r.failed > 0)
            ? dispatch({ type: 'GOTO', step: 'summary' })
            : handleClose()
        }
      />
      <ImportSummaryModal
        open={open && state.step === 'summary'}
        state={state}
        onClose={handleClose}
      />
    </>
  );
}

/**
 * buildJobs - project parsed rows through the operator's column mapping
 * into BulkImportJobCreateDto[]. Applies the fixedAddresses overrides for
 * any row the operator hand-corrected in Step 4.
 */
function buildJobs(state: WizardState, isUs: boolean): BulkImportJobCreateDto[] {
  if (!state.parsed) return [];
  const m = state.mapping;
  const get = (row: Record<string, string>, key: string) => {
    const col = m[key];
    if (!col) return null;
    const v = row[col];
    return v == null || v === '' ? null : v;
  };
  // Decode the encoded override values from Step 2. See MapColumnsModal
  // for the encoding shape ("name|length|width|height|weight" for dims;
  // display name for contact). Overrides win over per-row mapped values,
  // matching BulkImportHyper homeControl.js:2317-2325.
  const overrideContact = state.options.overrideFromContact?.trim() || null;
  const overrideDims = decodeOverrideDimensions(state.options.overrideDimensions);
  const autoGen = state.options.autogenerateJobNumber;
  // Batch-level stopType from MapColumns wins over the per-row mapped column
  // when set to 'pickup' or 'dropoff'. 'mapped' (the default) means keep
  // whatever the operator mapped. Mirrors legacy homeControl.js:3355-3357
  // `if (job.stopType === 'pickup' || 'dropoff') jobCopy.stopType = ...`.
  const batchStopType = state.options.stopType;
  // NZ on-demand-only per-job flags (matches homeControl.js:3359-3363).
  const applyNzOnDemandFlags = !isUs && state.importType === 'onDemand';
  return state.parsed.rows.map((row, idx) => {
    const mappedLength = toFloatOrNull(get(row, 'length'));
    const mappedWidth = toFloatOrNull(get(row, 'width'));
    const mappedHeight = toFloatOrNull(get(row, 'height'));
    const mappedWeight = toFloatOrNull(get(row, 'weight'));
    const j: BulkImportJobCreateDto = {
      jobNumber: autoGen ? 'AUTOGENERATE' : get(row, 'jobNumber'),
      bookDate: get(row, 'bookDate'),
      fromContact: overrideContact ?? get(row, 'fromContact'),
      fromCompany: get(row, 'fromCompany'),
      fromAddress: get(row, 'fromAddress'),
      fromSuburb: get(row, 'fromSuburb'),
      fromPostCode: get(row, 'fromPostCode'),
      fromUnit: get(row, 'fromUnit'),
      fromCity: get(row, 'fromCity'),
      fromState: get(row, 'fromState'),
      fromZipCode: get(row, 'fromZipCode'),
      toCompany: get(row, 'toCompany'),
      toAddress: get(row, 'toAddress'),
      toSuburb: get(row, 'toSuburb'),
      toPostCode: get(row, 'toPostCode'),
      toUnit: get(row, 'toUnit'),
      toCity: get(row, 'toCity'),
      toState: get(row, 'toState'),
      toZipCode: get(row, 'toZipCode'),
      toContact: get(row, 'toContact'),
      toContactPhone: get(row, 'toContactPhone'),
      quantity: toIntOrNull(get(row, 'quantity')),
      // Override dimensions win when > 0. A zero-valued stock size (rare
      // but possible) falls through to the mapped column, matching
      // BulkImportHyper's `job.length = stockSize.length || row[mapped]`
      // truthy check at homeControl.js:2320-2325.
      length: (overrideDims && overrideDims.length > 0 ? overrideDims.length : mappedLength) ?? 0,
      width: (overrideDims && overrideDims.width > 0 ? overrideDims.width : mappedWidth) ?? 0,
      height: (overrideDims && overrideDims.height > 0 ? overrideDims.height : mappedHeight) ?? 0,
      weight: (overrideDims && overrideDims.weight > 0 ? overrideDims.weight : mappedWeight) ?? 0,
      clientRefA: get(row, 'clientRefA'),
      clientRefB: get(row, 'clientRefB'),
      ourRef: get(row, 'ourRef'),
      notes: get(row, 'notes'),
      trackingEmail: get(row, 'trackingEmail'),
      trackingMobile: get(row, 'trackingMobile'),
      stopType: normalizeStopType(get(row, 'stopType')),
    };
    if (batchStopType === 'pickup' || batchStopType === 'dropoff') {
      j.stopType = batchStopType;
    }
    if (applyNzOnDemandFlags) {
      j.onHold = state.options.onHold;
      j.nationwideDoc = state.options.nationwideDoc;
    }
    // Fixed-zip override. Legacy matches on (name + postcode) for NZ so
    // duplicate suburb names across postcodes get independent replacements
    // (homeControl.js:2339-2344). US matches on zip alone.
    if (isUs && j.toZipCode && state.fixedZips[j.toZipCode]) {
      j.toZipCode = state.fixedZips[j.toZipCode];
    }
    if (!isUs && j.toSuburb) {
      const compoundKey = `${j.toSuburb.toLowerCase()}|${j.toPostCode ?? ''}`;
      if (state.fixedZips[compoundKey]) {
        j.toSuburb = state.fixedZips[compoundKey];
      }
    }
    // Fixed-address coordinate overrides. Destination pins update
    // toLatitude/toLongitude; origin pins update fromLatitude/fromLongitude
    // (populated by the FixAddresses step for on-demand batches that need
    // accurate pickup coords).
    const fixedTo = state.fixedAddresses[idx];
    if (fixedTo) {
      j.toLatitude = String(fixedTo.lat);
      j.toLongitude = String(fixedTo.lng);
    }
    const fixedFrom = state.fixedFromAddresses[idx];
    if (fixedFrom) {
      j.fromLatitude = String(fixedFrom.lat);
      j.fromLongitude = String(fixedFrom.lng);
    }
    // US: if fromAddress holds a combined "Street, City, State ZIP" string
    // and the per-component From fields weren't separately mapped, split
    // and back-fill the empty ones. Only replaces empty values - never
    // overwrites a column the operator explicitly mapped. Mirrors legacy
    // homeControl.js:2418-2426 parseCombinedUsAddress. Runs BEFORE zip strip
    // so the extracted zip goes through the same normalise path as mapped
    // zips.
    if (isUs && j.fromAddress) {
      const parsed = parseCombinedUsAddress(j.fromAddress);
      if (parsed) {
        j.fromAddress = parsed.street;
        if (!notEmptyString(j.fromCity)) j.fromCity = parsed.city;
        if (!notEmptyString(j.fromState)) j.fromState = parsed.state;
        if (!notEmptyString(j.fromZipCode)) j.fromZipCode = parsed.zip;
      }
    }
    // US: strip ZIP+4 to base 5-digit so the server INT parse succeeds.
    // Legacy homeControl.js:3347-3350 formatZipCode does the same. Applied
    // AFTER fixed-zip override + combined-address parse so operator-typed
    // corrections and split-out zips both normalise.
    if (isUs) {
      j.toZipCode = stripZipPlus4(j.toZipCode);
      j.fromZipCode = stripZipPlus4(j.fromZipCode);
    }
    return j;
  });
}

/**
 * Split a US "Street, City, State ZIP[-####]" string into components.
 * Returns null if the value doesn't match the expected shape - the caller
 * then leaves the row unchanged.
 *
 * Mirrors legacy homeControl.js:4278-4289 (regex identical). Used only when
 * the operator uploaded a single-column From Address on a US tenant.
 */
function parseCombinedUsAddress(
  value: string | null | undefined
): { street: string; city: string; state: string; zip: string } | null {
  if (!value) return null;
  const s = String(value).trim();
  if (!s) return null;
  const m = s.match(/^\s*(.+?)\s*,\s*([^,]+?)\s*,\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/);
  if (!m) return null;
  return {
    street: m[1],
    city: m[2],
    state: m[3].toUpperCase(),
    zip: m[4],
  };
}

function notEmptyString(v: string | null | undefined): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Normalise real-world stop-type synonyms into the two values the server
 * accepts ('pickup' | 'dropoff'). Case-insensitive. Empty string returns
 * null (treated as "not provided"); anything unrecognised also returns
 * null so the server validator can flag it rather than silently accept
 * a malformed value. Mirrors legacy homeControl.js:4265-4271.
 */
function normalizeStopType(value: string | null | undefined): string | null {
  if (value == null) return null;
  const s = String(value).trim().toLowerCase();
  if (!s) return null;
  if (['pickup', 'pick up', 'pick-up', 'pu', 'collection', 'collect'].includes(s)) return 'pickup';
  if (['dropoff', 'drop off', 'drop-off', 'do', 'delivery', 'deliver'].includes(s)) return 'dropoff';
  return null;
}

/**
 * Trim a US ZIP+4 like "02110-1234" down to its 5-digit base "02110".
 * Also strips non-digit noise. Returns the input unchanged if already
 * <= 5 digits (or null/empty).
 */
function stripZipPlus4(zip: string | null | undefined): string | null {
  if (!zip) return null;
  const digits = String(zip).replace(/[^0-9]/g, '');
  if (!digits) return null;
  return digits.slice(0, 5);
}

function toIntOrNull(v: string | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function toFloatOrNull(v: string | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Decode the "name|length|width|height|weight" string produced by the
 * Override Dimensions dropdown in MapColumnsModal. Returns null when the
 * option is empty or malformed; empty is the wizard default.
 */
function decodeOverrideDimensions(
  encoded: string | null | undefined
): { length: number; width: number; height: number; weight: number } | null {
  if (!encoded) return null;
  const parts = encoded.split('|');
  if (parts.length < 5) return null;
  const length = Number(parts[1]);
  const width = Number(parts[2]);
  const height = Number(parts[3]);
  const weight = Number(parts[4]);
  if (![length, width, height, weight].every((n) => Number.isFinite(n))) return null;
  return { length, width, height, weight };
}
