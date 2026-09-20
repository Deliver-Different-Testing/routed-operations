# Import/Export Hooks

React hooks for the Universal Import/Export System.

## useValidation

A hook that wraps the ValidationEngine to provide validation functionality for import data.

### Features

- **Async validation** with loading state
- **Auto-fix capabilities** (trim whitespace, normalize booleans, format dates)
- **Error/warning tracking** with severity levels
- **Computed helpers** (hasErrors, hasWarnings, canProceed)
- **onComplete callback** for side effects
- **Reset functionality** to clear validation state

### Basic Usage

```tsx
import { useValidation } from '@/features/import-export/hooks';
import { userSchema } from '@/features/import-export/schemas';

function ImportValidator() {
  const { result, isValidating, validate, hasErrors, canProceed } = useValidation({
    autoFix: true,
    strictMode: false,
  });

  const handleValidate = (rows: Record<string, unknown>[]) => {
    validate(rows, userSchema);
  };

  return (
    <div>
      {isValidating && <Spinner />}
      {hasErrors && <ErrorList errors={result.errors} />}
      <Button onClick={handleValidate} disabled={isValidating}>
        Validate
      </Button>
      <Button disabled={!canProceed}>Proceed to Import</Button>
    </div>
  );
}
```

### API

#### Options

```typescript
interface UseValidationOptions {
  autoFix?: boolean;        // Default: true - Auto-fix minor issues
  strictMode?: boolean;     // Default: false - Treat warnings as errors
  onComplete?: (result: ValidationResult) => void;  // Callback after validation
}
```

#### Return Value

```typescript
interface UseValidationReturn {
  // State
  result: ValidationResult | null;  // Full validation result
  isValidating: boolean;            // Loading state

  // Actions
  validate: (rows: Record<string, unknown>[], schema: ImportSchema) => void;
  reset: () => void;                // Clear validation state

  // Computed
  hasErrors: boolean;               // True if errors exist
  hasWarnings: boolean;             // True if warnings exist
  canProceed: boolean;              // True if no errors (warnings OK)
}
```

### Advanced Usage

#### With onComplete Callback

```tsx
const { validate } = useValidation({
  autoFix: true,
  onComplete: (result) => {
    if (result.isValid) {
      toast.success(`Validation passed! ${result.autoFixed} fields auto-fixed.`);
    } else {
      toast.error(`Validation failed: ${result.errors.length} errors found.`);
    }
  },
});
```

#### With Strict Mode

```tsx
// Treat all warnings as errors
const { validate, hasErrors } = useValidation({
  strictMode: true,
});
```

#### Manual Reset

```tsx
const { result, reset } = useValidation();

// Clear validation state when user modifies data
const handleDataChange = () => {
  reset();
};
```

### ValidationResult Structure

```typescript
interface ValidationResult {
  isValid: boolean;           // True if no errors
  errors: FieldError[];       // Critical errors that block import
  warnings: FieldError[];     // Non-critical warnings
  infos: FieldError[];        // Informational messages
  autoFixed: number;          // Count of auto-fixed fields
  unfixable: number;          // Count of rows with unfixable errors
}

interface FieldError {
  row: number;                // Row number (1-indexed, header = row 1)
  column: string;             // Column key
  value: unknown;             // Actual value
  message: string;            // Human-readable error message
  severity: 'error' | 'warning' | 'info';
  suggestedFix?: unknown;     // Optional suggested fix value
}
```

### Error Handling

The hook gracefully handles validation errors:

```tsx
const { result } = useValidation();

// If validateAll() throws an exception, result will contain:
{
  isValid: false,
  errors: [{
    row: 0,
    column: '',
    value: null,
    message: 'Validation failed',
    severity: 'error',
  }],
  warnings: [],
  infos: [],
  autoFixed: 0,
  unfixable: 1,
}
```

### Performance Considerations

- Validation runs **asynchronously** using `setTimeout(0)` to avoid blocking the UI
- The `isValidating` flag updates immediately when validation starts
- Large datasets may take time to validate - show loading state to users

### Best Practices

1. **Always show loading state**: Display a spinner or disable UI during validation
2. **Use canProceed for import buttons**: Disable import if `!canProceed`
3. **Display error counts**: Show error/warning counts in the UI
4. **Provide feedback**: Use the `onComplete` callback for toast notifications
5. **Reset on data change**: Call `reset()` when user modifies the data

### Example: Full Validation Flow

