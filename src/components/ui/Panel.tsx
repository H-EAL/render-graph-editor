import type { ReactNode } from 'react';

interface PanelProps {
  title?: string;
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
}

export function Panel({ title, children, className = '', actions }: PanelProps) {
  return (
    <div className={`flex flex-col ${className}`}>
      {title && (
        <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-700/60">
          <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">{title}</span>
          {actions && <div className="flex items-center gap-1">{actions}</div>}
        </div>
      )}
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  );
}

export function SectionHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <div className="flex items-center justify-between px-3 py-2 bg-zinc-800/50 border-b border-zinc-700/40 sticky top-0 z-10">
      <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">{title}</span>
      {actions && <div className="flex items-center gap-1">{actions}</div>}
    </div>
  );
}

export function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-2 items-start py-1.5 px-3 border-b border-zinc-800/60">
      <label className="text-xs text-zinc-500 pt-1.5 shrink-0">{label}</label>
      <div>{children}</div>
    </div>
  );
}

export function InspectorSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-b border-zinc-700/40">
      <div className="px-3 py-1.5 bg-zinc-800/40">
        <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">{title}</span>
      </div>
      {children}
    </div>
  );
}
