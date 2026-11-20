import { useState } from 'react';
import { Button } from '../common/Button';
import { useToast } from '../../context/ToastContext';
import { territoryService, type ZoneGroupImportPreview } from '../../services/territoryService';
import { ApiError, messageWithRef } from '../../services/api';

interface Props {
  groupId: number;
  /** 'postcode' on NZ, 'zip' on US. */
  memberWord: string;
  /** The uploaded file's text, sent again on apply so the server re-checks it. */
  csv: string;
  fileName: string;
  preview: ZoneGroupImportPreview;
  onApplied: () => void;
  onCancel: () => void;
  /** Re-run the preview against the group as it is now. Called after the
   *  server refuses an apply (most often because the group changed since
   *  this preview), so a second Apply does not fail on the same token. */
  onRefresh?: () => Promise<void>;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * F4 (ZG3): the preview of a re-uploaded zone group export, and its apply.
 *
 * Nothing is written until Apply. A file with any bad row shows only the
 * errors, each naming its row, and offers no Apply at all (spec test 8).
 * Rows the file leaves out are listed separately and are removed only when
 * the "also remove" box is ticked (M0 I-6): removing coverage is the one
 * change here that cannot be seen on the sheet, so it is never implied.
 */
export function ZoneGroupImportPanel({ groupId, memberWord, csv, fileName, preview, onApplied, onCancel, onRefresh }: Props) {
  const toast = useToast();
  const [removeMissing, setRemoveMissing] = useState(false);
  const [applying, setApplying] = useState(false);

  const hasErrors = preview.errors.length > 0;
  const removing = removeMissing ? preview.removed.length : 0;
  const changes = preview.added.length + preview.moved.length + removing;

  const apply = async () => {
    setApplying(true);
    try {
      const r = (await territoryService.applyZoneGroupImport(groupId, {
        csv, token: preview.token, removeMissing,
      })).response;
      const parts = [
        r.added > 0 && `${r.added} added`,
        r.moved > 0 && `${r.moved} moved`,
        r.removed > 0 && `${r.removed} removed`,
      ].filter(Boolean).join(', ');
      toast.show(
        `Group updated from the file: ${parts}.`
          + (r.keptNotInFile > 0 ? ` ${plural(r.keptNotInFile, memberWord)} not in the file kept.` : ''),
        'success');
      onApplied();
    } catch (e) {
      // r3: only a stale token means the group changed, so only that one
      // re-runs the preview. Any other refusal says its own words.
      const refused = e instanceof ApiError && e.status === 400 && onRefresh != null
        && (e.body as { code?: string } | null)?.code === 'stale';
      toast.show(
        messageWithRef(e) + (refused ? ' The preview below now shows the group as it is.' : ''),
        'error');
      if (refused) {
        // Removal is confirmed again against the refreshed list.
        setRemoveMissing(false);
        try {
          await onRefresh();
        } catch (refreshError) {
          toast.show(messageWithRef(refreshError), 'error');
          onCancel();
        }
      }
    } finally {
      setApplying(false);
    }
  };

  return (
    <div data-testid="pg-import-panel" className="rounded border border-border bg-surface-cream/40 px-3 py-2 mb-2 text-xs space-y-1.5">
      <p className="font-semibold text-text-primary">Upload {fileName}</p>

      {hasErrors ? (
        <div data-testid="pg-import-errors" className="text-red-700 space-y-0.5">
          <p className="font-semibold">Nothing will be saved. Fix the file and upload it again:</p>
          <ul className="list-disc pl-5">
            {preview.errors.map((e, i) => <li key={`${i}-${e}`}>{e}</li>)}
          </ul>
        </div>
      ) : (
        <div data-testid="pg-import-summary" className="space-y-0.5">
          {preview.added.length > 0 && (
            <p className="text-green-700">
              <span className="font-semibold">Added ({preview.added.length}):</span>{' '}
              <span className="font-mono">{preview.added.map((a) => `${a.code} to zone ${a.zone}`).join(', ')}</span>
            </p>
          )}
          {preview.moved.length > 0 && (
            <p className="text-amber-700" data-testid="pg-import-moved">
              <span className="font-semibold">Moved ({preview.moved.length}):</span>{' '}
              <span className="font-mono">{preview.moved.map((m) => `${m.code} zone ${m.fromZone} to ${m.toZone}${m.newZone ? ' (new zone)' : ''}`).join(', ')}</span>
            </p>
          )}
          {preview.removed.length > 0 && (
            <p className="text-text-primary">
              <span className="font-semibold">Not in the file ({preview.removed.length}):</span>{' '}
              <span className="font-mono">{preview.removed.map((r) => r.code).join(', ')}</span>
            </p>
          )}
          {preview.unrecognised.length > 0 && (
            <p className="text-amber-700">
              <span className="font-semibold">Unrecognised ({preview.unrecognised.length}):</span>{' '}
              <span className="font-mono">{preview.unrecognised.join(', ')}</span>
              {' '}- not used anywhere on this tenant yet. They will still be added; check the spelling.
            </p>
          )}
          <p className="text-text-muted">Unchanged: {preview.unchanged}</p>
          {preview.removed.length > 0 && (
            <label className="flex items-center gap-1.5 cursor-pointer text-text-primary">
              <input
                type="checkbox"
                data-testid="pg-import-remove"
                checked={removeMissing}
                onChange={(e) => setRemoveMissing(e.target.checked)}
              />
              Also remove the {plural(preview.removed.length, memberWord)} not in the file
            </label>
          )}
          {changes === 0 && (
            <p className="text-text-muted italic">Nothing to change.</p>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="neutral" onClick={onCancel} disabled={applying}>
          {hasErrors ? 'Close' : 'Cancel'}
        </Button>
        {!hasErrors && (
          <Button
            variant="secondary"
            data-testid="pg-import-apply"
            onClick={apply}
            disabled={applying || changes === 0}
          >
            {applying ? 'Applying...' : 'Apply'}
          </Button>
        )}
      </div>
    </div>
  );
}
