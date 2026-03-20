/**
 * ValueSourceEditor
 *
 * Mode-aware field editor for bindable step fields.
 * Replaces a plain static control with a mode pill + the appropriate sub-editor.
 *
 * Modes
 *   constant — hard-coded value (same as the old UI; rendered by the caller via renderConstant)
 *   input    — driven by a graph InputParameter   (scalar/bool fields only)
 *   select   — boolean select(condition, ifTrue, ifFalse)
 *
 * Distinction
 *   Use "input"  for: same shader, the field value IS an InputParameter value
 *   Use "select" for: same shader, choose between two concrete values based on a bool condition
 *   Use IfBlock  for: execution branching (running different step sequences)
 *   Use Variant  for: implementation-family switching
 */

import type { ReactNode } from "react";
import type { ValueSource, InputParameter } from "../../types";
import type { FieldKind } from "../../utils/valueSource";
import { defaultSelector, validateValueSource } from "../../utils/valueSource";
import { ResourceSelect } from "./ResourceSelect";

// ─── Shared sub-types ─────────────────────────────────────────────────────────

export interface ResourceOption {
    value: string;
    label: string;
}

// ─── Mode pill ────────────────────────────────────────────────────────────────

type Mode = "constant" | "input" | "select";

function getMode(src: ValueSource | undefined): Mode {
    if (!src || src.kind === "constant") return "constant";
    if (src.kind === "input") return "input";
    return "select";
}

interface ModePillProps {
    mode: Mode;
    fieldKind: FieldKind;
    onChange: (m: Mode) => void;
}

const MODES_RESOURCE: Mode[] = ["constant", "select"];
const MODES_SCALAR: Mode[] = ["constant", "input", "select"];

const MODE_LABELS: Record<Mode, string> = {
    constant: "const",
    input: "input",
    select: "select",
};
const MODE_COLORS: Record<Mode, string> = {
    constant: "bg-zinc-800 text-zinc-400 border-zinc-700/50",
    input: "bg-blue-900/40 text-blue-300 border-blue-700/50",
    select: "bg-purple-900/40 text-purple-300 border-purple-700/50",
};

function ModePill({ mode, fieldKind, onChange }: ModePillProps) {
    const modes = fieldKind === "resource" ? MODES_RESOURCE : MODES_SCALAR;
    return (
        <div className="flex items-center gap-0.5 shrink-0">
            {modes.map((m) => (
                <button
                    key={m}
                    onClick={() => onChange(m)}
                    className={`text-[9px] rounded px-1.5 py-0.5 border font-mono transition-colors ${
                        m === mode
                            ? MODE_COLORS[m]
                            : "bg-transparent text-zinc-600 border-transparent hover:text-zinc-400"
                    }`}
                >
                    {MODE_LABELS[m]}
                </button>
            ))}
        </div>
    );
}

// ─── Leaf value editor (constant or input, no select) ─────────────────────────

interface LeafEditorProps {
    src: ValueSource;
    onChange: (s: ValueSource) => void;
    fieldKind: FieldKind;
    resourceOptions: ResourceOption[];
    inputParameters: InputParameter[];
    placeholder?: string;
}

function LeafEditor({
    src,
    onChange,
    fieldKind,
    resourceOptions,
    inputParameters,
    placeholder,
}: LeafEditorProps) {
    const inputOpts = inputParameters.map((p) => ({ value: p.name, label: p.name }));

    if (src.kind === "constant") {
        if (fieldKind === "resource") {
            return (
                <ResourceSelect
                    value={(src.value as string) ?? ""}
                    onChange={(v) => onChange({ kind: "constant", value: v })}
                    options={resourceOptions}
                    allowEmpty
                />
            );
        }
        if (fieldKind === "bool") {
            return (
                <select
                    value={String(src.value ?? false)}
                    onChange={(e) =>
                        onChange({ kind: "constant", value: e.target.value === "true" })
                    }
                    className="flex-1 bg-zinc-800 border border-zinc-700/60 text-zinc-200 text-[11px] rounded px-1.5 py-1 focus:outline-none focus:border-zinc-500"
                >
                    <option value="true">true</option>
                    <option value="false">false</option>
                </select>
            );
        }
        // scalar
        return (
            <input
                type="number"
                value={src.value as number ?? 0}
                onChange={(e) =>
                    onChange({ kind: "constant", value: parseFloat(e.target.value) || 0 })
                }
                placeholder={placeholder}
                className="flex-1 bg-zinc-800 border border-zinc-700/60 text-zinc-200 text-[11px] rounded px-1.5 py-1 focus:outline-none focus:border-zinc-500 font-mono"
            />
        );
    }

    // kind === "input"
    const inputId = src.kind === "input" ? src.inputId : "";
    return (
        <ResourceSelect
            value={inputId ?? ""}
            onChange={(v) => onChange({ kind: "input", inputId: v })}
            options={inputOpts}
            allowEmpty
        />
    );
}

