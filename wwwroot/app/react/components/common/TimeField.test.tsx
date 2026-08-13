import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TimeField } from './TimeField';

describe('TimeField', () => {
  it('renders two native selects labelled Hour and Minute by default', () => {
    render(<TimeField value="" onChange={() => {}} />);
    expect(screen.getByLabelText('Hour')).toBeInTheDocument();
    expect(screen.getByLabelText('Minute')).toBeInTheDocument();
  });

  it('uses ariaLabel to derive per-select aria labels', () => {
    render(<TimeField value="" onChange={() => {}} ariaLabel="Ready time" />);
    expect(screen.getByLabelText('Ready time hour')).toBeInTheDocument();
    expect(screen.getByLabelText('Ready time minute')).toBeInTheDocument();
  });

  it('splits the incoming value into HH and MM select values', () => {
    render(<TimeField value="09:30" onChange={() => {}} />);
    expect((screen.getByLabelText('Hour') as HTMLSelectElement).value).toBe('09');
    expect((screen.getByLabelText('Minute') as HTMLSelectElement).value).toBe('30');
  });

  it('emits HH:MM on hour change, auto-completing minutes to 00', () => {
    const onChange = vi.fn();
    render(<TimeField value="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Hour'), { target: { value: '07' } });
    expect(onChange).toHaveBeenCalledWith('07:00');
  });

  it('emits HH:MM on minute change, auto-completing hour to 00', () => {
    const onChange = vi.fn();
    render(<TimeField value="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Minute'), { target: { value: '15' } });
    expect(onChange).toHaveBeenCalledWith('00:15');
  });

  it('preserves the other segment when only one changes', () => {
    const onChange = vi.fn();
    render(<TimeField value="09:30" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Hour'), { target: { value: '14' } });
    expect(onChange).toHaveBeenCalledWith('14:30');
  });

  it('emits empty string when both segments are empty', () => {
    const onChange = vi.fn();
    render(<TimeField value="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Hour'), { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith('');
  });

  it('emits 00:MM when hour is cleared but minute remains', () => {
    const onChange = vi.fn();
    render(<TimeField value="09:30" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Hour'), { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith('00:30');
  });

  it('offers minutes in 5-minute steps (12 options: 00..55)', () => {
    render(<TimeField value="" onChange={() => {}} />);
    const minute = screen.getByLabelText('Minute') as HTMLSelectElement;
    const values = Array.from(minute.options).map((o) => o.value);
    expect(values).toEqual(['', '00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55']);
  });

  it('appends a non-step current minute value into the options', () => {
    render(<TimeField value="09:07" onChange={() => {}} />);
    const minute = screen.getByLabelText('Minute') as HTMLSelectElement;
    const values = Array.from(minute.options).map((o) => o.value);
    expect(values).toContain('07');
  });

  it('renders the 24h suffix', () => {
    render(<TimeField value="" onChange={() => {}} />);
    expect(screen.getByText('24h')).toBeInTheDocument();
  });

  it('keeps the pr-7 padding class so the native disclosure arrow does not overlap digits', () => {
    render(<TimeField value="09:00" onChange={() => {}} />);
    expect((screen.getByLabelText('Hour') as HTMLSelectElement).className).toContain('pr-7');
    expect((screen.getByLabelText('Minute') as HTMLSelectElement).className).toContain('pr-7');
  });
});
