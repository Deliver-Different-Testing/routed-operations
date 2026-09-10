/**
 * Manual Test for useImportExport Hook
 *
 * This is a simple component to manually test the useImportExport hook.
 * To run: Copy this into your app and render it.
 */

import { useImportExport } from './useImportExport';
import type { ImportSchema } from '../types';

const testSchema: ImportSchema = {
  id: 'test-schema',
  name: 'Test Schema',
  description: 'Manual test schema',
  columns: [
    {
      key: 'id',
      header: 'ID',
      type: 'string',
      locked: true,
    },
    {
      key: 'name',
      header: 'Name',
      type: 'string',
      required: true,
    },
    {
      key: 'email',
      header: 'Email',
      type: 'email',
      required: true,
    },
  ],
};

export function UseImportExportManualTest() {
  const importExport = useImportExport({
    schema: testSchema,
    existingData: [
      { id: '1', name: 'John Doe', email: 'john@example.com' },
      { id: '2', name: 'Jane Smith', email: 'jane@example.com' },
    ],
    onImportComplete: (summary) => {
      console.log('Import complete!', summary);
    },
  });

  return (
    <div style={{ padding: '20px', fontFamily: 'monospace' }}>
      <h1>useImportExport Manual Test</h1>

      <section style={{ marginTop: '20px' }}>
        <h2>State</h2>
        <pre>{JSON.stringify({
          step: importExport.step,
          hasFile: !!importExport.file,
          hasParsedData: !!importExport.parsedData,
          columnMappingKeys: Object.keys(importExport.columnMapping),
          parsedRowsCount: importExport.parsedRows.length,
          isProcessing: importExport.isProcessing,
          progress: importExport.progress,
          error: importExport.error,
        }, null, 2)}</pre>
      </section>

      <section style={{ marginTop: '20px' }}>
        <h2>Summary</h2>
        <pre>{JSON.stringify(importExport.summary, null, 2)}</pre>
      </section>

      <section style={{ marginTop: '20px' }}>
        <h2>Validation</h2>
        <pre>{JSON.stringify({
          hasValidationResult: !!importExport.validationResult,
          isValidating: importExport.isValidating,
          canProceed: importExport.canProceed,
        }, null, 2)}</pre>
      </section>

      <section style={{ marginTop: '20px' }}>
        <h2>Actions</h2>
        <button onClick={() => importExport.downloadTemplate()}>
          Download Template
        </button>
        {' '}
        <button onClick={() => importExport.nextStep()}>
          Next Step
        </button>
        {' '}
        <button onClick={() => importExport.prevStep()}>
          Previous Step
        </button>
        {' '}
        <button onClick={() => importExport.reset()}>
          Reset
        </button>
        {' '}
        <button onClick={() => importExport.setColumnMapping({ id: 'ID', name: 'Name', email: 'Email' })}>
          Set Mapping
        </button>
        {' '}
        <button onClick={() => importExport.executeImport()}>
          Execute Import
        </button>
      </section>

      <section style={{ marginTop: '20px' }}>
        <h2>Step Navigation Test</h2>
        <div>
          {(['select-file', 'map-columns', 'validate', 'confirm', 'processing', 'complete'] as const).map(step => (
            <button
              key={step}
              onClick={() => importExport.goToStep(step)}
              style={{
                marginRight: '5px',
                fontWeight: importExport.step === step ? 'bold' : 'normal',
                backgroundColor: importExport.step === step ? '#4CAF50' : '#ddd',
                color: importExport.step === step ? 'white' : 'black',
              }}
            >
              {step}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

// Test results checklist:
// ✅ Hook initializes with step='select-file'
// ✅ Summary starts with all zeros
// ✅ Can navigate between steps
// ✅ Can set column mapping
// ✅ Can download template
// ✅ Can execute import (simulated)
// ✅ Can reset state
// ✅ Validation state is exposed (null initially)
