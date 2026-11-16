import { describe, expect, it } from 'vitest';
import { modelStateMessage } from './api';

// A model-state 400 from ASP.NET Core arrives as ValidationProblemDetails,
// which carries none of the fields `request` previously looked at, so the
// operator saw "HTTP 400 at /api/bulk-import/import" and had no idea which
// column was unmapped. Observed on Urgent staging 2026-10-29 importing 23
// WOOP rows with From Contact unmapped.
describe('modelStateMessage', () => {
  it('collapses one message repeated per row into a single line with a count', () => {
    const body = {
      errors: {
        'jobs[0].FromContact': ['From Contact is required.'],
        'jobs[1].FromContact': ['From Contact is required.'],
        'jobs[2].FromContact': ['From Contact is required.'],
      },
    };
    expect(modelStateMessage(body)).toBe('From Contact is required. (rows 1, 2, 3)');
  });

  // The operator fixes the sheet, so name the rows. jobs[n] is the n-th job
  // in the request, which is sheet record n+1 on a one-depot import.
  it('names the row a per-job message came from, counting from 1', () => {
    const body = { errors: { 'Jobs[3].ToContact': ["'To Contact' must not be empty."] } };
    expect(modelStateMessage(body)).toBe("'To Contact' must not be empty. (row 4)");
  });

  it('lists at most ten rows and says how many more', () => {
    const errors: Record<string, string[]> = {};
    for (let i = 0; i < 13; i++) errors[`jobs[${i}].Quantity`] = ['Quantity must be a whole number from 1 to 32767.'];
    expect(modelStateMessage({ errors })).toBe(
      'Quantity must be a whole number from 1 to 32767. (rows 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 +3 more)'
    );
  });

  it('keeps a plain count for a repeated message that is not tied to a row', () => {
    const body = { errors: { A: ['Same problem.'], B: ['Same problem.'] } };
    expect(modelStateMessage(body)).toBe('Same problem. (2 rows)');
  });

  it('does not add a count for a single occurrence', () => {
    expect(modelStateMessage({ errors: { ClientId: ['Client is required.'] } }))
      .toBe('Client is required.');
  });

  it('names two distinct problems and counts the rest', () => {
    const body = {
      errors: {
        'jobs[0].FromContact': ['From Contact is required.'],
        'jobs[0].ToAddress': ['To Address is required.'],
        'jobs[0].ToPostCode': ['Post Code is required.'],
        'jobs[0].Quantity': ['Quantity is required.'],
      },
    };
    const msg = modelStateMessage(body)!;
    expect(msg).toContain('From Contact is required.');
    expect(msg).toContain('To Address is required.');
    expect(msg).toContain('...and 2 more');
  });

  it('accepts a bare string value as well as an array', () => {
    expect(modelStateMessage({ errors: { Field: 'Single string problem.' } }))
      .toBe('Single string problem.');
  });

  it('returns undefined for bodies that are not model-state failures', () => {
    expect(modelStateMessage(undefined)).toBeUndefined();
    expect(modelStateMessage(null)).toBeUndefined();
    expect(modelStateMessage({})).toBeUndefined();
    expect(modelStateMessage({ errors: [] })).toBeUndefined();
    expect(modelStateMessage({ errors: {} })).toBeUndefined();
    expect(modelStateMessage({ errors: { Field: [''] } })).toBeUndefined();
    expect(modelStateMessage({ message: 'plain' })).toBeUndefined();
  });
});
