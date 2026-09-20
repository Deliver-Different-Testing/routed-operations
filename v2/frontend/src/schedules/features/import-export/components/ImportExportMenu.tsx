import { useState, useRef, useEffect, Fragment, type ComponentType, type ReactElement } from 'react';
import { Download, FileSpreadsheet, Upload, ChevronDown } from 'lucide-react';

export interface ImportExportMenuProps {
  onDownloadData: () => void;         // Export current data
  onDownloadTemplate: () => void;     // Download empty template
  onUpload: () => void;               // Open upload wizard
  disabled?: boolean;
  className?: string;
  dataCount?: number;                 // Optional: show "Export 42 records"
}

interface MenuItem {
  icon: ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  onClick: () => void;
}

export function ImportExportMenu({
  onDownloadData,
  onDownloadTemplate,
  onUpload,
  disabled = false,
  className = '',
  dataCount
}: ImportExportMenuProps): ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Click outside handler
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // ESC key handler
  useEffect(() => {
    const handleEscKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscKey);
    }

    return () => document.removeEventListener('keydown', handleEscKey);
  }, [isOpen]);

  const handleMenuItemClick = (onClick: () => void) => {
    onClick();
    setIsOpen(false);
  };

  const menuItems: MenuItem[] = [
    {
      icon: Download,
      title: 'Download Data',
      subtitle: dataCount !== undefined
        ? `Export ${dataCount} record${dataCount !== 1 ? 's' : ''} as CSV`
        : 'Export current data as CSV',
      onClick: onDownloadData
    },
    {
      icon: FileSpreadsheet,
      title: 'Download Template',
      subtitle: 'Empty CSV with headers',
      onClick: onDownloadTemplate
    },
    {
      icon: Upload,
      title: 'Upload CSV',
      subtitle: 'Import or update records',
      onClick: onUpload
    }
  ];

  return (
    <div className={`relative ${className}`} ref={menuRef} data-testid="import-export-menu">
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled}
        className={`
          flex items-center gap-2 px-5 py-2.5 rounded-md text-base font-medium transition-all duration-normal
          bg-white text-text-secondary border-2 border-border
          hover:bg-surface-light hover:-translate-y-px
          active:translate-y-0
          disabled:opacity-50 disabled:pointer-events-none
          ${isOpen ? 'bg-surface-light' : ''}
        `}
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <span className="hidden sm:inline">Import/Export</span>
        <span className="sm:hidden">I/E</span>
        <ChevronDown
          className={`w-4 h-4 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          className="absolute top-full right-0 mt-2 w-72 bg-white border border-border rounded-lg shadow-lg z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200"
          role="menu"
        >
          {menuItems.map((item, index) => {
            const IconComponent = item.icon;
            const isLastItem = index === menuItems.length - 1;

            return (
              <Fragment key={item.title}>
                <button
                  onClick={() => handleMenuItemClick(item.onClick)}
                  className="w-full flex items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-light focus:bg-surface-light focus:outline-none"
                  role="menuitem"
                >
                  <IconComponent className="w-5 h-5 text-brand-cyan flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-text-primary">
                      {item.title}
                    </div>
                    <div className="text-xs text-text-muted mt-0.5">
                      {item.subtitle}
                    </div>
                  </div>
                </button>
                {!isLastItem && (
                  <div className="border-t border-border mx-3" />
                )}
              </Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}