// ─── Select branch editor ─────────────────────────────────────────────────────

interface SelectEditorProps {
    src: Extract<ValueSource, { kind: "select" }>;
    onChange: (s: ValueSource) => void;
    fieldKind: FieldKind;
    resourceOptions: ResourceOption[];
    inputParameters: InputParameter[];
    depth: number;
}

const BRANCH_STYLE =
    "flex items-center gap-1.5 px-2 py-1 border-t border-zinc-800/60 text-[10px]";

function SelectEditor({
    src,
    onChange,
    fieldKind,
    resourceOptions,
    inputParameters,
    depth,
}: SelectEditorProps) {
    const condOpts = inputParameters
        .filter((p) => p.type === "bool")
        .map((p) => ({ value: p.name, label: p.name }));
    const allCondOpts = inputParameters.map((p) => ({ value: p.name, label: p.name }));
    const opts = condOpts.length > 0 ? condOpts : allCondOpts;

    const updateBranch = (branch: "trueValue" | "falseValue", vs: ValueSource) =>
        onChange({ ...src, [branch]: vs });

    return (
        <>
            {/* Condition row */}
            <div className={BRANCH_STYLE}>
                <span className="text-[9px] font-mono text-purple-400/80 shrink-0 w-12">if</span>
                <ResourceSelect
                    value={src.condition}
                    onChange={(v) => onChange({ ...src, condition: v })}
                    options={opts}
                    allowEmpty
                />
            </div>
            {/* True branch */}
            <div className={BRANCH_STYLE}>
                <span className="text-[9px] font-mono text-green-400/80 shrink-0 w-12">true</span>
                <BranchValueEditor
                    src={src.trueValue}
                    onChange={(vs) => updateBranch("trueValue", vs)}
                    fieldKind={fieldKind}
                    resourceOptions={resourceOptions}
                    inputParameters={inputParameters}
                    depth={depth}
                />
            </div>
            {/* False branch */}
            <div className={BRANCH_STYLE}>
                <span className="text-[9px] font-mono text-orange-400/80 shrink-0 w-12">false</span>
                <BranchValueEditor
                    src={src.falseValue}
                    onChange={(vs) => updateBranch("falseValue", vs)}
                    fieldKind={fieldKind}
                    resourceOptions={resourceOptions}
                    inputParameters={inputParameters}
                    depth={depth}
                />
            </div>
        </>
    );
}

/** A branch value inside a select: allows constant/input but not nested selects. */
function BranchValueEditor({
    src,
    onChange,
    fieldKind,
    resourceOptions,
    inputParameters,
    depth,
}: LeafEditorProps & { depth: number }) {
    const mode = getMode(src);
    const canNest = depth < 1; // allow one level of nesting max

    const handleModeChange = (m: Mode) => {
        if (m === "constant") onChange({ kind: "constant", value: fieldKind === "resource" ? "" : fieldKind === "bool" ? false : 0 });
        else if (m === "input") onChange({ kind: "input", inputId: "" });
        else if (m === "select" && canNest) onChange(defaultSelector(fieldKind));
    };

    const availModes: Mode[] = fieldKind === "resource"
        ? (canNest ? ["constant", "select"] : ["constant"])
        : (canNest ? ["constant", "input", "select"] : ["constant", "input"]);

    return (
        <div className="flex-1 flex flex-col gap-0">
            <div className="flex items-center gap-1">
                {/* Inline mode pills for branches */}
                <div className="flex items-center gap-0.5 shrink-0">
                    {availModes.map((m) => (
                        <button
                            key={m}
                            onClick={() => handleModeChange(m)}
                            className={`text-[8px] rounded px-1 py-0.5 border font-mono transition-colors ${
                                m === mode
                                    ? MODE_COLORS[m]
                                    : "bg-transparent text-zinc-600 border-transparent hover:text-zinc-400"
                            }`}
                        >
                            {MODE_LABELS[m]}
                        </button>
                    ))}
                </div>
                {src.kind !== "select" && (
                    <div className="flex-1">
                        <LeafEditor
                            src={src}
                            onChange={onChange}
                            fieldKind={fieldKind}
                            resourceOptions={resourceOptions}
                            inputParameters={inputParameters}
                        />
                    </div>
                )}
            </div>
            {src.kind === "select" && (
                <div className="ml-2 border-l border-purple-800/30 mt-0.5">
                    <SelectEditor
                        src={src}
                        onChange={onChange}
                        fieldKind={fieldKind}
                        resourceOptions={resourceOptions}
                        inputParameters={inputParameters}
                        depth={depth + 1}
                    />
                </div>
            )}
        </div>
    );
}

