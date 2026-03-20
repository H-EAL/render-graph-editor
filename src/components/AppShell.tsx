import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { useStore } from "../state/store";
import { examples, type ExampleId } from "../data/seed";
import { getApiKey, setApiKey } from "../utils/shaderApi";
import { PipelineTimelineView } from "../features/pipeline/PipelineTimelineView";
import { PassInspector } from "../features/pass/PassInspector";
import { StepInspector } from "../features/step/StepInspector";
import { ResourceDrawer } from "../features/resources/ResourceDrawer";
import { JsonPreviewPanel } from "./JsonPreviewPanel";
import { GlobalSearch } from "./GlobalSearch";
import { validateDocument } from "../validation";
import { StatsModal } from "../features/stats/StatsModal";
import { InputEditorPanel } from "../features/inputs/InputEditorPanel";
import { computeMemStats, formatBytes } from "../utils/memoryStats";

// ─── Resize hooks ─────────────────────────────────────────────────────────────

function useResizeW(initial: number, min: number, max: number, dir: "left" | "right") {
    const [width, setWidth] = useState(initial);
    const drag = useRef(false);
    const x0 = useRef(0);
    const w0 = useRef(0);
    const onMouseDown = useCallback(
        (e: React.MouseEvent) => {
            drag.current = true;
            x0.current = e.clientX;
            w0.current = width;
            e.preventDefault();
            const move = (ev: MouseEvent) => {
                if (!drag.current) return;
                const d = dir === "right" ? ev.clientX - x0.current : x0.current - ev.clientX;
                setWidth(Math.max(min, Math.min(max, w0.current + d)));
            };
            const up = () => {
                drag.current = false;
                window.removeEventListener("mousemove", move);
                window.removeEventListener("mouseup", up);
            };
            window.addEventListener("mousemove", move);
            window.addEventListener("mouseup", up);
        },
        [width, min, max, dir],
    );
    return { width, onMouseDown };
}

// ─── 3dverse API key button ───────────────────────────────────────────────────

