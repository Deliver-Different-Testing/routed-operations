import { describe, expect, it } from 'vitest';
import { formatAssignmentToast, type AssignmentOutcome } from './assignmentToast';

const base: AssignmentOutcome = {
  succeeded: 0, failed: 0, moved: 0, fromCourierCodes: [], targetCode: '2', rejected: [],
};

describe('formatAssignmentToast', () => {
  it('says which courier the jobs came off, the wording Ruth asked for', () => {
    expect(formatAssignmentToast({ ...base, succeeded: 3, moved: 3, fromCourierCodes: ['22'] }))
      .toBe('Moved 3 jobs from 22 to 2.');
  });

  // Fix round 3 A1: re-assign to the driver the jobs are already on is the
  // resend path. The server counts those as succeeded, not moved, so the
  // toast must not read "Moved 2 jobs from 2 to 2".
  it('reads as an assign on a same-driver resend', () => {
    expect(formatAssignmentToast({ ...base, succeeded: 2, moved: 0, fromCourierCodes: [] }))
      .toBe('Assigned 2 jobs to 2.');
  });

  it('splits moved jobs from jobs that had no courier', () => {
    expect(formatAssignmentToast({ ...base, succeeded: 3, moved: 1, fromCourierCodes: ['22', '77'] }))
      .toBe('Moved 1 job from 22, 77 to 2. Assigned 2 jobs to 2.');
  });

  it('names completed jobs as skipped instead of counting them as assigned', () => {
    expect(formatAssignmentToast({
      ...base, succeeded: 1,
      rejected: [{ jobId: 4, jobNumber: 'J4', reason: 'Job is already completed.' }],
    })).toBe('Assigned 1 job to 2. Skipped 1 job: J4 (Job is already completed).');
  });

  it('caps the skipped list and falls back to the id when there is no number', () => {
    const rejected = Array.from({ length: 7 }, (_, i) => ({ jobId: i + 1, jobNumber: i === 0 ? null : `J${i + 1}`, reason: 'x' }));
    expect(formatAssignmentToast({ ...base, rejected }))
      .toBe('Skipped 7 jobs: #1 (x), J2 (x), J3 (x), J4 (x), J5 (x) and 2 more.');
  });

  it('warns that an unnamed failure may have left a job unassigned', () => {
    // Folded in from the RO SPEC review test (F3): restore worked, despatch
    // failed, so the job is off the old phone and not on the new one.
    const text = formatAssignmentToast({ ...base, succeeded: 2, failed: 1, moved: 2, fromCourierCodes: ['22'] });
    expect(text).toMatch(/unassigned/i);
    expect(text).toBe('Moved 2 jobs from 22 to 2. 1 job failed and may now be unassigned. Check and assign again.');
  });

  it('names a job that failed after it came off the old driver and says to assign it again', () => {
    expect(formatAssignmentToast({
      ...base, succeeded: 1, failed: 1, moved: 1, fromCourierCodes: ['512'],
      failedJobs: [{ jobId: 31, jobNumber: 'P31MR', nowUnassigned: true }],
    })).toBe('Moved 1 job from 512 to 2. P31MR failed and is now unassigned. Assign it again.');
  });

  it('does not call a failed job unassigned when it is still on its driver', () => {
    expect(formatAssignmentToast({
      ...base, failed: 3,
      failedJobs: [
        { jobId: 1, jobNumber: 'A1', nowUnassigned: true },
        { jobId: 2, jobNumber: null, nowUnassigned: true },
        { jobId: 3, jobNumber: 'C3', nowUnassigned: false },
      ],
    })).toBe('A1, #2 failed and are now unassigned. Assign them again. C3 failed.');
  });

  it('does not claim success when nothing changed', () => {
    expect(formatAssignmentToast(base)).toBe('No jobs were changed.');
  });
});
