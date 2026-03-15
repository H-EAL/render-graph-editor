import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { useStore } from '../state/store';
import { PipelineTimelineView } from '../features/pipeline/PipelineTimelineView';
import { StepList } from '../features/step/StepList';
import { PassInspector } from '../features/pass/PassInspector';
import { StepInspector } from '../features/step/StepInspector';
import { ResourceEditor } from '../features/resources/ResourceEditor';
import { JsonPreviewPanel } from './JsonPreviewPanel';
import { Badge } from './ui/Badge';
import { validateDocument } from '../validation';

// ─── Resize hooks ─────────────────────────────────────────────────────────────

function useResizeH(initial: number, min: number, max: number, dir: 'up' | 'down') {
  const [height, setHeight] = useState(initial);
  const drag = useRef(false);
  const y0   = useRef(0);
  const h0   = useRef(0);
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    drag.current = true; y0.current = e.clientY; h0.current = height;
    e.preventDefault();
    const move = (ev: MouseEvent) => {
      if (!drag.current) return;
      const d = dir === 'down' ? ev.clientY - y0.current : y0.current - ev.clientY;
      setHeight(Math.max(min, Math.min(max, h0.current + d)));
    };
    const up = () => { drag.current = false; window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }, [height, min, max, dir]);
  return { height, onMouseDown };
}

function useResizeW(initial: number, min: number, max: number, dir: 'left' | 'right') {
  const [width, setWidth] = useState(initial);
  const drag = useRef(false);
  const x0   = useRef(0);
  const w0   = useRef(0);
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    drag.current = true; x0.current = e.clientX; w0.current = width;
    e.preventDefault();
    const move = (ev: MouseEvent) => {
      if (!drag.current) return;
      const d = dir === 'right' ? ev.clientX - x0.current : x0.current - ev.clientX;
      setWidth(Math.max(min, Math.min(max, w0.current + d)));
    };
    const up = () => { drag.current = false; window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }, [width, min, max, dir]);
  return { width, onMouseDown };
}

// ─── Pipeline header ──────────────────────────────────────────────────────────

function PipelineHeader({ onToggleJson, jsonOpen }: { onToggleJson: () => void; jsonOpen: boolean }) {
  const { pipeline, setPipelineName } = useStore();
  const [editing, setEditing] = useState(false);
  const [name, setName]       = useState(pipeline.name);
  const commit = () => { const t = name.trim(); if (t) setPipelineName(t); setEditing(false); };
  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-zinc-900 border-b border-zinc-700/80 shrink-0">
      <span className="text-xs font-bold text-zinc-500 tracking-tight shrink-0">Render Pipeline Editor</span>
      <span className="text-zinc-700">·</span>
      {editing ? (
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
          className="bg-zinc-800 border border-zinc-600 text-zinc-100 text-sm font-semibold rounded px-2 py-0.5 focus:outline-none" />
      ) : (
        <button className="text-sm font-semibold text-zinc-200 hover:text-white"
          onDoubleClick={() => { setName(pipeline.name); setEditing(true); }}
          title="Double-click to rename">
          {pipeline.name}
        </button>
      )}
      <span className="text-[10px] text-zinc-600 font-mono">v{pipeline.version}</span>
      <div className="flex-1" />
      <button
        onClick={onToggleJson}
        title="Toggle JSON viewer"
        className={`text-[11px] px-2.5 py-1 rounded border font-mono transition-colors
          ${jsonOpen
            ? 'bg-zinc-700 border-zinc-500 text-zinc-200'
            : 'bg-zinc-800/60 border-zinc-700/60 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600'}`}
      >
        {'{ }'}
      </button>
    </div>
  );
}

// ─── Center panel ─────────────────────────────────────────────────────────────

