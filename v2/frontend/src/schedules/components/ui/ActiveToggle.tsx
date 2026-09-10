// src/components/ui/ActiveToggle.tsx

interface ActiveToggleProps {
  isActive: boolean;
  onToggle: (newValue: boolean) => void;
  size?: 'sm' | 'md';
  disabled?: boolean;
}

export function ActiveToggle({ isActive, onToggle, disabled = false }: ActiveToggleProps) {
  return (
    <button
      role="switch"
      aria-checked={isActive}
      onClick={(e) => { e.stopPropagation(); onToggle(!isActive); }}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
        isActive ? 'bg-green-500' : 'bg-gray-300'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      disabled={disabled}
    >
      <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
        isActive ? 'translate-x-[18px]' : 'translate-x-[3px]'
      }`} />
    </button>
  );
}