function ApiKeyButton() {
    const [open, setOpen] = useState(false);
    const [value, setValue] = useState(() => getApiKey());
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [open]);

    const save = () => {
        setApiKey(value.trim());
        setOpen(false);
        void useStore.getState().resolveShaderNames();
    };

    const hasKey = !!getApiKey();

    return (
        <div className="relative" ref={ref}>
            <button
                onClick={() => setOpen((v) => !v)}
                title="Configure 3dverse API key for shader descriptors"
                className={`text-[11px] px-2 py-1 rounded border font-mono transition-colors ${
                    hasKey
                        ? "bg-emerald-900/30 border-emerald-700/50 text-emerald-400 hover:border-emerald-600"
                        : "bg-zinc-800/60 border-zinc-700/60 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600"
                }`}
            >
                ⚙ 3dv
            </button>
            {open && (
                <div className="absolute top-full right-0 mt-1 z-50 w-72 bg-zinc-900 border border-zinc-700 rounded shadow-2xl p-3 flex flex-col gap-2">
                    <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
                        3dverse API Key
                    </span>
                    <p className="text-[10px] text-zinc-500">
                        Used to fetch shader descriptors (slot names &amp; access) from the 3dverse
                        API. Stored in localStorage.
                    </p>
                    <input
                        type="password"
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && save()}
                        placeholder="Paste your api_key here…"
                        className="w-full bg-zinc-800 border border-zinc-700 text-zinc-100 text-xs rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
                        autoComplete="off"
                    />
                    <div className="flex gap-2 justify-end">
                        <button
                            onClick={() => setOpen(false)}
                            className="text-[11px] px-2 py-1 rounded text-zinc-500 hover:text-zinc-300"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={save}
                            className="text-[11px] px-3 py-1 rounded bg-emerald-800/50 border border-emerald-700/50 text-emerald-300 hover:bg-emerald-700/50"
                        >
                            Save
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── Pipeline header ──────────────────────────────────────────────────────────

function PipelineHeader({
    onToggleJson,
    jsonOpen,
    activeExample,
    onSelectExample,
    onOpenSearch,
    onOpenInputs,
}: {
    onToggleJson: () => void;
    jsonOpen: boolean;
    activeExample: ExampleId;
    onSelectExample: (id: ExampleId) => void;
    onOpenSearch: () => void;
    onOpenInputs: () => void;
}) {
    const { pipeline, setPipelineName } = useStore();
    const [editing, setEditing] = useState(false);
    const [name, setName] = useState(pipeline.name);
    const commit = () => {
        const t = name.trim();
        if (t) setPipelineName(t);
        setEditing(false);
    };
    return (
        <div className="flex items-center gap-3 px-4 py-2 bg-zinc-900 border-b border-zinc-700/80 shrink-0">
            <span className="text-xs font-bold text-zinc-500 tracking-tight shrink-0">
                Render Pipeline Editor
            </span>
            <span className="text-zinc-700">·</span>
            {editing ? (
                <input
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={commit}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") commit();
                        if (e.key === "Escape") setEditing(false);
                    }}
                    className="bg-zinc-800 border border-zinc-600 text-zinc-100 text-sm font-semibold rounded px-2 py-0.5 focus:outline-none"
                />
            ) : (
                <button
                    className="text-sm font-semibold text-zinc-200 hover:text-white"
                    onDoubleClick={() => {
                        setName(pipeline.name);
                        setEditing(true);
                    }}
                    title="Double-click to rename"
                >
                    {pipeline.name}
                </button>
            )}
            <span className="text-[10px] text-zinc-600 font-mono">v{pipeline.version}</span>
            <div className="flex-1" />

            {/* Example switcher */}
            <div className="flex items-center gap-0.5 bg-zinc-800/60 border border-zinc-700/60 rounded p-0.5">
                {examples.map((ex) => (
                    <button
                        key={ex.id}
                        onClick={() => onSelectExample(ex.id)}
                        className={`text-[10px] px-2 py-0.5 rounded font-mono transition-colors
              ${
                  activeExample === ex.id
                      ? "bg-zinc-600 text-zinc-100"
                      : "text-zinc-500 hover:text-zinc-300"
              }`}
                    >
                        {ex.label}
                    </button>
                ))}
            </div>

            <button
                onClick={onOpenSearch}
                title="Global search (Ctrl+K)"
                className="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded border bg-zinc-800/60 border-zinc-700/60 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600 transition-colors"
            >
                <span>⌕</span>
                <kbd className="font-mono text-[10px] text-zinc-600">Ctrl K</kbd>
            </button>

            <button
                onClick={onOpenInputs}
                title="Open Render Graph Input Editor"
                className="text-[11px] px-2.5 py-1 rounded border font-mono transition-colors bg-zinc-800/60 border-zinc-700/60 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600"
            >
                Inputs
            </button>

            <ApiKeyButton />

            <button
                onClick={onToggleJson}
                title="Toggle JSON viewer"
                className={`text-[11px] px-2.5 py-1 rounded border font-mono transition-colors
          ${
              jsonOpen
                  ? "bg-zinc-700 border-zinc-500 text-zinc-200"
                  : "bg-zinc-800/60 border-zinc-700/60 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600"
          }`}
            >
                {"{ }"}
            </button>
        </div>
    );
}

// ─── Right inspector ──────────────────────────────────────────────────────────

function RightInspector() {
    const selectedPassId = useStore((s) => s.selectedPassId);
    const selectedStepId = useStore((s) => s.selectedStepId);
    const selectedResourceId = useStore((s) => s.selectedResourceId);

    // Pass / step takes precedence over resource
    if (selectedPassId || selectedStepId) {
        return (
            <div className="flex flex-col h-full">
                <div className="px-3 py-2 border-b border-zinc-700/60 shrink-0">
                    <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                        Inspector
                    </span>
                </div>
                <div className="flex-1 overflow-y-auto">
                    {selectedStepId ? <StepInspector /> : <PassInspector />}
                </div>
            </div>
        );
    }

    if (selectedResourceId) {
        return <ResourceDrawer />;
    }

    return (
        <div className="flex flex-col h-full">
            <div className="px-3 py-2 border-b border-zinc-700/60 shrink-0">
                <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                    Inspector
                </span>
            </div>
            <div className="flex-1 overflow-y-auto">
                <PassInspector />
            </div>
        </div>
    );
}

// ─── Status bar ───────────────────────────────────────────────────────────────

