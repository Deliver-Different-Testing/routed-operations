import React, { useRef, useState } from 'react';
import { Upload, FileSpreadsheet, AlertCircle } from 'lucide-react';

export interface FileDropzoneProps {
  onFileSelect: (file: File) => void;
  accept?: string;                    // Default '.csv'
  maxSize?: number;                   // Max file size in bytes (default 10MB)
  disabled?: boolean;
  error?: string;                     // Error message to display
  className?: string;
}

/**
 * File upload dropzone with drag-and-drop support.
 * Validates file type and size before invoking `onFileSelect`.
 */
export function FileDropzone({
  onFileSelect,
  accept = '.csv',
  maxSize = 10 * 1024 * 1024,        // 10MB
  disabled = false,
  error,
  className = ''
}: FileDropzoneProps): React.ReactElement {
  const [isDragOver, setIsDragOver] = useState(false);
  const [internalError, setInternalError] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const displayError = error || internalError;

  const validateAndSelect = (file: File | undefined) => {
    if (!file) {
      setInternalError('No file selected');
      return;
    }

    // Clear any previous errors
    setInternalError('');

    // Check file extension
    const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase();
    const acceptedExtensions = accept.split(',').map(ext => ext.trim().toLowerCase());

    if (!acceptedExtensions.includes(fileExtension)) {
      setInternalError(`Invalid file type. Please upload a ${accept} file.`);
      return;
    }

    // Check file size
    if (file.size > maxSize) {
      const maxSizeMB = (maxSize / (1024 * 1024)).toFixed(0);
      setInternalError(`File size exceeds ${maxSizeMB}MB limit.`);
      return;
    }

    // Valid file - call callback
    onFileSelect(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled) {
      setIsDragOver(true);
    }
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    if (disabled) return;

    const file = e.dataTransfer.files[0];
    validateAndSelect(file);
  };

  const handleClick = () => {
    if (!disabled && fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    validateAndSelect(file);

    // Reset input so the same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const maxSizeMB = (maxSize / (1024 * 1024)).toFixed(0);

  return (
    <div className={`w-full ${className}`}>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label="File upload dropzone — drag and drop or press Enter to browse"
        aria-disabled={disabled}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleClick}
        onKeyDown={(e) => { if (!disabled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); handleClick(); } }}
        data-testid="file-dropzone"
        className={`
          relative
          border-2 border-dashed rounded-md
          px-6 py-12
          text-center
          transition-all duration-normal
          ${
            disabled
              ? 'bg-surface-light border-border cursor-not-allowed opacity-50'
              : isDragOver
              ? 'border-brand-cyan bg-brand-cyan/5 cursor-pointer'
              : displayError
              ? 'border-error bg-error/5 cursor-pointer'
              : 'border-border hover:border-brand-cyan hover:bg-surface-light cursor-pointer'
          }
          ${!disabled ? 'focus-within:outline-none focus-within:border-brand-cyan focus-within:shadow-cyan-glow' : ''}
        `}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          onChange={handleFileChange}
          disabled={disabled}
          className="sr-only"
          aria-label="File upload"
        />

        <div className="flex flex-col items-center gap-3">
          {/* Icon */}
          <div className={`
            ${disabled ? 'text-text-muted' : displayError ? 'text-error' : isDragOver ? 'text-brand-cyan' : 'text-text-secondary'}
          `}>
            {displayError ? (
              <AlertCircle className="w-12 h-12" />
            ) : (
              <Upload className="w-12 h-12" />
            )}
          </div>

          {/* Main text */}
          <div className="space-y-1">
            <p className={`text-base font-medium ${disabled ? 'text-text-muted' : 'text-text-primary'}`}>
              Drag & drop your CSV file here
            </p>
            <p className={`text-sm ${disabled ? 'text-text-muted' : 'text-text-secondary'}`}>
              or click to browse
            </p>
          </div>

          {/* File info */}
          <div className={`flex items-center gap-2 text-sm ${disabled ? 'text-text-muted' : 'text-text-muted'}`}>
            <FileSpreadsheet className="w-4 h-4" />
            <span>Supported: {accept} files</span>
          </div>
          <p className={`text-sm ${disabled ? 'text-text-muted' : 'text-text-muted'}`}>
            Max size: {maxSizeMB}MB
          </p>
        </div>
      </div>

      {/* Error message */}
      {displayError && (
        <div className="mt-2 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-error flex-shrink-0 mt-0.5" />
          <p className="text-sm text-error">{displayError}</p>
        </div>
      )}
    </div>
  );
}
