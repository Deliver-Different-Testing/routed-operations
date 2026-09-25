import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import { clientsService, type ClientSettingsDto } from '../../services/clientsService';
import { addressService, type RegionDto } from '../../services/addressService';
import { templatesService, type TemplateDto } from '../../services/templatesService';
import {
  autoMatchColumn,
  urgentFieldsFor,
  type WizardAction,
  type WizardState,
} from './wizardState';

interface Props {
  open: boolean;
  state: WizardState;
  dispatch: (action: WizardAction) => void;
  onBack: () => void;
  onNext: () => void;
  onCancel: () => void;
}

/**
 * MapColumnsModal - Step 2 of the wizard. Three-column layout matching
 * BulkImportHyper's homeView.html step2:
 *   - LEFT   Required system fields (label + Data-Seems-OK badge)
 *   - MIDDLE Customer column dropdown (populated from parsed headers)
 *   - RIGHT  Options panel (overrides, origin, template placeholders)
 *
 * Row preview pagination at the bottom cycles through parsed rows and
 * shows the currently-mapped values inline.
 */
export function MapColumnsModal({ open, state, dispatch, onBack, onNext, onCancel }: Props) {
  const auth = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const isUsTenant = auth.isUsTenant || state.client?.isUsTenant || false;

  const [settings, setSettings] = useState<ClientSettingsDto | null>(null);
  const [regions, setRegions] = useState<RegionDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [previewIdx, setPreviewIdx] = useState(0);
  // Contact-owned templates. Loaded once when the modal opens; getTemplates
  // is filtered server-side by ContactID so no client-side scoping is needed.
  const [templates, setTemplates] = useState<TemplateDto[]>([]);

  const fields = useMemo(
    () => urgentFieldsFor(
      isUsTenant,
      state.importType,
      state.options.autogenerateJobNumber,
      state.options.routeStartsFromClientSite,
      settings
        ? {
            referenceAMandatory: settings.referenceAMandatory,
            referenceAMessage: settings.referenceAMessage,
            referenceBMandatory: settings.referenceBMandatory,
            referenceBMessage: settings.referenceBMessage,
          }
        : undefined,
      !!state.options.overrideDimensions?.trim()
    ),
    [
      isUsTenant,
      state.importType,
      state.options.autogenerateJobNumber,
      state.options.routeStartsFromClientSite,
      settings,
      state.options.overrideDimensions,
    ]
  );
  const parsedHeaders = state.parsed?.headers ?? [];
  const parsedRows = state.parsed?.rows ?? [];
  const currentRow = parsedRows[previewIdx] ?? {};

  // First open: auto-map + load client settings + regions in parallel.
  useEffect(() => {
    if (!open) return;
    if (!state.client) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const auto: Record<string, string> = { ...state.mapping };
        for (const f of fields) {
          if (auto[f.key]) continue;
          const match = autoMatchColumn(f, parsedHeaders);
          if (match) auto[f.key] = match;
        }
        if (!cancelled) dispatch({ type: 'SET_MAPPING', mapping: auto });

        const [settingsRes, regionsRes, templatesRes] = await Promise.all([
          clientsService.getSettings(state.client!.id),
          isUsTenant ? addressService.getRegions() : Promise.resolve(null),
          // Templates are contact-owned, not client-owned, so we fetch the
          // full list once. Failure is not fatal - the wizard still works
          // without templates, so we swallow the error and log it.
          templatesService.getTemplates().catch(() => null),
        ]);
        if (cancelled) return;
        setSettings(settingsRes.response.settings);
        // Also push the settings onto wizard state so downstream steps
        // (SchedulePickerModal) can read schedules/speeds without a
        // second /clients/{id}/settings fetch. Mirrors BulkImportHyper's
        // `import.client = { ...clientSettings }` write on client-select.
        dispatch({ type: 'SET_CLIENT_SETTINGS', settings: settingsRes.response.settings });
        if (regionsRes) setRegions(regionsRes.response.regions ?? []);
        if (templatesRes) setTemplates(templatesRes.response.templates ?? []);
      } catch (e) {
        if (!cancelled) toast.show(`Failed to load client settings: ${(e as Error).message}`, 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, state.client?.id, isUsTenant, state.importType, state.options.autogenerateJobNumber]);

  // Visible fields = all urgentFields minus those hidden by option toggles:
  //   - RouteStartsFromClientSite hides every from* row (server sources
  //     origin from client.UcclAddress).
  //   - OverrideFromContact hides fromContact (the override supplies it).
  // Matches BulkImportHyper homeControl.js `urgentFields[key].show()`
  // semantics (returns false when the corresponding option makes the field
  // redundant).
  const overrideContactSet = !!state.options.overrideFromContact?.trim();
  const visibleFields = fields.filter((f) => {
    if (state.options.routeStartsFromClientSite && f.key.startsWith('from')) return false;
    if (overrideContactSet && f.key === 'fromContact') return false;
    return true;
  });

  // A required field counts as "missing" when either:
  //   - no column is mapped, OR
  //   - the mapped column is blank in at least one parsed row.
  // The second rule catches the case where the operator picked a column
  // that exists in the sheet but has no values (e.g. an empty Job Number
  // column). Without this the wizard advances to the import step and the
  // server bounces the batch with a validation 400. Note that when
  // Autogenerate Job Number is ticked, jobNumber is not present in
  // visibleFields at all (see urgentFieldsFor in wizardState.ts:394-402),
  // so ticking Autogen automatically satisfies this check.
  const missingRequired = visibleFields
    .filter((f) => {
      if (!f.required) return false;
      const mapped = state.mapping[f.key];
      if (!mapped) return true;
      if (!state.parsed) return false;
      return state.parsed.rows.some((r) => {
        const v = r[mapped];
        return v == null || String(v).trim() === '';
      });
    })
    .map((f) => f.label);

  function handleNext() {
    if (missingRequired.length > 0) {
      const jobNumberBlocked = missingRequired.includes('Job Number');
      const msg = jobNumberBlocked
        ? `Job Number is empty in one or more rows. Map a column with values or tick 'Autogenerate Job Number'.`
        : `Please map: ${missingRequired.join(', ')}`;
      toast.show(msg, 'warning');
      return;
    }
    onNext();
  }

  // 1-based row number of the first row whose mapped required column is
  // blank. Used to drive the legacy-style "Invalid data at record N."
  // banner. Zero means no invalid rows were found.
  const firstInvalidRecord = (() => {
    if (!state.parsed) return 0;
    for (let i = 0; i < state.parsed.rows.length; i++) {
      const row = state.parsed.rows[i];
      for (const f of visibleFields) {
        if (!f.required) continue;
        const col = state.mapping[f.key];
        if (!col) continue;
        const v = row[col];
        if (v == null || String(v).trim() === '') return i + 1;
      }
    }
    return 0;
  })();

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title="Map the Columns"
      size="5xl"
      loading={loading}
      loadingMessage="Loading client settings, regions, and templates..."
      footer={
        <div className="flex justify-between items-center">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <div className="flex gap-2">
            <Button variant="neutral" onClick={onBack}>
              Back
            </Button>
            <Button
              variant="primary"
              onClick={handleNext}
              disabled={missingRequired.length > 0}
            >
              Next
            </Button>
          </div>
        </div>
      }
    >
      <div className="max-h-[70vh] overflow-y-auto">
        <div className="grid grid-cols-[2fr,1fr] gap-4">
          <div>
            <div className="grid grid-cols-2 gap-2 mb-2 text-xs font-semibold text-text-secondary">
              <div>Required Columns</div>
              <div>Customer Columns</div>
            </div>
            <div className="space-y-1.5">
              {visibleFields.map((f) => {
                const mapped = state.mapping[f.key] || '';
                const value = mapped ? currentRow[mapped] : '';
                const hasValue = mapped && value != null && value !== '';
                return (
                  <div key={f.key} className="grid grid-cols-2 gap-2 items-center">
                    <div className="border border-border rounded px-2 py-1.5 bg-surface-cream">
                      <div className="text-xs font-medium text-text-primary flex items-center gap-1">
                        <span className="text-brand-cyan">&gt;</span>
                        {f.label}
                        {f.required && <span className="text-error text-[10px]">*</span>}
                      </div>
                      <div className="text-[10px] mt-0.5">
                        {!mapped ? (
                          <span className="text-text-muted">Please select a field</span>
                        ) : hasValue ? (
                          <span className="text-success">Data Seems OK</span>
                        ) : f.required ? (
                          <span className="text-error font-semibold">Invalid</span>
                        ) : (
                          <span className="text-warning">Field selected but empty</span>
                        )}
                      </div>
                    </div>
                    <div
                      className={`border rounded px-2 py-1.5 ${
                        mapped ? 'border-border bg-surface-white' : 'border-warning/50 bg-warning/5'
                      }`}
                    >
                      <select
                        value={mapped}
                        onChange={(e) =>
                          dispatch({ type: 'PATCH_MAPPING', field: f.key, column: e.target.value })
                        }
                        className="w-full text-xs bg-transparent focus:outline-none"
                        aria-label={`Map ${f.label}`}
                      >
                        <option value="">
                          Choose Field... {f.required ? '' : '( Optional )'}
                        </option>
                        {parsedHeaders.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                      <div className="text-[10px] mt-0.5 text-text-muted truncate">
                        {mapped ? String(value) : ' '}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex items-center justify-center gap-2 text-xs text-text-secondary">
              <button
                type="button"
                aria-label="Jump back 10 rows"
                onClick={() => setPreviewIdx((i) => Math.max(0, i - 10))}
                className="px-1.5 hover:text-brand-cyan"
              >
                &lt;&lt;
              </button>
              <button
                type="button"
                aria-label="Previous row"
                onClick={() => setPreviewIdx((i) => Math.max(0, i - 1))}
                className="px-1.5 hover:text-brand-cyan"
              >
                &lt;
              </button>
              <span>
                Row {parsedRows.length === 0 ? 0 : previewIdx + 1} of {parsedRows.length}
              </span>
              <button
                type="button"
                aria-label="Next row"
                onClick={() => setPreviewIdx((i) => Math.min(parsedRows.length - 1, i + 1))}
                className="px-1.5 hover:text-brand-cyan"
              >
                &gt;
              </button>
              <button
                type="button"
                aria-label="Jump forward 10 rows"
                onClick={() => setPreviewIdx((i) => Math.min(parsedRows.length - 1, i + 10))}
                className="px-1.5 hover:text-brand-cyan"
              >
                &gt;&gt;
              </button>
            </div>
          </div>

          <div className="border-2 border-error/30 rounded p-3 space-y-2.5 bg-error/[0.02]">
            {/*
              Override From Contact - the value is the display name
              ("FirstName Surname") which NewImportWizard.buildJobs stamps
              onto every row's fromContact. Mirrors homeControl.js:2317-2318
              in BulkImportHyper (formatString(`${first} ${surname}`)). We
              use the composite name as the option value rather than an ID
              because ContactDto on the server does not carry an ID field,
              and the override is applied purely on the frontend before
              submit.
            */}
            <select
              value={state.options.overrideFromContact}
              onChange={(e) =>
                dispatch({
                  type: 'SET_OPTIONS',
                  options: { overrideFromContact: e.target.value },
                })
              }
              className="w-full text-xs border border-border rounded px-2 py-1.5 bg-surface-white"
              disabled={loading || !settings}
            >
              <option value="">Override From Contact... (Optional)</option>
              {settings?.contacts?.map((c, i) => {
                const name = `${c.firstName ?? ''} ${c.surname ?? ''}`.trim();
                return (
                  <option key={`${name}-${i}`} value={name}>
                    {name}
                  </option>
                );
              })}
            </select>

            {/*
              Override Dimensions - encodes the picked stock size as
              "name|length|width|height|weight" so buildJobs can decode and
              stamp per-row length/width/height/weight without needing a
              second settings lookup. Mirrors homeControl.js:2320-2325 in
              BulkImportHyper (job.length = stockSize.length; etc).
            */}
            <select
              value={state.options.overrideDimensions}
              onChange={(e) =>
                dispatch({
                  type: 'SET_OPTIONS',
                  options: { overrideDimensions: e.target.value },
                })
              }
              className="w-full text-xs border border-border rounded px-2 py-1.5 bg-surface-white"
              disabled={loading || !settings}
            >
              <option value="">Override Dimensions... (Optional)</option>
              {settings?.stockSizes?.map((s, i) => {
                const encoded = [
                  s.name ?? '',
                  s.length ?? 0,
                  s.width ?? 0,
                  s.height ?? 0,
                  s.weight ?? 0,
                ].join('|');
                return (
                  <option key={`${s.name}-${i}`} value={encoded}>
                    {s.name}
                  </option>
                );
              })}
            </select>

            {isUsTenant && (
              <select
                value={state.options.stopType}
                onChange={(e) =>
                  dispatch({ type: 'SET_OPTIONS', options: { stopType: e.target.value } })
                }
                className="w-full text-xs border border-border rounded px-2 py-1.5 bg-surface-white"
              >
                <option value="mapped">Stop Type - use mapped column</option>
                <option value="pickup">Stop Type - all rows are Pickup</option>
                <option value="dropoff">Stop Type - all rows are Dropoff</option>
              </select>
            )}

            {isUsTenant && state.importType === 'routed' && (
              <>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={state.options.routeStartsFromClientSite}
                    onChange={(e) =>
                      dispatch({
                        type: 'SET_OPTIONS',
                        options: { routeStartsFromClientSite: e.target.checked },
                      })
                    }
                  />
                  Route starts from client site
                </label>
                {!state.options.routeStartsFromClientSite && (
                  <select
                    value={state.options.originLocation ?? ''}
                    onChange={(e) =>
                      dispatch({
                        type: 'SET_OPTIONS',
                        options: {
                          originLocation: e.target.value ? Number(e.target.value) : null,
                        },
                      })
                    }
                    className="w-full text-xs border border-border rounded px-2 py-1.5 bg-surface-white"
                  >
                    <option value="">Origin Location... (Optional)</option>
                    {regions.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                )}
              </>
            )}

            {/*
              Select Template - applies a saved column-mapping template
              wholesale. Mirrors BulkImportHyper homeControl.js:applyTemplate
              which sets each urgent field's mapping from the template's
              mapping list. Only fields present in the template are set;
              anything else stays whatever the auto-map produced. templateId
              is stamped onto options so the "Save as template" section
              hides for the currently-loaded template.
            */}
            <div className="flex items-center gap-1">
              <select
                value={state.options.templateId ?? ''}
                onChange={(e) => {
                  const raw = e.target.value;
                  // Empty selection clears the currently-applied template
                  // (matches legacy homeControl.js:475-486 loadFromTemplate
                  // guard which no-ops when no template is picked, PLUS the
                  // explicit reset when the user re-picks the placeholder).
                  // We rebuild the mapping from auto-map so the operator
                  // sees a clean slate instead of leftover template columns.
                  if (!raw) {
                    const auto: Record<string, string> = {};
                    for (const f of fields) {
                      const match = autoMatchColumn(f, parsedHeaders);
                      if (match) auto[f.key] = match;
                    }
                    dispatch({ type: 'APPLY_TEMPLATE', templateId: null, mapping: auto });
                    toast.show('Template cleared.', 'info');
                    return;
                  }
                  const id = Number(raw);
                  const tpl = templates.find((t) => t.id === id);
                  if (!tpl) return;
                  const mapping: Record<string, string> = {};
                  for (const m of tpl.mappings) {
                    // Only carry over template mappings whose customer column
                    // actually exists in this file - a stale mapping to a
                    // renamed column would otherwise silently break auto-map.
                    if (parsedHeaders.includes(m.importField)) {
                      mapping[m.urgentField] = m.importField;
                    }
                  }
                  dispatch({ type: 'APPLY_TEMPLATE', templateId: id, mapping });
                  toast.show(`Applied template "${tpl.name}".`, 'success');
                }}
                className="flex-1 text-xs border border-border rounded px-2 py-1.5 bg-surface-white"
                disabled={loading}
                aria-label="Select a saved column-mapping template"
              >
                <option value="">Select Template... (Optional)</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              {/*
                Delete Template - trash button mirrors BulkImportHyper
                homeView.html:318 `<i class="fa-trash" ng-if="import.template"
                ng-click="deleteTemplate()">`. Only shown when a template is
                currently loaded (templateId != null). On success, removes
                the template from the local list + clears templateId, matching
                homeControl.js:322-337.
              */}
              {state.options.templateId != null && (
                <button
                  type="button"
                  className="text-xs px-2 py-1.5 border border-border rounded bg-surface-white hover:bg-error-bg/50 hover:border-error text-text-secondary hover:text-error"
                  aria-label="Delete this template"
                  title="Delete this template"
                  disabled={loading}
                  onClick={async () => {
                    const id = state.options.templateId;
                    if (id == null) return;
                    const tpl = templates.find((t) => t.id === id);
                    const name = tpl?.name ?? 'this template';
                    const proceed = await confirm({
                      title: 'Delete template',
                      message: `Delete template "${name}"?`,
                      confirmLabel: 'Delete',
                      danger: true,
                    });
                    if (!proceed) return;
                    try {
                      await templatesService.deleteTemplate(id);
                      setTemplates((prev) => prev.filter((t) => t.id !== id));
                      // Clear the selection - mapping stays as-is, matching
                      // legacy which does not undo already-applied mappings.
                      dispatch({ type: 'APPLY_TEMPLATE', templateId: null, mapping: state.mapping });
                      toast.show(`Deleted template "${name}".`, 'success');
                    } catch (e) {
                      toast.show(`Failed to delete template: ${(e as Error).message}`, 'error');
                    }
                  }}
                >
                  Delete
                </button>
              )}
            </div>

            {/*
              Autogenerate Job Number - when ticked, buildJobs stamps
              every row's jobNumber as "AUTOGENERATE" and the server
              (BulkImportJobFactory.AssignJobNumbersAsync) allocates a
              client-prefixed sequence in one atomic call. urgentFieldsFor
              already drops the Job Number required badge when this flag
              is on (see wizardState.ts:165-173).
            */}
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={state.options.autogenerateJobNumber}
                onChange={(e) =>
                  dispatch({
                    type: 'SET_OPTIONS',
                    options: { autogenerateJobNumber: e.target.checked },
                  })
                }
              />
              Autogenerate Job Number
            </label>
            {/*
              Import as Completed Jobs - when ticked, the server stamps
              JobStatus = 6, Done = true, ComplTime = now and populates
              PodName with the logged-in contact's name+email. Backend
              already reads request.ImportAsCompleted end-to-end (see
              BulkImportJobFactory.cs:142-149,951-952).
            */}
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={state.options.importAsCompleted}
                onChange={(e) =>
                  dispatch({
                    type: 'SET_OPTIONS',
                    options: { importAsCompleted: e.target.checked },
                  })
                }
              />
              Import as Completed Jobs
            </label>
            {/*
              Save as template - stamps a saveAsTemplate flag + templateName
              on the wizard state so NewImportWizard.fireImport POSTs to
              /api/templates alongside the import call. Hidden when the
              operator just applied a template (there's nothing to save
              that differs from what's already stored). Mirrors
              BulkImportHyper homeView.html:saveAsTemplate checkbox.
            */}
            {state.options.templateId == null && (
              <div className="space-y-1">
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={state.options.saveAsTemplate}
                    onChange={(e) =>
                      dispatch({
                        type: 'SET_OPTIONS',
                        options: { saveAsTemplate: e.target.checked },
                      })
                    }
                  />
                  Save as template
                </label>
                {state.options.saveAsTemplate && (
                  <input
                    type="text"
                    value={state.options.templateName}
                    onChange={(e) =>
                      dispatch({
                        type: 'SET_OPTIONS',
                        options: { templateName: e.target.value },
                      })
                    }
                    placeholder="Template name"
                    className="w-full text-xs border border-border rounded px-2 py-1.5 bg-surface-white"
                    aria-label="Template name"
                    maxLength={100}
                  />
                )}
              </div>
            )}
          </div>
        </div>

        {loading && (
          <p className="text-[11px] text-text-muted mt-3 text-center">
            Loading client settings...
          </p>
        )}
        {missingRequired.length > 0 && (
          <div className="mt-3 p-2 bg-error/5 border border-error/30 rounded text-xs text-error">
            Please map required column(s): {missingRequired.join(', ')}.
            {firstInvalidRecord > 0 && (
              <span> Invalid data at record {firstInvalidRecord}.</span>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
