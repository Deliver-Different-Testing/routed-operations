# BulkImport Wizard - Design Brief

Discovery pass 2026-07-22.
Redesign is presentation-only. Every current behaviour must survive.

---

## Part A. Inventory of the CURRENT BulkImport UI

Sources:
- `wwwroot/app/react/pages/BulkImport.tsx` (1197 lines, single component + one inline `EditRowModal`)
- `wwwroot/app/react/services/bulkImportService.ts` (222 lines, thin HTTP layer)
- `PARITY-TRACKING.md` sections "BulkImport pass 1" through "BulkImport pass 5" (lines 322-935)

Current layout: a top toolbar plus a 2x2 grid of four `<Panel>`s ("1. Upload", "2. Map columns", "3. Preview", "4. Result + existing sets"), then a footnote `<Card>` and two `<Modal>`s (history drill-in + inline edit). All four panels are visible simultaneously - operators can jump around freely, which is where the "cluttered" complaint comes from.

### A1. State variables (BulkImport.tsx:76-120)

| Variable | Where used | Note |
|---|---|---|
| `file`, `parsed` (line 76-77) | Panel 1 upload zone + Panel 2 mapping grid | `parsed` holds the server-parsed `{header, rows, delimiter, encoding, localeHint, warnings}` (63-70) |
| `mapping` (78) | Panel 2 mapping selects | `Record<sourceHeader, targetField|"__unmapped__">` |
| `importSetCode` (79) | Panel 1 text input + submit body | Auto-seeded from filename minus extension (190) |
| `submitting / validating / parsing` (80-82) | Button labels + disabled states | 3 separate spinners |
| `progress` (83) | Panel 2 progress bar + submit button label | `{done, total}` for chunked upload |
| `dateLocale` (84) | Panel 1 radio buttons + `readDate` in `mappedRows` memo (255) | `'nz' | 'us'`, seeded from server hint (193) |
| `validation` (85-87) | Panel 3 badges + preview row highlights + `downloadErrorsCsv` | `{valid, invalid, problems: Map<idx,string[]>, warnings: Map<idx,string[]>}` |
| `sets` (88) | Panel 4 list | `BulkImportSetSummary[]` from `getSets` |
| `submitResult` (89-91) | Panel 4 result banner | `{inserted, rejected, setCode}` |
| `systemError` (97-99) | Panel 4 persistent RED banner (870-901) | Pass-5 addition, `{error, hint, partialCount}` from a 500 response |
| `zeroZeroWarning` (104) | Panel 4 amber banner (902-919) | Pass-5 defence-in-depth for `0/0` outcome |
| `previewPage` (105) | Panel 3 pager | Client-side pagination, 50 rows per page (58) |
| `dragOver` (106) | Panel 1 drop-zone border colour | |
| `historyOpen` (107) | History modal `open` prop + polling scope | Set code drilled into, or `null` |
| `historyRows / historyLoading / historyPage / historyTotal` (108-111) | History modal grid + pager | Server-paged 50/page |
| `editingRow` (112) | Inline edit modal | `BulkImportStoredRow | null` |
| `promoteResult / promoting / promoteProgress` (113-117) | History modal footer badge + progress bar | Pass-4 async promote |
| `promotePollRef` (118) | `setInterval` handle for `/promote/status` poll (593) | Cleared on modal close + unmount (499, 517) |
| `abortRef` (120) | `AbortController` for preview + submit + unmount | |

### A2. Buttons and their handlers

Toolbar (635-647):
- `Download template` (anchor, `BULK_IMPORT_TEMPLATE_URL = /api/bulk-import/template.csv`, service.ts:125)
- `Refresh` -> `loadSets()`

Panel 1 - Upload (650-708):
- Text input `Import set code` (654-660)
- Drop zone `<div onDrop>` + hidden `<input type="file" accept=".csv,.xlsx,.xlsm">` (662-684)
- Radio pair `Date format: NZ / US` (694-706)

Panel 2 - Map (710-784):
- One `<select>` per source header (721-732)
- `Validate rows` -> `doValidate()` (742-750)
- `Download issues` -> `downloadErrorsCsv()` (751-759)
- `Import N row(s)` -> `doSubmit()` (760-768)
- `Cancel` (visible only while submitting) -> `cancelUpload()` (769-771)

