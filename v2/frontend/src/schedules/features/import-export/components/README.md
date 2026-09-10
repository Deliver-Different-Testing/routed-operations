# Import/Export Components

This directory contains UI components for the Universal Import/Export System.

## Components

### FileDropzone

A drag-and-drop file upload component for CSV files.

**Location:** `FileDropzone.tsx`

**Props:**
- `onFileSelect: (file: File) => void` - Callback when a valid file is selected
- `accept?: string` - File extensions to accept (default: `.csv`)
- `maxSize?: number` - Max file size in bytes (default: 10MB)
- `disabled?: boolean` - Disable the dropzone
- `error?: string` - Error message to display
- `className?: string` - Additional CSS classes

**Features:**
- Drag and drop file upload
- Click to browse file picker
- File extension validation
- File size validation
- Visual states: default, hover, disabled, error
- Accessible (keyboard navigation, ARIA labels)
- Brand-consistent styling (uses Tailwind config)

**Usage:**
```tsx
import { FileDropzone } from '@/features/import-export/components';

function MyComponent() {
  const handleFileSelect = (file: File) => {
    console.log('Selected:', file.name);
  };

  return (
    <FileDropzone
      onFileSelect={handleFileSelect}
      accept=".csv"
      maxSize={10 * 1024 * 1024} // 10MB
    />
  );
}
```

**Examples:** See `FileDropzone.example.tsx`

**Tests:** See `FileDropzone.test.tsx`

---

### ImportExportButton

(Documentation will be expanded in the tidy-up pass)

### ImportExportMenu

(Documentation will be expanded in the tidy-up pass)

## Styling

All components follow the brand design system defined in `tailwind.config.js`:

- **Brand Colors:** `brand-cyan`, `brand-dark`, `brand-purple`
- **Text Colors:** `text-primary`, `text-secondary`, `text-muted`
- **Spacing:** 8pt scale (`sm`, `md`, `lg`, etc.)
- **Transitions:** `duration-normal` (200ms)
- **Shadows:** `shadow-cyan-glow` for focus states

## Icons

Components use [Lucide React](https://lucide.dev/) icons:
- `Upload` - File upload icon
- `FileSpreadsheet` - CSV file icon
- `AlertCircle` - Error/warning icon
