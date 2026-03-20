/**
 * ConditionBuilder — structured rule-builder UI for InputCondition.
 *
 * Renders a tree of condition nodes (comparison, and, or, not).
 * Never uses free-form text; all values are chosen through dropdowns / inputs.
 */

import type { InputCondition, InputDefinition, InputId, InputKind } from "../../types";
import { makeDefaultCondition, makeDefaultGroup } from "../../utils/inputCondition";

// ─── Operators by kind ────────────────────────────────────────────────────────

const OPERATORS_BOOL:  Array<InputCondition & { type: "comparison" } extends { operator: infer O } ? O : never> = ["==", "!="] as const;
const OPERATORS_ENUM   = ["==", "!="] as const;
const OPERATORS_NUMBER = ["==", "!=", "<", "<=", ">", ">="] as const;

type ComparisonOp = "==" | "!=" | ">" | ">=" | "<" | "<=";

function operatorsFor(kind: InputKind | undefined): readonly ComparisonOp[] {
    if (!kind) return OPERATORS_ENUM;
    if (kind === "bool") return OPERATORS_BOOL;
    if (kind === "int" || kind === "float") return OPERATORS_NUMBER;
    return OPERATORS_ENUM;
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const ROW = "flex items-center gap-1.5 py-1 px-2 text-[11px]";
const SEL = "bg-zinc-800 border border-zinc-700/60 text-zinc-200 rounded px-1.5 py-0.5 text-[11px] focus:outline-none focus:border-zinc-500";
const BTN_GHOST = "text-[10px] text-zinc-600 hover:text-zinc-300 px-1 py-0.5 rounded hover:bg-zinc-800 transition-colors";
const BTN_ADD = "text-[10px] text-zinc-500 hover:text-zinc-200 px-1.5 py-0.5 rounded border border-dashed border-zinc-700/50 hover:border-zinc-600 transition-colors";

// ─── RightValue editor ────────────────────────────────────────────────────────

function RightValueEditor({
    kind,
    value,
    enumOptions,
    onChange,
}: {
    kind: InputKind | undefined;
    value: boolean | number | string;
    enumOptions?: { value: string; label: string }[];
    onChange: (v: boolean | number | string) => void;
}) {
    if (kind === "bool") {
        return (
            <select
                value={String(value)}
                onChange={(e) => onChange(e.target.value === "true")}
                className={SEL}
            >
                <option value="true">true</option>
                <option value="false">false</option>
            </select>
        );
    }
    if (kind === "enum" && enumOptions) {
        return (
            <select
                value={String(value)}
                onChange={(e) => onChange(e.target.value)}
                className={SEL}
            >
                {enumOptions.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                ))}
            </select>
        );
    }
    if (kind === "int" || kind === "float") {
        return (
            <input
                type="number"
                value={value as number}
                step={kind === "int" ? 1 : "any"}
                onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
                className={`${SEL} w-20 font-mono`}
            />
        );
    }
    // fallback: text
    return (
        <input
            type="text"
            value={String(value)}
            onChange={(e) => onChange(e.target.value)}
            className={`${SEL} w-28 font-mono`}
        />
    );
}

// ─── ComparisonEditor ─────────────────────────────────────────────────────────

