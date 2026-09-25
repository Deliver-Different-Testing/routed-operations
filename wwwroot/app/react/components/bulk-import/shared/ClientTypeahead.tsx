import { useEffect, useMemo, useRef, useState } from 'react';
import { clientsService, type ClientDto } from '../../../services/clientsService';

interface Props {
  value: ClientDto | null;
  onChange: (client: ClientDto | null) => void;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
}

/**
 * ClientTypeahead - controlled client picker used at Step 1 of the New
 * Import wizard. Mirrors the AngularJS ui-select in homeView.html: three-
 * character minimum before hitting /clients/search, 300 ms debounce, top
 * 20 results, format `<code> - <name>`.
 *
 * The parent owns the selected client so wiping it on Reset just calls
 * onChange(null). No cache on this side - the server-side query is fast
 * enough and the operator's search string is usually 3-5 chars.
 */
export function ClientTypeahead({
  value,
  onChange,
  placeholder = 'Search clients (min 3 characters)...',
  autoFocus,
  disabled,
}: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ClientDto[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  // Debounced server search after 3+ chars.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 3) {
      setResults([]);
      setError(null);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    setError(null);
    const controller = new AbortController();
    const handle = window.setTimeout(async () => {
      try {
        const { response } = await clientsService.search(trimmed);
        if (controller.signal.aborted) return;
        setResults((response.clients ?? []).slice(0, 20));
      } catch (e) {
        if (controller.signal.aborted) return;
        setError((e as Error).message);
        setResults([]);
      } finally {
        if (!controller.signal.aborted) setIsSearching(false);
      }
    }, 300);
    return () => {
      controller.abort();
      window.clearTimeout(handle);
    };
  }, [query]);

  const displayValue = useMemo(() => {
    if (open) return query;
    if (value) return `${value.code} - ${value.name}`;
    return '';
  }, [open, query, value]);

  return (
    <div ref={containerRef} className="relative">
      <label className="block text-xs font-medium text-text-secondary mb-1">
        Client
      </label>
      <input
        ref={inputRef}
        type="text"
        autoFocus={autoFocus}
        disabled={disabled}
        value={displayValue}
        placeholder={placeholder}
        onFocus={() => {
          setOpen(true);
          setQuery(value ? '' : query);
        }}
        onChange={(e) => {
          if (!open) setOpen(true);
          setQuery(e.target.value);
        }}
        className="w-full rounded border border-border px-3 py-2 text-sm focus:outline-none focus:border-brand-cyan focus:ring-1 focus:ring-brand-cyan disabled:bg-surface-cream disabled:cursor-not-allowed"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-haspopup="listbox"
      />
      {value && !open && (
        <button
          type="button"
          onClick={() => {
            onChange(null);
            setQuery('');
            inputRef.current?.focus();
          }}
          className="absolute right-2 top-8 text-xs text-text-muted hover:text-error"
          aria-label="Clear selected client"
        >
          Clear
        </button>
      )}
      {open && (
        <div className="absolute z-30 mt-1 w-full bg-surface-white border border-border rounded shadow-lg max-h-64 overflow-auto">
          {query.trim().length < 3 && (
            <div className="px-3 py-2 text-xs text-text-muted">
              Type at least 3 characters to search clients.
            </div>
          )}
          {isSearching && (
            <div className="px-3 py-2 text-xs text-text-muted flex items-center gap-2">
              <span className="w-3 h-3 border-2 border-brand-cyan/30 border-t-brand-cyan rounded-full animate-spin" />
              Searching...
            </div>
          )}
          {error && (
            <div className="px-3 py-2 text-xs text-error">Search failed: {error}</div>
          )}
          {!isSearching && !error && query.trim().length >= 3 && results.length === 0 && (
            <div className="px-3 py-2 text-xs text-text-muted">No matching clients.</div>
          )}
          <ul role="listbox">
            {results.map((c) => (
              <li
                key={c.id}
                role="option"
                aria-selected={value?.id === c.id}
                onMouseDown={(e) => {
                  // Use mousedown so the pick happens before the input blurs.
                  e.preventDefault();
                  onChange(c);
                  setQuery('');
                  setOpen(false);
                }}
                className={`px-3 py-2 text-sm cursor-pointer hover:bg-brand-cyan/10 ${
                  value?.id === c.id ? 'bg-brand-cyan/15' : ''
                }`}
              >
                <span className="font-medium text-text-primary">{c.code}</span>
                <span className="text-text-muted"> - </span>
                <span className="text-text-secondary">{c.name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
