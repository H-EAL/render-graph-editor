/**
 * InputTree — left panel of the Input Editor.
 *
 * Shows inputs grouped hierarchically by categoryPath.
 * Supports: expand/collapse categories, search/filter, inline rename, drag & drop reorder.
 */

import { useState, useRef, useCallback } from "react";
import type { InputDefinition, InputId } from "../../types";
import { buildUsedBy } from "../../utils/inputCondition";

// ─── Tree model ───────────────────────────────────────────────────────────────

type CategoryNode = {
    kind: "category";
    name: string;
    path: string[];
    children: TreeNode[];
    inputCount: number; // total inputs under this subtree
};

type InputLeaf = {
    kind: "input";
    def: InputDefinition;
};

type TreeNode = CategoryNode | InputLeaf;

function buildTree(definitions: InputDefinition[]): TreeNode[] {
    // Group inputs by their full categoryPath, then build nested nodes
    interface CategoryMap {
        children: Map<string, CategoryMap>;
        inputs: InputDefinition[];
    }

    const root: CategoryMap = { children: new Map(), inputs: [] };

    for (const def of definitions) {
        let node = root;
        for (const seg of def.categoryPath) {
            if (!node.children.has(seg))
                node.children.set(seg, { children: new Map(), inputs: [] });
            node = node.children.get(seg)!;
        }
        node.inputs.push(def);
    }

    function toNodes(map: CategoryMap, path: string[]): TreeNode[] {
        const nodes: TreeNode[] = [];
        for (const [name, child] of map.children) {
            const childPath = [...path, name];
            const children = toNodes(child, childPath);
            const inputCount = countInputs(child);
            nodes.push({ kind: "category", name, path: childPath, children, inputCount });
        }
        for (const def of map.inputs) {
            nodes.push({ kind: "input", def });
        }
        return nodes;
    }

    function countInputs(map: CategoryMap): number {
        let n = map.inputs.length;
        for (const child of map.children.values()) n += countInputs(child);
        return n;
    }

    return toNodes(root, []);
}

// ─── Filtering ────────────────────────────────────────────────────────────────

function filterTree(
    nodes: TreeNode[],
    query: string,
    filterType: string,
    filterFlag: string,
): TreeNode[] {
    const q = query.toLowerCase();
    function matches(def: InputDefinition): boolean {
        if (q && !def.label.toLowerCase().includes(q) && !def.id.toLowerCase().includes(q))
            return false;
        if (filterType && def.kind !== filterType) return false;
        if (filterFlag === "conditional" && !def.visibilityCondition && !def.enabledCondition)
            return false;
        if (filterFlag === "advanced" && !def.advanced) return false;
        return true;
    }

    function filterNodes(ns: TreeNode[]): TreeNode[] {
        const out: TreeNode[] = [];
        for (const n of ns) {
            if (n.kind === "input") {
                if (matches(n.def)) out.push(n);
            } else {
                const children = filterNodes(n.children);
                if (children.length > 0)
                    out.push({ ...n, children, inputCount: children.reduce(countLeaves, 0) });
            }
        }
        return out;
    }

    function countLeaves(acc: number, n: TreeNode): number {
        return acc + (n.kind === "input" ? 1 : n.children.reduce(countLeaves, 0));
    }

    return filterNodes(nodes);
}

// ─── Badges ───────────────────────────────────────────────────────────────────

const KIND_COLORS: Record<string, string> = {
    bool:    "bg-emerald-900/40 text-emerald-400 border-emerald-700/40",
    int:     "bg-blue-900/40 text-blue-400 border-blue-700/40",
    float:   "bg-sky-900/40 text-sky-400 border-sky-700/40",
    enum:    "bg-violet-900/40 text-violet-400 border-violet-700/40",
    color:   "bg-orange-900/40 text-orange-400 border-orange-700/40",
    vec2:    "bg-yellow-900/40 text-yellow-400 border-yellow-700/40",
    vec3:    "bg-yellow-900/40 text-yellow-400 border-yellow-700/40",
    vec4:    "bg-yellow-900/40 text-yellow-400 border-yellow-700/40",
    texture: "bg-pink-900/40 text-pink-400 border-pink-700/40",
    buffer:  "bg-red-900/40 text-red-400 border-red-700/40",
};

function KindBadge({ kind }: { kind: string }) {
    return (
        <span
            className={`shrink-0 text-[8px] font-mono rounded px-1 py-0 border ${KIND_COLORS[kind] ?? "bg-zinc-800 text-zinc-500 border-zinc-700/40"}`}
        >
            {kind}
        </span>
    );
}

