import { useStore } from "../../../state/store";
import { Input } from "../../../components/ui/Input";
import { Select } from "../../../components/ui/Select";
import { FieldRow } from "../../../components/ui/Panel";
import { ResourceSelect } from "../../../components/ui/ResourceSelect";
import { useShaderDescriptor, inferAccess } from "../../../utils/shaderApi";
import type { ShaderRTSlot } from "../../../utils/shaderApi";
import { newId } from "../../../utils/id";
import type {
    RasterCommand,
    SetDynamicStateCommand,
    DrawBatchCommand,
    DrawBatchType,
    PipelineConfig,
    BatchFilter,
    VkPrimitiveTopology,
    VkPolygonMode,
    VkCullMode,
    VkFrontFace,
    VkCompareOp,
    StepId,
    CommandId,
    DynamicStateType,
    ResourceId,
} from "../../../types";

const DYNAMIC_STATE_OPTIONS: { value: DynamicStateType; label: string }[] = [
    { value: "viewport", label: "Viewport" },
    { value: "scissor", label: "Scissor" },
    { value: "depthBias", label: "Depth Bias" },
    { value: "stencilRef", label: "Stencil Ref" },
];

// ─── Batch flags (batch_type bitfield) ────────────────────────────────────────

const BATCH_FLAGS: { bit: number; label: string }[] = [
    { bit: 1 << 0,  label: "Opaque" },
    { bit: 1 << 1,  label: "Transparent" },
    { bit: 1 << 2,  label: "Static Meshes" },
    { bit: 1 << 3,  label: "Static Textured" },
    { bit: 1 << 4,  label: "All Static" },
    { bit: 1 << 5,  label: "Skinned" },
    { bit: 1 << 6,  label: "Selected" },
    { bit: 1 << 7,  label: "No Material" },
    { bit: 1 << 8,  label: "Double-Sided" },
    { bit: 1 << 9,  label: "Single-Sided" },
    { bit: 1 << 10, label: "Occlusion" },
    { bit: 1 << 11, label: "Unselected" },
    { bit: 1 << 12, label: "Cast Shadows" },
];

// ─── Pipeline config options ──────────────────────────────────────────────────

const TOPOLOGY_OPTIONS: { value: VkPrimitiveTopology; label: string }[] = [
    { value: "pointList",    label: "Point List" },
    { value: "lineList",     label: "Line List" },
    { value: "lineStrip",    label: "Line Strip" },
    { value: "triangleList", label: "Triangle List" },
    { value: "triangleStrip",label: "Triangle Strip" },
    { value: "triangleFan",  label: "Triangle Fan" },
];

const POLYGON_MODE_OPTIONS: { value: VkPolygonMode; label: string }[] = [
    { value: "fill",  label: "Fill" },
    { value: "line",  label: "Wireframe" },
    { value: "point", label: "Points" },
];

const CULL_MODE_OPTIONS: { value: VkCullMode; label: string }[] = [
    { value: "none",         label: "None" },
    { value: "front",        label: "Front" },
    { value: "back",         label: "Back" },
    { value: "frontAndBack", label: "Front & Back" },
];

const FRONT_FACE_OPTIONS: { value: VkFrontFace; label: string }[] = [
    { value: "counterClockwise", label: "CCW" },
    { value: "clockwise",        label: "CW" },
];

const COMPARE_OP_OPTIONS: { value: VkCompareOp; label: string }[] = [
    { value: "never",          label: "Never" },
    { value: "less",           label: "Less" },
    { value: "equal",          label: "Equal" },
    { value: "lessOrEqual",    label: "Less or Equal" },
    { value: "greater",        label: "Greater" },
    { value: "notEqual",       label: "Not Equal" },
    { value: "greaterOrEqual", label: "Greater or Equal" },
    { value: "always",         label: "Always" },
];

