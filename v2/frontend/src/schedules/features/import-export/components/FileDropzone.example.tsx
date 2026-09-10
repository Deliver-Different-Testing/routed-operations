// Example usage of FileDropzone component

import React, { useState } from 'react';
import { FileDropzone } from './FileDropzone';

export function FileDropzoneExample() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string>('');

  const handleFileSelect = (file: File) => {
    console.log('File selected:', file.name);
    setSelectedFile(file);
    setError(''); // Clear any errors
  };

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h2 className="text-2xl font-semibold mb-4">Upload CSV File</h2>

      {/* Basic usage */}
      <FileDropzone
        onFileSelect={handleFileSelect}
        accept=".csv"
        maxSize={10 * 1024 * 1024} // 10MB
        error={error}
      />

      {/* Show selected file */}
      {selectedFile && (
        <div className="mt-4 p-4 bg-surface-light rounded-md">
          <p className="text-sm text-text-secondary">Selected file:</p>
          <p className="text-base font-medium text-text-primary">{selectedFile.name}</p>
          <p className="text-sm text-text-muted">
            Size: {(selectedFile.size / 1024).toFixed(2)} KB
          </p>
        </div>
      )}
    </div>
  );
}

// Disabled state example
export function DisabledFileDropzoneExample() {
  return (
    <FileDropzone
      onFileSelect={() => {}}
      disabled={true}
    />
  );
}

// Custom accept types example
export function CustomAcceptExample() {
  return (
    <FileDropzone
      onFileSelect={(file) => console.log(file)}
      accept=".csv,.xlsx,.xls"
      maxSize={5 * 1024 * 1024} // 5MB
    />
  );
}

// With error example
export function ErrorStateExample() {
  return (
    <FileDropzone
      onFileSelect={() => {}}
      error="Failed to upload file. Please try again."
    />
  );
}
