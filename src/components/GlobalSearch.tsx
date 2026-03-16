import { useState, useEffect, useRef, useMemo } from "react";
import { useStore } from "../state/store";

// ─── Types ────────────────────────────────────────────────────────────────────

type ResultKind =
    | "pass"
    | "step"
    | "renderTarget"
    | "buffer"
    | "shader"
    | "blendState"
    | "inputParam";

interface SearchResult {
    id: string;
    kind: ResultKind;
    name: string;
    subtitle?: string;
    parentPassId?: string;
}

const KIND_LABELS: Record<ResultKind, string> = {
    pass: "Pass",
    step: "Step",
    renderTarget: "RT",
    buffer: "Buffer",
    shader: "Shader",
    blendState: "Blend",
    inputParam: "Param",
};

const KIND_COLORS: Record<ResultKind, string> = {
    pass: "bg-blue-900/50 text-blue-300 border-blue-700/40",
    step: "bg-cyan-900/50 text-cyan-300 border-cyan-700/40",
    renderTarget: "bg-amber-900/50 text-amber-300 border-amber-700/40",
    buffer: "bg-violet-900/50 text-violet-300 border-violet-700/40",
    shader: "bg-emerald-900/50 text-emerald-300 border-emerald-700/40",
    blendState: "bg-rose-900/50 text-rose-300 border-rose-700/40",
    inputParam: "bg-zinc-700/50 text-zinc-300 border-zinc-600/40",
};

// ─── Component ────────────────────────────────────────────────────────────────

interface GlobalSearchProps {
    open: boolean;
    onClose: () => void;
}