```tsx
function ImportFlow() {
  const {
    result,
    isValidating,
    validate,
    reset,
    hasErrors,
    canProceed
  } = useValidation({
    autoFix: true,
    onComplete: (result) => {
      if (result.autoFixed > 0) {
        toast.info(`Auto-fixed ${result.autoFixed} field(s)`);
      }
    },
  });

  const [rows, setRows] = useState<Record<string, unknown>[]>([]);

  const handleFileUpload = (uploadedRows: Record<string, unknown>[]) => {
    setRows(uploadedRows);
    validate(uploadedRows, userSchema);
  };

  const handleProceed = () => {
    if (canProceed) {
      // Proceed with import
      importData(rows);
    }
  };

  return (
    <div>
      <FileUploader onUpload={handleFileUpload} />

      {isValidating && <Spinner />}

      {result && (
        <ValidationSummary
          errors={result.errors}
          warnings={result.warnings}
          autoFixed={result.autoFixed}
        />
      )}

      <Button
        onClick={handleProceed}
        disabled={!canProceed || isValidating}
      >
        Import {rows.length} Rows
      </Button>
    </div>
  );
}
```

## useImportExport

Main orchestration hook that combines CSV parsing, validation, and import flow management.

### Features

- **Auto-step transitions** - Automatically moves between import steps
- **Integrated parsing & validation** - Uses useCSVParser and useValidation internally
- **Diff calculation** - Compares import data against existing records
- **Progress tracking** - Simulates import progress (0-100%)
- **Download helpers** - Export data and generate templates
- **Summary statistics** - Tracks new, modified, unchanged, error, and deleted rows

### Basic Usage

```tsx
import { useImportExport } from '@/features/import-export/hooks';
import { clientsSchema } from '@/features/import-export/schemas';

function ImportWizard() {
  const importExport = useImportExport({
    schema: clientsSchema,
    existingData: existingClients,
    onImportComplete: (summary) => {
      toast.success(`Import complete! ${summary.new} new, ${summary.modified} modified`);
    },
  });

  return (
    <div>
      <p>Step: {importExport.step}</p>
      <p>Total: {importExport.summary.total}</p>

      {importExport.step === 'select-file' && (
        <input
          type="file"
          onChange={(e) => importExport.setFile(e.target.files?.[0] || null)}
        />
      )}

      {importExport.step === 'confirm' && (
        <button onClick={importExport.executeImport}>
          Import Now
        </button>
      )}
    </div>
  );
}
```

### API

#### Options

```typescript
interface UseImportExportOptions {
  schema: ImportSchema;              // Required: Import schema definition
  existingData?: Record<string, unknown>[];  // Optional: For diff calculation
  onImportComplete?: (result: ImportSummary) => void;  // Callback after import
}
```

#### Return Value

```typescript
interface UseImportExportReturn {
  // State
  step: ImportStep;                   // 'select-file' | 'map-columns' | 'validate' | 'confirm' | 'processing' | 'complete'
  file: File | null;
  parsedData: { headers: string[]; rows: Record<string, string>[] } | null;
  columnMapping: Record<string, string>;  // CSV column → Schema column
  parsedRows: ParsedRow[];            // Validated rows with status and diffs
  summary: ImportSummary;             // Counts by status
  isProcessing: boolean;
  progress: number;                   // 0-100
  error: string | null;

  // From child hooks
  validationResult: ValidationResult | null;
  isValidating: boolean;
  canProceed: boolean;                // True if no validation errors

  // Actions
  setFile: (file: File | null) => void;
  setColumnMapping: (mapping: Record<string, string>) => void;
  goToStep: (step: ImportStep) => void;
  nextStep: () => void;
  prevStep: () => void;
  downloadData: (data: Record<string, unknown>[]) => void;
  downloadTemplate: () => void;
  executeImport: () => Promise<void>;
  reset: () => void;
}
```

### Import Flow Steps

1. **select-file** - User selects CSV file
   - Auto-transitions to `map-columns` when file parses successfully
2. **map-columns** - Map CSV columns to schema columns
   - User manually calls `nextStep()` when mapping is complete
3. **validate** - Validate mapped data
   - Validation runs automatically on step entry
   - Builds `parsedRows` with status and diffs
4. **confirm** - Review changes before import
   - Show summary, diffs, errors/warnings
   - User calls `executeImport()` to proceed
5. **processing** - Import in progress
   - Shows `progress` (0-100)
6. **complete** - Import finished
   - `onImportComplete` callback fires
   - Show final summary

### Advanced Usage

#### Full Import Wizard

