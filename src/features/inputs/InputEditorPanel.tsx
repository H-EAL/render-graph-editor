/**
 * InputEditorPanel — full-screen modal for the Render Graph Input Editor.
 *
 * Layout: [InputTree | InputInspector | InputPreview]
 * All state lives in the Zustand store; local state tracks the selected input.
 */

import { useState, useCallback } from "react";
import { useStore } from "../../state/store";
import type { InputDefinition, InputId, InputKind } from "../../types";
import { newId } from "../../utils/id";
import { InputTree } from "./InputTree";
import { InputInspector } from "./InputInspector";
import { InputPreview } from "./InputPreview";

// ─── Default factory ──────────────────────────────────────────────────────────

function makeDefaultDefinition(categoryPath: string[]): Omit<InputDefinition, "id"> {
    return {
        label: "New Input",
        kind: "bool" as InputKind,
        defaultValue: false,
        categoryPath,
        userFacing: true,
        advanced: false,
    };
}

// ─── Panel header ─────────────────────────────────────────────────────────────

function PanelHeader({ onClose }: { onClose: () => void }) {
    return (
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-zinc-700/60 shrink-0 bg-zinc-900">
            <span className="text-[11px] font-bold text-zinc-300 uppercase tracking-widest">
                Render Graph Inputs
            </span>
            <div className="flex-1" />
            <button
                onClick={onClose}
                className="text-zinc-600 hover:text-zinc-200 text-sm leading-none p-1 transition-colors"
                title="Close (Esc)"
            >
                ✕
            </button>
        </div>
    );
}

// ─── Resize handle ────────────────────────────────────────────────────────────

