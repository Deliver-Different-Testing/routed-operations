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
    expect(modelStateMessage(body)).toBe('From Contact is required. (3 rows)');
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
