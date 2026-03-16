import { useStore } from "../../../state/store";
import { ResourceSelect } from "../../../components/ui/ResourceSelect";
import { FieldRow } from "../../../components/ui/Panel";
import { useShaderDescriptor, inferAccess } from "../../../utils/shaderApi";
import type { ShaderRTSlot, SlotAccess } from "../../../utils/shaderApi";
import type { DispatchComputeStep } from "../../../types";

export function DispatchComputeEditor({ step }: { step: DispatchComputeStep }) {
    const { updateStep, resources } = useStore();
    const u = (patch: object) => updateStep(step.id, patch as never);
    // Show all shaders — compute steps can use any stage (fragment/compute for fullscreen/quad nodes)
    const computeShaders = resources.shaders.map((s) => ({ value: s.id, label: s.name }));

    // Look up the UUID from the selected shader resource
    const shaderDef = resources.shaders.find((s) => s.id === step.shader);
    const shaderUuid = shaderDef?.uuid;

    const { descriptor, loading, error } = useShaderDescriptor(shaderUuid);

    // Merge descriptor slots with any extra binding keys (e.g. imported from rg.json)
    const descriptorSlots: ShaderRTSlot[] = descriptor?.renderTargetSlots ?? [];
    const descriptorNames = new Set(descriptorSlots.map((s) => s.name));
    const inferredSlots: ShaderRTSlot[] = Object.keys(step.shaderBindings ?? {})
        .filter((k) => !descriptorNames.has(k))
        .map((k) => ({
            name: k,
            access: (step.shaderBindingAccess?.[k] ?? inferAccess(k)) as SlotAccess,
            isSizeRef: k === step.sizeReferenceSlot || k.toLowerCase().includes("sizereference"),
        }));
    // Also apply isSizeRef to descriptor slots
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

                    {/* All slots: descriptor slots + inferred from existing bindings */}
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
        </>
    );
}