Panel 3 - Preview (786-866):
- `Prev / Next` pager (852-861)
- Row-level `title` tooltip carries problems + warnings (827)
- No row-level action; edits happen from Panel 4 -> history modal

Panel 4 - Result + sets (868-957):
- Persistent RED banner with X (870-901)
- Amber `zeroZeroWarning` banner with X (902-919)
- Green/amber `submitResult` banner (920-926)
- Per-set `View` -> `openHistory(code)` (948-950)
- Per-set `Delete` -> `doDelete(code)` (951-953)

History modal (972-1081):
- `Promote to Live` -> `doPromote(code)` (1004-1010, `window.confirm` gate at 527)
- `Close` -> `closeHistory()` (1011)
- Per-row `Edit` (only for un-promoted rows) -> `setEditingRow(r)` (1053-1061)
- `Prev / Next` server-paginated (1069-1079)

Edit modal (1137-1197):
- 16 form fields, one per `BulkImportRow` key (1143-1160)
- `Cancel` (1169), `Save` -> `saveEdit(patch)` (1170)

### A3. Modals and when they open

| Modal | Open trigger | Component |
|---|---|---|
| History drill-in | Click `View` in Panel 4 list | Existing `<Modal>` (`components/common/Modal.tsx`) with 500-ish body height, contains 9-col row grid + pager (972-1081) |
| Inline edit | Click `Edit` on any un-promoted history row | Inline `EditRowModal` function component (1131-1197) wrapping the same `<Modal>` |
| `window.confirm` (2x) | `doDelete` (432), `doPromote` (527) | Browser native, blocking |

### A4. Backend endpoints (via `bulkImportService`)

| Method | URL | Purpose | Response shape (`.response`) |
|---|---|---|---|
| GET | `/api/bulk-import/sets` | List sets for Panel 4 (service.ts:128-129) | `BulkImportSetSummary[]` |
| GET | `/api/bulk-import/sets/{code}/rows?page&pageSize` | History drill-in (131-134) | `BulkImportRowPage` |
| GET | `/api/bulk-import/template.csv` | Anonymous template download (125) | CSV file |
| POST | `/api/bulk-import/parse` (multipart) | Server parse of .csv/.xlsx/.xlsm (203-221) | `BulkImportParseResult` |
| POST | `/api/bulk-import/preview` | Validate rows (136-141) | `BulkImportPreviewResult` |
| POST | `/api/bulk-import/submit` | Insert into `tblBulkImportJob` (143-148) | `BulkImportSubmitResult` |
| POST | `/api/bulk-import/{code}/promote?async=true` | Kick off background promote (159-170) | `{jobId, statusUrl, total, startedUtc}` |
| GET | `/api/bulk-import/{code}/promote/status` | Poll progress every 2 s (172-189) | `{active, total, completed, failed, done, result?, error?}` |
| POST | `/api/bulk-import/{code}/promote` | Sync promote (unused in UI after pass 3) (150-154) | `BulkImportPromotionResult` |
| PUT | `/api/bulk-import/rows/{rowId}` | Inline edit (191-195) | `BulkImportStoredRow` |
| DELETE | `/api/bulk-import/sets/{code}` | Soft-delete set (197-201) | `{importSetCode, deleted}` |

### A5. Feedback surfaces

- Toast provider (`useToast()`, 75). Fires on: parse warnings (199), parse error (202), validate result (327), submit result (398), delete success (435), promote result (597), edit save (621), abort notice (404), zero-row nag on validate (307), zero-row nag on submit (341), row-cap exceeded on submit (344).
- Persistent RED banner (`systemError`, 870-901) - 500 from submit with structured body.
- Persistent amber banner (`zeroZeroWarning`, 902-919) - `0 inserted && 0 rejected && rows submitted > 0`.
- Success/warning `submitResult` banner (920-926).
- Warning inline hint under mapping when required fields unmapped (736-741).
- Warning inline hint under Upload for parse warnings (689-691).
- Progress bar (submit chunk) (773-780).
- Progress bar (promote poll) (986-1002).
- Preview row highlights: `bg-error/5` for invalid, `bg-warning-bg/40` for warned (831); `title` attr carries the messages.
- History row highlights: `bg-error/5` for promote-failed, `bg-success-bg/40` for promoted (1043).
- Per-set summary line: `N rows, N flagged, N live, N pending, uploader, timestamp` (935-946).

