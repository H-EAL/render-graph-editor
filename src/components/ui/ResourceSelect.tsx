import { useState, useRef, useEffect } from 'react';

interface Option {
  value: string;
  label: string;
  group?: string;
}

interface ResourceSelectProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  placeholder?: string;
  allowEmpty?: boolean;
}

export function ResourceSelect({ label, value, onChange, options, placeholder = 'Select…', allowEmpty = true }: ResourceSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);
  const filtered = options.filter((o) =>
    o.label.toLowerCase().includes(search.toLowerCase()) || o.value.toLowerCase().includes(search.toLowerCase())
  );

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="flex flex-col gap-1" ref={ref}>
      {label && <label className="text-xs text-zinc-400 font-medium">{label}</label>}
      <div className="relative">
        <button
          type="button"
          onClick={() => { setOpen(!open); setSearch(''); }}
          className="w-full text-left bg-zinc-800 border border-zinc-700 text-sm rounded px-2 py-1.5 focus:outline-none focus:border-zinc-500 text-zinc-100 hover:border-zinc-600 flex items-center justify-between"
        >
          <span className={selected ? 'text-zinc-100' : 'text-zinc-500'}>
            {selected ? selected.label : placeholder}
          </span>
          <span className="text-zinc-500 text-xs">▾</span>
        </button>
        {open && (
          <div className="absolute z-50 w-full mt-1 bg-zinc-800 border border-zinc-600 rounded shadow-xl">
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="w-full bg-zinc-700/60 border-b border-zinc-600 text-zinc-100 text-sm px-2 py-1.5 focus:outline-none"
            />
            <div className="max-h-48 overflow-y-auto">
              {allowEmpty && (
                <button
                  type="button"
                  className="w-full text-left px-2 py-1.5 text-sm text-zinc-500 hover:bg-zinc-700"
                  onClick={() => { onChange(''); setOpen(false); }}
                >
                  — None —
                </button>
              )}
              {filtered.length === 0 && (
                <div className="px-2 py-2 text-xs text-zinc-500">No results</div>
              )}
              {filtered.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  className={`w-full text-left px-2 py-1.5 text-sm hover:bg-zinc-700 ${o.value === value ? 'text-blue-300 bg-blue-900/30' : 'text-zinc-200'}`}
                  onClick={() => { onChange(o.value); setOpen(false); }}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
