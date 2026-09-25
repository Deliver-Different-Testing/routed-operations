import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FileUploadZone from './FileUploadZone';

function makeFile(name = 'a.csv', type = 'text/csv', size = 12) {
  return new File(['x'.repeat(size)], name, { type });
}

describe('FileUploadZone', () => {
  it('renders the default empty prompt', () => {
    render(<FileUploadZone onFileSelected={() => {}} />);
    expect(screen.getByText(/Drop your file here or click to browse/)).toBeInTheDocument();
    expect(screen.getByText(/Supports \.csv, \.xlsx, \.xlsm/)).toBeInTheDocument();
  });

  it('shows the parsing spinner label when isLoading is true', () => {
    render(<FileUploadZone onFileSelected={() => {}} isLoading />);
    expect(screen.getByText('Parsing file...')).toBeInTheDocument();
  });

  it('shows the selected-file display when fileName provided', () => {
    render(<FileUploadZone onFileSelected={() => {}} fileName="report.csv" fileSize={2048} />);
    expect(screen.getByText('report.csv')).toBeInTheDocument();
    expect(screen.getByText('2.0 KB')).toBeInTheDocument();
    expect(screen.getByText('Click or drop to replace')).toBeInTheDocument();
  });

  it('formats sizes in B, KB, MB', () => {
    const { rerender } = render(<FileUploadZone onFileSelected={() => {}} fileName="x" fileSize={512} />);
    expect(screen.getByText('512 B')).toBeInTheDocument();
    rerender(<FileUploadZone onFileSelected={() => {}} fileName="x" fileSize={1500} />);
    expect(screen.getByText('1.5 KB')).toBeInTheDocument();
    rerender(<FileUploadZone onFileSelected={() => {}} fileName="x" fileSize={2 * 1048576} />);
    expect(screen.getByText('2.0 MB')).toBeInTheDocument();
  });

  it('does not render size when fileSize is null', () => {
    render(<FileUploadZone onFileSelected={() => {}} fileName="only-name.csv" fileSize={null} />);
    expect(screen.getByText('only-name.csv')).toBeInTheDocument();
    // No number-with-unit shown
    expect(screen.queryByText(/KB/)).not.toBeInTheDocument();
  });

  it('marks aria-disabled when disabled', () => {
    render(<FileUploadZone onFileSelected={() => {}} disabled />);
    const zone = screen.getByRole('button', { name: /Upload file drop zone/ });
    expect(zone).toHaveAttribute('aria-disabled', 'true');
    expect(zone).toHaveAttribute('tabIndex', '-1');
  });

  it('emits the file when an Enter keypress opens the picker and a file is selected', () => {
    const onSelected = vi.fn();
    render(<FileUploadZone onFileSelected={onSelected} />);
    const zone = screen.getByRole('button', { name: /Upload file drop zone/ });
    // Simulate Enter key path
    fireEvent.keyDown(zone, { key: 'Enter' });
    // Fire the underlying input change with a file
    const input = zone.querySelector('input[type="file"]') as HTMLInputElement;
    const file = makeFile('picked.csv');
    fireEvent.change(input, { target: { files: [file] } });
    expect(onSelected).toHaveBeenCalledTimes(1);
    expect(onSelected.mock.calls[0][0]).toBeInstanceOf(File);
    expect(onSelected.mock.calls[0][0].name).toBe('picked.csv');
  });

  it('activates on space key path too', () => {
    render(<FileUploadZone onFileSelected={() => {}} />);
    const zone = screen.getByRole('button', { name: /Upload file drop zone/ });
    fireEvent.keyDown(zone, { key: ' ' });
    // No throw. Also verify the input still exists and is not disabled
    const input = zone.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.disabled).toBe(false);
  });

  it('ignores keydown when disabled', () => {
    render(<FileUploadZone onFileSelected={() => {}} disabled />);
    const zone = screen.getByRole('button', { name: /Upload file drop zone/ });
    fireEvent.keyDown(zone, { key: 'Enter' });
    const input = zone.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  it('ignores non-activation keys', () => {
    const onSelected = vi.fn();
    render(<FileUploadZone onFileSelected={onSelected} />);
    const zone = screen.getByRole('button', { name: /Upload file drop zone/ });
    fireEvent.keyDown(zone, { key: 'Tab' });
    expect(onSelected).not.toHaveBeenCalled();
  });

  it('clicking the zone opens the picker (no throw)', async () => {
    const user = userEvent.setup();
    render(<FileUploadZone onFileSelected={() => {}} />);
    const zone = screen.getByRole('button', { name: /Upload file drop zone/ });
    await user.click(zone);
    // JSDOM does not open real file picker; just assert no throw + input present
    expect(zone.querySelector('input[type="file"]')).toBeTruthy();
  });

  it('clicking when disabled does nothing to picker state', async () => {
    const user = userEvent.setup();
    render(<FileUploadZone onFileSelected={() => {}} disabled />);
    const zone = screen.getByRole('button', { name: /Upload file drop zone/ });
    await user.click(zone);
    const input = zone.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  it('setting isDragOver via drag over then leave restores default border', () => {
    render(<FileUploadZone onFileSelected={() => {}} />);
    const zone = screen.getByRole('button', { name: /Upload file drop zone/ });
    fireEvent.dragOver(zone);
    expect(zone.className).toContain('border-brand-cyan');
    fireEvent.dragLeave(zone);
    expect(zone.className).not.toContain('bg-brand-cyan/5');
  });

  it('drag-over is inert while disabled', () => {
    render(<FileUploadZone onFileSelected={() => {}} disabled />);
    const zone = screen.getByRole('button', { name: /Upload file drop zone/ });
    fireEvent.dragOver(zone);
    // The drag-over highlight branch is skipped
    expect(zone.className).not.toContain('bg-brand-cyan/5');
  });

  it('handles onDrop with a file and emits it', () => {
    const onSelected = vi.fn();
    render(<FileUploadZone onFileSelected={onSelected} />);
    const zone = screen.getByRole('button', { name: /Upload file drop zone/ });
    const file = makeFile('dropped.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });
    expect(onSelected).toHaveBeenCalledTimes(1);
    expect(onSelected.mock.calls[0][0].name).toBe('dropped.xlsx');
  });

  it('drop when disabled does nothing', () => {
    const onSelected = vi.fn();
    render(<FileUploadZone onFileSelected={onSelected} disabled />);
    const zone = screen.getByRole('button', { name: /Upload file drop zone/ });
    const file = makeFile('dropped.csv');
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });
    expect(onSelected).not.toHaveBeenCalled();
  });

  it('drop when isLoading does nothing', () => {
    const onSelected = vi.fn();
    render(<FileUploadZone onFileSelected={onSelected} isLoading />);
    const zone = screen.getByRole('button', { name: /Upload file drop zone/ });
    const file = makeFile('dropped.csv');
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });
    expect(onSelected).not.toHaveBeenCalled();
  });

  it('drop with no files is a no-op', () => {
    const onSelected = vi.fn();
    render(<FileUploadZone onFileSelected={onSelected} />);
    const zone = screen.getByRole('button', { name: /Upload file drop zone/ });
    fireEvent.drop(zone, { dataTransfer: { files: [] } });
    expect(onSelected).not.toHaveBeenCalled();
  });

  it('input change with no file is a no-op', () => {
    const onSelected = vi.fn();
    render(<FileUploadZone onFileSelected={onSelected} />);
    const input = screen.getByRole('button', { name: /Upload file drop zone/ })
      .querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [] } });
    expect(onSelected).not.toHaveBeenCalled();
  });
});