function ComparisonEditor({
    cond,
    onChange,
    onRemove,
    definitions,
    depth,
}: {
    cond: Extract<InputCondition, { type: "comparison" }>;
    onChange: (c: InputCondition) => void;
    onRemove?: () => void;
    definitions: InputDefinition[];
    depth: number;
}) {
    const selected = definitions.find((d) => d.id === cond.leftInput);
    const ops = operatorsFor(selected?.kind);

    const update = (patch: Partial<typeof cond>) =>
        onChange({ ...cond, ...patch } as InputCondition);

    const handleLeftChange = (id: InputId) => {
        const def = definitions.find((d) => d.id === id);
        // Reset rightValue when input changes to avoid type mismatches
        let rightValue: boolean | number | string = cond.rightValue;
        if (def?.kind === "bool") rightValue = true;
        else if (def?.kind === "int" || def?.kind === "float") rightValue = 0;
        else if (def?.kind === "enum") rightValue = def.enumOptions?.[0]?.value ?? "";
        update({ leftInput: id, rightValue });
    };

    return (
        <div className={ROW} style={{ paddingLeft: depth > 0 ? 8 : 0 }}>
            {/* Input selector */}
            <select
                value={cond.leftInput}
                onChange={(e) => handleLeftChange(e.target.value)}
                className={`${SEL} flex-1 min-w-0 max-w-[140px]`}
            >
                <option value="">— pick input —</option>
                {definitions.map((d) => (
                    <option key={d.id} value={d.id}>{d.label}</option>
                ))}
            </select>

            {/* Operator */}
            <select
                value={cond.operator}
                onChange={(e) => update({ operator: e.target.value as ComparisonOp })}
                className={`${SEL} shrink-0`}
            >
                {ops.map((op) => (
                    <option key={op} value={op}>{op}</option>
                ))}
            </select>

            {/* Right value */}
            <RightValueEditor
                kind={selected?.kind}
                value={cond.rightValue}
                enumOptions={selected?.enumOptions}
                onChange={(v) => update({ rightValue: v })}
            />

            {/* Remove */}
            {onRemove && (
                <button onClick={onRemove} className={BTN_GHOST} title="Remove condition">✕</button>
            )}
        </div>
    );
}

// ─── LogicalGroupEditor ───────────────────────────────────────────────────────

function LogicalGroupEditor({
    cond,
    onChange,
    onRemove,
    definitions,
    depth,
}: {
    cond: Extract<InputCondition, { type: "and" | "or" }>;
    onChange: (c: InputCondition) => void;
    onRemove?: () => void;
    definitions: InputDefinition[];
    depth: number;
}) {
    const update = (conditions: InputCondition[]) => onChange({ ...cond, conditions });

    const updateAt = (i: number, c: InputCondition) =>
        update(cond.conditions.map((x, j) => (j === i ? c : x)));
    const removeAt = (i: number) =>
        update(cond.conditions.filter((_, j) => j !== i));
    const addComparison = () => update([...cond.conditions, makeDefaultCondition()]);
    const addGroup = (type: "and" | "or") => update([...cond.conditions, makeDefaultGroup(type)]);

    return (
        <div className="border border-zinc-700/40 rounded my-1" style={{ marginLeft: depth * 8 }}>
            {/* Header */}
            <div className={`${ROW} bg-zinc-800/60 rounded-t gap-2`}>
                {/* Toggle AND / OR */}
                <div className="flex items-center gap-0.5 rounded border border-zinc-700/50 overflow-hidden">
                    {(["and", "or"] as const).map((t) => (
                        <button
                            key={t}
                            onClick={() => onChange({ ...cond, type: t })}
                            className={`px-2 py-0.5 text-[10px] font-mono transition-colors ${
                                cond.type === t
                                    ? "bg-purple-700/60 text-purple-200"
                                    : "text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700/40"
                            }`}
                        >
                            {t.toUpperCase()}
                        </button>
                    ))}
                </div>
                <span className="text-[10px] text-zinc-500 flex-1">
                    {cond.type === "and" ? "All must be true" : "Any must be true"}
                </span>
                {onRemove && (
                    <button onClick={onRemove} className={BTN_GHOST} title="Remove group">✕</button>
                )}
            </div>

            {/* Children */}
            {cond.conditions.map((child, i) => (
                <ConditionNode
                    key={i}
                    cond={child}
                    onChange={(c) => updateAt(i, c)}
                    onRemove={() => removeAt(i)}
                    definitions={definitions}
                    depth={depth + 1}
                />
            ))}

            {/* Add buttons */}
            <div className={`${ROW} gap-2 border-t border-zinc-800/60`}>
                <button onClick={addComparison} className={BTN_ADD}>+ rule</button>
                {depth < 2 && (
                    <>
                        <button onClick={() => addGroup("and")} className={BTN_ADD}>+ AND</button>
                        <button onClick={() => addGroup("or")} className={BTN_ADD}>+ OR</button>
                    </>
                )}
            </div>
        </div>
    );
}

