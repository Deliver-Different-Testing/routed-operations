import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import StepWizard from './StepWizard';

const STEPS = ['Upload', 'Map', 'Review', 'Import'];

describe('StepWizard', () => {
  it('renders every step label', () => {
    render(<StepWizard steps={STEPS} current={1} />);
    STEPS.forEach((s) => expect(screen.getByText(s)).toBeInTheDocument());
  });

  it('marks the current step with aria-current="step"', () => {
    render(<StepWizard steps={STEPS} current={2} />);
    const current = screen.getByRole('listitem', { name: /Step 2: Map \(current\)/ });
    expect(current).toHaveAttribute('aria-current', 'step');
  });

  it('marks earlier steps as completed in the aria label', () => {
    render(<StepWizard steps={STEPS} current={3} />);
    expect(screen.getByRole('listitem', { name: /Step 1: Upload \(completed\)/ })).toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: /Step 2: Map \(completed\)/ })).toBeInTheDocument();
  });

  it('renders the numeric circle for future steps and a v tick for completed', () => {
    render(<StepWizard steps={STEPS} current={3} />);
    const done = screen.getByRole('listitem', { name: /Step 1: Upload \(completed\)/ });
    expect(done.textContent).toContain('v');
    const future = screen.getByRole('listitem', { name: /Step 4:/ });
    expect(future.textContent).toContain('4');
  });

  it('disables every step button when onStepClick is not provided', () => {
    render(<StepWizard steps={STEPS} current={2} />);
    expect(screen.getByRole('listitem', { name: /Step 1: Upload \(completed\)/ })).toBeDisabled();
    expect(screen.getByRole('listitem', { name: /Step 3:/ })).toBeDisabled();
    expect(screen.getByRole('listitem', { name: /Step 2: Map \(current\)/ })).not.toBeDisabled();
  });

  it('enables completed step buttons when onStepClick is provided but keeps future disabled', () => {
    render(<StepWizard steps={STEPS} current={3} onStepClick={() => {}} />);
    expect(screen.getByRole('listitem', { name: /Step 1: Upload \(completed\)/ })).not.toBeDisabled();
    expect(screen.getByRole('listitem', { name: /Step 2: Map \(completed\)/ })).not.toBeDisabled();
    expect(screen.getByRole('listitem', { name: /Step 3: Review \(current\)/ })).not.toBeDisabled();
    expect(screen.getByRole('listitem', { name: /Step 4:/ })).toBeDisabled();
  });

  it('fires onStepClick with the 1-based step number when a completed step is clicked', () => {
    const onStepClick = vi.fn();
    render(<StepWizard steps={STEPS} current={3} onStepClick={onStepClick} />);
    fireEvent.click(screen.getByRole('listitem', { name: /Step 1: Upload \(completed\)/ }));
    expect(onStepClick).toHaveBeenCalledWith(1);
  });

  it('does not fire onStepClick for the current step', () => {
    const onStepClick = vi.fn();
    render(<StepWizard steps={STEPS} current={2} onStepClick={onStepClick} />);
    fireEvent.click(screen.getByRole('listitem', { name: /Step 2: Map \(current\)/ }));
    expect(onStepClick).not.toHaveBeenCalled();
  });

  it('exposes the outer wrapper with role="list" and aria-label', () => {
    render(<StepWizard steps={STEPS} current={1} />);
    expect(screen.getByRole('list', { name: 'Import steps' })).toBeInTheDocument();
  });
});
