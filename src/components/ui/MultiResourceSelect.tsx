import { useState, useRef, useEffect } from 'react';

interface Option {
  value: string;
  label: string;
}

interface MultiResourceSelectProps {
  label?: string;
  values: string[];
  onChange: (values: string[]) => void;
  options: Option[];
  placeholder?: string;
}

export function MultiResourceSelect({ label, values, onChange, options, placeholder = 'Add resource…' }: MultiResourceSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  const filtered = options.filter(
    (o) =>
      !values.includes(o.value) &&
      (o.label.toLowerCase().includes(search.toLowerCase()) || o.value.toLowerCase().includes(search.toLowerCase()))
  );

  const remove = (v: string) => onChange(values.filter((x) => x !== v));
  const add = (v: string) => { onChange([...values, v]); setOpen(false); setSearch(''); };

  const getLabel = (v: string) => options.find((o) => o.value === v)?.label ?? v;

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
      <div className="flex flex-wrap gap-1 mb-1">
        {values.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 bg-zinc-700 text-zinc-200 text-xs rounded px-1.5 py-0.5 font-mono">
            {getLabel(v)}
            <button type="button" onClick={() => remove(v)} className="text-zinc-400 hover:text-red-300">×</button>
          </span>
        ))}
      </div>
      <div className="relative">
        <button
          type="button"
          onClick={() => { setOpen(!open); setSearch(''); }}
          className="w-full text-left bg-zinc-800 border border-zinc-700 border-dashed text-xs rounded px-2 py-1 text-zinc-500 hover:text-zinc-300 hover:border-zinc-500"
        >
          + {placeholder}
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
              {filtered.length === 0 && <div className="px-2 py-2 text-xs text-zinc-500">No options</div>}
              {filtered.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  className="w-full text-left px-2 py-1.5 text-sm text-zinc-200 hover:bg-zinc-700"
                  onClick={() => add(o.value)}
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
