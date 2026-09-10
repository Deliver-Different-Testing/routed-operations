# useImportExport Flow Diagram

## Step Flow

```
┌─────────────────┐
│  select-file    │  User selects CSV file
└────────┬────────┘
         │ setFile(file) → csvParser.parseFile()
         │ [AUTO-TRANSITION on parse success]
         ▼
┌─────────────────┐
│  map-columns    │  Map CSV headers to schema columns
└────────┬────────┘
         │ setColumnMapping({ csv: schema })
         │ nextStep() [MANUAL]
         ▼
┌─────────────────┐
│    validate     │  Validate mapped data
└────────┬────────┘
         │ validation.validate() [AUTO on step entry]
         │ Builds parsedRows with status/diffs
         │ nextStep() [MANUAL - blocked if !canProceed]
         ▼
┌─────────────────┐
│    confirm      │  Review changes before import
└────────┬────────┘
         │ User reviews summary/diffs
         │ executeImport() [MANUAL]
         ▼
┌─────────────────┐
│   processing    │  Import in progress
└────────┬────────┘
         │ Shows progress (0-100%)
         │ [AUTO-TRANSITION on completion]
         ▼
┌─────────────────┐
│    complete     │  Import finished
└─────────────────┘
         │ Shows final summary
         │ reset() to start over
```

## Data Flow

```
┌──────────────────────────────────────────────────────────────┐
│                    useImportExport                           │
│                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │              │    │              │    │              │  │
│  │ useCSVParser │───▶│ useValidation│───▶│  parsedRows  │  │
│  │              │    │              │    │  + summary   │  │
│  └──────────────┘    └──────────────┘    └──────────────┘  │
│         │                   │                    ▲          │
│         │                   │                    │          │
│         ▼                   ▼                    │          │
│    parsedData         validationResult           │          │
│    (headers/rows)     (errors/warnings)          │          │
│                                                  │          │
│                     ┌──────────────┐             │          │
│                     │   diffAll()  │─────────────┘          │
│                     └──────────────┘                        │
│                            ▲                                │
│                            │                                │
│                      existingData                           │
│                      columnMapping                          │
└──────────────────────────────────────────────────────────────┘
```

## Component Integration

```
┌────────────────────────────────────────────────────────────┐
│                   ImportWizard                             │
│                                                            │
│  const importExport = useImportExport({ schema, data })   │
│                                                            │
│  switch (importExport.step) {                             │
│                                                            │
│    case 'select-file':                                    │
│      return <FileUpload                                   │
│                onFile={importExport.setFile}              │
│                onDownloadTemplate={...} />                │
│                                                            │
│    case 'map-columns':                                    │
│      return <ColumnMapper                                 │
│                mapping={importExport.columnMapping}       │
│                onMappingChange={...}                      │
│                onNext={importExport.nextStep} />          │
│                                                            │
│    case 'validate':                                       │
│      return <ValidationView                               │
│                result={importExport.validationResult}     │
│                canProceed={importExport.canProceed}       │
│                onNext={importExport.nextStep} />          │
│                                                            │
│    case 'confirm':                                        │
│      return <ConfirmImport                                │
│                summary={importExport.summary}             │
│                parsedRows={importExport.parsedRows}       │
│                onConfirm={importExport.executeImport} />  │
│                                                            │
│    case 'processing':                                     │
│      return <Progress value={importExport.progress} />    │
│                                                            │
│    case 'complete':                                       │
│      return <ImportComplete                               │
│                summary={importExport.summary}             │
│                onReset={importExport.reset} />            │
│  }                                                         │
└────────────────────────────────────────────────────────────┘
```

## State Management

```
┌─────────────────────────────────────────────────────────┐
│                    Internal State                       │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  step: ImportStep                                       │
│    └─ Current step in flow                             │
│                                                         │
│  file: File | null                                      │
│    └─ Selected CSV file                                │
│                                                         │
│  columnMapping: Record<string, string>                  │
│    └─ { schemaKey: csvHeader }                         │
│                                                         │
│  parsedRows: ParsedRow[]                                │
│    └─ Validated rows with status/diffs                 │
│    └─ Computed via useEffect from validation result    │
│                                                         │
│  isProcessing: boolean                                  │
│    └─ True during executeImport()                      │
│                                                         │
│  progress: number (0-100)                               │
│    └─ Import progress percentage                       │
│                                                         │
│  error: string | null                                   │
│    └─ Aggregated from csvParser.error + local errors   │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                   Child Hook State                      │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  csvParser:                                             │
│    • result: { headers, rows }                         │
│    • isLoading: boolean                                │
│    • error: string | null                              │
│                                                         │
│  validation:                                            │
│    • result: ValidationResult | null                   │
│    • isValidating: boolean                             │
│    • canProceed: boolean                               │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Action Flow

```
User Action                Hook Method              Effect
───────────────────────────────────────────────────────────
Select file          →     setFile(file)      →    Parse CSV
                                               →    Auto-transition to map-columns

Map columns          →     setColumnMapping() →    Store mapping

Next (map→validate)  →     nextStep()         →    Trigger validation
                                               →    Build parsedRows

Next (validate→conf) →     nextStep()         →    Move to confirm
                           (blocked if errors)

Confirm import       →     executeImport()    →    Start import
                                               →    Show progress
                                               →    Auto-transition to complete

Download template    →     downloadTemplate() →    Generate & download CSV

Download data        →     downloadData(data) →    Generate & download CSV

Reset                →     reset()            →    Clear all state
                                               →    Go to select-file

Go to step           →     goToStep(step)     →    Jump directly to step
```

## Summary Calculation

```
parsedRows           ParsedRow[]
    │
    │ useMemo(() => {
    │   return {
    │     total: parsedRows.length,
    │     new: count(status === 'new'),
    │     modified: count(status === 'modified'),
    │     unchanged: count(status === 'unchanged'),
    │     errors: count(status === 'error'),
    │     deleted: count(status === 'delete'),
    │   }
    │ }, [parsedRows])
    │
    ▼
  summary            ImportSummary
    │
    └─▶ Used in UI to show counts
```

## Diff Calculation Flow

```
csvParser.result.rows         columnMapping              existingData
        │                           │                           │
        │                           │                           │
        ▼                           ▼                           │
  CSV Row Data              Map to Schema                       │
        │                           │                           │
        └───────────┬───────────────┘                           │
                    ▼                                           │
              mappedRows                                        │
                    │                                           │
                    └───────────────┬───────────────────────────┘
                                    ▼
                            diffAll(mappedRows, existingData, schema)
                                    │
                                    ▼
                            DiffResult per row
                                    │
                          ┌─────────┴─────────┐
                          ▼                   ▼
                      status              diffs[]
                  (new/modified/          (field changes)
                   unchanged)
                          │                   │
                          └─────────┬─────────┘
                                    ▼
                            Build ParsedRow
                                    │
                                    └─▶ parsedRows[]
```

## Error Handling

```
┌──────────────────────────────────────────────┐
│              Error Sources                   │
├──────────────────────────────────────────────┤
│                                              │
│  1. CSV Parse Error                          │
│     csvParser.error → aggregated to hook     │
│                                              │
│  2. Validation Errors                        │
│     validation.result.errors → blocking      │
│                                              │
│  3. Import Execution Error                   │
│     try/catch in executeImport()             │
│     → setError() and return to 'confirm'     │
│                                              │
│  4. File Reading Error                       │
│     csvParser.parseFile() catches            │
│                                              │
└──────────────────────────────────────────────┘

All errors exposed via:
  - importExport.error (string | null)
  - importExport.validationResult.errors
```