// ─── Validation badge ─────────────────────────────────────────────────────────

interface ValidationBadgeProps {
    src: ValueSource;
    field: string;
    fieldKind: FieldKind;
    inputParameters: InputParameter[];
    resourceIds: Set<string>;
}

function ValidationBadge({ src, field, fieldKind, inputParameters, resourceIds }: ValidationBadgeProps) {
    const errors = validateValueSource(src, field, fieldKind, inputParameters, resourceIds);
    if (errors.length === 0) return null;
    const msg = errors.map((e) => e.message).join("\n");
    return (
        <span title={msg} className="shrink-0 text-amber-400 text-[10px] cursor-help">⚠</span>
    );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export interface ValueSourceEditorProps {
    /** Slot / field name (used for validation labels) */
    slotName: string;
    /** Current selector state; undefined = use static constant (legacy constant mode) */
    selector: ValueSource | undefined;
    /** Called when the selector changes; undefined removes it (reverts to static constant) */
    onSelectorChange: (src: ValueSource | undefined) => void;
    /** Whether this field holds a resource ID, bool, or numeric scalar */
    fieldKind: FieldKind;
    /** Rendered in constant mode (the old static editor for this field) */
    renderStatic: () => ReactNode;
    /** Resource options for resource-type selectors */
    resourceOptions?: ResourceOption[];
    /** Available graph InputParameters */
    inputParameters: InputParameter[];
    /** All known resource IDs (for validation) */
    resourceIds?: Set<string>;
}

export function ValueSourceEditor({
    slotName,
    selector,
    onSelectorChange,
    fieldKind,
    renderStatic,
    resourceOptions = [],
    inputParameters,
    resourceIds = new Set(),
}: ValueSourceEditorProps) {
    const mode = getMode(selector);

    const handleModeChange = (m: Mode) => {
        if (m === "constant") {
            onSelectorChange(undefined); // remove selector → static constant
        } else if (m === "input") {
            onSelectorChange({ kind: "input", inputId: "" });
        } else {
            onSelectorChange(defaultSelector(fieldKind));
        }
    };

    return (
        <div className="flex flex-col gap-0 flex-1 min-w-0">
            {/* Mode picker + value on the same row */}
            <div className="flex items-center gap-1.5 min-w-0">
                <ModePill mode={mode} fieldKind={fieldKind} onChange={handleModeChange} />

                {/* Static constant mode: show the caller's existing editor */}
                {mode === "constant" && (
                    <div className="flex-1 min-w-0">{renderStatic()}</div>
                )}

                {/* Input mode: input param picker */}
                {mode === "input" && selector?.kind === "input" && (
                    <>
                        <div className="flex-1 min-w-0">
                            <ResourceSelect
                                value={selector.inputId}
                                onChange={(v) => onSelectorChange({ kind: "input", inputId: v })}
                                options={inputParameters.map((p) => ({ value: p.name, label: p.name }))}
                                allowEmpty
                            />
                        </div>
                        <ValidationBadge
                            src={selector}
                            field={slotName}
                            fieldKind={fieldKind}
                            inputParameters={inputParameters}
                            resourceIds={resourceIds}
                        />
                    </>
                )}

                {/* Select mode: show summary + validation in the header row */}
                {mode === "select" && selector?.kind === "select" && (
                    <ValidationBadge
                        src={selector}
                        field={slotName}
                        fieldKind={fieldKind}
                        inputParameters={inputParameters}
                        resourceIds={resourceIds}
                    />
                )}
            </div>

            {/* Select expanded body */}
            {mode === "select" && selector?.kind === "select" && (
                <div className="border border-purple-800/30 rounded mt-1 bg-zinc-900/30">
                    <SelectEditor
                        src={selector}
                        onChange={(vs) => onSelectorChange(vs)}
                        fieldKind={fieldKind}
                        resourceOptions={resourceOptions}
                        inputParameters={inputParameters}
                        depth={0}
                    />
                </div>
            )}
        </div>
    );
}
