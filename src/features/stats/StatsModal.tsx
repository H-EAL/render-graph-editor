import { useState, useMemo } from 'react';
import { useStore } from '../../state/store';
import { computeMemStats, formatBytes, VIEWPORT_PRESETS, type RTMemStat, type BufMemStat } from '../../utils/memoryStats';

// ─── Mini section header ──────────────────────────────────────────────────────

function SectionHead({ label, right }: { label: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-1.5">
      <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">{label}</span>
      <div className="flex-1 h-px bg-zinc-800" />
      {right}
    </div>
  );
}

// ─── Proportion bar ───────────────────────────────────────────────────────────

function ProportionBar({ rtBytes, bufBytes }: { rtBytes: number; bufBytes: number }) {
  const total = rtBytes + bufBytes;
  if (total === 0) return null;
  const rtPct  = (rtBytes  / total) * 100;
  const bufPct = (bufBytes / total) * 100;
  return (
    <div className="flex h-2 rounded overflow-hidden gap-px bg-zinc-900">
      {rtPct  > 0 && <div style={{ width: `${rtPct}%`  }} className="bg-blue-600 transition-all"  title={`Render Targets: ${rtPct.toFixed(1)}%`} />}
      {bufPct > 0 && <div style={{ width: `${bufPct}%` }} className="bg-amber-600 transition-all" title={`Buffers: ${bufPct.toFixed(1)}%`} />}
    </div>
  );
}

// ─── Memory row bar ───────────────────────────────────────────────────────────

function MemBar({ bytes, maxBytes, color }: { bytes: number; maxBytes: number; color: string }) {
  const pct = maxBytes > 0 ? (bytes / maxBytes) * 100 : 0;
  return (
    <div className="flex-1 min-w-0 flex items-center gap-1.5">
      <div className="flex-1 h-1.5 bg-zinc-800 rounded overflow-hidden">
        <div style={{ width: `${pct}%` }} className={`h-full ${color} rounded transition-all`} />
      </div>
      <span className="text-[10px] font-mono text-zinc-300 w-16 text-right shrink-0">{formatBytes(bytes)}</span>
    </div>
  );
}

// ─── RT rows ─────────────────────────────────────────────────────────────────

function RTRows({ rows, maxBytes }: { rows: RTMemStat[]; maxBytes: number }) {
  const sorted = useMemo(() => [...rows].sort((a, b) => b.bytes - a.bytes), [rows]);
  if (sorted.length === 0) return <p className="text-[10px] text-zinc-700 italic py-1">None</p>;
  return (
    <div className="flex flex-col gap-0.5">
      {sorted.map((rt) => (
        <div key={rt.id} className="flex items-center gap-2 py-0.5">
          <span className="text-[10px] font-mono text-blue-400/80 shrink-0">▣</span>
          <span className="text-[10px] text-zinc-300 truncate w-36 shrink-0" title={rt.name}>{rt.name}</span>
          <span className="text-[9px] font-mono text-zinc-600 w-20 shrink-0">
            {rt.isViewportScaled ? `${rt.width}×${rt.height}` : `${rt.width}×${rt.height} ✦`}
          </span>
          <span className="text-[9px] font-mono text-zinc-600 w-20 shrink-0">{rt.format.toUpperCase()}</span>
          {rt.mips > 1 && <span className="text-[9px] font-mono text-zinc-700 shrink-0">{rt.mips}mip</span>}
          {rt.layers > 1 && <span className="text-[9px] font-mono text-zinc-700 shrink-0">{rt.layers}L</span>}
          <MemBar bytes={rt.bytes} maxBytes={maxBytes} color="bg-blue-500" />
        </div>
      ))}
    </div>
  );
}

// ─── Buffer rows ──────────────────────────────────────────────────────────────

