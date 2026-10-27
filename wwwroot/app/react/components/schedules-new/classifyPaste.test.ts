import { describe, expect, it } from 'vitest';
import { classifyPaste } from './PostcodeLookupInput';

/**
 * Sorting a pasted blob of postcodes into what was bound, what was already
 * there, and what needs a decision.
 *
 * Ruth's Cheetah file is 602 ZIPs, 118 of which Dane flagged as unusable
 * (116 "DOS NOT ON FILE", two with no territory, one with no day). So the
 * three buckets are the feature, not a nicety: "97 added" hides the handful
 * the operator actually has to act on.
 *
 * The one that has to stay conservative is `unknown`. A code in no zone can
 * never be offered, because the availability function resolves the depot from
 * the code's zone and returns early when it finds none. Binding it anyway
 * would leave a schedule that looks configured and serves nothing, which is
 * the same silent shape as the bug this whole spec exists to fix.
 */
const US = 5;
const NZ = 4;
const known = (...zips: number[]) => new Set(zips);

describe('classifyPaste', () => {
  it('binds the codes that are known and not already bound', () => {
    const r = classifyPaste('64030, 65201', [], known(64030, 65201), US);
    expect(r.added).toEqual([64030, 65201]);
    expect(r.unknown).toEqual([]);
  });

  it('splits on commas, spaces, semicolons and new lines', () => {
    const r = classifyPaste('64030, 65201 63501;64429\n64430', [], known(64030, 65201, 63501, 64429, 64430), US);
    expect(r.added).toEqual([64030, 65201, 63501, 64429, 64430]);
  });

  it('drops duplicates inside the paste', () => {
    const r = classifyPaste('64030 64030, 64030', [], known(64030), US);
    expect(r.added).toEqual([64030]);
  });

  it('reports what was already bound instead of adding it again', () => {
    const r = classifyPaste('64030, 65201', [64030], known(64030, 65201), US);
    expect(r.added).toEqual([65201]);
    expect(r.alreadyBound).toEqual([64030]);
  });

  it('does NOT bind a code that is in no zone', () => {
    // The decision this test exists for. A ZIP in no zone resolves to no
    // depot, and the depot rule runs before any coverage test, so a schedule
    // bound to it would serve nothing and look configured.
    const r = classifyPaste('64030, 99999', [], known(64030), US);
    expect(r.added).toEqual([64030]);
    expect(r.unknown).toEqual([99999]);
  });

  it('shows a short entry as the padded code it was read as', () => {
    // "7030" is 07030, not 70300. The reading is a guess, so it is surfaced.
    const r = classifyPaste('7030', [], known(7030), US);
    expect(r.added).toEqual([7030]);
    expect(r.padded).toEqual([7030]);
  });

  it('does not call a full-length entry padded', () => {
    const r = classifyPaste('64030', [], known(64030), US);
    expect(r.padded).toEqual([]);
  });

  it('returns what it could not read verbatim', () => {
    const r = classifyPaste('64030, DOS NOT ON FILE, --', [], known(64030), US);
    expect(r.added).toEqual([64030]);
    // Verbatim, because a count does not tell the operator what to fix.
    expect(r.ignored).toContain('DOS');
    expect(r.ignored).toContain('--');
  });

  it('accepts everything as typed when the lookup did not load', () => {
    // Matching the single-entry Add button: a failed lookup turns validation
    // off rather than calling every code unknown and blocking all work.
    const r = classifyPaste('64030, 99999', [], undefined, US);
    expect(r.added).toEqual([64030, 99999]);
    expect(r.unknown).toEqual([]);
  });

  it('takes the first digits of a ZIP+4 so it matches the stored code', () => {
    const r = classifyPaste('64030-1234', [], known(64030), US);
    expect(r.added).toEqual([64030]);
  });

  it('works to NZ four-digit codes', () => {
    const r = classifyPaste('1010, 3010, 99999', [], known(1010, 3010), NZ);
    expect(r.added).toEqual([1010, 3010]);
    // 99999 is five digits, so on NZ its first four read as 9999, which is
    // in no zone here.
    expect(r.unknown).toEqual([9999]);
  });

  it('rejects zero rather than binding it', () => {
    const r = classifyPaste('0, 00000', [], known(64030), US);
    expect(r.added).toEqual([]);
    expect(r.unknown).toEqual([]);
    expect(r.ignored.length).toBeGreaterThan(0);
  });

  it('returns empty buckets for an empty paste', () => {
    const r = classifyPaste('   \n  ', [], known(64030), US);
    expect(r).toEqual({ added: [], alreadyBound: [], unknown: [], padded: [], ignored: [] });
  });
});