### A6. Keyboard shortcuts

**None.** No `useHotkeys`, no `keydown` listener, no `Enter`-to-submit anywhere in `BulkImport.tsx`. Only browser-native affordances (Tab focus, Space/Enter on focused button).

### A7. Automatic behaviours

- Auto-map headers on parse (`autoMap`, 137-153). Two-pass: exact alias match, then `includes()`. Runs inside `handleFile` (188).
- Auto-derive `importSetCode` from filename if operator has not typed one (189-191).
- Auto-adopt server-detected date locale hint (`nz` / `us`) but let operator override (192-194).
- Auto-load sets on mount (`useEffect(() => { void loadSets(); }, [])`, 134) with a deliberately empty dep list to dodge a retry storm (comment 130-133).
- Auto-abort any in-flight preview/submit on component unmount (515-524).
- Auto-clear the promote-status poll on modal close (499-503) and on component unmount (515-524).
- Chunk-and-idempotency-key on submit >200 rows (338-425). Single shared GUID across chunks so server dedups the whole round (355-356).
- Client-side file-size gate 20 MB (165-171) - matches server `MaxUploadBytes`.
- Belt-and-braces zero-row warning after a 200 with `inserted=0 && rejected=0` (394-397).

---

## Part B. Reference wizard patterns

### B1. Configurator

**Two `StepWizard` implementations exist. Prefer the "common" one; it is the label-strip pattern the RoutedOperations import wants.**

**`components/common/StepWizard.tsx` (36 lines):**
Pure indicator strip. Props: `{ steps: string[]; current: number }`. Renders a flex row of equal-width segments; each shows a numbered circle + step label; segments switch to `brand-cyan` when active, `success green` with a `✓` when done. No Next/Back logic - the parent renders its own footer buttons. Used by `pages/np/CourierImport.tsx:146-149`, `pages/np/UserImport.tsx`, `pages/np/AddCourier.tsx`.

Prop shape and full render (StepWizard.tsx:1-35):
```tsx
interface Props { steps: string[]; current: number; }
// current is 1-based to match the numbered circles.
```

**`components/tenant/StepWizard.tsx` (76 lines):**
Fuller stepper: renders indicator + step content + Next/Back footer inside one component. Props: `{ steps: {label, content}[]; currentStep; onNext; onPrev; onSubmit; canProceed? }`. Used only in the tenant module. Slightly heavier because it owns the button strip; less flexible when a step wants its own custom footer (which BulkImport needs - "Validate" + "Download issues" + "Import" all sit in the mapping step, and "Promote" lives elsewhere entirely).

**Reference implementation for BulkImport: `pages/np/CourierImport.tsx` (290 lines).**
This is the exact pattern the user wants. 4-step Upload / AutoMap / Validate / Import. Each step is a plain `{step === N && (...)}` block. Footer buttons rendered per-step (Back on left, primary Continue on right). Loading indicators inline. Shared import components in `components/import/`:
- `FileUploadZone.tsx` (72 lines) - drop zone + click-to-browse + loading spinner + file-picked confirmation. Almost drop-in for BulkImport panel 1 with an extra `accept` prop for `.xlsm`.
- `ColumnMapper.tsx` (247 lines) - manual mapping grid.
- `AutoMateMapper.tsx` (256 lines) - AI-first mapping grid (unnecessary for BulkImport unless we later add AI).
- `ValidationResults.tsx` (155 lines) - error/warning row table with per-row select checkboxes.
- `ImportProgress.tsx` (131 lines) - progress bar + final result screen.

Visual style across Configurator wizards: horizontal step strip, numbered circles that flip to green `✓` when done, `brand-cyan` for active, `text-muted` for pending, pill-shaped `rounded-full` buttons in the footer.

### B2. SetUp Dashboard