function ResizeHandle({
    onMouseDown,
}: {
    onMouseDown: (e: React.MouseEvent) => void;
}) {
    return (
        <div
            onMouseDown={onMouseDown}
            className="w-px bg-zinc-800 hover:bg-blue-600/50 cursor-col-resize shrink-0 transition-colors"
        />
    );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export interface InputEditorPanelProps {
    onClose: () => void;
}

export function InputEditorPanel({ onClose }: InputEditorPanelProps) {
    const { inputDefinitions, addInputDefinition, updateInputDefinition, deleteInputDefinition, reorderInputDefinitions } =
        useStore();

    const [selectedId, setSelectedId] = useState<InputId | null>(
        inputDefinitions[0]?.id ?? null,
    );

    // Panel widths
    const [treeW, setTreeW] = useState(240);
    const [inspW, setInspW] = useState(380);

    const makeResizer = useCallback(
        (getter: () => number, setter: (v: number) => void, min: number, max: number) => {
            return (e: React.MouseEvent) => {
                const x0 = e.clientX;
                const w0 = getter();
                const move = (ev: MouseEvent) => {
                    const delta = ev.clientX - x0;
                    setter(Math.max(min, Math.min(max, w0 + delta)));
                };
                const up = () => {
                    window.removeEventListener("mousemove", move);
                    window.removeEventListener("mouseup", up);
                };
                window.addEventListener("mousemove", move);
                window.addEventListener("mouseup", up);
                e.preventDefault();
            };
        },
        [],
    );

    const selectedDef = inputDefinitions.find((d) => d.id === selectedId) ?? null;

    const handleAdd = useCallback(
        (categoryPath: string[]) => {
            const draft = makeDefaultDefinition(categoryPath);
            const id = newId();
            addInputDefinition({ ...draft, id } as unknown as Omit<InputDefinition, "id">);
            // Actually addInputDefinition generates a new id, but we want to select it.
            // Use a setTimeout to pick up the new entry after state update.
            setTimeout(() => {
                const defs = useStore.getState().inputDefinitions;
                const newest = defs[defs.length - 1];
                if (newest) setSelectedId(newest.id);
            }, 0);
        },
        [addInputDefinition],
    );

    const handleDelete = useCallback(
        (id: InputId) => {
            deleteInputDefinition(id);
            if (selectedId === id) {
                const idx = inputDefinitions.findIndex((d) => d.id === id);
                const next = inputDefinitions[idx + 1] ?? inputDefinitions[idx - 1] ?? null;
                setSelectedId(next?.id ?? null);
            }
        },
        [deleteInputDefinition, selectedId, inputDefinitions],
    );

    const handleReorder = useCallback(
        (fromId: InputId, toId: InputId) => {
            const ids = inputDefinitions.map((d) => d.id);
            const fi = ids.indexOf(fromId);
            const ti = ids.indexOf(toId);
            if (fi === -1 || ti === -1) return;
            const next = [...ids];
            next.splice(fi, 1);
            next.splice(ti, 0, fromId);
            reorderInputDefinitions(next);
        },
        [inputDefinitions, reorderInputDefinitions],
    );

    const handleMoveToCategory = useCallback(
        (id: InputId, path: string[]) => {
            updateInputDefinition(id, { categoryPath: path });
        },
        [updateInputDefinition],
    );

    const handleChange = useCallback(
        (patch: Partial<InputDefinition>) => {
            if (selectedId) updateInputDefinition(selectedId, patch);
        },
        [selectedId, updateInputDefinition],
    );

    // Close on Escape
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Escape") onClose();
    };

    return (
        <div
            className="fixed inset-0 z-[400] flex items-stretch"
            style={{ background: "rgba(0,0,0,0.65)" }}
            onKeyDown={handleKeyDown}
            tabIndex={-1}
        >
            {/* Click backdrop to close */}
            <div className="absolute inset-0" onClick={onClose} />

            {/* Panel */}
            <div
                className="relative m-auto flex flex-col bg-zinc-900 border border-zinc-700/60 rounded-lg shadow-2xl overflow-hidden"
                style={{ width: "min(1400px, 96vw)", height: "min(900px, 92vh)" }}
                onClick={(e) => e.stopPropagation()}
            >
                <PanelHeader onClose={onClose} />

                {/* 3-column body */}
                <div className="flex flex-1 min-h-0 overflow-hidden">
                    {/* Left: Input Tree */}
                    <div
                        className="flex flex-col shrink-0 overflow-hidden border-r border-zinc-800"
                        style={{ width: treeW }}
                    >
                        <div className="px-3 py-1.5 border-b border-zinc-800 shrink-0">
                            <span className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest">
                                Inputs
                            </span>
                        </div>
                        <div className="flex-1 min-h-0">
                            <InputTree
                                definitions={inputDefinitions}
                                selectedId={selectedId}
                                onSelect={setSelectedId}
                                onAdd={handleAdd}
                                onDelete={handleDelete}
                                onRename={(id, label) => updateInputDefinition(id, { label })}
                                onMoveToCategory={handleMoveToCategory}
                                onReorder={handleReorder}
                            />
                        </div>
                    </div>

                    <ResizeHandle onMouseDown={makeResizer(() => treeW, setTreeW, 160, 400)} />

                    {/* Center: Inspector */}
                    <div
                        className="flex flex-col shrink-0 overflow-hidden border-r border-zinc-800 bg-zinc-900"
                        style={{ width: inspW }}
                    >
                        <div className="px-3 py-1.5 border-b border-zinc-800 shrink-0 flex items-center gap-2">
                            <span className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest flex-1">
                                Inspector
                            </span>
                            {selectedDef && (
                                <span className="text-[9px] font-mono text-zinc-600">
                                    {selectedDef.id}
                                </span>
                            )}
                        </div>
                        <div className="flex-1 min-h-0 overflow-y-auto">
                            {selectedDef ? (
                                <InputInspector
                                    definition={selectedDef}
                                    definitions={inputDefinitions}
                                    onChange={handleChange}
                                />
                            ) : (
                                <div className="flex items-center justify-center h-full">
                                    <span className="text-[11px] text-zinc-600 italic">
                                        Select an input to inspect
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>

                    <ResizeHandle onMouseDown={makeResizer(() => inspW, setInspW, 240, 600)} />

                    {/* Right: Preview */}
                    <div className="flex-1 min-w-0 overflow-hidden bg-zinc-950">
                        <div className="px-3 py-1.5 border-b border-zinc-800 shrink-0">
                            <span className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest">
                                Preview
                            </span>
                        </div>
                        <div className="h-full overflow-hidden" style={{ height: "calc(100% - 30px)" }}>
                            <InputPreview definitions={inputDefinitions} />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
