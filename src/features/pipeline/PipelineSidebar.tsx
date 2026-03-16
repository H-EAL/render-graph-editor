import {
    useState,
    useRef,
    useMemo,
    useLayoutEffect,
    useCallback,
    createContext,
    useContext,
} from "react";
import {
    DndContext,
    closestCenter,
    PointerSensor,
    KeyboardSensor,
    useSensor,
    useSensors,
    type DragEndEvent,
} from "@dnd-kit/core";
import {
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy,
    arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useStore } from "../../state/store";
import { Button } from "../../components/ui/Button";
import type { Pass, PassId, Timeline, TimelineType } from "../../types";

// ─── Timeline type badge colors ───────────────────────────────────────────────

const TL_COLORS: Record<TimelineType, string> = {
    graphics: "bg-blue-900/50 text-blue-300 border-blue-700/50",
    asyncCompute: "bg-purple-900/50 text-purple-300 border-purple-700/50",
    transfer: "bg-amber-900/50 text-amber-300 border-amber-700/50",
    raytracing: "bg-emerald-900/50 text-emerald-300 border-emerald-700/50",
    custom: "bg-zinc-700/50 text-zinc-300 border-zinc-600/50",
};

const TL_TYPE_LABELS: Record<TimelineType, string> = {
    graphics: "Graphics",
    asyncCompute: "Async Compute",
    transfer: "Transfer",
    raytracing: "Ray Tracing",
    custom: "Custom",
};

const TL_TYPE_OPTS: { value: TimelineType; label: string }[] = [
    { value: "graphics", label: "Graphics" },
    { value: "asyncCompute", label: "Async Compute" },
    { value: "transfer", label: "Transfer" },
    { value: "raytracing", label: "Ray Tracing" },
    { value: "custom", label: "Custom" },
];

// ─── Merge context ───────────────────────────────────────────────────────────

interface MergeCtx {
    mergeMode: boolean;
    mergeSelection: Set<PassId>;
    toggleMerge: (passId: PassId) => void;
}

const MergeContext = createContext<MergeCtx>({
    mergeMode: false,
    mergeSelection: new Set(),
    toggleMerge: () => undefined,
});

// ─── Pass row ─────────────────────────────────────────────────────────────────