function SetDynamicStateEditor({ cmd, stepId }: { cmd: SetDynamicStateCommand; stepId: StepId }) {
    const { updateRasterCommand } = useStore();
    const u = (patch: Partial<SetDynamicStateCommand>) =>
        updateRasterCommand(stepId, cmd.id, patch as Partial<RasterCommand>);

    return (
        <>
            <FieldRow label="State Type">
                <Select
                    options={DYNAMIC_STATE_OPTIONS}
                    value={cmd.stateType}
                    onChange={(e) => u({ stateType: e.target.value as DynamicStateType })}
                />
            </FieldRow>

            {(cmd.stateType === "viewport" || cmd.stateType === "scissor") && (
                <>
                    <FieldRow label="X / Y">
                        <div className="flex gap-1">
                            <input
                                type="number"
                                value={cmd.x ?? 0}
                                onChange={(e) => u({ x: parseFloat(e.target.value) || 0 })}
                                className="w-16 bg-zinc-800 border border-zinc-700 text-zinc-100 text-xs rounded px-1.5 py-1"
                            />
                            <input
                                type="number"
                                value={cmd.y ?? 0}
                                onChange={(e) => u({ y: parseFloat(e.target.value) || 0 })}
                                className="w-16 bg-zinc-800 border border-zinc-700 text-zinc-100 text-xs rounded px-1.5 py-1"
                            />
                        </div>
                    </FieldRow>
                    <FieldRow label="Width">
                        <Input
                            value={String(cmd.width ?? "viewport.width")}
                            onChange={(e) => u({ width: e.target.value })}
                        />
                    </FieldRow>
                    <FieldRow label="Height">
                        <Input
                            value={String(cmd.height ?? "viewport.height")}
                            onChange={(e) => u({ height: e.target.value })}
                        />
                    </FieldRow>
                </>
            )}

            {cmd.stateType === "viewport" && (
                <FieldRow label="Depth Range">
                    <div className="flex gap-1 items-center">
                        <input
                            type="number"
                            step="0.01"
                            value={cmd.minDepth ?? 0}
                            onChange={(e) => u({ minDepth: parseFloat(e.target.value) || 0 })}
                            className="w-14 bg-zinc-800 border border-zinc-700 text-zinc-100 text-xs rounded px-1.5 py-1"
                            title="Min depth"
                        />
                        <span className="text-zinc-600 text-xs">–</span>
                        <input
                            type="number"
                            step="0.01"
                            value={cmd.maxDepth ?? 1}
                            onChange={(e) => u({ maxDepth: parseFloat(e.target.value) || 0 })}
                            className="w-14 bg-zinc-800 border border-zinc-700 text-zinc-100 text-xs rounded px-1.5 py-1"
                            title="Max depth"
                        />
                    </div>
                </FieldRow>
            )}

            {cmd.stateType === "depthBias" && (
                <>
                    <FieldRow label="Constant Factor">
                        <input
                            type="number"
                            step="0.001"
                            value={cmd.constantFactor ?? 0}
                            onChange={(e) => u({ constantFactor: parseFloat(e.target.value) || 0 })}
                            className="w-24 bg-zinc-800 border border-zinc-700 text-zinc-100 text-xs rounded px-1.5 py-1"
                        />
                    </FieldRow>
                    <FieldRow label="Clamp">
                        <input
                            type="number"
                            step="0.001"
                            value={cmd.clamp ?? 0}
                            onChange={(e) => u({ clamp: parseFloat(e.target.value) || 0 })}
                            className="w-24 bg-zinc-800 border border-zinc-700 text-zinc-100 text-xs rounded px-1.5 py-1"
                        />
                    </FieldRow>
                    <FieldRow label="Slope Factor">
                        <input
                            type="number"
                            step="0.001"
                            value={cmd.slopeFactor ?? 0}
                            onChange={(e) => u({ slopeFactor: parseFloat(e.target.value) || 0 })}
                            className="w-24 bg-zinc-800 border border-zinc-700 text-zinc-100 text-xs rounded px-1.5 py-1"
                        />
                    </FieldRow>
                </>
            )}

            {cmd.stateType === "stencilRef" && (
                <FieldRow label="Reference">
                    <input
                        type="number"
                        value={cmd.reference ?? 0}
                        onChange={(e) => u({ reference: parseInt(e.target.value) || 0 })}
                        className="w-20 bg-zinc-800 border border-zinc-700 text-zinc-100 text-xs rounded px-1.5 py-1"
                    />
                </FieldRow>
            )}
        </>
    );
}