// ─── NotEditor ────────────────────────────────────────────────────────────────

function NotEditor({
    cond,
    onChange,
    onRemove,
    definitions,
    depth,
}: {
    cond: Extract<InputCondition, { type: "not" }>;
    onChange: (c: InputCondition) => void;
    onRemove?: () => void;
    definitions: InputDefinition[];
    depth: number;
}) {
    return (
        <div className="border border-zinc-700/40 rounded my-1" style={{ marginLeft: depth * 8 }}>
            <div className={`${ROW} bg-zinc-800/60 rounded-t`}>
                <span className="text-[10px] font-mono text-red-400/80 px-1">NOT</span>
                <span className="text-[10px] text-zinc-500 flex-1">Negate condition</span>
                {onRemove && (
                    <button onClick={onRemove} className={BTN_GHOST} title="Remove NOT">✕</button>
                )}
            </div>
            <ConditionNode
                cond={cond.condition}
                onChange={(c) => onChange({ type: "not", condition: c })}
                definitions={definitions}
                depth={depth + 1}
            />
        </div>
    );
}

// ─── ConditionNode dispatcher ─────────────────────────────────────────────────

function ConditionNode({
    cond,
    onChange,
    onRemove,
    definitions,
    depth,
}: {
    cond: InputCondition;
    onChange: (c: InputCondition) => void;
    onRemove?: () => void;
    definitions: InputDefinition[];
    depth: number;
}) {
    if (cond.type === "comparison")
        return (
            <ComparisonEditor
                cond={cond}
                onChange={onChange}
                onRemove={onRemove}
                definitions={definitions}
                depth={depth}
            />
        );
    if (cond.type === "and" || cond.type === "or")
        return (
            <LogicalGroupEditor
                cond={cond}
                onChange={onChange}
                onRemove={onRemove}
                definitions={definitions}
                depth={depth}
            />
        );
    return (
        <NotEditor
            cond={cond}
            onChange={onChange}
            onRemove={onRemove}
            definitions={definitions}
            depth={depth}
        />
    );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export interface ConditionBuilderProps {
    /** Label shown above the builder (e.g. "Visibility" / "Enabled") */
    label: string;
    value: InputCondition | undefined;
    onChange: (cond: InputCondition | undefined) => void;
    definitions: InputDefinition[];
}

export function ConditionBuilder({ label, value, onChange, definitions }: ConditionBuilderProps) {
    const hasCondition = !!value;

    return (
        <div className="flex flex-col gap-1">
            {/* Header row */}
            <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider flex-1">
                    {label}
                </span>
                {hasCondition ? (
                    <button
                        onClick={() => onChange(undefined)}
                        className={`${BTN_GHOST} text-red-500/70 hover:text-red-400`}
                    >
                        Remove
                    </button>
                ) : (
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => onChange(makeDefaultCondition())}
                            className={BTN_ADD}
                        >
                            + rule
                        </button>
                        <button
                            onClick={() => onChange(makeDefaultGroup("and"))}
                            className={BTN_ADD}
                        >
                            + AND group
                        </button>
                        <button
                            onClick={() => onChange(makeDefaultGroup("or"))}
                            className={BTN_ADD}
                        >
                            + OR group
                        </button>
                    </div>
                )}
            </div>

            {/* Condition tree */}
            {value && (
                <div className="bg-zinc-900/60 border border-zinc-800 rounded">
                    <ConditionNode
                        cond={value}
                        onChange={onChange}
                        definitions={definitions}
                        depth={0}
                    />
                </div>
            )}

            {!hasCondition && (
                <div className="text-[10px] text-zinc-600 italic px-1">
                    Always {label.toLowerCase().includes("visibility") ? "visible" : "enabled"}
                </div>
            )}
        </div>
    );
}
