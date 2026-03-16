import { useStore } from "../../../state/store";
import { Input } from "../../../components/ui/Input";
import { ResourceSelect } from "../../../components/ui/ResourceSelect";
import { FieldRow } from "../../../components/ui/Panel";
import { useShaderDescriptor, inferAccess } from "../../../utils/shaderApi";
import type { ShaderRTSlot } from "../../../utils/shaderApi";
import type { DispatchRayTracingStep } from "../../../types";

export function DispatchRayTracingEditor({ step }: { step: DispatchRayTracingStep }) {
    const { updateStep, resources } = useStore();
    const u = (patch: object) => updateStep(step.id, patch as never);
    const rtShaders = resources.shaders
        .filter((s) => ["raygen", "miss", "closesthit"].includes(s.stage))
        .map((s) => ({ value: s.id, label: `${s.name} (${s.stage})` }));

    // Look up UUID for the raygen shader to fetch its descriptor
    const raygenDef = resources.shaders.find((s) => s.id === step.raygenShader);
    const raygenUuid =
        raygenDef?.uuid ??
        (step.raygenShader?.startsWith("shader-") ? step.raygenShader.slice(7) : undefined);
    const { descriptor, loading, error } = useShaderDescriptor(raygenUuid);

    // Merge descriptor slots with any extra binding keys (e.g. imported from rg.json)
    const descriptorSlots: ShaderRTSlot[] = descriptor?.renderTargetSlots ?? [];
    const descriptorNames = new Set(descriptorSlots.map((s) => s.name));
    const inferredSlots: ShaderRTSlot[] = Object.keys(step.shaderBindings ?? {})
        .filter((k) => !descriptorNames.has(k))
        .map((k) => ({ name: k, access: inferAccess(k) }));
    const allSlots: ShaderRTSlot[] = [...descriptorSlots, ...inferredSlots];

    const rtOpts = [
        ...resources.renderTargets.map((r) => ({ value: r.id, label: r.name })),
        ...resources.buffers.map((b) => ({ value: b.id, label: b.name })),
    ];

    const updateBinding = (slotName: string, rid: string) => {
        u({ shaderBindings: { ...(step.shaderBindings ?? {}), [slotName]: rid } });
    };

    return (
        <>
            <FieldRow label="Raygen Shader">
                <ResourceSelect
                    value={step.raygenShader}
                    onChange={(v) => u({ raygenShader: v })}
                    options={rtShaders}
                />
            </FieldRow>
            <FieldRow label="Miss Shader">
                <ResourceSelect
                    value={step.missShader ?? ""}
                    onChange={(v) => u({ missShader: v })}
                    options={rtShaders}
                />
            </FieldRow>
            <FieldRow label="ClosestHit">
                <ResourceSelect
                    value={step.closestHitShader ?? ""}
                    onChange={(v) => u({ closestHitShader: v })}
                    options={rtShaders}
                />
            </FieldRow>
            <FieldRow label="Width">
                <Input
                    value={String(step.width)}
                    onChange={(e) => u({ width: e.target.value })}
                    placeholder="viewport.width"
                />
            </FieldRow>
            <FieldRow label="Height">
                <Input
                    value={String(step.height)}
                    onChange={(e) => u({ height: e.target.value })}
                    placeholder="viewport.height"
                />
            </FieldRow>

            {/* Raygen shader bindings */}
            {step.raygenShader && (
                <div className="mx-3 mt-1 mb-2 border border-zinc-700/50 rounded overflow-hidden">
                    <div className="px-2 py-1 bg-zinc-800/80 flex items-center gap-2">
                        <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider flex-1">
                            Raygen Bindings
                        </span>
                        {loading && (
                            <span className="text-[9px] text-zinc-500 italic">fetching…</span>
                        )}
                        {error && (
                            <span className="text-[9px] text-amber-400" title={error}>
                                ⚠ no descriptor
                            </span>
                        )}
                    </div>

                    {/* All slots: descriptor slots + inferred from existing bindings */}
                    {allSlots.length > 0 ? (
                        allSlots.map((slot) => (
                            <div
                                key={slot.name}
                                className="grid grid-cols-[1fr_1fr] gap-2 items-center px-2 py-1 border-t border-zinc-800/60"
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