export function GlobalSearch({ open, onClose }: GlobalSearchProps) {
    const { pipeline, resources, selectPass, selectStep, selectResource } = useStore();
    const [query, setQuery] = useState("");
    const [activeIdx, setActiveIdx] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    // Reset and focus when opened
    useEffect(() => {
        if (open) {
            setQuery("");
            setActiveIdx(0);
            setTimeout(() => inputRef.current?.focus(), 0);
        }
    }, [open]);

    const results = useMemo<SearchResult[]>(() => {
        const q = query.toLowerCase().trim();
        if (!q) return [];

        const out: SearchResult[] = [];

        // Passes
        for (const tl of pipeline.timelines) {
            for (const pid of tl.passIds) {
                const pass = pipeline.passes[pid];
                if (pass?.name.toLowerCase().includes(q)) {
                    out.push({ id: pass.id, kind: "pass", name: pass.name, subtitle: tl.name });
                }
            }
        }

        // Steps
        for (const tl of pipeline.timelines) {
            for (const pid of tl.passIds) {
                const pass = pipeline.passes[pid];
                if (!pass) continue;
                for (const sid of pass.steps) {
                    const step = pipeline.steps[sid];
                    if (step?.name.toLowerCase().includes(q)) {
                        out.push({
                            id: step.id,
                            kind: "step",
                            name: step.name,
                            subtitle: pass.name,
                            parentPassId: pass.id,
                        });
                    }
                }
            }
        }

        // Render Targets
        for (const rt of resources.renderTargets) {
            if (rt.name.toLowerCase().includes(q)) {
                out.push({ id: rt.id, kind: "renderTarget", name: rt.name, subtitle: rt.format });
            }
        }

        // Buffers
        for (const buf of resources.buffers) {
            if (buf.name.toLowerCase().includes(q)) {
                out.push({ id: buf.id, kind: "buffer", name: buf.name });
            }
        }

        // Shaders
        for (const sh of resources.shaders) {
            if (sh.name.toLowerCase().includes(q)) {
                out.push({ id: sh.id, kind: "shader", name: sh.name, subtitle: sh.stage });
            }
        }

        // Blend States
        for (const bs of resources.blendStates) {
            if (bs.name.toLowerCase().includes(q)) {
                out.push({ id: bs.id, kind: "blendState", name: bs.name });
            }
        }

        // Input Parameters
        for (const ip of resources.inputParameters) {
            if (ip.name.toLowerCase().includes(q)) {
                out.push({ id: ip.id, kind: "inputParam", name: ip.name, subtitle: ip.type });
            }
        }

        return out;
    }, [query, pipeline, resources]);

    // Reset active index when results change
    useEffect(() => {
        setActiveIdx(0);
    }, [results]);

    const select = (result: SearchResult) => {
        switch (result.kind) {
            case "pass":
                selectResource(null);
                selectStep(null);
                selectPass(result.id);
                break;
            case "step":
                selectResource(null);
                if (result.parentPassId) selectPass(result.parentPassId);
                selectStep(result.id);
                break;
            default:
                selectPass(null);
                selectStep(null);
                selectResource(result.id);
                break;
        }
        onClose();
    };

    // Keyboard navigation
    useEffect(() => {
        if (!open) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                onClose();
            } else if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIdx((i) => Math.min(i + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIdx((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
                const r = results[activeIdx];
                if (r) select(r);
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [open, results, activeIdx]);

    // Scroll active item into view
    useEffect(() => {
        const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`);
        el?.scrollIntoView({ block: "nearest" });
    }, [activeIdx]);

    if (!open) return null;

    return (
        <>
            {/* Backdrop */}
            <div className="fixed inset-0 z-50 bg-black/50" onClick={onClose} />

            {/* Palette */}
            <div className="fixed top-[18%] left-1/2 -translate-x-1/2 z-50 w-[560px] max-w-[calc(100vw-2rem)] flex flex-col bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl overflow-hidden">
                {/* Search input */}
                <div className="flex items-center gap-2.5 px-3 py-2.5 border-b border-zinc-700/60">
                    <span className="text-zinc-500 text-base shrink-0 leading-none">⌕</span>
                    <input
                        ref={inputRef}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search passes, steps, render targets, shaders…"
                        className="flex-1 bg-transparent text-zinc-100 text-sm focus:outline-none placeholder-zinc-600"
                    />
                    <kbd className="text-[10px] text-zinc-600 border border-zinc-700 rounded px-1.5 py-0.5 shrink-0 font-mono">
                        Esc
                    </kbd>
                </div>

                {/* Results list */}
                <div ref={listRef} className="max-h-80 overflow-y-auto">
                    {query.trim() === "" ? (
                        <div className="px-4 py-8 text-center text-xs text-zinc-600">
                            Type to search passes, steps, render targets, shaders…
                        </div>
                    ) : results.length === 0 ? (
                        <div className="px-4 py-8 text-center text-xs text-zinc-600">
                            No results for "{query}"
                        </div>
                    ) : (
                        results.map((r, i) => (
                            <div
                                key={`${r.kind}-${r.id}`}
                                data-idx={i}
                                onClick={() => select(r)}
                                onMouseEnter={() => setActiveIdx(i)}
                                className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer border-b border-zinc-800/40 select-none transition-colors
                                    ${i === activeIdx ? "bg-blue-900/30" : "hover:bg-zinc-800/40"}`}
                            >
                                <span
                                    className={`text-[10px] font-mono px-1.5 py-0.5 rounded border shrink-0 w-14 text-center ${KIND_COLORS[r.kind]}`}
                                >
                                    {KIND_LABELS[r.kind]}
                                </span>
                                <span className="text-sm text-zinc-200 font-medium truncate flex-1">
                                    {r.name}
                                </span>
                                {r.subtitle && (
                                    <span className="text-[11px] text-zinc-500 shrink-0 truncate max-w-[180px]">
                                        {r.subtitle}
                                    </span>
                                )}
                            </div>
                        ))
                    )}
                </div>

                {/* Footer hints */}
                {results.length > 0 && (
                    <div className="flex items-center gap-3 px-3 py-1.5 border-t border-zinc-800/60 bg-zinc-950/40 shrink-0">
                        <span className="text-[10px] text-zinc-600">↑↓ navigate</span>
                        <span className="text-[10px] text-zinc-600">↵ select</span>
                        <span className="text-[10px] text-zinc-600">Esc close</span>
                        <span className="flex-1" />
                        <span className="text-[10px] text-zinc-600">
                            {results.length} result{results.length !== 1 ? "s" : ""}
                        </span>
                    </div>
                )}
            </div>
        </>
    );
}