function StatusBar({
    onToggleValidation,
    validationOpen,
    onOpenStats,
}: {
    onToggleValidation: () => void;
    validationOpen: boolean;
    onOpenStats: () => void;
}) {
    const { pipeline, resources, inputDefinitions } = useStore();
    const issues = useMemo(() => validateDocument(pipeline, resources, inputDefinitions), [pipeline, resources, inputDefinitions]);
    const errors = issues.filter((i) => i.severity === "error");
    const warnings = issues.filter((i) => i.severity === "warning");
    const vram = useMemo(
        () => computeMemStats(resources, pipeline, { w: 1920, h: 1080 }),
        [resources, pipeline],
    );

    return (
        <div
            className={`flex items-center h-6 border-t shrink-0 bg-zinc-900 transition-colors
      ${errors.length > 0 ? "border-t-red-900/60" : warnings.length > 0 ? "border-t-amber-900/40" : "border-t-zinc-800"}`}
        >
            {/* Validation section — takes up left portion, clickable */}
            <button
                onClick={onToggleValidation}
                title={validationOpen ? "Hide validation issues" : "Show validation issues"}
                className={`flex items-center gap-2 px-3 h-full transition-colors
          ${validationOpen ? "bg-zinc-800" : "hover:bg-zinc-800/60"}`}
            >
                {issues.length === 0 ? (
                    <span className="text-[10px] text-emerald-500 flex items-center gap-1">
                        <span>✓</span>
                        <span>No issues</span>
                    </span>
                ) : (
                    <>
                        {errors.length > 0 && (
                            <span className="text-[10px] text-red-400">
                                ✗ {errors.length} error{errors.length !== 1 ? "s" : ""}
                            </span>
                        )}
                        {warnings.length > 0 && (
                            <span className="text-[10px] text-amber-400">
                                ⚠ {warnings.length} warning{warnings.length !== 1 ? "s" : ""}
                            </span>
                        )}
                    </>
                )}
                <span className="text-[9px] text-zinc-700">{validationOpen ? "▼" : "▲"}</span>
            </button>

            <div className="w-px h-3 bg-zinc-700/60 mx-1 shrink-0" />

            {/* VRAM stats button */}
            <button
                onClick={onOpenStats}
                title="Open memory stats"
                className="flex items-center gap-1.5 px-2 h-full text-[10px] font-mono text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors"
            >
                <span className="text-zinc-600">▣</span>
                <span>{formatBytes(vram.totalBytes)}</span>
                <span className="text-zinc-700">VRAM</span>
            </button>

            <div className="flex-1" />

            {/* Quick pipeline overview */}
            <span className="text-[9px] font-mono text-zinc-700 pr-3">
                {pipeline.timelines.length}TL · {Object.keys(pipeline.passes).length}P ·{" "}
                {Object.keys(pipeline.steps).length}S · {resources.renderTargets.length}RT
            </span>
        </div>
    );
}

// ─── Validation popover ───────────────────────────────────────────────────────