// ─── Batch filter editor ──────────────────────────────────────────────────────

function BatchFilterEditor({
    filter,
    onUpdate,
    onDuplicate,
    onRemove,
    removable,
}: {
    filter: BatchFilter;
    onUpdate: (patch: Partial<BatchFilter>) => void;
    onDuplicate: () => void;
    onRemove: () => void;
    removable: boolean;
}) {
    return (
        <div className="border border-zinc-700/40 rounded mb-1.5 overflow-hidden">
            <div className="flex items-center gap-1.5 px-2 py-1 bg-zinc-800/50">
                <input
                    type="text"
                    value={filter.label ?? ""}
                    onChange={(e) => onUpdate({ label: e.target.value || undefined })}
                    placeholder="label…"
                    className="flex-1 bg-transparent text-[10px] text-zinc-300 focus:outline-none placeholder:text-zinc-600"
                />
                <button onClick={onDuplicate} title="Duplicate" className="text-zinc-600 hover:text-zinc-300 text-[10px] leading-none transition-colors">⧉</button>
                {removable && (
                    <button onClick={onRemove} className="text-zinc-600 hover:text-red-400 text-[10px] leading-none transition-colors">✕</button>
                )}
            </div>
            <div className="px-2 py-1.5 flex flex-wrap gap-1">
                {BATCH_FLAGS.map(({ bit, label }) => {
                    const active = (filter.flags & bit) !== 0;
                    return (
                        <button
                            key={bit}
                            onClick={() => onUpdate({ flags: filter.flags ^ bit })}
                            className={`text-[9px] px-1.5 py-0.5 rounded border transition-colors ${
                                active
                                    ? "bg-emerald-900/50 text-emerald-300 border-emerald-700/50"
                                    : "bg-zinc-800/60 text-zinc-500 border-zinc-700/40 hover:text-zinc-300"
                            }`}
                        >
                            {label}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

// ─── Pipeline config editor ───────────────────────────────────────────────────

function PipelineConfigEditor({
    cfg,
    onUpdate,
    onDuplicate,
    onRemove,
    removable,
}: {
    cfg: PipelineConfig;
    onUpdate: (patch: Partial<PipelineConfig>) => void;
    onDuplicate: () => void;
    onRemove: () => void;
    removable: boolean;
}) {
    const FIELD = "bg-zinc-800 border border-zinc-700/60 text-zinc-200 text-[11px] rounded px-1.5 py-0.5 focus:outline-none w-full";
    const CHK = "w-3.5 h-3.5 accent-blue-500 cursor-pointer";

    return (
        <div className="border border-zinc-700/40 rounded mb-1.5 overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-1.5 px-2 py-1 bg-zinc-800/50">
                <input
                    type="text"
                    value={cfg.label ?? ""}
                    onChange={(e) => onUpdate({ label: e.target.value || undefined })}
                    placeholder="label…"
                    className="flex-1 bg-transparent text-[10px] text-zinc-300 focus:outline-none placeholder:text-zinc-600"
                />
                <button
                    onClick={onDuplicate}
                    title="Duplicate"
                    className="text-zinc-600 hover:text-zinc-300 text-[10px] leading-none transition-colors"
                >⧉</button>
                {removable && (
                    <button
                        onClick={onRemove}
                        className="text-zinc-600 hover:text-red-400 text-[10px] leading-none transition-colors"
                    >✕</button>
                )}
            </div>

            <div className="px-2 py-1.5 flex flex-col gap-1">
                {/* Topology + Polygon Mode */}
                <div className="grid grid-cols-2 gap-1.5">
                    <div>
                        <div className="text-[9px] text-zinc-600 mb-0.5">Topology</div>
                        <select value={cfg.topology ?? "triangleList"} onChange={(e) => onUpdate({ topology: e.target.value as VkPrimitiveTopology })} className={FIELD}>
                            {TOPOLOGY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                    </div>
                    <div>
                        <div className="text-[9px] text-zinc-600 mb-0.5">Polygon</div>
                        <select value={cfg.polygonMode ?? "fill"} onChange={(e) => onUpdate({ polygonMode: e.target.value as VkPolygonMode })} className={FIELD}>
                            {POLYGON_MODE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                    </div>
                </div>

                {/* Cull Mode + Front Face */}
                <div className="grid grid-cols-2 gap-1.5">
                    <div>
                        <div className="text-[9px] text-zinc-600 mb-0.5">Cull</div>
                        <select value={cfg.cullMode ?? "none"} onChange={(e) => onUpdate({ cullMode: e.target.value as VkCullMode })} className={FIELD}>
                            {CULL_MODE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                    </div>
                    <div>
                        <div className="text-[9px] text-zinc-600 mb-0.5">Front Face</div>
                        <select value={cfg.frontFace ?? "counterClockwise"} onChange={(e) => onUpdate({ frontFace: e.target.value as VkFrontFace })} className={FIELD}>
                            {FRONT_FACE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                    </div>
                </div>

                {/* Depth */}
                <div className="grid grid-cols-[auto_auto_1fr] gap-x-3 gap-y-0.5 items-center">
                    <label className="flex items-center gap-1 cursor-pointer">
                        <input type="checkbox" checked={cfg.depthTestEnable ?? true} onChange={(e) => onUpdate({ depthTestEnable: e.target.checked })} className={CHK} />
                        <span className="text-[10px] text-zinc-400">Depth Test</span>
                    </label>
                    <label className="flex items-center gap-1 cursor-pointer">
                        <input type="checkbox" checked={cfg.depthWriteEnable ?? true} onChange={(e) => onUpdate({ depthWriteEnable: e.target.checked })} className={CHK} />
                        <span className="text-[10px] text-zinc-400">Write</span>
                    </label>
                    <label className="flex items-center gap-1 cursor-pointer">
                        <input type="checkbox" checked={cfg.depthBiasEnable ?? false} onChange={(e) => onUpdate({ depthBiasEnable: e.target.checked })} className={CHK} />
                        <span className="text-[10px] text-zinc-400">Bias</span>
                    </label>
                </div>
                {(cfg.depthTestEnable ?? true) && (
                    <div>
                        <div className="text-[9px] text-zinc-600 mb-0.5">Compare Op</div>
                        <select value={cfg.depthCompareOp ?? "greater"} onChange={(e) => onUpdate({ depthCompareOp: e.target.value as VkCompareOp })} className={FIELD}>
                            {COMPARE_OP_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                    </div>
                )}

            </div>
        </div>
    );
}

// ─── Draw Batch editor ────────────────────────────────────────────────────────

function DrawBatchEditor({ cmd, stepId }: { cmd: DrawBatchCommand; stepId: StepId }) {
    const { updateRasterCommand, resources, pipeline } = useStore();
    const shaderOpts = resources.shaders.map((s) => ({ value: s.id, label: s.name }));
    const blendOpts = resources.blendStates.map((b) => ({ value: b.id, label: b.name }));
    const miOpts = resources.materialInterfaces.map((m) => ({ value: m.id, label: m.name }));

    // The stepId IS the raster step — get its attachment count directly
    const rasterStep = pipeline.steps[stepId] as import("../../../types").RasterStep | undefined;
    const stepAttachmentCount = rasterStep?.attachments?.colorAttachments?.length ?? 0;

    const u = (patch: Partial<DrawBatchCommand>) =>
        updateRasterCommand(stepId, cmd.id, patch as Partial<RasterCommand>);

    // Shader descriptor for binding slots
    const shaderDef = resources.shaders.find((s) => s.id === cmd.shader);
    const shaderUuid = shaderDef?.uuid;
    const { descriptor, loading, error } = useShaderDescriptor(shaderUuid);

    const descriptorSlots: ShaderRTSlot[] = descriptor?.renderTargetSlots ?? [];
    const descriptorNames = new Set(descriptorSlots.map((s) => s.name));
    const inferredSlots: ShaderRTSlot[] = Object.keys(cmd.shaderBindings ?? {})
        .filter((k) => !descriptorNames.has(k))
        .map((k) => ({ name: k, access: inferAccess(k) }));
    const allSlots: ShaderRTSlot[] = [...descriptorSlots, ...inferredSlots];

    const rtOpts = [
        ...resources.renderTargets.map((r) => ({ value: r.id, label: r.name })),
        ...resources.buffers.map((b) => ({ value: b.id, label: b.name })),
        ...resources.inputParameters.map((p) => ({ value: p.id, label: p.name })),
    ];
    const updateBinding = (slotName: string, rid: string) =>
        u({ shaderBindings: { ...(cmd.shaderBindings ?? {}), [slotName]: rid } });

    // Pipeline configs — fall back to a virtual config from legacy flat fields
    const configs: PipelineConfig[] = cmd.pipelineConfigs?.length
        ? cmd.pipelineConfigs
        : [{
            id: "__legacy__",
            cullMode: (cmd.cullMode as VkCullMode) ?? "back",
            depthTestEnable: cmd.depthTest ?? true,
            depthWriteEnable: cmd.depthWrite ?? true,
            depthCompareOp: "greater",
            topology: "triangleList",
            polygonMode: "fill",
            frontFace: "counterClockwise",
            depthBiasEnable: false,
        }];

    const updateConfig = (id: string, patch: Partial<PipelineConfig>) => {
        const next = configs.map((c) => c.id === id ? { ...c, ...patch } : c);
        u({ pipelineConfigs: next });
    };
    const addConfig = () => {
        u({ pipelineConfigs: [...configs, {
            id: newId(),
            cullMode: "back",
            depthTestEnable: true,
            depthWriteEnable: true,
            depthCompareOp: "greater",
            topology: "triangleList",
            polygonMode: "fill",
            frontFace: "counterClockwise",
            depthBiasEnable: false,
        }]});
    };
    const duplicateConfig = (id: string) => {
        const src = configs.find((c) => c.id === id);
        if (!src) return;
        const idx = configs.indexOf(src);
        const copy = { ...src, id: newId(), label: src.label ? src.label + " (copy)" : undefined };
        const next = [...configs.slice(0, idx + 1), copy, ...configs.slice(idx + 1)];
        u({ pipelineConfigs: next });
    };
    const removeConfig = (id: string) =>
        u({ pipelineConfigs: configs.filter((c) => c.id !== id) });

    const batchFilters: BatchFilter[] = cmd.batchFilters?.length
        ? cmd.batchFilters
        : [{ id: "__legacy__", flags: cmd.batchFlags ?? 0 }];

    const updateFilter = (id: string, patch: Partial<BatchFilter>) =>
        u({ batchFilters: batchFilters.map((f) => f.id === id ? { ...f, ...patch } : f) });
    const duplicateFilter = (id: string) => {
        const src = batchFilters.find((f) => f.id === id);
        if (!src) return;
        const idx = batchFilters.indexOf(src);
        const copy = { ...src, id: newId(), label: src.label ? src.label + " (copy)" : undefined };
        u({ batchFilters: [...batchFilters.slice(0, idx + 1), copy, ...batchFilters.slice(idx + 1)] });
    };
    const removeFilter = (id: string) =>
        u({ batchFilters: batchFilters.filter((f) => f.id !== id) });
    const addFilter = () =>
        u({ batchFilters: [...batchFilters, { id: newId(), flags: 0 }] });

    return (
        <>
            {/* ── Draw type ─────────────────────────────────────────────── */}
            <div className="px-3 pt-2 pb-1">
                <div className="flex rounded overflow-hidden border border-zinc-700/60">
                    {(["batch", "fullscreen", "debugLines"] as DrawBatchType[]).map((dt) => {
                        const labels: Record<DrawBatchType, string> = {
                            batch: "Batch",
                            fullscreen: "Fullscreen",
                            debugLines: "Debug Lines",
                        };
                        const active = (cmd.drawType ?? "batch") === dt;
                        return (
                            <button
                                key={dt}
                                onClick={() => u({ drawType: dt })}
                                className={`flex-1 text-[10px] py-1 transition-colors ${active ? "bg-blue-900/50 text-blue-300" : "text-zinc-500 hover:text-zinc-300"}`}
                            >
                                {labels[dt]}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* ── Blend states ──────────────────────────────────────────── */}
            {stepAttachmentCount > 0 && (() => {
                const blendIndices: Array<ResourceId | "disabled"> = Array.from(
                    { length: stepAttachmentCount },
                    (_, i) => cmd.blendStateIndices?.[i] ?? "disabled"
                );
                const updateBlend = (i: number, val: string) => {
                    const next = [...blendIndices];
                    next[i] = val || "disabled";
                    u({ blendStateIndices: next });
                };
                return (
                    <div className="px-3 py-2">
                        <div className="flex items-center gap-2 mb-1.5">
                            <span className="text-[9px] font-semibold text-zinc-600 uppercase tracking-wider flex-1">Blend States</span>
                        </div>
                        {blendIndices.map((bid, i) => (
                            <div key={i} className="grid grid-cols-[auto_1fr] gap-2 items-center py-0.5">
                                <span className="text-[10px] text-zinc-500 w-16">
                                    {stepAttachmentCount > 1 ? `Attachment ${i}` : "Attachment"}
                                </span>
                                <ResourceSelect
                                    value={bid === "disabled" ? "" : bid}
                                    onChange={(v) => updateBlend(i, v)}
                                    options={blendOpts}
                                    allowEmpty
                                    placeholder="Disabled"
                                    emptyLabel="Disabled"
                                />
                            </div>
                        ))}
                    </div>
                );
            })()}

            {/* ── Shader source ─────────────────────────────────────────── */}
            <div className="px-3 pt-2 pb-1">
                {(cmd.drawType ?? "batch") === "batch" && (
                    <div className="flex rounded overflow-hidden border border-zinc-700/60 mb-2">
                        <button
                            onClick={() => u({ withMaterials: false })}
                            className={`flex-1 text-[10px] py-1 transition-colors ${!cmd.withMaterials ? "bg-blue-900/50 text-blue-300" : "text-zinc-500 hover:text-zinc-300"}`}
                        >
                            Custom Shader
                        </button>
                        <button
                            onClick={() => u({ withMaterials: true })}
                            className={`flex-1 text-[10px] py-1 transition-colors ${cmd.withMaterials ? "bg-blue-900/50 text-blue-300" : "text-zinc-500 hover:text-zinc-300"}`}
                        >
                            Material Shaders
                        </button>
                    </div>
                )}
                {!cmd.withMaterials || (cmd.drawType ?? "batch") !== "batch" ? (
                    <ResourceSelect
                        value={cmd.shader}
                        onChange={(v) => u({ shader: v })}
                        options={shaderOpts}
                    />
                ) : (
                    <>
                        <Input
                            value={cmd.materialSet ?? ""}
                            onChange={(e) => u({ materialSet: e.target.value })}
                            placeholder="material set tag…"
                        />
                        <div className="mt-1.5">
                            <div className="text-[9px] text-zinc-600 mb-0.5 uppercase tracking-wider">Interface</div>
                            <ResourceSelect
                                value={cmd.materialInterfaceId ?? ""}
                                onChange={(v) => u({ materialInterfaceId: v || undefined })}
                                options={miOpts}
                                allowEmpty
                                placeholder="None"
                            />
                        </div>
                    </>
                )}
            </div>

            {/* ── Shader bindings ───────────────────────────────────────── */}
            {cmd.shader && !cmd.withMaterials && (
                <div className="border-t border-zinc-800/60">
                    <div className="px-3 py-1 flex items-center gap-2">
                        <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider flex-1">Shader Bindings</span>
                        {loading && <span className="text-[9px] text-zinc-500 italic">fetching…</span>}
                        {error && <span className="text-[9px] text-amber-400" title={error}>⚠</span>}
                    </div>
                    {allSlots.length > 0
                        ? allSlots.map((slot) => {
                            const boundId = cmd.shaderBindings?.[slot.name] ?? "";
                            const isRT = resources.renderTargets.some((r) => r.id === boundId);
                            return (
                                <div key={slot.name} className="grid grid-cols-[1fr_1fr] gap-2 items-center px-3 py-0.5">
                                    <div className="flex items-center gap-1 min-w-0">
                                        <span className="text-[10px] font-mono text-zinc-300 truncate" title={slot.name}>{slot.name}</span>
                                        {isRT && (
                                            <span className={`text-[9px] shrink-0 rounded px-1 py-0 border ${
                                                slot.access === "read_write" ? "bg-purple-900/30 text-purple-400 border-purple-700/40"
                                                : slot.access === "write" ? "bg-amber-900/30 text-amber-400 border-amber-700/40"
                                                : "bg-blue-900/30 text-blue-400 border-blue-700/40"
                                            }`}>{slot.access}</span>
                                        )}
                                    </div>
                                    <ResourceSelect value={boundId} onChange={(v) => updateBinding(slot.name, v)} options={rtOpts} allowEmpty />
                                </div>
                            );
                          })
                        : descriptor
                            ? <div className="px-3 py-1 text-[10px] text-zinc-600 italic">No RT slots in descriptor.</div>
                            : null
                    }
                </div>
            )}

            {/* ── Material inputs ───────────────────────────────────────── */}
            {cmd.materialInputs && Object.keys(cmd.materialInputs).length > 0 && (
                <div className="border-t border-zinc-800/60">
                    <div className="px-3 py-1 flex items-center gap-2">
                        <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider flex-1">Material Inputs</span>
                        {cmd.shader && !cmd.withMaterials && Object.keys(cmd.shaderBindings ?? {}).length > 0 && (
                            <span className="text-[9px] text-amber-400" title="Command has both shader bindings and material inputs">⚠ conflict</span>
                        )}
                    </div>
                    {Object.entries(cmd.materialInputs).map(([key, val]) => {
                        const setVal = (v: string | number | boolean) =>
                            u({ materialInputs: { ...cmd.materialInputs, [key]: v } });
                        return (
                            <div key={key} className="grid grid-cols-[1fr_1fr] gap-2 items-center px-3 py-0.5">
                                <div className="flex items-center gap-1 min-w-0">
                                    <span className="text-[10px] font-mono text-zinc-300 truncate" title={key}>{key}</span>
                                    {typeof val === "string" && (
                                        <span className="text-[9px] shrink-0 rounded px-1 py-0 border bg-blue-900/30 text-blue-400 border-blue-700/40">read</span>
                                    )}
                                </div>
                                {typeof val === "string" ? (
                                    <ResourceSelect value={val} onChange={setVal} options={rtOpts} allowEmpty />
                                ) : typeof val === "boolean" ? (
                                    <input type="checkbox" checked={val} onChange={(e) => setVal(e.target.checked)} className="w-4 h-4 accent-blue-500 cursor-pointer" />
                                ) : (
                                    <input type="number" value={val} onChange={(e) => setVal(parseFloat(e.target.value) || 0)} className="w-full bg-zinc-800 border border-zinc-700 text-zinc-100 text-xs rounded px-1.5 py-1 text-right" />
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* ── Batch filters ─────────────────────────────────────────── */}
            {(cmd.drawType ?? "batch") === "batch" && <div className="border-t border-zinc-800/60 px-3 py-2">
                <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[9px] font-semibold text-zinc-600 uppercase tracking-wider flex-1">Batch Filters</span>
                    <button onClick={addFilter} className="text-[9px] text-zinc-500 hover:text-zinc-300 transition-colors">＋ Add</button>
                </div>
                {batchFilters.map((filter) => (
                    <BatchFilterEditor
                        key={filter.id}
                        filter={filter}
                        onUpdate={(patch) => updateFilter(filter.id, patch)}
                        onDuplicate={() => duplicateFilter(filter.id)}
                        onRemove={() => removeFilter(filter.id)}
                        removable={batchFilters.length > 1}
                    />
                ))}
            </div>}

            {/* ── Pipeline configs ──────────────────────────────────────── */}
            <div className="border-t border-zinc-800/60 px-3 py-2">
                <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[9px] font-semibold text-zinc-600 uppercase tracking-wider flex-1">Pipeline Configs</span>
                    <button
                        onClick={addConfig}
                        className="text-[9px] text-zinc-500 hover:text-zinc-300 transition-colors"
                    >＋ Add</button>
                </div>
                {configs.map((cfg) => (
                    <PipelineConfigEditor
                        key={cfg.id}
                        cfg={cfg}
                        onUpdate={(patch) => updateConfig(cfg.id, patch)}
                        onDuplicate={() => duplicateConfig(cfg.id)}
                        onRemove={() => removeConfig(cfg.id)}
                        removable={configs.length > 1}
                    />
                ))}
            </div>

            {/* ── Combination matrix ────────────────────────────────────── */}
            {configs.length > 1 || batchFilters.length > 1 ? (() => {
                // When enabledCombinations is absent all pairs are active
                const enabled = cmd.enabledCombinations;
                const allActive = enabled === undefined;
                const isActive = (configId: string, filterId: string) =>
                    allActive || enabled!.some((e) => e.configId === configId && e.filterId === filterId);

                const toggleCell = (configId: string, filterId: string) => {
                    // Materialise the full set on first toggle
                    const current: { configId: string; filterId: string }[] = allActive
                        ? configs.flatMap((c) => batchFilters.map((f) => ({ configId: c.id, filterId: f.id })))
                        : [...enabled!];
                    const idx = current.findIndex((e) => e.configId === configId && e.filterId === filterId);
                    const next = idx >= 0 ? current.filter((_, i) => i !== idx) : [...current, { configId, filterId }];
                    u({ enabledCombinations: next.length === configs.length * batchFilters.length ? undefined : next });
                };

                return (
                    <div className="border-t border-zinc-800/60 px-3 py-2">
                        <div className="flex items-center gap-2 mb-2">
                            <span className="text-[9px] font-semibold text-zinc-600 uppercase tracking-wider flex-1">Active Combinations</span>
                            {!allActive && (
                                <button
                                    onClick={() => u({ enabledCombinations: undefined })}
                                    className="text-[9px] text-zinc-600 hover:text-zinc-300 transition-colors"
                                >reset</button>
                            )}
                        </div>
                        <div className="overflow-x-auto">
                            <table className="text-[9px] border-collapse w-full">
                                <thead>
                                    <tr>
                                        <th className="text-left pr-2 pb-1 text-zinc-600 font-normal w-0 whitespace-nowrap" />
                                        {batchFilters.map((f) => (
                                            <th key={f.id} className="pb-1 px-1 text-zinc-500 font-normal text-center max-w-12">
                                                <span className="block truncate" title={f.label ?? `Filter ${batchFilters.indexOf(f) + 1}`}>
                                                    {f.label || `F${batchFilters.indexOf(f) + 1}`}
                                                </span>
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {configs.map((cfg) => (
                                        <tr key={cfg.id}>
                                            <td className="pr-2 py-0.5 text-zinc-500 whitespace-nowrap text-right">
                                                {cfg.label || `C${configs.indexOf(cfg) + 1}`}
                                            </td>
                                            {batchFilters.map((f) => {
                                                const active = isActive(cfg.id, f.id);
                                                return (
                                                    <td key={f.id} className="text-center py-0.5 px-1">
                                                        <button
                                                            onClick={() => toggleCell(cfg.id, f.id)}
                                                            className={`w-4 h-4 rounded border transition-colors inline-flex items-center justify-center text-[9px] leading-none ${
                                                                active
                                                                    ? "bg-blue-600 border-blue-500 text-white"
                                                                    : "bg-zinc-900 border-zinc-600 text-zinc-700 hover:border-zinc-400"
                                                            }`}
                                                        >
                                                            {active ? "✓" : ""}
                                                        </button>
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                );
            })() : null}



        </>
    );
}

interface RasterCommandEditorProps {
    stepId: StepId;
    commandId: CommandId;
    command: RasterCommand;
}

export function RasterCommandEditor({ stepId, commandId, command }: RasterCommandEditorProps) {
    const { updateRasterCommand } = useStore();
    const u = (patch: Partial<RasterCommand>) => updateRasterCommand(stepId, commandId, patch);

    return (
        <div className="flex flex-col gap-0">
            <FieldRow label="Name">
                <Input value={command.name} onChange={(e) => u({ name: e.target.value })} />
            </FieldRow>

            {command.type === "setDynamicState" && (
                <SetDynamicStateEditor cmd={command} stepId={stepId} />
            )}
            {command.type === "drawBatch" && <DrawBatchEditor cmd={command} stepId={stepId} />}
        </div>
    );
}
