/**
 * Example usage of ImportExportMenu component
 * 
 * This file demonstrates how to use the ImportExportMenu dropdown
 * in different scenarios.
 */

import { ImportExportMenu } from './ImportExportMenu';

// Example 1: Basic usage
export function BasicExample() {
  return (
    <ImportExportMenu
      onDownloadData={() => console.log('Downloading data...')}
      onDownloadTemplate={() => console.log('Downloading template...')}
      onUpload={() => console.log('Opening upload wizard...')}
    />
  );
}

// Example 2: With data count
export function WithDataCountExample() {
  const recordCount = 42;
  
  return (
    <ImportExportMenu
      onDownloadData={() => console.log('Exporting 42 records...')}
      onDownloadTemplate={() => console.log('Downloading template...')}
      onUpload={() => console.log('Opening upload wizard...')}
      dataCount={recordCount}
    />
  );
}

// Example 3: Disabled state
export function DisabledExample() {
  return (
    <ImportExportMenu
      onDownloadData={() => {}}
      onDownloadTemplate={() => {}}
      onUpload={() => {}}
      disabled={true}
    />
  );
}

// Example 4: With custom className
export function CustomStyledExample() {
  return (
    <ImportExportMenu
      onDownloadData={() => console.log('Downloading data...')}
      onDownloadTemplate={() => console.log('Downloading template...')}
      onUpload={() => console.log('Opening upload wizard...')}
      className="ml-4"
    />
  );
}

// Example 5: Real-world integration
export function RealWorldExample() {
  const handleDownloadData = async () => {
    try {
      // Fetch data from API
      const response = await fetch('/api/zones/export');
      const blob = await response.blob();
      
      // Trigger download
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'zones-export.csv';
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Export failed:', error);
    }
  };

  const handleDownloadTemplate = () => {
    // Download empty template with headers
    const headers = ['Zone Number', 'Zone Name', 'Region', 'Status'];
    const csv = headers.join(',') + '\n';
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'zones-template.csv';
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const handleUpload = () => {
    // Open upload wizard modal
    console.log('Opening upload wizard...');
  };

  return (
    <div className="flex justify-end p-4">
      <ImportExportMenu
        onDownloadData={handleDownloadData}
        onDownloadTemplate={handleDownloadTemplate}
        onUpload={handleUpload}
        dataCount={156}
      />
    </div>
  );
}