function PassRow({ pass, timelineId }: { pass: Pass; timelineId: string }) {
    const {
        selectedPassId,
        selectPass,
        deletePass,
        duplicatePass,
        updatePass,
        pipeline,
        movePassToTimeline,
    } = useStore();
    const { mergeMode, mergeSelection, toggleMerge } = useContext(MergeContext);
    const isSelected = selectedPassId === pass.id;
    const isMergeSelected = mergeSelection.has(pass.id);
    const [editing, setEditing] = useState(false);
    const [editName, setEditName] = useState(pass.name);
    const [showMove, setShowMove] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: pass.id,
    });
    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
    };

    // Scroll into view when selected (e.g. via global search)
    useLayoutEffect(() => {
        if (!isSelected) return;
        const el = document.querySelector<HTMLElement>(`[data-pass-id="${pass.id}"]`);
        el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, [isSelected, pass.id]);

    const otherTimelines = pipeline.timelines.filter((tl) => tl.id !== timelineId);

    const startEdit = (e: React.MouseEvent) => {
        e.stopPropagation();
        setEditName(pass.name);
        setEditing(true);
        setTimeout(() => inputRef.current?.select(), 0);
    };

    const commitEdit = () => {
        const t = editName.trim();
        if (t) updatePass(pass.id, { name: t });
        setEditing(false);
    };

    const confirmDelete = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (window.confirm(`Delete pass "${pass.name}"?`)) deletePass(pass.id);
    };

    return (
        <div
            ref={setNodeRef}
            data-pass-id={pass.id}
            style={style}
            onClick={() => (mergeMode ? toggleMerge(pass.id) : selectPass(pass.id))}
            className={`group relative flex flex-col gap-0.5 px-2 py-2 cursor-pointer border-b border-zinc-800/50 hover:bg-zinc-800/40 select-none
        ${isMergeSelected ? "bg-violet-900/25 border-l-2 border-l-violet-500" : isSelected && !mergeMode ? "bg-blue-900/20 border-l-2 border-l-blue-500" : "border-l-2 border-l-transparent"}`}
        >
            <div className="flex items-center gap-1.5">
                {mergeMode ? (
                    <span
                        className={`shrink-0 w-3.5 h-3.5 rounded border flex items-center justify-center text-[9px] cursor-pointer
                            ${
                                isMergeSelected
                                    ? "bg-violet-600 border-violet-500 text-white"
                                    : "border-zinc-600 text-transparent"
                            }`}
                        onClick={(e) => {
                            e.stopPropagation();
                            toggleMerge(pass.id);
                        }}
                    >
                        ✓
                    </span>
                ) : (
                    <button
                        {...attributes}
                        {...listeners}
                        onClick={(e) => e.stopPropagation()}
                        className="text-zinc-700 hover:text-zinc-400 cursor-grab active:cursor-grabbing text-xs shrink-0"
                    >
                        ⠿
                    </button>
                )}

                {editing ? (
                    <input
                        ref={inputRef}
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onBlur={commitEdit}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") commitEdit();
                            if (e.key === "Escape") setEditing(false);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="flex-1 bg-zinc-700 text-zinc-100 text-xs rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                ) : (
                    <span
                        className="flex-1 text-xs text-zinc-200 truncate font-medium"
                        onDoubleClick={startEdit}
                    >
                        {pass.name}
                    </span>
                )}

                <div
                    className="hidden group-hover:flex items-center gap-0 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                >
                    <button
                        onClick={startEdit}
                        title="Rename"
                        className="p-1 text-zinc-600 hover:text-zinc-300 text-xs"
                    >
                        ✎
                    </button>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            duplicatePass(pass.id);
                        }}
                        title="Duplicate"
                        className="p-1 text-zinc-600 hover:text-zinc-300 text-xs"
                    >
                        ⧉
                    </button>
                    {otherTimelines.length > 0 && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setShowMove(!showMove);
                            }}
                            title="Move to timeline"
                            className="p-1 text-zinc-600 hover:text-zinc-300 text-xs"
                        >
                            ↔
                        </button>
                    )}
                    <button
                        onClick={confirmDelete}
                        title="Delete"
                        className="p-1 text-zinc-600 hover:text-red-400 text-xs"
                    >
                        ✕
                    </button>
                </div>
            </div>

            <div className="flex items-center gap-2 pl-4">
                <span className="text-[10px] text-zinc-600">
                    {pass.steps.length} step{pass.steps.length !== 1 ? "s" : ""}
                </span>
                {!pass.enabled && (
                    <span className="text-[10px] text-zinc-600 italic">disabled</span>
                )}
                {pass.conditions.length > 0 && (
                    <span className="text-[10px] text-amber-500/70">
                        {pass.conditions.length} cond
                    </span>
                )}
            </div>

            {/* Move to timeline dropdown */}
            {showMove && (
                <div
                    className="absolute left-0 top-full z-50 w-full bg-zinc-800 border border-zinc-600 rounded shadow-xl"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="px-2 py-1 text-[10px] text-zinc-500 border-b border-zinc-700">
                        Move to timeline
                    </div>
                    {otherTimelines.map((tl) => (
                        <button
                            key={tl.id}
                            className="w-full text-left px-2 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700"
                            onClick={() => {
                                movePassToTimeline(pass.id, tl.id);
                                setShowMove(false);
                            }}
                        >
                            {tl.name}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

// ─── Timeline column ──────────────────────────────────────────────────────────

function TimelineColumn({ timeline }: { timeline: Timeline }) {
    const { pipeline, addPass, reorderPassesInTimeline, deleteTimeline, updateTimeline } =
        useStore();
    const [editingName, setEditingName] = useState(false);
    const [editName, setEditName] = useState(timeline.name);
    const nameRef = useRef<HTMLInputElement>(null);

    const passes = timeline.passIds.map((pid) => pipeline.passes[pid]).filter(Boolean) as Pass[];

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );

    const onDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (over && active.id !== over.id) {
            const oldIdx = timeline.passIds.indexOf(active.id as string);
            const newIdx = timeline.passIds.indexOf(over.id as string);
            reorderPassesInTimeline(timeline.id, arrayMove(timeline.passIds, oldIdx, newIdx));
        }
    };

    const commitName = () => {
        const t = editName.trim();
        if (t) updateTimeline(timeline.id, { name: t });
        setEditingName(false);
    };

    const confirmDelete = () => {
        if (
            passes.length > 0 &&
            !window.confirm(`Delete timeline "${timeline.name}" and its ${passes.length} pass(es)?`)
        )
            return;
        deleteTimeline(timeline.id);
    };

    const tlColor = TL_COLORS[timeline.type] ?? TL_COLORS.custom;

    return (
        <div
            className="flex flex-col border-r border-zinc-700/60 last:border-r-0"
            style={{ minWidth: 0, flex: 1 }}
        >
            {/* Timeline header */}
            <div
                className={`flex flex-col gap-1 px-2 py-2 border-b border-zinc-700/60 bg-zinc-900/60`}
            >
                <div className="flex items-center gap-1">
                    <span
                        className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${tlColor}`}
                    >
                        {TL_TYPE_LABELS[timeline.type]}
                    </span>
                    <div className="flex-1" />
                    <button
                        onClick={() => {
                            setEditName(timeline.name);
                            setEditingName(true);
                            setTimeout(() => nameRef.current?.select(), 0);
                        }}
                        className="text-zinc-600 hover:text-zinc-300 text-xs p-0.5"
                        title="Rename"
                    >
                        ✎
                    </button>
                    <button
                        onClick={confirmDelete}
                        className="text-zinc-600 hover:text-red-400 text-xs p-0.5"
                        title="Delete timeline"
                    >
                        ✕
                    </button>
                </div>
                {editingName ? (
                    <input
                        ref={nameRef}
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onBlur={commitName}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") commitName();
                            if (e.key === "Escape") setEditingName(false);
                        }}
                        className="bg-zinc-700 text-zinc-100 text-xs font-semibold rounded px-1.5 py-0.5 w-full focus:outline-none"
                    />
                ) : (
                    <span
                        className="text-xs font-semibold text-zinc-200 truncate"
                        onDoubleClick={() => {
                            setEditName(timeline.name);
                            setEditingName(true);
                        }}
                    >
                        {timeline.name}
                    </span>
                )}
                <div className="flex items-center justify-between">
                    <span className="text-[10px] text-zinc-600">
                        {passes.length} pass{passes.length !== 1 ? "es" : ""}
                    </span>
                    <Button
                        size="sm"
                        variant="primary"
                        onClick={() => addPass(timeline.id)}
                        className="text-[10px] py-0.5 px-1.5"
                    >
                        + Pass
                    </Button>
                </div>
            </div>

            {/* Pass list */}
            <div className="flex-1 overflow-y-auto">
                {passes.length === 0 ? (
                    <div className="px-2 py-4 text-center text-[10px] text-zinc-600">No passes</div>
                ) : (
                    <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={onDragEnd}
                    >
                        <SortableContext
                            items={timeline.passIds}
                            strategy={verticalListSortingStrategy}
                        >
                            {passes.map((pass) => (
                                <PassRow key={pass.id} pass={pass} timelineId={timeline.id} />
                            ))}
                        </SortableContext>
                    </DndContext>
                )}
            </div>
        </div>
    );
}

// ─── Search results panel ─────────────────────────────────────────────────────

function SearchResults({ query, onClose }: { query: string; onClose: () => void }) {
    const { pipeline, selectPass, selectStep } = useStore();
    const q = query.toLowerCase();

    const results = useMemo(() => {
        return pipeline.timelines.flatMap((tl) =>
            tl.passIds.flatMap((pid) => {
                const pass = pipeline.passes[pid];
                if (!pass) return [];
                const passMatch = pass.name.toLowerCase().includes(q);
                const matchingSteps = pass.steps
                    .map((sid) => pipeline.steps[sid])
                    .filter(
                        (s): s is NonNullable<typeof s> => !!s && s.name.toLowerCase().includes(q),
                    );
                if (!passMatch && matchingSteps.length === 0) return [];
                return [{ pass, tl, passMatch, matchingSteps }];
            }),
        );
    }, [pipeline, q]);

    if (results.length === 0) {
        return (
            <div className="flex-1 flex items-center justify-center text-[11px] text-zinc-600 px-4 text-center">
                No passes or steps match "{query}"
            </div>
        );
    }

    return (
        <div className="flex-1 overflow-y-auto">
            {results.map(({ pass, tl, passMatch, matchingSteps }) => (
                <div key={pass.id} className="border-b border-zinc-800/50">
                    {/* Pass row */}
                    <div
                        className={`flex flex-col gap-0.5 px-2 py-1.5 cursor-pointer hover:bg-zinc-800/40 select-none ${passMatch ? "" : "opacity-60"}`}
                        onClick={() => {
                            selectPass(pass.id);
                            onClose();
                        }}
                    >
                        <div className="flex items-center gap-1.5">
                            <span
                                className={`text-[9px] font-mono px-1 py-0.5 rounded border shrink-0 ${TL_COLORS[tl.type] ?? TL_COLORS.custom}`}
                            >
                                {tl.name}
                            </span>
                            <span className="text-xs text-zinc-200 font-medium truncate">
                                {pass.name}
                            </span>
                        </div>
                    </div>
                    {/* Matching steps */}
                    {matchingSteps.map((step) => (
                        <div
                            key={step.id}
                            className="flex items-center gap-2 pl-6 pr-2 py-1 cursor-pointer hover:bg-zinc-800/60 select-none border-t border-zinc-800/30"
                            onClick={() => {
                                selectPass(pass.id);
                                selectStep(step.id);
                                onClose();
                            }}
                        >
                            <span className="text-zinc-600 text-[9px] shrink-0">↳</span>
                            <span className="text-[11px] text-zinc-400 truncate">{step.name}</span>
                        </div>
                    ))}
                </div>
            ))}
        </div>
    );
}

// ─── Main sidebar ─────────────────────────────────────────────────────────────

export function PipelineSidebar() {
    const { pipeline, addTimeline, mergePasses } = useStore();
    const [showAddMenu, setShowAddMenu] = useState(false);
    const [query, setQuery] = useState("");
    const searchRef = useRef<HTMLInputElement>(null);

    // ── Merge mode state ──────────────────────────────────────────────────────
    const [mergeMode, setMergeMode] = useState(false);
    const [mergeSelection, setMergeSelection] = useState<Set<PassId>>(new Set());
    const [mergeName, setMergeName] = useState("");

    const toggleMerge = useCallback((passId: PassId) => {
        setMergeSelection((prev) => {
            const next = new Set(prev);
            if (next.has(passId)) next.delete(passId);
            else next.add(passId);
            return next;
        });
    }, []);

    const exitMergeMode = () => {
        setMergeMode(false);
        setMergeSelection(new Set());
        setMergeName("");
    };

    const enterMergeMode = () => {
        setMergeMode(true);
        setMergeSelection(new Set());
        setMergeName("");
        setQuery(""); // close search if open
    };

    // Determine merge validity: all selected passes must share a single timeline.
    const mergePassObjs = [...mergeSelection]
        .map((id) => pipeline.passes[id])
        .filter(Boolean) as Pass[];
    const mergeTimelineIds = new Set(mergePassObjs.map((p) => p.timelineId));
    const mergeValid = mergeSelection.size >= 2 && mergeTimelineIds.size === 1;
    const mergeCrossTimeline = mergeSelection.size >= 2 && mergeTimelineIds.size > 1;

    // Build default name from timeline order when selection changes.
    const firstPassInOrder = useMemo(() => {
        if (mergePassObjs.length === 0) return null;
        const tid = [...mergeTimelineIds][0];
        const tl = pipeline.timelines.find((t) => t.id === tid);
        if (!tl) return mergePassObjs[0];
        const first = tl.passIds.find((pid) => mergeSelection.has(pid));
        return first ? pipeline.passes[first] : mergePassObjs[0];
    }, [mergeSelection, pipeline]); // eslint-disable-line react-hooks/exhaustive-deps

    const doMerge = () => {
        if (!mergeValid) return;
        const orderedIds = [
            ...pipeline.timelines
                .find((tl) => tl.id === [...mergeTimelineIds][0])!
                .passIds.filter((pid) => mergeSelection.has(pid)),
        ];
        mergePasses(orderedIds, mergeName.trim() || undefined);
        exitMergeMode();
    };

    return (
        <MergeContext.Provider value={{ mergeMode, mergeSelection, toggleMerge }}>
            <div className="flex flex-col h-full bg-zinc-900 border-r border-zinc-700/60">
                {/* Top bar */}
                <div className="flex flex-col gap-1.5 px-3 py-2 border-b border-zinc-700/60 shrink-0">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                            Timelines
                        </span>
                        <div className="flex items-center gap-1">
                            <button
                                onClick={mergeMode ? exitMergeMode : enterMergeMode}
                                title={mergeMode ? "Cancel merge" : "Merge passes"}
                                className={`text-[10px] px-1.5 py-0.5 rounded border font-mono transition-colors
                                ${
                                    mergeMode
                                        ? "bg-violet-900/50 border-violet-600 text-violet-300 hover:bg-violet-800/60"
                                        : "border-zinc-600 text-zinc-500 hover:text-zinc-300 hover:border-zinc-500"
                                }`}
                            >
                                ⊕ Merge
                            </button>
                            <div className="relative">
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setShowAddMenu(!showAddMenu)}
                                >
                                    + Timeline
                                </Button>
                                {showAddMenu && (
                                    <div className="absolute right-0 top-full mt-1 z-50 bg-zinc-800 border border-zinc-600 rounded shadow-xl w-44">
                                        {TL_TYPE_OPTS.map((opt) => (
                                            <button
                                                key={opt.value}
                                                className="w-full text-left px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-700"
                                                onClick={() => {
                                                    addTimeline(opt.value);
                                                    setShowAddMenu(false);
                                                }}
                                            >
                                                {opt.label}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                    {/* Search box */}
                    {!mergeMode && (
                        <div className="relative flex items-center">
                            <span className="absolute left-2 text-zinc-500 text-[10px] pointer-events-none">
                                ⌕
                            </span>
                            <input
                                ref={searchRef}
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Escape") {
                                        setQuery("");
                                        e.currentTarget.blur();
                                    }
                                }}
                                placeholder="Search passes & steps…"
                                className="w-full bg-zinc-800 text-zinc-200 text-[11px] rounded pl-6 pr-6 py-1 border border-zinc-700/60 focus:outline-none focus:border-sky-600/70 placeholder-zinc-600"
                            />
                            {query && (
                                <button
                                    className="absolute right-2 text-zinc-500 hover:text-zinc-300 text-[10px]"
                                    onClick={() => {
                                        setQuery("");
                                        searchRef.current?.focus();
                                    }}
                                >
                                    ✕
                                </button>
                            )}
                        </div>
                    )}
                    {/* Merge mode hint */}
                    {mergeMode && (
                        <p className="text-[10px] text-violet-400/80 leading-tight">
                            Click passes to select. All must be on the same timeline.
                        </p>
                    )}
                </div>

                {query.trim() && !mergeMode ? (
                    <SearchResults query={query.trim()} onClose={() => setQuery("")} />
                ) : (
                    /* Timeline columns */
                    <div className="flex flex-1 overflow-hidden">
                        {pipeline.timelines.length === 0 ? (
                            <div className="flex-1 flex items-center justify-center text-xs text-zinc-600 p-4 text-center">
                                No timelines. Click "+ Timeline" to add one.
                            </div>
                        ) : (
                            pipeline.timelines.map((tl) => (
                                <TimelineColumn key={tl.id} timeline={tl} />
                            ))
                        )}
                    </div>
                )}

                {/* ── Merge action bar ──────────────────────────────────────────── */}
                {mergeMode && mergeSelection.size > 0 && (
                    <div className="shrink-0 border-t border-violet-700/50 bg-violet-950/40 px-3 py-2 flex flex-col gap-2">
                        {mergeCrossTimeline ? (
                            <p className="text-[10px] text-red-400">
                                Selection spans multiple timelines — passes must be on the same
                                timeline to merge.
                            </p>
                        ) : (
                            <>
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] text-violet-300 font-medium">
                                        {mergeSelection.size} passes selected
                                    </span>
                                    <button
                                        className="text-[10px] text-zinc-500 hover:text-zinc-300"
                                        onClick={() => setMergeSelection(new Set())}
                                    >
                                        Clear
                                    </button>
                                </div>
                                {mergeSelection.size >= 2 && (
                                    <>
                                        <input
                                            value={mergeName}
                                            onChange={(e) => setMergeName(e.target.value)}
                                            placeholder={
                                                firstPassInOrder?.name ?? "Merged pass name…"
                                            }
                                            className="w-full bg-zinc-800 text-zinc-200 text-[11px] rounded px-2 py-1 border border-zinc-600 focus:outline-none focus:border-violet-500 placeholder-zinc-600"
                                        />
                                        <Button
                                            size="sm"
                                            variant="primary"
                                            onClick={doMerge}
                                            className="w-full text-[11px] py-1 bg-violet-700 hover:bg-violet-600 border-violet-600"
                                        >
                                            Merge {mergeSelection.size} passes
                                        </Button>
                                    </>
                                )}
                            </>
                        )}
                    </div>
                )}
            </div>
        </MergeContext.Provider>
    );
}
