import { useState, type KeyboardEvent } from 'react';

interface TagsInputProps {
  label?: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
}

export function TagsInput({ label, values, onChange, placeholder = 'Add…' }: TagsInputProps) {
  const [input, setInput] = useState('');

  const add = () => {
    const trimmed = input.trim();
    if (trimmed && !values.includes(trimmed)) {
      onChange([...values, trimmed]);
    }
    setInput('');
  };

  const remove = (v: string) => onChange(values.filter((x) => x !== v));

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add();
    }
    if (e.key === 'Backspace' && !input && values.length) {
      remove(values[values.length - 1]);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      {label && <label className="text-xs text-zinc-400 font-medium">{label}</label>}
      <div className="flex flex-wrap gap-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 min-h-8.5 focus-within:border-zinc-500">
        {values.map((v) => (
          <span
            key={v}
            className="inline-flex items-center gap-1 bg-zinc-700 text-zinc-200 text-xs rounded px-1.5 py-0.5"
          >
            {v}
            <button
              type="button"
              onClick={() => remove(v)}
              className="text-zinc-400 hover:text-zinc-100 leading-none"
            >
              ×
            </button>
          </span>
        ))}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          onBlur={add}
          placeholder={values.length === 0 ? placeholder : ''}
          className="flex-1 min-w-20 bg-transparent text-zinc-100 text-sm focus:outline-none placeholder-zinc-600"
        />
      </div>
    </div>
  );
}