function PassCenterPanel() {
  const { pipeline, selectedPassId } = useStore();
  const pass = selectedPassId ? pipeline.passes[selectedPassId] : null;
  if (!pass) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-600 text-sm">
        Select a pass from the timeline
      </div>
    );
  }
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-700/60 bg-zinc-800/20 shrink-0">
        <Badge value={pass.kind} />
        <span className="text-sm font-semibold text-zinc-100">{pass.name}</span>
        {!pass.enabled && <span className="text-[10px] text-zinc-500 italic ml-1">disabled</span>}
        {pass.conditions.length > 0 && (
          <div className="flex gap-1 ml-1">
            {pass.conditions.map((c) => (
              <span key={c} className="text-[10px] bg-amber-900/40 text-amber-300 border border-amber-700/40 rounded px-1.5 py-0.5 font-mono">{c}</span>
            ))}
          </div>
        )}
        <div className="flex-1" />
        {pass.notes && <span className="text-[10px] text-zinc-500 truncate max-w-48" title={pass.notes}>{pass.notes}</span>}
      </div>
      <div className="flex-1 overflow-hidden">
        <StepList passId={pass.id} />
      </div>
    </div>
  );
}

// ─── Right inspector ──────────────────────────────────────────────────────────

function RightInspector() {
  const selectedStepId = useStore((s) => s.selectedStepId);
  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-zinc-700/60 shrink-0">
        <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
          {selectedStepId ? 'Step Inspector' : 'Pass Inspector'}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {selectedStepId ? <StepInspector /> : <PassInspector />}
      </div>
    </div>
  );
}

// ─── Validation status bar ────────────────────────────────────────────────────

function ValidationStatusBar({ onToggle, open }: { onToggle: () => void; open: boolean }) {
  const { pipeline, resources } = useStore();
  const issues   = useMemo(() => validateDocument(pipeline, resources), [pipeline, resources]);
  const errors   = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');

  return (
    <button
      onClick={onToggle}
      title={open ? 'Hide validation issues' : 'Show validation issues'}
      className={`flex items-center gap-2.5 px-3 h-6 w-full text-left border-t transition-colors
        ${open
          ? 'bg-zinc-800 border-zinc-600'
          : 'bg-zinc-900 border-zinc-800 hover:bg-zinc-800/60'}
        ${errors.length > 0 ? 'border-t-red-900/60' : warnings.length > 0 ? 'border-t-amber-900/40' : 'border-t-zinc-800'}`}
    >
      {issues.length === 0 ? (
        <span className="text-[10px] text-emerald-500 flex items-center gap-1">
          <span>✓</span><span>No issues</span>
        </span>
      ) : (
        <>
          {errors.length > 0 && (
            <span className="text-[10px] text-red-400">
              ✗ {errors.length} error{errors.length !== 1 ? 's' : ''}
            </span>
          )}
          {warnings.length > 0 && (
            <span className="text-[10px] text-amber-400">
              ⚠ {warnings.length} warning{warnings.length !== 1 ? 's' : ''}
            </span>
          )}
        </>
      )}
      <span className="ml-auto text-[9px] text-zinc-600">{open ? '▼' : '▲'}</span>
    </button>
  );
}

// ─── Validation popover ───────────────────────────────────────────────────────

