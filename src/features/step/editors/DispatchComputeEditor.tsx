import { useMemo } from "react";
import { useStore } from "../../../state/store";
import { ResourceSelect } from "../../../components/ui/ResourceSelect";
import { ValueSourceEditor } from "../../../components/ui/ValueSourceEditor";
import { FieldRow } from "../../../components/ui/Panel";
import { useShaderDescriptor, inferAccess } from "../../../utils/shaderApi";
import type { ShaderRTSlot, SlotAccess } from "../../../utils/shaderApi";
import type { DispatchComputeStep, ValueSource } from "../../../types";

export function DispatchComputeEditor({ step }: { step: DispatchComputeStep }) {
    const { updateStep, resources } = useStore();
    const u = (patch: object) => updateStep(step.id, patch as never);
    const computeShaders = resources.shaders.map((s) => ({ value: s.id, label: s.name }));

    const shaderDef = resources.shaders.find((s) => s.id === step.shader);
    const { descriptor, loading, error } = useShaderDescriptor(shaderDef?.uuid);

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
        ...resources.inputParameters.map((p) => ({ value: p.id, label: p.name })),
    ];

    const resourceIds = useMemo(
        () => new Set([...resources.renderTargets.map((r) => r.id), ...resources.buffers.map((b) => b.id)]),
        [resources],
    );

    const updateBinding = (slotName: string, rid: string) =>
        u({ shaderBindings: { ...(step.shaderBindings ?? {}), [slotName]: rid } });

    const updateSelector = (slotName: string, src: ValueSource | undefined) => {
        const next = { ...(step.fieldSelectors ?? {}) };
        if (src === undefined) delete next[slotName];
        else next[slotName] = src;
        u({ fieldSelectors: next });
    };

    const updateConstant = (name: string, value: number | boolean) =>
        u({ shaderConstants: { ...(step.shaderConstants ?? {}), [name]: value } });

    return (
        <>
            <FieldRow label="Shader">
                <ResourceSelect
                    value={step.shader}
                    onChange={(v) => u({ shader: v })}
                    options={computeShaders}
                />
            </FieldRow>

            {step.shader && (
                <div className="mx-3 mt-1 mb-2 border border-zinc-700/50 rounded">
                    <div className="px-2 py-1 bg-zinc-800/80 flex items-center gap-2 rounded-t">
                        <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider flex-1">
                            Shader Bindings
                        </span>
                        {loading && <span className="text-[9px] text-zinc-500 italic">fetching…</span>}
                        {error && <span className="text-[9px] text-amber-400" title={error}>⚠ no descriptor</span>}
                        {!shaderDef?.uuid && <span className="text-[9px] text-zinc-600 italic">set API key to load slots</span>}
                    </div>

                    {/* Constant scalar slots */}
                    {Object.entries(step.shaderConstants ?? {}).map(([name, value]) => {
                        const isNum = typeof value === "number";
                        const fieldKind = isNum ? "scalar" as const : "bool" as const;
                        const selector = step.fieldSelectors?.[name];
                        return (
                            <div key={name} className="border-t border-zinc-800/60 bg-zinc-900/20">
                                <div className="flex items-start gap-2 px-2 py-1.5">
                                    <div className="flex items-center gap-1 min-w-0 pt-0.5" style={{ minWidth: "40%" }}>
                                        <span className="text-[10px] font-mono text-zinc-400 truncate" title={name}>{name}</span>
                                        <span className="text-[9px] shrink-0 rounded px-1 py-0 border bg-zinc-800 text-zinc-600 border-zinc-700/40">
                                            {isNum ? "scalar" : "bool"}
                                        </span>
                                    </div>
                                    <ValueSourceEditor
                                        slotName={name}
                                        selector={selector}
                                        onSelectorChange={(src) => updateSelector(name, src)}
                                        fieldKind={fieldKind}
                                        inputParameters={resources.inputParameters}
                                        resourceIds={resourceIds}
                                        renderStatic={() =>
                                            fieldKind === "bool" ? (
                                                <select
                                                    value={String(value)}
                                                    onChange={(e) => updateConstant(name, e.target.value === "true")}
                                                    className="w-full bg-zinc-800 border border-zinc-700/60 text-zinc-200 text-[11px] rounded px-1.5 py-1 focus:outline-none"
                                                >
                                                    <option value="true">true</option>
                                                    <option value="false">false</option>
                                                </select>
                                            ) : (
                                                <input
                                                    type="number"
                                                    value={value as number}
                                                    onChange={(e) => updateConstant(name, parseFloat(e.target.value) || 0)}
                                                    className="w-full bg-zinc-800 border border-zinc-700/60 text-zinc-200 text-[11px] rounded px-1.5 py-1 focus:outline-none font-mono"
                                                />
                                            )
                                        }
                                    />
                                </div>
                            </div>
                        );
                    })}

                    {/* Resource binding slots */}
                    {allSlots.length > 0 ? (
                        allSlots.map((slot) => {
                            const selector = step.fieldSelectors?.[slot.name];
                            return (
                                <div
                                    key={slot.name}
                                    className={`border-t border-zinc-800/60 ${slot.isSizeRef ? "bg-teal-950/40" : ""}`}
                                >
                                    <div className="flex items-start gap-2 px-2 py-1.5">
                                        {/* Left: slot label + badges */}
                                        <div className="flex items-center gap-1 min-w-0 pt-0.5 shrink-0" style={{ minWidth: "40%" }}>
                                            <span className="text-[10px] font-mono text-zinc-300 truncate" title={slot.name}>
                                                {slot.name}
                                            </span>
                                            <span className={`text-[9px] shrink-0 rounded px-1 py-0 border ${
                                                slot.access === "read_write"
                                                    ? "bg-purple-900/30 text-purple-400 border-purple-700/40"
                                                    : slot.access === "write"
                                                      ? "bg-amber-900/30 text-amber-400 border-amber-700/40"
                                                      : "bg-blue-900/30 text-blue-400 border-blue-700/40"
                                            }`}>
                                                {slot.access}
                                            </span>
                                            {slot.isSizeRef && (
                                                <span className="text-[9px] shrink-0 rounded px-1 py-0 border bg-teal-900/40 text-teal-400 border-teal-700/50">size</span>
                                            )}
                                        </div>
                                        {/* Right: value source editor */}
                                        <ValueSourceEditor
                                            slotName={slot.name}
                                            selector={selector}
                                            onSelectorChange={(src) => updateSelector(slot.name, src)}
                                            fieldKind="resource"
                                            resourceOptions={rtOpts}
                                            inputParameters={resources.inputParameters}
                                            resourceIds={resourceIds}
                                            renderStatic={() => (
                                                <ResourceSelect
                                                    value={step.shaderBindings?.[slot.name] ?? ""}
                                                    onChange={(v) => updateBinding(slot.name, v)}
                                                    options={rtOpts}
                                                    allowEmpty
                                                />
                                            )}
                                        />
                                    </div>
                                </div>
                            );
                        })
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