// ─── InputRow ─────────────────────────────────────────────────────────────────

function InputRow({
    def,
    selected,
    isController,
    onSelect,
    onDelete,
    onRename,
    onDragStart,
    onDragOver,
    onDrop,
    draggingId,
}: {
    def: InputDefinition;
    selected: boolean;
    isController: boolean;
    onSelect: () => void;
    onDelete: () => void;
    onRename: (label: string) => void;
    onDragStart: (id: InputId) => void;
    onDragOver: (id: InputId) => void;
    onDrop: (targetId: InputId) => void;
    draggingId: InputId | null;
}) {
    const [editing, setEditing] = useState(false);
    const [editVal, setEditVal] = useState(def.label);
    const inputRef = useRef<HTMLInputElement>(null);

    const commitRename = () => {
        const t = editVal.trim();
        if (t && t !== def.label) onRename(t);
        setEditing(false);
    };

    const hasCond = !!(def.visibilityCondition || def.enabledCondition);
    const isDraggingOver = draggingId !== null && draggingId !== def.id;

    return (
        <div
            draggable
            onDragStart={() => onDragStart(def.id)}
            onDragOver={(e) => { e.preventDefault(); onDragOver(def.id); }}
            onDrop={(e) => { e.preventDefault(); onDrop(def.id); }}
            onClick={onSelect}
            onDoubleClick={() => {
                setEditVal(def.label);
                setEditing(true);
                setTimeout(() => inputRef.current?.select(), 0);
            }}
            className={`
                flex items-center gap-1.5 px-2 py-1 cursor-pointer select-none rounded-sm
                border-l-2 transition-colors
                ${selected
                    ? "bg-blue-900/30 border-l-blue-500 text-zinc-100"
                    : "border-l-transparent text-zinc-300 hover:bg-zinc-800/50 hover:text-zinc-100"
                }
                ${isDraggingOver ? "border-t border-blue-500/40" : ""}
            `}
        >
            {/* Drag handle */}
            <span className="text-zinc-700 text-[10px] shrink-0 cursor-grab">⠿</span>

            {/* Label (or rename input) */}
            <div className="flex-1 min-w-0">
                {editing ? (
                    <input
                        ref={inputRef}
                        autoFocus
                        value={editVal}
                        onChange={(e) => setEditVal(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") commitRename();
                            if (e.key === "Escape") setEditing(false);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full bg-zinc-700 border border-zinc-500 text-zinc-100 text-[11px] rounded px-1 py-0 focus:outline-none"
                    />
                ) : (
                    <span className="text-[11px] truncate block" title={def.label}>
                        {def.label}
                    </span>
                )}
            </div>

            {/* Badges */}
            <div className="flex items-center gap-0.5 shrink-0">
                <KindBadge kind={def.kind} />
                {isController && (
                    <span className="text-[8px] rounded px-1 py-0 border bg-amber-900/30 text-amber-400 border-amber-700/40" title="Controller: referenced by other inputs">
                        ctrl
                    </span>
                )}
                {hasCond && (
                    <span className="text-[8px] rounded px-1 py-0 border bg-zinc-800 text-zinc-500 border-zinc-700/40" title="Has conditions">
                        cond
                    </span>
                )}
                {def.advanced && (
                    <span className="text-[8px] rounded px-1 py-0 border bg-zinc-800 text-zinc-600 border-zinc-700/40" title="Advanced">
                        adv
                    </span>
                )}
            </div>

            {/* Delete */}
            <button
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
                className="shrink-0 text-zinc-700 hover:text-red-400 text-[10px] transition-colors leading-none"
                title="Delete input"
            >
                ✕
            </button>
        </div>
    );
}

// ─── CategoryRow ──────────────────────────────────────────────────────────────

function CategoryRow({
    node,
    expanded,
    onToggle,
    onDropInto,
    draggingId,
}: {
    node: CategoryNode;
    expanded: boolean;
    onToggle: () => void;
    onDropInto: (path: string[]) => void;
    draggingId: InputId | null;
}) {
    const [dropOver, setDropOver] = useState(false);

    return (
        <div
            onDragOver={(e) => { e.preventDefault(); setDropOver(true); }}
            onDragLeave={() => setDropOver(false)}
            onDrop={(e) => {
                e.preventDefault();
                setDropOver(false);
                onDropInto(node.path);
            }}
            onClick={onToggle}
            className={`
                flex items-center gap-1.5 px-2 py-0.5 cursor-pointer rounded-sm
                text-[10px] font-semibold text-zinc-400 uppercase tracking-wider
                hover:text-zinc-200 hover:bg-zinc-800/40 transition-colors select-none
                ${dropOver && draggingId ? "bg-blue-900/20 text-blue-300" : ""}
            `}
        >
            <span className="text-[9px] text-zinc-600">{expanded ? "▼" : "▶"}</span>
            <span className="flex-1 truncate">{node.name}</span>
            <span className="text-[9px] text-zinc-600 font-normal normal-case tracking-normal">
                {node.inputCount}
            </span>
        </div>
    );
}

// ─── Recursive tree renderer ──────────────────────────────────────────────────

function TreeNodes({
    nodes,
    expandedPaths,
    onToggleExpand,
    selectedId,
    onSelect,
    onDelete,
    onRename,
    onDragStart,
    onDragOver,
    onDrop,
    onDropIntoCategory,
    draggingId,
    controllerIds,
    indent,
}: {
    nodes: TreeNode[];
    expandedPaths: Set<string>;
    onToggleExpand: (pathKey: string) => void;
    selectedId: InputId | null;
    onSelect: (id: InputId) => void;
    onDelete: (id: InputId) => void;
    onRename: (id: InputId, label: string) => void;
    onDragStart: (id: InputId) => void;
    onDragOver: (id: InputId) => void;
    onDrop: (targetId: InputId) => void;
    onDropIntoCategory: (path: string[]) => void;
    draggingId: InputId | null;
    controllerIds: Set<InputId>;
    indent: number;
}) {
    return (
        <>
            {nodes.map((node) => {
                if (node.kind === "input") {
                    return (
                        <div key={node.def.id} style={{ paddingLeft: indent * 12 }}>
                            <InputRow
                                def={node.def}
                                selected={selectedId === node.def.id}
                                isController={controllerIds.has(node.def.id)}
                                onSelect={() => onSelect(node.def.id)}
                                onDelete={() => onDelete(node.def.id)}
                                onRename={(label) => onRename(node.def.id, label)}
                                onDragStart={onDragStart}
                                onDragOver={onDragOver}
                                onDrop={onDrop}
                                draggingId={draggingId}
                            />
                        </div>
                    );
                }

                const pathKey = node.path.join("/");
                const expanded = expandedPaths.has(pathKey);

                return (
                    <div key={pathKey} style={{ paddingLeft: indent * 12 }}>
                        <CategoryRow
                            node={node}
                            expanded={expanded}
                            onToggle={() => onToggleExpand(pathKey)}
                            onDropInto={onDropIntoCategory}
                            draggingId={draggingId}
                        />
                        {expanded && (
                            <TreeNodes
                                nodes={node.children}
                                expandedPaths={expandedPaths}
                                onToggleExpand={onToggleExpand}
                                selectedId={selectedId}
                                onSelect={onSelect}
                                onDelete={onDelete}
                                onRename={onRename}
                                onDragStart={onDragStart}
                                onDragOver={onDragOver}
                                onDrop={onDrop}
                                onDropIntoCategory={onDropIntoCategory}
                                draggingId={draggingId}
                                controllerIds={controllerIds}
                                indent={indent + 1}
                            />
                        )}
                    </div>
                );
            })}
        </>
    );
}

// ─── Main export ──────────────────────────────────────────────────────────────

const INPUT_KINDS = [
    "bool", "int", "float", "enum", "color", "vec2", "vec3", "vec4", "texture", "buffer",
];

export interface InputTreeProps {
    definitions: InputDefinition[];
    selectedId: InputId | null;
    onSelect: (id: InputId) => void;
    onAdd: (categoryPath: string[]) => void;
    onDelete: (id: InputId) => void;
    onRename: (id: InputId, label: string) => void;
    onMoveToCategory: (id: InputId, path: string[]) => void;
    onReorder: (fromId: InputId, toId: InputId) => void;
}

export function InputTree({
    definitions,
    selectedId,
    onSelect,
    onAdd,
    onDelete,
    onRename,
    onMoveToCategory,
    onReorder,
}: InputTreeProps) {
    const [search, setSearch] = useState("");
    const [filterType, setFilterType] = useState("");
    const [filterFlag, setFilterFlag] = useState("");
    const [draggingId, setDraggingId] = useState<InputId | null>(null);

    // All category paths for "expand all" default
    const allPathKeys = useCallback(() => {
        const keys = new Set<string>();
        function collect(defs: InputDefinition[]) {
            for (const def of defs) {
                for (let i = 1; i <= def.categoryPath.length; i++) {
                    keys.add(def.categoryPath.slice(0, i).join("/"));
                }
            }
        }
        collect(definitions);
        return keys;
    }, [definitions]);

    const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => allPathKeys());

    // Expand new categories automatically
    const expandAll = () => setExpandedPaths(allPathKeys());

    const toggleExpand = (key: string) =>
        setExpandedPaths((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });

    // Controller ids: inputs referenced by any condition
    const controllerIds = new Set(
        [...buildUsedBy(definitions).entries()]
            .filter(([, usedBy]) => usedBy.size > 0)
            .map(([id]) => id),
    );

    const tree = buildTree(definitions);
    const filtered = filterTree(tree, search, filterType, filterFlag);
    const isFiltering = !!(search || filterType || filterFlag);

    const handleDrop = useCallback(
        (targetId: InputId) => {
            if (draggingId && draggingId !== targetId) {
                onReorder(draggingId, targetId);
            }
            setDraggingId(null);
            // dragOverId cleared via draggingId
        },
        [draggingId, onReorder],
    );

    const handleDropIntoCategory = useCallback(
        (path: string[]) => {
            if (draggingId) onMoveToCategory(draggingId, path);
            setDraggingId(null);
            // dragOverId cleared via draggingId
        },
        [draggingId, onMoveToCategory],
    );

    return (
        <div className="flex flex-col h-full bg-zinc-950">
            {/* Search + filters */}
            <div className="flex flex-col gap-1.5 px-2 pt-2 pb-1.5 border-b border-zinc-800 shrink-0">
                <input
                    type="text"
                    placeholder="Search inputs…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full bg-zinc-800 border border-zinc-700/60 text-zinc-200 text-[11px] rounded px-2 py-1 focus:outline-none focus:border-zinc-500 placeholder:text-zinc-600"
                />
                <div className="flex items-center gap-1">
                    <select
                        value={filterType}
                        onChange={(e) => setFilterType(e.target.value)}
                        className="flex-1 bg-zinc-800 border border-zinc-700/60 text-zinc-400 text-[10px] rounded px-1.5 py-0.5 focus:outline-none"
                    >
                        <option value="">All types</option>
                        {INPUT_KINDS.map((k) => (
                            <option key={k} value={k}>{k}</option>
                        ))}
                    </select>
                    <select
                        value={filterFlag}
                        onChange={(e) => setFilterFlag(e.target.value)}
                        className="flex-1 bg-zinc-800 border border-zinc-700/60 text-zinc-400 text-[10px] rounded px-1.5 py-0.5 focus:outline-none"
                    >
                        <option value="">All flags</option>
                        <option value="conditional">Conditional</option>
                        <option value="advanced">Advanced</option>
                    </select>
                </div>
            </div>

            {/* Tree */}
            <div className="flex-1 overflow-y-auto py-1">
                {filtered.length === 0 && (
                    <div className="px-3 py-4 text-[11px] text-zinc-600 italic">
                        {isFiltering ? "No inputs match the filter." : "No inputs yet."}
                    </div>
                )}
                <TreeNodes
                    nodes={filtered}
                    expandedPaths={expandedPaths}
                    onToggleExpand={toggleExpand}
                    selectedId={selectedId}
                    onSelect={onSelect}
                    onDelete={onDelete}
                    onRename={onRename}
                    onDragStart={(id) => setDraggingId(id)}
                    onDragOver={() => {}}
                    onDrop={handleDrop}
                    onDropIntoCategory={handleDropIntoCategory}
                    draggingId={draggingId}
                    controllerIds={controllerIds}
                    indent={0}
                />
            </div>

            {/* Footer actions */}
            <div className="flex items-center gap-1.5 px-2 py-1.5 border-t border-zinc-800 shrink-0">
                <button
                    onClick={() => onAdd([])}
                    className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border border-zinc-700/50 text-zinc-400 hover:text-zinc-100 hover:border-zinc-600 transition-colors"
                >
                    <span>＋</span> Add Input
                </button>
                <div className="flex-1" />
                <button
                    onClick={expandAll}
                    className="text-[9px] text-zinc-600 hover:text-zinc-400 transition-colors"
                    title="Expand all"
                >
                    expand all
                </button>
                <span className="text-[9px] text-zinc-700">
                    {definitions.length} input{definitions.length !== 1 ? "s" : ""}
                </span>
            </div>
        </div>
    );
}