function BufRows({ rows, maxBytes }: { rows: BufMemStat[]; maxBytes: number }) {
  const sorted = useMemo(() => [...rows].sort((a, b) => b.bytes - a.bytes), [rows]);
  if (sorted.length === 0) return <p className="text-[10px] text-zinc-700 italic py-1">None</p>;
  return (
    <div className="flex flex-col gap-0.5">
      {sorted.map((buf) => (
        <div key={buf.id} className="flex items-center gap-2 py-0.5">
          <span className="text-[10px] font-mono text-amber-400/80 shrink-0">▤</span>
          <span className="text-[10px] text-zinc-300 truncate w-36 shrink-0" title={buf.name}>{buf.name}</span>
          <MemBar bytes={buf.bytes} maxBytes={maxBytes} color="bg-amber-500" />
        </div>
      ))}
    </div>
  );
}

// ─── StatsModal ───────────────────────────────────────────────────────────────

export function StatsModal({ onClose }: { onClose: () => void }) {
  const { pipeline, resources } = useStore();

  const [vp, setVp] = useState({ w: 1920, h: 1080 });
  const [wStr, setWStr] = useState('1920');
  const [hStr, setHStr] = useState('1080');

  const applyPreset = (w: number, h: number) => {
    setVp({ w, h });
    setWStr(String(w));
    setHStr(String(h));
  };
  const commitW = () => { const n = parseInt(wStr, 10); if (n > 0) setVp((v) => ({ ...v, w: n })); else setWStr(String(vp.w)); };
  const commitH = () => { const n = parseInt(hStr, 10); if (n > 0) setVp((v) => ({ ...v, h: n })); else setHStr(String(vp.h)); };

  const stats = useMemo(() => computeMemStats(resources, pipeline, vp), [resources, pipeline, vp]);

  const allMaxBytes = Math.max(
    ...stats.renderTargets.map((r) => r.bytes),
    ...stats.buffers.map((b) => b.bytes),
    1,
  );

  const rtPct  = stats.totalBytes > 0 ? ((stats.rtTotalBytes  / stats.totalBytes) * 100).toFixed(1) : '0';
  const bufPct = stats.totalBytes > 0 ? ((stats.bufTotalBytes / stats.totalBytes) * 100).toFixed(1) : '0';

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-6"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={onClose}>

      <div className="flex flex-col bg-zinc-900 border border-zinc-700/80 rounded-xl shadow-2xl overflow-hidden"
        style={{ width: 640, maxHeight: 'calc(100vh - 80px)' }}
        onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-zinc-700/60 shrink-0">
          <span className="text-xs font-bold text-zinc-200 tracking-wide">Pipeline Memory Stats</span>
          <span className="text-[10px] text-zinc-500 font-mono">{pipeline.name}</span>
          <div className="flex-1" />
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 text-sm leading-none p-1">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-5">

          {/* Viewport size */}
          <div>
            <SectionHead label="Viewport Size" />
            <div className="flex items-center gap-2 flex-wrap">
              {VIEWPORT_PRESETS.map((p) => (
                <button key={p.label}
                  onClick={() => applyPreset(p.w, p.h)}
                  className={`text-[10px] px-2 py-0.5 rounded border font-mono transition-colors
                    ${vp.w === p.w && vp.h === p.h
                      ? 'border-blue-500/70 bg-blue-950/40 text-blue-300'
                      : 'border-zinc-700/60 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300'}`}>
                  {p.label}
                </button>
              ))}
              <div className="flex items-center gap-1 ml-1">
                <input
                  type="number" min={1} value={wStr}
                  onChange={(e) => setWStr(e.target.value)}
                  onBlur={commitW}
                  onKeyDown={(e) => e.key === 'Enter' && commitW()}
                  className="w-16 bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-[10px] text-zinc-200 font-mono focus:outline-none focus:border-blue-600 text-right"
                />
                <span className="text-zinc-600 text-xs">×</span>
                <input
                  type="number" min={1} value={hStr}
                  onChange={(e) => setHStr(e.target.value)}
                  onBlur={commitH}
                  onKeyDown={(e) => e.key === 'Enter' && commitH()}
                  className="w-16 bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-[10px] text-zinc-200 font-mono focus:outline-none focus:border-blue-600 text-right"
                />
              </div>
            </div>
          </div>

          {/* Summary cards */}
          <div>
            <SectionHead label="Memory Summary" />
            <div className="grid grid-cols-3 gap-3 mb-3">
              {[
                { label: 'Total VRAM', value: formatBytes(stats.totalBytes), sub: null, accent: 'text-zinc-200' },
                { label: 'Render Targets', value: formatBytes(stats.rtTotalBytes), sub: `${rtPct}% · ${stats.renderTargets.length} RTs`, accent: 'text-blue-400' },
                { label: 'Buffers', value: formatBytes(stats.bufTotalBytes), sub: `${bufPct}% · ${stats.buffers.length} bufs`, accent: 'text-amber-400' },
              ].map(({ label, value, sub, accent }) => (
                <div key={label} className="bg-zinc-800/60 border border-zinc-700/50 rounded-lg px-3 py-2">
                  <div className="text-[9px] text-zinc-500 uppercase tracking-widest mb-0.5">{label}</div>
                  <div className={`text-base font-bold font-mono ${accent}`}>{value}</div>
                  {sub && <div className="text-[9px] text-zinc-600 mt-0.5">{sub}</div>}
                </div>
              ))}
            </div>
            <ProportionBar rtBytes={stats.rtTotalBytes} bufBytes={stats.bufTotalBytes} />
            <div className="flex items-center gap-3 mt-1">
              <span className="flex items-center gap-1 text-[9px] text-zinc-600"><span className="w-2 h-2 rounded-sm bg-blue-600 inline-block" />Render Targets</span>
              <span className="flex items-center gap-1 text-[9px] text-zinc-600"><span className="w-2 h-2 rounded-sm bg-amber-600 inline-block" />Buffers</span>
            </div>
          </div>

          {/* Render Targets */}
          <div>
            <SectionHead label="Render Targets" right={
              <span className="text-[9px] font-mono text-zinc-600">✦ fixed size</span>
            } />
            <RTRows rows={stats.renderTargets} maxBytes={allMaxBytes} />
          </div>

          {/* Buffers */}
          <div>
            <SectionHead label="Buffers" />
            <BufRows rows={stats.buffers} maxBytes={allMaxBytes} />
          </div>

          {/* Pipeline overview */}
          <div>
            <SectionHead label="Pipeline Overview" />
            <div className="grid grid-cols-2 gap-x-8 gap-y-1">
              {[
                ['Timelines',    String(stats.timelineCount)],
                ['Total passes', `${stats.passOverview.total} (${stats.passOverview.enabled} enabled)`],
                ['Conditional',  `${stats.passOverview.conditional} pass${stats.passOverview.conditional !== 1 ? 'es' : ''}`],
                ['Steps',        String(stats.stepCount)],
                ...Object.entries(stats.passOverview.byKind).map(([k, v]) => [`${k.charAt(0).toUpperCase() + k.slice(1)} passes`, String(v)]),
                ...Object.entries(stats.shadersByStage).map(([s, v]) => [`${s.charAt(0).toUpperCase() + s.slice(1)} shaders`, String(v)]),
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between text-[10px] py-0.5 border-b border-zinc-800/50">
                  <span className="text-zinc-500">{label}</span>
                  <span className="font-mono text-zinc-300">{value}</span>
                </div>
              ))}
            </div>
          </div>

        </div>

        {/* Footer note */}
        <div className="px-4 py-2 border-t border-zinc-800/60 shrink-0">
          <p className="text-[9px] text-zinc-700">
            Memory estimates assume all resources are simultaneously resident. Mip chains and array layers are included. Compressed formats use block-size approximations.
          </p>
        </div>
      </div>
    </div>
  );
}
