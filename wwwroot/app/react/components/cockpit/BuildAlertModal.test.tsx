import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BuildAlertModal } from './BuildAlertModal';

const noSkips = { missingWindow: 0, missingCubic: 0, missingPostcode: 0 };

describe('BuildAlertModal', () => {
  it('renders nothing when open is false', () => {
    render(
      <BuildAlertModal
        open={false}
        buckets={[]}
        skips={noSkips}
        totalValid={0}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />
    );
    expect(screen.queryByText(/Confirm build/)).not.toBeInTheDocument();
  });

  it('renders the header with bucket + valid job counts', () => {
    render(
      <BuildAlertModal
        open
        buckets={[{ key: 'a', hhmm: '0900', jobCount: 5 }]}
        skips={noSkips}
        totalValid={5}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />
    );
    expect(screen.getByRole('heading', { name: /1 run bucket\(s\), 5 valid job\(s\)/ })).toBeInTheDocument();
  });

  it('shows the empty state and disables confirm when no buckets', () => {
    render(
      <BuildAlertModal
        open
        buckets={[]}
        skips={noSkips}
        totalValid={0}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />
    );
    expect(screen.getByText(/No buckets formed/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nothing to build' })).toBeDisabled();
  });

  it('renders one row per bucket with DW-prefixed key when hhmm present', () => {
    render(
      <BuildAlertModal
        open
        buckets={[
          { key: 'x', hhmm: '0800', jobCount: 4, windowLabel: '08:00 - 12:00' },
          { key: 'y', hhmm: '1300', jobCount: 2, windowLabel: '13:00 - 17:00' },
        ]}
        skips={noSkips}
        totalValid={6}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />
    );
    expect(screen.getByText('DW0800')).toBeInTheDocument();
    expect(screen.getByText('DW1300')).toBeInTheDocument();
    expect(screen.getByText('08:00 - 12:00')).toBeInTheDocument();
  });

  it('falls back to bucket key when hhmm is null', () => {
    render(
      <BuildAlertModal
        open
        buckets={[{ key: 'north', hhmm: null, jobCount: 7 }]}
        skips={noSkips}
        totalValid={7}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />
    );
    expect(screen.getByText('north')).toBeInTheDocument();
  });

  it('renders the skips warning box only when any skip count is non-zero', () => {
    render(
      <BuildAlertModal
        open
        buckets={[{ key: 'a', hhmm: null, jobCount: 1 }]}
        skips={{ missingWindow: 2, missingCubic: 1, missingPostcode: 0 }}
        totalValid={1}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />
    );
    expect(screen.getByText(/Skipped rows in this build/)).toBeInTheDocument();
    expect(screen.getByText(/2 missing schedule window/)).toBeInTheDocument();
    expect(screen.getByText(/1 missing cubic data/)).toBeInTheDocument();
    expect(screen.queryByText(/missing postcode/)).not.toBeInTheDocument();
  });

  it('fires onCancel when Cancel clicked and onConfirm when Build clicked', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <BuildAlertModal
        open
        buckets={[{ key: 'a', hhmm: '0900', jobCount: 3 }]}
        skips={noSkips}
        totalValid={3}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: /Build 1 bucket/ }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
