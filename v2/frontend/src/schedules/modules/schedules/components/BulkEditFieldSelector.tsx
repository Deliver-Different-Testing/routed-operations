// src/modules/schedules/components/BulkEditFieldSelector.tsx
import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import type { BulkEditField, BulkEditFieldType, TimeUnit } from '../types';
import { BULK_EDITABLE_FIELDS } from '../types';

interface BulkEditFieldSelectorProps {
  fields: BulkEditField[];
  onFieldsChange: (fields: BulkEditField[]) => void;
}

export function BulkEditFieldSelector({ fields, onFieldsChange }: BulkEditFieldSelectorProps) {
  const [selectedFieldType, setSelectedFieldType] = useState<BulkEditFieldType | ''>('');

  const availableFields = BULK_EDITABLE_FIELDS.filter(
    (f) => !fields.some((existing) => existing.field === f.field)
  );

  const handleAddField = () => {
    if (!selectedFieldType) return;

    const fieldDef = BULK_EDITABLE_FIELDS.find((f) => f.field === selectedFieldType);
    if (!fieldDef) return;

    const newField: BulkEditField = {
      field: selectedFieldType,
      label: fieldDef.label,
      mode: 'absolute',
      value: '',
      unit: selectedFieldType === 'cutoffValue' ? 'hours' : undefined,
    };

    onFieldsChange([...fields, newField]);
    setSelectedFieldType('');
  };

  const handleRemoveField = (field: BulkEditFieldType) => {
    onFieldsChange(fields.filter((f) => f.field !== field));
  };

  const handleFieldChange = (field: BulkEditFieldType, updates: Partial<BulkEditField>) => {
    onFieldsChange(
      fields.map((f) => (f.field === field ? { ...f, ...updates } : f))
    );
  };

  return (
    <div className="space-y-4" data-testid="bulk-edit-field-selector" aria-label="bulk edit field selector">
      {/* Existing fields */}
      {fields.map((field) => {
        const fieldDef = BULK_EDITABLE_FIELDS.find((f) => f.field === field.field);

        return (
          <div
            key={field.field}
            className="p-4 border border-border rounded-lg bg-white space-y-3"
          >
            <div className="flex items-center justify-between">
              <span className="font-medium text-text-primary">{field.label}</span>
              <button
                onClick={() => handleRemoveField(field.field)}
                className="p-1 hover:bg-surface-cream rounded transition-colors"
              >
                <X className="w-4 h-4 text-text-muted" />
              </button>
            </div>

            {/* Mode selector (if field supports relative) */}
            {fieldDef?.supportsRelative && (
              <div className="flex gap-4">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={`mode-${field.field}`}
                    checked={field.mode === 'absolute'}
                    onChange={() => handleFieldChange(field.field, { mode: 'absolute' })}
                    className="text-brand-cyan focus:ring-brand-cyan"
                  />
                  <span className="text-sm">Set to</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={`mode-${field.field}`}
                    checked={field.mode === 'relative'}
                    onChange={() => handleFieldChange(field.field, { mode: 'relative' })}
                    className="text-brand-cyan focus:ring-brand-cyan"
                  />
                  <span className="text-sm">Adjust by</span>
                </label>
              </div>
            )}

            {/* Value input */}
            <div className="flex items-center gap-2">
              {field.mode === 'relative' && (
                <select
                  value={typeof field.value === 'number' && field.value >= 0 ? '+' : '-'}
                  onChange={(e) => {
                    const currentVal = Math.abs(Number(field.value) || 0);
                    const newVal = e.target.value === '+' ? currentVal : -currentVal;
                    handleFieldChange(field.field, { value: newVal });
                  }}
                  className="px-2 py-1.5 border border-border rounded-lg text-sm"
                >
                  <option value="+">+</option>
                  <option value="-">-</option>
                </select>
              )}
              <input
                type={field.field === 'operatingDays' ? 'text' : 'number'}
                value={typeof field.value === 'number' ? Math.abs(field.value) : field.value}
                onChange={(e) => {
                  const val = field.field === 'operatingDays' ? e.target.value : Number(e.target.value);
                  if (field.mode === 'relative' && typeof field.value === 'number' && field.value < 0) {
                    handleFieldChange(field.field, { value: -Math.abs(Number(val)) });
                  } else {
                    handleFieldChange(field.field, { value: val });
                  }
                }}
                placeholder={field.mode === 'relative' ? 'Amount' : 'Value'}
                className="flex-1 px-3 py-1.5 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-cyan focus:border-transparent"
              />
              {field.unit && (
                <select
                  value={field.unit}
                  onChange={(e) => handleFieldChange(field.field, { unit: e.target.value as TimeUnit })}
                  className="px-2 py-1.5 border border-border rounded-lg text-sm"
                >
                  <option value="minutes">minutes</option>
                  <option value="hours">hours</option>
                </select>
              )}
            </div>
          </div>
        );
      })}

      {/* Add field */}
      {availableFields.length > 0 && (
        <div className="flex items-center gap-2">
          <select
            value={selectedFieldType}
            onChange={(e) => setSelectedFieldType(e.target.value as BulkEditFieldType)}
            className="flex-1 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-cyan focus:border-transparent"
          >
            <option value="">Select a field to edit...</option>
            {availableFields.map((f) => (
              <option key={f.field} value={f.field}>
                {f.label}
              </option>
            ))}
          </select>
          <Button
            variant="secondary"
            onClick={handleAddField}
            disabled={!selectedFieldType}
          >
            <Plus className="w-4 h-4 mr-1" />
            Add Field
          </Button>
        </div>
      )}

      {fields.length === 0 && (
        <div className="text-center text-text-muted text-sm py-4">
          Select a field above to start editing
        </div>
      )}
    </div>
  );
}
