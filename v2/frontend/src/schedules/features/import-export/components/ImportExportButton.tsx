import { useState } from 'react';
import { ImportExportMenu } from './ImportExportMenu';
import { ImportWizardModal } from './ImportWizardModal';
import { generateCSV, generateTemplate, downloadCSV } from '../engine';
import type { ImportSchema } from '../types';

export type ImportExportMode = 'closed' | 'download-data' | 'download-template' | 'upload';

export interface ImportExportButtonProps {
  schema: ImportSchema;              // Schema for this page's data
  data?: Record<string, unknown>[];  // Current data to export
  onImportComplete?: (result: {
    created: number;
    updated: number;
    deleted: number;
    errors: number;
  }) => void;
  disabled?: boolean;
  className?: string;
}

export function ImportExportButton({
  schema,
  data = [],
  onImportComplete,
  disabled = false,
  className
}: ImportExportButtonProps): React.ReactElement {
  const [mode, setMode] = useState<ImportExportMode>('closed');

  /**
   * Handle Download Data
   * Generates CSV from current data and triggers download
   */
  const handleDownloadData = () => {
    try {
      setMode('download-data');

      // Generate CSV from current data
      const csv = generateCSV(data, schema);

      // Download with schema-specific filename
      const filename = `${schema.id}-export.csv`;
      downloadCSV(csv, filename);

      // Optional: Show success feedback
      console.log(`Downloaded ${data.length} records to ${filename}`);

      // Reset mode
      setMode('closed');
    } catch (error) {
      console.error('Error downloading data:', error);
      setMode('closed');
    }
  };

  /**
   * Handle Download Template
   * Generates empty CSV template with headers and hint row
   */
  const handleDownloadTemplate = () => {
    try {
      setMode('download-template');

      // Generate template with hint row
      const csv = generateTemplate(schema, { includeHintRow: true });

      // Download with schema-specific filename
      const filename = `${schema.id}-template.csv`;
      downloadCSV(csv, filename);

      // Optional: Show success feedback
      console.log(`Downloaded template to ${filename}`);

      // Reset mode
      setMode('closed');
    } catch (error) {
      console.error('Error downloading template:', error);
      setMode('closed');
    }
  };

  /**
   * Handle Upload
   * Opens the ImportWizardModal (placeholder for now)
   */
  const handleUpload = () => {
    setMode('upload');
    // Later: This will open the ImportWizardModal
    console.log('Upload flow - will open ImportWizardModal');
  };

  /**
   * Handle Import Complete (from ImportWizardModal)
   * Called when the wizard finishes processing
   */
  const handleImportComplete = (result: {
    created: number;
    updated: number;
    deleted: number;
    errors: number;
  }) => {
    setMode('closed');

    // Notify parent component
    if (onImportComplete) {
      onImportComplete(result);
    }
  };

  return (
    <div data-testid="import-export-button" aria-label="Import and export controls">
      <ImportExportMenu
        onDownloadData={handleDownloadData}
        onDownloadTemplate={handleDownloadTemplate}
        onUpload={handleUpload}
        dataCount={data.length}
        disabled={disabled}
        className={className}
      />

      {/* Import Wizard Modal */}
      <ImportWizardModal
        isOpen={mode === 'upload'}
        onClose={() => setMode('closed')}
        schema={schema}
        existingData={data}
        onComplete={handleImportComplete}
      />
    </div>
  );
}
