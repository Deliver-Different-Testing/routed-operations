import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  mappedReferenceRows,
  referenceErrorLines,
  refusedRowsNotice,
  staffReferenceRows,
} from './referenceCheck';
import { RowErrorTable } from './RowErrorTable';
import { requiredFieldLines, requiredFieldProblems } from './wizardState';

// The preview only warns truthfully if it reads the columns the import reads. A
// header the check misses shows a row as refused that would in fact book.
describe('staffReferenceRows', () => {
  it.each(['ClientRefA', 'Client Ref A', 'Ref A', 'Reference A', 'REFERENCE A', 'ref a'])(
    'reads Ref A under the header %s',
    (header) => {
      expect(staffReferenceRows([{ ClientID: '5', [header]: 'PO1' }])[0].referenceA).toBe('PO1');
    }
  );

  it.each(['ClientRefB', 'Client Ref B', 'Ref B', 'Reference B', 'reference b'])(
    'reads Ref B under the header %s',
    (header) => {
      expect(staffReferenceRows([{ ClientID: '5', [header]: 'CC1' }])[0].referenceB).toBe('CC1');
    }
  );

  it('numbers rows from 1, the number the import reports back', () => {
    expect(staffReferenceRows([{ ClientID: '5' }, { ClientID: '6' }]).map((r) => r.rowNumber)).toEqual([1, 2]);
  });

  it('takes the first column with a value and trims it, as the server does', () => {
    const [row] = staffReferenceRows([{ ClientID: '5', ClientRefA: '  ', 'Ref A': ' PO1 ' }]);
    expect(row.referenceA).toBe('PO1');
  });

  it('sends a blank reference as empty, not as a missing field', () => {
    expect(staffReferenceRows([{ ClientID: '5' }])[0]).toMatchObject({ clientId: 5, referenceA: '', referenceB: '' });
  });

  it('sends the code when the row names its client by code', () => {
    expect(staffReferenceRows([{ clientcode: 'UCLKT' }])[0]).toMatchObject({ clientId: null, clientCode: 'UCLKT' });
    expect(staffReferenceRows([{ ClientID: 'abc', ClientCode: 'UCLKT' }])[0].clientId).toBeNull();
  });

  it('copes with numeric cells from the upload', () => {
    const row = { ClientID: 5, 'Ref A': 1234 } as unknown as Record<string, string>;
    expect(staffReferenceRows([row])[0]).toMatchObject({ clientId: 5, referenceA: '1234' });
  });
});

describe('mappedReferenceRows', () => {
  it('reads through the mapping, keeps the cell as the import sends it, and sends blank when unmapped', () => {
    const rows = mappedReferenceRows([{ PO: 'A1  ' }, { PO: '' }], { clientRefA: 'PO' }, 9);
    expect(rows).toEqual([
      { rowNumber: 1, clientId: 9, referenceA: 'A1  ', referenceB: '' },
      { rowNumber: 2, clientId: 9, referenceA: '', referenceB: '' },
    ]);
  });
});

describe('refusedRowsNotice', () => {
  it('says how many are refused and how many still import', () => {
    expect(refusedRowsNotice(1, 3)).toBe('1 row will be refused. The other 2 will import.');
    expect(refusedRowsNotice(2, 3)).toBe('2 rows will be refused. The other 1 will import.');
  });

  it('says nothing can import when every row is refused', () => {
    expect(refusedRowsNotice(3, 3)).toMatch(/^Every row would be refused/);
  });
});

describe('referenceErrorLines', () => {
  const errors = [1, 2, 3].map((n) => ({ rowNumber: n, error: `"Reference A" - "X${n}" not in defined list.` }));

  it('names the record and carries the proc wording', () => {
    expect(referenceErrorLines(errors.slice(0, 1))).toEqual(['Record 1: "Reference A" - "X1" not in defined list.']);
  });

  it('says how many more it did not list', () => {
    expect(referenceErrorLines(errors, 2).slice(-1)).toEqual(['...and 1 more.']);
  });
});

describe('requiredFieldLines', () => {
  const refA = { key: 'clientRefA', label: 'Ref A (cat)', required: true };

  it('names the field and the first blank record, not "please map", when the column is mapped', () => {
    const rows = [{ PO: '1' }, { PO: '2' }, { PO: '3' }, { PO: '  ' }, { PO: '' }];
    const lines = requiredFieldLines(requiredFieldProblems([refA], { clientRefA: 'PO' }, rows));
    expect(lines).toEqual(['Ref A (cat) is required: record 4 is blank']);
  });

  it('still asks to map a column that is not mapped', () => {
    const lines = requiredFieldLines(requiredFieldProblems([refA], {}, [{ PO: '1' }]));
    expect(lines).toEqual(['Please map required column(s): Ref A (cat).']);
  });

  it('gives each field its own first blank record', () => {
    const fields = [refA, { key: 'toAddress', label: 'To Address', required: true }];
    const rows = [{ PO: '', Addr: 'x' }, { PO: '1', Addr: '' }];
    const lines = requiredFieldLines(requiredFieldProblems(fields, { clientRefA: 'PO', toAddress: 'Addr' }, rows));
    expect(lines).toEqual(['Ref A (cat) is required: record 1 is blank', 'To Address is required: record 2 is blank']);
  });

  it('has nothing to say about an optional field or a filled column', () => {
    const fields = [{ key: 'notes', label: 'Notes' }, refA];
    expect(requiredFieldLines(requiredFieldProblems(fields, { clientRefA: 'PO' }, [{ PO: '1' }]))).toEqual([]);
  });
});

describe('RowErrorTable', () => {
  it('shows the row, the job number, a dash for none, and keeps a two-line reason on two lines', () => {
    const reason = 'Require "Reference A" - "cat"\r\n"Reference B" - "X" not in defined list.';
    render(
      <RowErrorTable
        rows={[
          { rowNumber: 3, jobNumber: 'REFCHK1', error: reason },
          { rowNumber: 4, jobNumber: null, error: 'Client not found.' },
        ]}
      />
    );
    const cell = screen.getByText(/Require "Reference A"/);
    expect(cell).toHaveClass('whitespace-pre-line');
    expect(cell.textContent).toBe(reason);
    expect(screen.getByText('REFCHK1')).toBeInTheDocument();
    expect(screen.getByText('-')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });
});
