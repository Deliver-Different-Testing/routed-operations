import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FileDropzone } from './FileDropzone';

describe('FileDropzone', () => {
  it('renders with default props', () => {
    const onFileSelect = vi.fn();
    render(<FileDropzone onFileSelect={onFileSelect} />);

    expect(screen.getByText(/Drag & drop your CSV file here/i)).toBeInTheDocument();
    expect(screen.getByText(/or click to browse/i)).toBeInTheDocument();
    expect(screen.getByText(/Supported: .csv files/i)).toBeInTheDocument();
    expect(screen.getByText(/Max size: 10MB/i)).toBeInTheDocument();
  });

  it('shows disabled state when disabled prop is true', () => {
    const onFileSelect = vi.fn();
    const { container } = render(<FileDropzone onFileSelect={onFileSelect} disabled />);

    const dropzone = container.querySelector('div[class*="cursor-not-allowed"]');
    expect(dropzone).toBeInTheDocument();
  });

  it('displays error message when error prop is provided', () => {
    const onFileSelect = vi.fn();
    const errorMessage = 'Invalid file format';
    render(<FileDropzone onFileSelect={onFileSelect} error={errorMessage} />);

    expect(screen.getByText(errorMessage)).toBeInTheDocument();
  });

  it('validates file extension and shows error for invalid files', () => {
    const onFileSelect = vi.fn();
    const { container } = render(<FileDropzone onFileSelect={onFileSelect} accept=".csv" />);

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['content'], 'test.txt', { type: 'text/plain' });

    Object.defineProperty(input, 'files', {
      value: [file],
      writable: false,
    });

    fireEvent.change(input);

    expect(onFileSelect).not.toHaveBeenCalled();
    expect(screen.getByText(/Invalid file type/i)).toBeInTheDocument();
  });

  it('validates file size and shows error for oversized files', () => {
    const onFileSelect = vi.fn();
    const maxSize = 1024; // 1KB
    const { container } = render(<FileDropzone onFileSelect={onFileSelect} maxSize={maxSize} />);

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const largeContent = new Array(2048).fill('a').join(''); // 2KB
    const file = new File([largeContent], 'test.csv', { type: 'text/csv' });

    Object.defineProperty(input, 'files', {
      value: [file],
      writable: false,
    });

    fireEvent.change(input);

    expect(onFileSelect).not.toHaveBeenCalled();
    expect(screen.getByText(/File size exceeds/i)).toBeInTheDocument();
  });

  it('calls onFileSelect with valid file', () => {
    const onFileSelect = vi.fn();
    const { container } = render(<FileDropzone onFileSelect={onFileSelect} />);

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['content'], 'test.csv', { type: 'text/csv' });

    Object.defineProperty(input, 'files', {
      value: [file],
      writable: false,
    });

    fireEvent.change(input);

    expect(onFileSelect).toHaveBeenCalledWith(file);
  });
});