```tsx
function ImportWizard() {
  const importExport = useImportExport({
    schema: servicesSchema,
    existingData: services,
  });

  if (importExport.step === 'select-file') {
    return (
      <FileUpload
        onFile={importExport.setFile}
        onDownloadTemplate={importExport.downloadTemplate}
      />
    );
  }

  if (importExport.step === 'map-columns') {
    return (
      <ColumnMapper
        csvHeaders={importExport.parsedData?.headers || []}
        schemaColumns={servicesSchema.columns}
        mapping={importExport.columnMapping}
        onMappingChange={importExport.setColumnMapping}
        onNext={importExport.nextStep}
        onBack={importExport.prevStep}
      />
    );
  }

  if (importExport.step === 'validate') {
    return (
      <ValidationView
        result={importExport.validationResult}
        isValidating={importExport.isValidating}
        onNext={importExport.nextStep}
        canProceed={importExport.canProceed}
      />
    );
  }

  if (importExport.step === 'confirm') {
    return (
      <ConfirmImport
        summary={importExport.summary}
        parsedRows={importExport.parsedRows}
        onConfirm={importExport.executeImport}
        onCancel={importExport.reset}
      />
    );
  }

  if (importExport.step === 'processing') {
    return <Progress value={importExport.progress} />;
  }

  if (importExport.step === 'complete') {
    return (
      <ImportComplete
        summary={importExport.summary}
        onReset={importExport.reset}
      />
    );
  }

  return null;
}
```

#### Export Only (No Import)

```tsx
function ExportButton({ data }: { data: Record<string, unknown>[] }) {
  const { downloadData } = useImportExport({ schema: mySchema });

  return (
    <button onClick={() => downloadData(data)}>
      Export to CSV
    </button>
  );
}
```

#### Template Download

```tsx
function TemplateButton() {
  const { downloadTemplate } = useImportExport({ schema: mySchema });

  return (
    <button onClick={downloadTemplate}>
      Download Import Template
    </button>
  );
}
```

### Data Structures

#### ImportSummary

```typescript
interface ImportSummary {
  total: number;      // Total rows
  new: number;        // New records (no match in existingData)
  modified: number;   // Modified records (match found, fields differ)
  unchanged: number;  // Unchanged records (match found, no changes)
  errors: number;     // Rows with validation errors
  deleted: number;    // Rows marked with _DELETE flag
}
```

#### ParsedRow

```typescript
interface ParsedRow {
  rowNumber: number;
  status: 'new' | 'modified' | 'unchanged' | 'error' | 'delete';
  data: Record<string, unknown>;
  validationResult: RowValidationResult;
  existingRecord?: Record<string, unknown>;
  diff?: FieldDiff[];
}
```

### Implementation Details

#### Auto-Transitions

- **select-file → map-columns**: Triggered automatically when file parses successfully
- **map-columns → validate**: Manual via `nextStep()`
- **validate → confirm**: Manual via `nextStep()` (blocked if `!canProceed`)
- **confirm → processing**: Via `executeImport()`
- **processing → complete**: Automatic when import finishes

#### Validation Trigger

When transitioning to the `validate` step, the hook:
1. Maps CSV rows using `columnMapping`
2. Calls `validation.validate(mappedRows, schema)`
3. Waits for validation to complete

#### Diff Calculation

After validation completes:
1. Uses `diffAll()` to compare mapped rows against `existingData`
2. Builds `ParsedRow[]` with status and diffs
3. Calculates summary statistics

#### Import Execution

Currently simulates import with progress (0-100%). Replace `executeImport` logic with your actual API call:

```tsx
const executeImport = useCallback(async () => {
  setIsProcessing(true);
  setStep('processing');

  try {
    // Replace this with your API call
    for (let i = 0; i <= 100; i += 10) {
      await new Promise(r => setTimeout(r, 100));
      setProgress(i);
    }

    setStep('complete');
    onImportComplete?.(summary);
  } catch (err) {
    setError(err.message);
    setStep('confirm');
  } finally {
    setIsProcessing(false);
  }
}, [summary, onImportComplete]);
```

### Best Practices

1. **Always provide existingData**: For diff calculation and status determination
2. **Show step indicators**: Let users know where they are in the flow
3. **Block navigation on errors**: Don't allow `nextStep()` if `!canProceed`
4. **Show summary before import**: Display counts in the confirm step
5. **Handle errors gracefully**: Show `error` in the UI
6. **Provide escape hatches**: Allow `reset()` to start over

### Testing

See `useImportExport.manual-test.tsx` for a manual testing component.

**Expected behavior:**
- ✅ Initializes with `step='select-file'`
- ✅ Summary starts with all zeros
- ✅ File parsing auto-transitions to map-columns
- ✅ Can set column mapping
- ✅ Validation triggers on validate step
- ✅ Can download template
- ✅ Can execute import (simulated)
- ✅ Can reset state

## See Also

- [ValidationEngine](../engine/ValidationEngine.ts) - Core validation logic
- [useCSVParser](./useCSVParser.ts) - Hook for parsing CSV files
- [useValidation](./useValidation.ts) - Hook for validating data
- [DiffEngine](../engine/DiffEngine.ts) - Diff calculation logic
- [Validation Types](../types/validation.types.ts) - Type definitions
- [Import Types](../types/import.types.ts) - Import type definitions
