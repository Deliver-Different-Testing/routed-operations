import { useEffect, useState } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import FileUploadZone from '../import/FileUploadZone';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { bulkImportService } from '../../services/bulkImportService';
import { clientsService, type ClientDto } from '../../services/clientsService';
import { ClientTypeahead } from './shared/ClientTypeahead';
import type { WizardAction, WizardState } from './wizardState';

interface Props {
  open: boolean;
  state: WizardState;
  dispatch: (action: WizardAction) => void;
  onCancel: () => void;
}

/**
 * NewImportModal - Step 1 of the wizard. Picks the client, uploads a file,
 * chooses routed vs on-demand. On successful upload we transition straight
 * to `mapColumns`; the parent wizard is responsible for the state routing.
 *
 * Client picker branches on the `isInternal` claim (matches legacy
 * homeControl.js:16-30 `getClients`): internal staff use a server-search
 * typeahead (thousands of clients possible), regular operators get a
 * pre-loaded dropdown of their assigned clients. Auto-selects when the
 * list has exactly one entry, matching legacy `resetImport` at 1192.
 */
export function NewImportModal({ open, state, dispatch, onCancel }: Props) {
  const toast = useToast();
  const { isUsTenant } = useAuth();
  const routedLabel = isUsTenant ? 'Routed' : 'Scheduled';
  const [uploading, setUploading] = useState(false);
  const [clientList, setClientList] = useState<ClientDto[]>([]);
  const [isInternal, setIsInternal] = useState<boolean | null>(null);
  const [clientsLoading, setClientsLoading] = useState(false);

  // Load the client list once the modal opens (and again after a reset that
  // clears everything back to initialWizardState). Server returns isInternal
  // + clients; internal staff get an empty list + typeahead, everyone else
  // gets the full list + dropdown.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setClientsLoading(true);
      try {
        const { response } = await clientsService.getClients();
        if (cancelled) return;
        setIsInternal(response.isInternal);
        const list = response.clients ?? [];
        setClientList(list);
        // Auto-select when there is exactly one client (matches legacy
        // resetImport: import.client = clients.length === 1 ? clients[0] : null).
        if (!response.isInternal && list.length === 1 && !state.client) {
          dispatch({ type: 'SET_CLIENT', client: list[0] });
        }
      } catch (e) {
        if (!cancelled) toast.show(`Failed to load clients: ${(e as Error).message}`, 'error');
      } finally {
        if (!cancelled) setClientsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const ready = !!state.client && !!state.file;

  async function handleUpload() {
    if (!state.file) return;
    setUploading(true);
    try {
      const { response } = await bulkImportService.uploadFile(state.file);
      dispatch({ type: 'SET_PARSED', parsed: response });
      dispatch({ type: 'GOTO', step: 'mapColumns' });
    } catch (e) {
      toast.show(`Upload failed: ${(e as Error).message}`, 'error');
    } finally {
      setUploading(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title="New Import"
      loading={uploading}
      loadingMessage="Uploading and parsing the file. This may take up to a minute for large batches."
      footer={
        <div className="flex justify-between items-center">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!ready || uploading} onClick={handleUpload}>
            {uploading ? 'Uploading...' : 'Upload File'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {isInternal ? (
          <ClientTypeahead
            value={state.client}
            onChange={(c) => dispatch({ type: 'SET_CLIENT', client: c })}
            autoFocus
            disabled={uploading}
          />
        ) : (
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              Client
            </label>
            <select
              value={state.client?.id ?? ''}
              disabled={uploading || clientsLoading || clientList.length === 0}
              autoFocus
              onChange={(e) => {
                const id = Number(e.target.value);
                const picked = clientList.find((c) => c.id === id) ?? null;
                dispatch({ type: 'SET_CLIENT', client: picked });
              }}
              className="w-full rounded border border-border px-3 py-2 text-sm focus:outline-none focus:border-brand-cyan focus:ring-1 focus:ring-brand-cyan disabled:bg-surface-cream disabled:cursor-not-allowed"
              aria-label="Client"
            >
              <option value="">
                {clientsLoading
                  ? 'Loading clients...'
                  : clientList.length === 0
                    ? 'No clients assigned'
                    : 'Select a client'}
              </option>
              {clientList.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} - {c.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">
            Import File
          </label>
          <FileUploadZone
            onFileSelected={(file) => dispatch({ type: 'SET_FILE', file })}
            fileName={state.file?.name ?? null}
            fileSize={state.file?.size ?? null}
            isLoading={uploading}
            disabled={uploading}
          />
        </div>

        {/*
          Google Drive import intentionally hidden. Backend endpoint stays
          wired at /api/bulk-import/import-google-drive so once a Google
          Picker + OAuth token acquisition ships (Phase 3), un-hide the
          affordance here without any backend work.
        */}

        <fieldset>
          <legend className="block text-xs font-medium text-text-secondary mb-1">
            Import Type
          </legend>
          <div className="flex gap-2">
            <label
              className={`flex-1 border rounded px-3 py-2 text-sm cursor-pointer transition-all ${
                state.importType === 'routed'
                  ? 'border-brand-cyan bg-brand-cyan/10 text-text-primary'
                  : 'border-border hover:border-brand-cyan/50 text-text-secondary'
              }`}
            >
              <input
                type="radio"
                name="importType"
                className="mr-2"
                checked={state.importType === 'routed'}
                onChange={() => dispatch({ type: 'SET_IMPORT_TYPE', importType: 'routed' })}
              />
              {routedLabel}
              <p className="text-[11px] text-text-muted mt-0.5 pl-6">
                Batch jobs onto runs for a scheduled delivery day.
              </p>
            </label>
            <label
              className={`flex-1 border rounded px-3 py-2 text-sm cursor-pointer transition-all ${
                state.importType === 'onDemand'
                  ? 'border-brand-cyan bg-brand-cyan/10 text-text-primary'
                  : 'border-border hover:border-brand-cyan/50 text-text-secondary'
              }`}
            >
              <input
                type="radio"
                name="importType"
                className="mr-2"
                checked={state.importType === 'onDemand'}
                onChange={() => dispatch({ type: 'SET_IMPORT_TYPE', importType: 'onDemand' })}
              />
              On-Demand
              <p className="text-[11px] text-text-muted mt-0.5 pl-6">
                Book jobs individually for immediate dispatch.
              </p>
            </label>
          </div>
        </fieldset>

        <p className="text-[11px] text-text-muted">
          Supported files: .csv, .xls, .xlsx (up to 20 MB, 10,000 rows).
        </p>
      </div>
    </Modal>
  );
}
