import { useStore } from "../../../state/store";
import { Input } from "../../../components/ui/Input";
import { ResourceSelect } from "../../../components/ui/ResourceSelect";
import { FieldRow } from "../../../components/ui/Panel";
import { useShaderDescriptor, inferAccess } from "../../../utils/shaderApi";
import type { ShaderRTSlot, SlotAccess } from "../../../utils/shaderApi";
import type { DispatchComputeDecalsStep } from "../../../types";

export function DispatchComputeDecalsEditor({ step }: { step: DispatchComputeDecalsStep }) {
    const { updateStep, resources } = useStore();
    const u = (patch: object) => updateStep(step.id, patch as never);
    const computeShaders = resources.shaders.map((s) => ({ value: s.id, label: s.name }));

    const shaderDef = resources.shaders.find((s) => s.id === step.shader);
    const shaderUuid = shaderDef?.uuid;

    const { descriptor, loading, error } = useShaderDescriptor(shaderUuid);

    const descriptorSlots: ShaderRTSlot[] = descriptor?.renderTargetSlots ?? [];
    const descriptorNames = new Set(descriptorSlots.map((s) => s.name));
    const inferredSlots: ShaderRTSlot[] = Object.keys(step.shaderBindings ?? {})
        .filter((k) => !descriptorNames.has(k))
        .map((k) => ({
            name: k,
            access: (step.shaderBindingAccess?.[k] ?? inferAccess(k)) as SlotAccess,
            isSizeRef: k === step.sizeReferenceSlot || k.toLowerCase().includes("sizereference"),
        }));
    const allSlots: ShaderRTSlot[] = [
        ...descriptorSlots.map((s) => ({
            ...s,
            isSizeRef:
                s.name === step.sizeReferenceSlot || s.name.toLowerCase().includes("sizereference"),
        })),
        ...inferredSlots,
    ];

    const rtOpts = [
        ...resources.renderTargets.map((r) => ({ value: r.id, label: r.name })),
        ...resources.buffers.map((b) => ({ value: b.id, label: b.name })),
    ];

    const updateBinding = (slotName: string, rid: string) => {
        u({ shaderBindings: { ...(step.shaderBindings ?? {}), [slotName]: rid } });
    };

    return (
        <>
            <FieldRow label="Shader">
                <ResourceSelect
                    value={step.shader}
                    onChange={(v) => u({ shader: v })}
                    options={computeShaders}
                />
            </FieldRow>

            {/* Shader bindings section */}
            {step.shader && (
                <div className="mx-3 mt-1 mb-2 border border-zinc-700/50 rounded overflow-hidden">
                    <div className="px-2 py-1 bg-zinc-800/80 flex items-center gap-2">
                        <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider flex-1">
                            Shader Bindings
                        </span>
                        {loading && (
                            <span className="text-[9px] text-zinc-500 italic">fetching…</span>
                        )}
                        {error && (
                            <span className="text-[9px] text-amber-400" title={error}>
                                ⚠ no descriptor
                            </span>
                        )}
                        {!shaderUuid && (
                            <span className="text-[9px] text-zinc-600 italic">
                                set API key to load slots
                            </span>
                        )}
                    </div>
                    {allSlots.length > 0 ? (
                        allSlots.map((slot) => (
                            <div
                                key={slot.name}
                                className={`grid grid-cols-[1fr_1fr] gap-2 items-center px-2 py-1 border-t border-zinc-800/60 ${
                                    slot.isSizeRef ? "bg-teal-950/40" : ""
                                }`}
                            >
                                <div className="flex items-center gap-1 min-w-0">
                                    <span
                                        className="text-[10px] font-mono text-zinc-300 truncate"
                                        title={slot.name}
                                    >
                                        {slot.name}
                                    </span>
                                    <span
                                        className={`text-[9px] shrink-0 rounded px-1 py-0 border ${
                                            slot.access === "read_write"
                                                ? "bg-purple-900/30 text-purple-400 border-purple-700/40"
                                                : slot.access === "write"
                                                  ? "bg-amber-900/30  text-amber-400  border-amber-700/40"
                                                  : "bg-blue-900/30   text-blue-400   border-blue-700/40"
                                        }`}
                                    >
                                        {slot.access}
                                    </span>
                                    {slot.isSizeRef && (
                                        <span className="text-[9px] shrink-0 rounded px-1 py-0 border bg-teal-900/40 text-teal-400 border-teal-700/50">
                                            size
                                        </span>
                                    )}
                                </div>
                                <ResourceSelect
                                    value={step.shaderBindings?.[slot.name] ?? ""}
                                    onChange={(v) => updateBinding(slot.name, v)}
                                    options={rtOpts}
                                    allowEmpty
                                />
                            </div>
                        ))
                    ) : descriptor ? (
                        <div className="px-2 py-1.5 text-[10px] text-zinc-600 italic border-t border-zinc-800/60">
                            No render-target slots in descriptor.
                        </div>
                    ) : null}
                </div>
            )}

            {/* Decal material fields */}
            <FieldRow label="Material Set">
                <Input
                    value={step.materialSet ?? ""}
                    onChange={(e) => u({ materialSet: e.target.value || undefined })}
                    placeholder="default"
                />
            </FieldRow>
            <FieldRow label="Batch Tag">
                <Input
                    value={step.batchTag ?? ""}
                    onChange={(e) => u({ batchTag: e.target.value || undefined })}
                    placeholder="optional"
                />
            </FieldRow>
        </>
    );
}