Path: `C:\Gitlab\SetUpDashboard\setup-dashboard\SetupDashboard.Api\ClientApp\src\`.

Stack: React 19 + Vite + Tailwind + Zustand. **10-step wizard driven from `App.tsx:19-131` and `components/ProgressBar.tsx` (46 lines).**

Pattern: all 10 step components are rendered simultaneously but hidden with CSS class `.step-content` / `.step-content.active` (opacity + transform + `position: absolute` -> `position: relative`, see `index.css:23-26`). Progress bar is a horizontal filled line with 10 clickable emoji-circle steps sitting on top; `w-12 h-12` circles with `bg-cyan` for done, white with `border-cyan` and a `step-pulse` animation for current, white with grey border for pending.

Key props / conventions:
- `useStore(s => s.currentStep)` Zustand-backed.
- `completedSteps: Set<number>` for tick marks.
- Progress bar `setCurrentStep(i)` on click - free step jumping.
- Next button is `disabled` while `apiStatus[step] === 'saving'` or `stepValidationBlocked[step]`.
- Back button hidden on step 0, Next hidden on last step (App.tsx:110-119).

**Reusability: LOW.** SetUp Dashboard's UI stack (Zustand store, custom Tailwind theme with `cyan`/`navy`/`lgrey`, per-step async validation flags) does not line up with RoutedOperations' `useToast` + local `useState` + `brand-cyan` token names. Emoji step icons + shimmer/pulse animations would clash with RoutedOperations' flat cockpit aesthetic. Take conventions (numbered circles, `✓` on complete, step jumping is OK for completed steps), not code.

### B3. RoutedOperations React app itself

Search for `Stepper|Wizard|StepIndicator|Steps|WizardShell` under `wwwroot/app/react` returns **one hit and it is a false positive** - `components/cockpit/FixGpsModal.tsx` matches on the word "steps" in a comment, not a component name.

Existing modals were checked for hidden multi-step patterns:
- `RouteEditor` (inside `pages/ScheduledRoutes.tsx:186, 210`) - single-form panel, no steps.
- `BuildConfigModal`, `BuildAlertModal`, `BulkMoveDateModal`, `FixGpsModal`, `MergeRunModal`, `OptimizePreviewModal`, `SendSelectedModal`, `VoidRelationshipDialog` (all under `components/cockpit/`) - all single-panel modals.

**Verdict: RoutedOperations has NO existing wizard component. This is greenfield.**

Component library available today (`components/common/`):
- `Button.tsx` (89 lines) - 6 variants (primary, secondary, warning, neutral, ghost, danger) x 3 sizes. Cyan/purple/orange design tokens. Use `primary` for Next, `neutral` for Back, `secondary` for the final Import CTA, `warning` for Promote, `danger` for Delete.
- `Panel.tsx` (20 lines) - titled bordered container with cream header strip. Good as a wizard step body.
- `Card.tsx` (14 lines) - unadorned white bordered box. Good for callouts.
- `Modal.tsx` (37 lines) - centred modal with `max-w-lg` cap, click-outside close, X button, optional footer strip. Keep for history drill-in + edit row.
- `StatusBadge.tsx` (not read but present) - likely the small coloured pill used elsewhere.

Design tokens the wizard should reuse: `brand-cyan`, `brand-dark`, `success`, `warning`, `warning-bg`, `error`, `error-bg`, `border`, `border-light`, `surface-white`, `surface-cream`, `text-primary`, `text-secondary`, `text-muted`. All present in `BulkImport.tsx` already.

---

## Part C. Proposed step structure

Four steps. Enforces upload -> map -> preview/validate -> submit sequence but keeps the history/promote flow as a peer surface (not a "step 5") because it is a separate lifecycle: once a set exists on the server it can be revisited any time without going back through Upload.

### Step 1. Upload

Contents:
- Import set code text input (currently line 654-660)
- Drop zone + file picker (currently 662-684)
- Post-parse summary line "Loaded X - N cols, N rows, delimiter=..." (685-693)
- Date-locale radios (694-706)
- Parse warnings inline warning box (currently a toast on 199; promote to persistent inline hint here)

Local state: `dragOver`.
Persisted across steps: `file`, `parsed`, `importSetCode`, `dateLocale`.

Progression rule: `Next` enabled iff `parsed !== null` AND `importSetCode.trim() !== ''`. Back is n/a on step 1. A `Reset` ghost button lets the operator drop the current file.

### Step 2. Map columns

Contents:
- 2-column grid of `sourceHeader -> targetField` selects (currently 717-735)
- Required-fields warning box (currently 736-741)
- Optional: hint text "Auto-mapped N of M columns" derived from `autoMap` output (new, from data we already have)

Local state: none (mapping is persisted).
Persisted: `mapping`.

Progression rule: `Next` enabled iff `missingRequired.length === 0`. Back re-shows Step 1 with previous values intact.

### Step 3. Preview and validate

Contents:
- Validation summary row (currently 793-802: green N valid, red N invalid, amber N warned)
- `Validate rows` button (currently 742-750, but auto-run on step entry if not yet run)
- `Download issues` button (currently 751-759)
- Paginated preview grid + row highlights + tooltips (currently 804-862)
- Zero-row nag surfaces here instead of as toasts

Local state: `previewPage`.
Persisted: `validation`.

Progression rule: `Next` enabled iff `mappedRows.length > 0` (validation is optional but strongly encouraged - if the operator did not click Validate we run it automatically on entering the step, honouring `AbortController` on back-navigation). Back returns to Step 2, mapping preserved.

### Step 4. Submit and finish

Contents:
- Big `Import N row(s)` primary button + `Cancel` while submitting (currently 760-772)
- Submit progress bar (currently 773-780)
- `submitResult` banner (currently 920-926)
- Persistent RED `systemError` banner (currently 870-901)
- Amber `zeroZeroWarning` (currently 902-919)
- After a successful submit: short "Next steps" panel with a `View this set` CTA that opens the history modal for the just-created set code, plus a `Start another import` button that resets state and jumps back to Step 1.

Local state: none.
Persisted: `submitResult`, `systemError`, `zeroZeroWarning`, `progress`.

Progression rule: no Next (this is terminal). Back re-shows Step 3 IF `!submitResult && !submitting` (once you have submitted you cannot re-submit the same buffer; the operator should start a new import or view the set).

### Peer surface (not part of the linear flow): Import history

Renders as a permanent sidebar or as an "Import history" tab in the wizard shell header - always accessible, independent of the four-step forward flow. Contents:
- Per-set list from `sets` (currently panel 4 lines 927-956) with `View` + `Delete`
- Opens the existing history modal for drill-in, promote, and inline edit

Rationale: promote and delete apply to any set, past or present. Burying them behind "step 5" would force the operator to walk through Upload/Map/Preview just to promote a set they created yesterday.

### Cross-step behaviour

- Toolbar (currently 635-647) stays above the step strip - `Bulk Import` title, set count, `Download template` link, `Refresh` button.
- Step jumping: click a completed step's circle to jump back for review (same convention as CourierImport + SetUp Dashboard). Forward jump only via `Next` so validation gates hold.
- Reset link in the wizard header clears every persisted state var and returns to Step 1 (needed when an operator wants to redo an import mid-flow without a page refresh).
- Keyboard: `Enter` on the primary button of each step. Optional `Alt+ArrowLeft` / `Alt+ArrowRight` for Back/Next (new, if the coding agent has time).
- All abort/poll cleanup effects (515-524, 499-503) are unchanged - they hang off the outer component, not the step components.

---

## Part D. Component library recommendation

### D1. Copy-paste from Configurator, keep the pattern

- **`components/common/StepWizard.tsx`** (Configurator, 36 lines). Copy verbatim into `RoutedOperations/wwwroot/app/react/components/common/StepWizard.tsx`. Design tokens (`brand-cyan`, `success`, `border`, `text-muted`) already exist in RoutedOperations Tailwind config. Zero API changes needed. Referenced by `pages/np/CourierImport.tsx:146`.

- **`components/import/FileUploadZone.tsx`** (Configurator, 72 lines). Copy into `RoutedOperations/wwwroot/app/react/components/import/FileUploadZone.tsx`. One-line change: extend `accept` from `.xlsx,.xls,.csv` to `.xlsx,.xls,.csv,.xlsm` to match current BulkImport line 675. Otherwise drop-in.

- **`pages/np/CourierImport.tsx`** (Configurator, 290 lines). Use as a structural template - do not copy wholesale, since BulkImport's server contract, chunking, idempotency, and pass-5 error banners are all different. Copy the shell: `step` state, per-step `{step === N && (...)}` blocks, footer buttons per step, "Continue" primary + "Back" neutral.

### D2. Reuse in-place from RoutedOperations

- `components/common/Button.tsx` for every button. Map primary Next -> `variant="primary"`; Back -> `variant="neutral"`; final Import -> `variant="secondary"` (per existing 761); Promote -> `variant="secondary"` (per existing 1005); Delete -> `variant="danger"` (per existing 951); Cancel (in-flight) -> `variant="danger"` (per existing 770).
- `components/common/Panel.tsx` for the step body container - already the right visual weight (bordered white card + cream header strip).
- `components/common/Modal.tsx` for the History drill-in and Edit-row modals - keep unchanged. Both flows survive the wizard rewrite.
- `components/common/Card.tsx` for the footnote about `tblBulkImportJob` (currently 962-969) and for the persistent RED / amber banners (or just keep them inline as today).
- `useToast` unchanged for transient success/failure notifications. Keep as `warning`/`success`/`error`/`info` levels the rest of the app uses.
- `services/bulkImportService.ts` unchanged - no endpoints move.
- `services/api.ts` `ApiError` unchanged - pass-5 error banner logic in the new Step 4 uses `instanceof ApiError` identically.

### D3. Build fresh (small)

- **`components/import/WizardShell.tsx`** (new, approx. 60 lines). Wraps toolbar + `StepWizard` strip + step content + Next/Back footer. Props: `{ steps: {label, canProceed?: boolean, content: ReactNode}[], currentStep, onStep, onNext, onBack, onCancel? }`. Optional but recommended - if the coding agent prefers, keep the shell inline in `BulkImport.tsx` and only extract if a second wizard needs it later.
- **`components/import/StepFooter.tsx`** (new, approx. 30 lines). Fixed Back-left / primary-right button row with `disabled` + `busy` states. Or bake it into the per-step block, since Step 3 needs three buttons (Validate, Download issues, Continue) not the plain two.

### D4. Do not build

- Do **NOT** port `components/import/AutoMateMapper.tsx` from Configurator - it depends on an AI-mapping backend endpoint we do not have. Current auto-map is a client-side alias table (BulkImport.tsx:137-153) and stays that way.
- Do **NOT** port SetUp Dashboard's `ProgressBar.tsx` - emoji icons and pulse animation clash with the cockpit look. Take the "click completed step to jump back" convention only.
- Do **NOT** replace `window.confirm` in `doDelete` and `doPromote` with a custom modal - out of scope, keep them.

---

## Surprising finds

1. **Configurator has an off-the-shelf `StepWizard.tsx` we can copy in one paste** (`components/common/StepWizard.tsx`, 36 lines). Plus a fully-worked bulk-import wizard at `pages/np/CourierImport.tsx` that lays out the exact 4-step flow BulkImport wants. This is the highest-leverage find in the pass - most of the design work is already done.
2. **RoutedOperations React has zero wizard/stepper code today.** Nothing to build on; nothing to conflict with. Greenfield.
3. **SetUp Dashboard's 10-step wizard is beautiful but stack-mismatched** (Zustand + custom Tailwind theme + emoji icons). We take the conventions, leave the code.
4. **BulkImport has no keyboard shortcuts today.** Adding `Enter`-to-advance and `Alt+arrow` navigation would be a genuine UX win for a wizard, not a regression to worry about.
5. **The four current `<Panel>`s already number themselves "1. Upload", "2. Map columns", "3. Preview", "4. Result"**. The operator model is already a linear wizard; the layout just paints it as a grid. This lowers the risk of the redesign - we are not remodelling the mental flow, only the presentation.
6. **Pass-5 error surfaces (persistent RED + amber banners) are load-bearing** - do not swap them for toasts in the redesign. They exist precisely because toasts fade before the operator can screenshot the hint (see rationale at PARITY-TRACKING.md:876-905).