function ValidationPopover({ onClose }: { onClose: () => void }) {
    const { pipeline, resources, inputDefinitions } = useStore();
    const issues = useMemo(() => validateDocument(pipeline, resources, inputDefinitions), [pipeline, resources, inputDefinitions]);
    const errors = issues.filter((i) => i.severity === "error");
    const warnings = issues.filter((i) => i.severity === "warning");
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) onClose();
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [onClose]);

    return (
        <div
            ref={ref}
            className="absolute bottom-6 left-0 z-50 w-96 max-h-72 flex flex-col bg-zinc-900 border border-zinc-700 rounded-tr shadow-2xl overflow-hidden"
        >
            {/* Header */}
            <div className="flex items-center gap-3 px-3 py-1.5 border-b border-zinc-700/60 shrink-0">
                <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
                    Validation
                </span>
                {errors.length > 0 && (
                    <span className="text-[10px] text-red-400">
                        {errors.length} error{errors.length !== 1 ? "s" : ""}
                    </span>
                )}
                {warnings.length > 0 && (
                    <span className="text-[10px] text-amber-400">
                        {warnings.length} warning{warnings.length !== 1 ? "s" : ""}
                    </span>
                )}
                <button
                    onClick={onClose}
                    className="ml-auto text-zinc-600 hover:text-zinc-300 text-xs"
                >
                    ✕
                </button>
            </div>
            {/* Issue list */}
            <div className="overflow-y-auto">
                {issues.length === 0 ? (
                    <div className="flex items-center gap-2 px-3 py-4 text-emerald-400 text-xs">
                        <span>✓</span>
                        <span>No issues found.</span>
                    </div>
                ) : (
                    issues.map((issue) => (
                        <div
                            key={issue.id}
                            className={`flex items-start gap-2 px-3 py-2 border-b border-zinc-800/60 text-xs
                ${issue.severity === "error" ? "text-red-300" : "text-amber-300"}`}
                        >
                            <span className="shrink-0 mt-0.5">
                                {issue.severity === "error" ? "✗" : "⚠"}
                            </span>
                            <div className="flex flex-col gap-0.5">
                                <span>{issue.message}</span>
                                {issue.location && (
                                    <span className="text-zinc-500">in {issue.location}</span>
                                )}
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
            {open && <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />}
            {/* Panel — always in DOM for transition */}
            <div
                className={`fixed top-0 right-0 bottom-0 z-50 w-130 flex flex-col bg-zinc-900 border-l border-zinc-700/80 shadow-2xl transition-transform duration-200 ease-in-out
          ${open ? "translate-x-0" : "translate-x-full"}`}
            >
                <div className="flex items-center px-3 py-2 border-b border-zinc-700/60 shrink-0">
                    <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                        JSON
                    </span>
                    <button
                        onClick={onClose}
                        className="ml-auto text-zinc-600 hover:text-zinc-300 text-sm leading-none p-1"
                    >
                        ✕
                    </button>
                </div>
                <div className="flex-1 overflow-hidden">{open && <JsonPreviewPanel />}</div>
            </div>
        </>
    );
}

// ─── AppShell ─────────────────────────────────────────────────────────────────

export function AppShell() {
    const [showJson, setShowJson] = useState(false);
    const [showValidation, setShowValidation] = useState(false);
    const [showStats, setShowStats] = useState(false);
    const [showSearch, setShowSearch] = useState(false);
    const [showInputEditor, setShowInputEditor] = useState(false);
    const [rightCollapsed, setRightCollapsed] = useState(false);
    const [activeExample, setActiveExample] = useState<ExampleId>("rg");

    // Global Ctrl+K / Cmd+K shortcut
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "k") {
                e.preventDefault();
                setShowSearch((v) => !v);
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, []);

    const loadDocument = useStore((s) => s.loadDocument);
    const handleSelectExample = useCallback(
        (id: ExampleId) => {
            const ex = examples.find((e) => e.id === id);
            if (ex) {
                loadDocument(JSON.stringify(ex.doc));
                setActiveExample(id);
            }
        },
        [loadDocument],
    );

    const rightPanel = useResizeW(360, 220, 640, "left");

    return (
        <div className="flex flex-col h-screen bg-zinc-950 text-zinc-100 overflow-hidden">
            {/* Title bar + pipeline name */}
            <PipelineHeader
                onToggleJson={() => setShowJson((v) => !v)}
                jsonOpen={showJson}
                activeExample={activeExample}
                onSelectExample={handleSelectExample}
                onOpenSearch={() => setShowSearch(true)}
                onOpenInputs={() => setShowInputEditor(true)}
            />

            {/* Main area: timeline (left) + right panel */}
            <div className="flex flex-1 overflow-hidden min-h-0">
                {/* Left: timeline, fills all available space */}
                <div className="flex-1 overflow-hidden min-w-0">
                    <PipelineTimelineView />
                </div>

                {/* Right panel (collapsible) */}
                {!rightCollapsed && (
                    <>
                        <div
                            onMouseDown={rightPanel.onMouseDown}
                            className="w-1 bg-zinc-800 hover:bg-blue-600/50 cursor-col-resize shrink-0 transition-colors"
                        />
                        <div
                            style={{ width: rightPanel.width }}
                            className="flex flex-col shrink-0 overflow-hidden bg-zinc-900 border-l border-zinc-700/60"
                        >
                            <RightInspector />
                        </div>
                    </>
                )}

                {/* Collapse / expand tab */}
                <button
                    onClick={() => setRightCollapsed((v) => !v)}
                    title={rightCollapsed ? "Expand panel" : "Collapse panel"}
                    className="w-4 shrink-0 bg-zinc-900 border-l border-zinc-800 hover:bg-zinc-800 text-zinc-600 hover:text-zinc-300 transition-colors flex items-center justify-center text-[9px]"
                >
                    {rightCollapsed ? "◀" : "▶"}
                </button>
            </div>

            {/* Status bar + validation popover */}
            <div className="relative shrink-0">
                {showValidation && <ValidationPopover onClose={() => setShowValidation(false)} />}
                <StatusBar
                    onToggleValidation={() => setShowValidation((v) => !v)}
                    validationOpen={showValidation}
                    onOpenStats={() => setShowStats(true)}
                />
            </div>

            {/* Stats modal */}
            {showStats && <StatsModal onClose={() => setShowStats(false)} />}

            {/* Input editor */}
            {showInputEditor && <InputEditorPanel onClose={() => setShowInputEditor(false)} />}

            {/* JSON drawer (overlay) */}
            <JsonDrawer open={showJson} onClose={() => setShowJson(false)} />

            {/* Global search palette */}
            <GlobalSearch open={showSearch} onClose={() => setShowSearch(false)} />
        </div>
    );
}