function ValidationPopover({ onClose }: { onClose: () => void }) {
  const { pipeline, resources } = useStore();
  const issues   = useMemo(() => validateDocument(pipeline, resources), [pipeline, resources]);
  const errors   = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const ref      = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute bottom-6 left-0 z-50 w-96 max-h-72 flex flex-col bg-zinc-900 border border-zinc-700 rounded-tr shadow-2xl overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-3 py-1.5 border-b border-zinc-700/60 shrink-0">
        <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">Validation</span>
        {errors.length > 0   && <span className="text-[10px] text-red-400">{errors.length} error{errors.length !== 1 ? 's' : ''}</span>}
        {warnings.length > 0 && <span className="text-[10px] text-amber-400">{warnings.length} warning{warnings.length !== 1 ? 's' : ''}</span>}
        <button onClick={onClose} className="ml-auto text-zinc-600 hover:text-zinc-300 text-xs">✕</button>
      </div>
      {/* Issue list */}
      <div className="overflow-y-auto">
        {issues.length === 0 ? (
          <div className="flex items-center gap-2 px-3 py-4 text-emerald-400 text-xs">
            <span>✓</span><span>No issues found.</span>
          </div>
        ) : (
          issues.map((issue) => (
            <div key={issue.id}
              className={`flex items-start gap-2 px-3 py-2 border-b border-zinc-800/60 text-xs
                ${issue.severity === 'error' ? 'text-red-300' : 'text-amber-300'}`}>
              <span className="shrink-0 mt-0.5">{issue.severity === 'error' ? '✗' : '⚠'}</span>
              <div className="flex flex-col gap-0.5">
                <span>{issue.message}</span>
                {issue.location && <span className="text-zinc-500">in {issue.location}</span>}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── JSON drawer ──────────────────────────────────────────────────────────────

function JsonDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <>
      {/* Backdrop */}
      {open && (
        <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      )}
      {/* Panel — always in DOM for transition */}
      <div
        className={`fixed top-0 right-0 bottom-0 z-50 w-130 flex flex-col bg-zinc-900 border-l border-zinc-700/80 shadow-2xl transition-transform duration-200 ease-in-out
          ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="flex items-center px-3 py-2 border-b border-zinc-700/60 shrink-0">
          <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">JSON</span>
          <button onClick={onClose} className="ml-auto text-zinc-600 hover:text-zinc-300 text-sm leading-none p-1">✕</button>
        </div>
        <div className="flex-1 overflow-hidden">
          {open && <JsonPreviewPanel />}
        </div>
      </div>
    </>
  );
}

// ─── AppShell ─────────────────────────────────────────────────────────────────

export function AppShell() {
  const [showJson,       setShowJson]       = useState(false);
  const [showValidation, setShowValidation] = useState(false);

  const topPanel  = useResizeH(210, 120, 480, 'down');
  const leftPanel = useResizeW(280, 160, 520, 'right');
  const inspector = useResizeW(320, 200, 520, 'left');

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-zinc-100 overflow-hidden">

      {/* Title bar + pipeline name (merged) */}
      <PipelineHeader onToggleJson={() => setShowJson((v) => !v)} jsonOpen={showJson} />

      {/* Timeline view */}
      <div style={{ height: topPanel.height }} className="shrink-0 overflow-hidden border-b border-zinc-700/60">
        <PipelineTimelineView />
      </div>
      <div onMouseDown={topPanel.onMouseDown}
        className="h-1 bg-zinc-800 hover:bg-blue-600/50 cursor-row-resize shrink-0 transition-colors" />

      {/* Main 3-column area */}
      <div className="flex flex-1 overflow-hidden min-h-0">

        {/* Left: Resources */}
        <div style={{ width: leftPanel.width }}
          className="flex flex-col shrink-0 overflow-hidden bg-zinc-900 border-r border-zinc-700/60">
          <div className="px-3 py-2 border-b border-zinc-700/60 shrink-0">
            <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Resources</span>
          </div>
          <div className="flex-1 overflow-hidden">
            <ResourceEditor />
          </div>
        </div>
        <div onMouseDown={leftPanel.onMouseDown}
          className="w-1 bg-zinc-800 hover:bg-blue-600/50 cursor-col-resize shrink-0 transition-colors" />

        {/* Center: Steps */}
        <div className="flex flex-col flex-1 overflow-hidden min-w-0 bg-zinc-900">
          <PassCenterPanel />
        </div>

        {/* Right: Inspector */}
        <div onMouseDown={inspector.onMouseDown}
          className="w-1 bg-zinc-800 hover:bg-blue-600/50 cursor-col-resize shrink-0 transition-colors" />
        <div style={{ width: inspector.width }}
          className="flex flex-col shrink-0 overflow-hidden bg-zinc-900 border-l border-zinc-700/60">
          <RightInspector />
        </div>
      </div>

      {/* Validation status bar + popover */}
      <div className="relative shrink-0">
        {showValidation && <ValidationPopover onClose={() => setShowValidation(false)} />}
        <ValidationStatusBar onToggle={() => setShowValidation((v) => !v)} open={showValidation} />
      </div>

      {/* JSON drawer (overlay) */}
      <JsonDrawer open={showJson} onClose={() => setShowJson(false)} />
    </div>
  );
}
