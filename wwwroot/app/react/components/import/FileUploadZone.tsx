import { useCallback, useRef, useState } from 'react';

/**
 * FileUploadZone - drop zone + click-to-browse for BulkImport.
 *
 * Ported from Configurator (components/import/FileUploadZone.tsx) with:
 *   - `.xlsm` added to the accept list (RoutedOperations parses macro-
 *     enabled workbooks server-side via ClosedXML).
 *   - Emoji icons removed - clashes with the RoutedOperations cockpit
 *     look. Replaced with plain-text labels + a small SVG glyph.
 *   - "Parsing" spinner label reads "Parsing file..." (parity with the
 *     original inline label at BulkImport.tsx panel 1).
 *   - `disabled` prop threads through to the hidden input so the picker
 *     stays inert while a parse is in flight.
 *
 * State kept local: `isDragOver`. `selectedFile` display comes from
 * the parent (BulkImport owns the parsed-file state and needs to reset
 * it on Reset), so the confirmation block is driven by the `fileName` +
 * `fileSize` props rather than internal state.
 */
interface Props {
  onFileSelected: (file: File) => void;
  isLoading?: boolean;
  fileName?: string | null;
  fileSize?: number | null;
  disabled?: boolean;
}

export default function FileUploadZone({
  onFileSelected,
  isLoading = false,
  fileName = null,
  fileSize = null,
  disabled = false,
}: Props) {
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((file: File) => {
    onFileSelected(file);
  }, [onFileSelected]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (disabled || isLoading) return;
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile, disabled, isLoading]);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  };

  const inert = disabled || isLoading;

  return (
    <div
      onDrop={onDrop}
      onDragOver={(e) => { e.preventDefault(); if (!inert) setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onClick={() => !inert && inputRef.current?.click()}
      role="button"
      tabIndex={inert ? -1 : 0}
      onKeyDown={(e) => {
        if (inert) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      className={`relative border-2 border-dashed rounded-lg p-8 text-center transition-all ${
        inert ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
      } ${
        isDragOver
          ? 'border-brand-cyan bg-brand-cyan/5'
          : 'border-border hover:border-brand-cyan/60 hover:bg-surface-cream/60'
      }`}
      aria-label="Upload file drop zone"
      aria-disabled={inert}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv,.xlsx,.xlsm,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) handleFile(f);
        }}
        className="hidden"
        disabled={inert}
      />

      {isLoading ? (
        <div className="flex flex-col items-center gap-3">
          <div className="w-9 h-9 border-4 border-brand-cyan/30 border-t-brand-cyan rounded-full animate-spin" />
          <p className="text-text-secondary font-medium text-sm">Parsing file...</p>
        </div>
      ) : fileName ? (
        <div className="flex flex-col items-center gap-2">
          <FileIcon />
          <div>
            <p className="font-semibold text-text-primary text-sm">{fileName}</p>
            {typeof fileSize === 'number' && (
              <p className="text-xs text-text-secondary">{formatSize(fileSize)}</p>
            )}
          </div>
          <p className="text-[11px] text-text-muted">Click or drop to replace</p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2">
          <UploadIcon />
          <p className="font-semibold text-text-primary text-sm">
            Drop your file here or click to browse
          </p>
          <p className="text-xs text-text-secondary">
            Supports .csv, .xlsx, .xlsm (up to 20 MB, 10,000 rows)
          </p>
        </div>
      )}
    </div>
  );
}

function UploadIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-9 h-9 text-brand-cyan"
      aria-hidden="true"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-8 h-8 text-success"
      aria-hidden="true"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <polyline points="9 15 11 17 15 13" />
    </svg>
  );
}
