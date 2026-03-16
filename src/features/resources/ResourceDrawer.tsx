import { useMemo } from "react";
import { useStore } from "../../state/store";
import { Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { getResourceUsage } from "../../utils/dependencyGraph";
import type { TextureFormat, ShaderStage, InputParamType, BlendFactor, BlendOp } from "../../types";

// ─── Option lists ─────────────────────────────────────────────────────────────


const FORMAT_OPTS: { value: TextureFormat; label: string }[] = [
    { value: "rgba8", label: "RGBA8" },
    { value: "rgba16f", label: "RGBA16F" },
    { value: "rgba32f", label: "RGBA32F" },
    { value: "r11g11b10f", label: "R11G11B10F" },
    { value: "rg16f", label: "RG16F" },
    { value: "r32f", label: "R32F" },
    { value: "d32f", label: "D32F" },
    { value: "d24s8", label: "D24S8" },
    { value: "bc1", label: "BC1" },
    { value: "bc3", label: "BC3" },
    { value: "bc5", label: "BC5" },
    { value: "bc7", label: "BC7" },
];

const STAGE_OPTS: { value: ShaderStage; label: string }[] = [
    { value: "vertex", label: "Vertex" },
    { value: "fragment", label: "Fragment" },
    { value: "compute", label: "Compute" },
    { value: "raygen", label: "Raygen" },
    { value: "miss", label: "Miss" },
    { value: "closesthit", label: "Closest Hit" },
];

const PARAM_TYPE_OPTS: { value: InputParamType; label: string }[] = [
    { value: "bool", label: "Bool" },
    { value: "float", label: "Float" },
    { value: "uint", label: "Uint" },
    { value: "int", label: "Int" },
    { value: "vec2", label: "Vec2" },
    { value: "vec3", label: "Vec3" },
    { value: "vec4", label: "Vec4" },
    { value: "color", label: "Color" },
];

const BLEND_FACTOR_OPTS: { value: BlendFactor; label: string }[] = [
    { value: "zero", label: "Zero" },
    { value: "one", label: "One" },
    { value: "srcColor", label: "Src Color" },
    { value: "oneMinusSrcColor", label: "1 - Src Color" },
    { value: "dstColor", label: "Dst Color" },
    { value: "oneMinusDstColor", label: "1 - Dst Color" },
    { value: "srcAlpha", label: "Src Alpha" },
    { value: "oneMinusSrcAlpha", label: "1 - Src Alpha" },
    { value: "dstAlpha", label: "Dst Alpha" },
    { value: "oneMinusDstAlpha", label: "1 - Dst Alpha" },
];

const BLEND_OP_OPTS: { value: BlendOp; label: string }[] = [
    { value: "add", label: "Add" },
    { value: "subtract", label: "Subtract" },
    { value: "reverseSubtract", label: "Reverse Subtract" },
    { value: "min", label: "Min" },
    { value: "max", label: "Max" },
];

// ─── RT size helpers ──────────────────────────────────────────────────────────

/**
 * In the legacy schema, numeric 0 means "viewport size" and a non-zero fraction
 * like 0.5 means "50% of viewport". String values (e.g. "viewport.width") are
 * kept as-is.
 */
export function fmtRTSize(v: number | string): string {
    if (typeof v === "string") return v;
    if (v === 0) return "viewport";
    if (v > 0 && v < 1) return `${v}× viewport`;
    return String(v);
}

// ─── Section divider ──────────────────────────────────────────────────────────

function Section({ label }: { label: string }) {
    return (
        <div className="flex items-center gap-2 pt-1">
            <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 shrink-0">
                {label}
            </span>
            <div className="flex-1 h-px bg-zinc-700/50" />
        </div>
    );
}

// ─── ResourceDrawer ───────────────────────────────────────────────────────────

export function ResourceDrawer() {
    const {
        resources,
        pipeline,
        selectedResourceId,
        selectResource,
        selectPass,
        updateRenderTarget,
        deleteRenderTarget,
        updateBuffer,
        deleteBuffer,
        updateBlendState,
        deleteBlendState,
        updateShader,
        deleteShader,
        updateInputParameter,
        deleteInputParameter,
    } = useStore();

    const rid = selectedResourceId;

    const rt = rid ? resources.renderTargets.find((r) => r.id === rid) : undefined;
    const buf = rid ? resources.buffers.find((b) => b.id === rid) : undefined;
    const bs = rid ? resources.blendStates.find((b) => b.id === rid) : undefined;
    const sh = rid ? resources.shaders.find((s) => s.id === rid) : undefined;
    const param = rid ? resources.inputParameters.find((p) => p.id === rid) : undefined;

    const resource = rt ?? buf ?? bs ?? sh ?? param;

    const usageMap = useMemo(() => getResourceUsage(pipeline), [pipeline]);
    const usage = rid ? usageMap.get(rid) : undefined;
    const isDead = !!usage && usage.writers.length > 0 && usage.readers.length === 0;
    const isUnused = !usage || (usage.writers.length === 0 && usage.readers.length === 0);

    const resourceType = rt
        ? "Render Target"
        : buf
          ? "Buffer"
          : bs
            ? "Blend State"
            : sh
              ? "Shader"
              : param
                ? "Input Param"
                : "Unknown";
    const typeIcon = rt ? "▣" : buf ? "▤" : bs ? "⊞" : sh ? "◈" : "◆";
    const typeCls = rt
        ? "text-blue-400"
        : buf
          ? "text-amber-400"
          : bs
            ? "text-emerald-400"
            : sh
              ? "text-purple-400"
              : "text-zinc-400";

    const handleDelete = () => {
        if (!rid || !resource) return;
        if (!window.confirm(`Delete "${resource.name}"?`)) return;
        selectResource(null);
        if (rt) deleteRenderTarget(rid);
        else if (buf) deleteBuffer(rid);
        else if (bs) deleteBlendState(rid);
        else if (sh) deleteShader(rid);
        else if (param) deleteInputParameter(rid);
    };

    if (!resource) return null;

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-700/60 shrink-0">
                <span className={`text-sm leading-none ${typeCls}`}>{typeIcon}</span>
                <span className="text-xs font-semibold text-zinc-200 flex-1 truncate">
                    {resource.name}
                </span>
                {isDead && (
                    <span
                        className="shrink-0 text-[10px] text-amber-400 font-bold"
                        title="Written but never read — result is discarded"
                    >
                        ⚠
                    </span>
                )}
                {!isDead && isUnused && (
                    <span
                        className="shrink-0 text-[10px] text-zinc-500 font-bold"
                        title="Not referenced by any pass"
                    >
                        ⚠
                    </span>
                )}
                <button
                    onClick={() => selectResource(null)}
                    className="shrink-0 text-zinc-600 hover:text-zinc-300 text-sm leading-none p-0.5"
                    title="Close"
                >
                    ✕
                </button>
            </div>

            {/* Type badge */}
            <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800/60 shrink-0 bg-zinc-800/30">
                <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-600">
                    Type
                </span>
                <span className={`text-[10px] font-mono font-semibold ${typeCls}`}>
                    {resourceType}
                </span>
                <span className="text-[9px] font-mono text-zinc-700 ml-auto truncate">{rid}</span>
            </div>

            {/* Edit form */}
            <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
                {/* ── Render Target ── */}
                {rt && (
                    <>
                        <Section label="Properties" />
                        <div className="grid grid-cols-2 gap-2">
                            <Input
                                label="Name"
                                value={rt.name}
                                onChange={(e) =>
                                    updateRenderTarget(rt.id, { name: e.target.value })
                                }
                            />
                            <Select
                                label="Format"
                                options={FORMAT_OPTS}
                                value={rt.format}
                                onChange={(e) =>
                                    updateRenderTarget(rt.id, {
                                        format: e.target.value as TextureFormat,
                                    })
                                }
                            />
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                            <Input
                                label="Width"
                                value={fmtRTSize(rt.width)}
                                onChange={(e) =>
                                    updateRenderTarget(rt.id, { width: e.target.value })
                                }
                            />
                            <Input
                                label="Height"
                                value={fmtRTSize(rt.height)}
                                onChange={(e) =>
                                    updateRenderTarget(rt.id, { height: e.target.value })
                                }
                            />
                            <Input
                                label="Mips"
                                type="number"
                                value={rt.mips}
                                onChange={(e) =>
                                    updateRenderTarget(rt.id, {
                                        mips: parseInt(e.target.value) || 1,
                                    })
                                }
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <Input
                                label="Layers"
                                type="number"
                                value={rt.layers}
                                onChange={(e) =>
                                    updateRenderTarget(rt.id, {
                                        layers: parseInt(e.target.value) || 1,
                                    })
                                }
                            />
                        </div>
                        <Input
                            label="Description"
                            value={rt.description ?? ""}
                            placeholder="Optional…"
                            onChange={(e) =>
                                updateRenderTarget(rt.id, { description: e.target.value })
                            }
                        />
                    </>
                )}

                {/* ── Buffer ── */}
                {buf && (
                    <>
                        <Section label="Properties" />
                        <div className="grid grid-cols-2 gap-2">
                            <Input
                                label="Name"
                                value={buf.name}
                                onChange={(e) => updateBuffer(buf.id, { name: e.target.value })}
                            />
                            <Input
                                label="Size (bytes)"
                                value={String(buf.size)}
                                onChange={(e) => updateBuffer(buf.id, { size: e.target.value })}
                            />
                        </div>
                        <Input
                            label="Description"
                            value={buf.description ?? ""}
                            placeholder="Optional…"
                            onChange={(e) => updateBuffer(buf.id, { description: e.target.value })}
                        />
                    </>
                )}

                {/* ── Blend State ── */}
                {bs && (
                    <>
                        <Section label="Properties" />
                        <div className="grid grid-cols-2 gap-2">
                            <Input
                                label="Name"
                                value={bs.name}
                                onChange={(e) => updateBlendState(bs.id, { name: e.target.value })}
                            />
                            <div className="flex flex-col gap-1">
                                <label className="text-xs text-zinc-400 font-medium">
                                    Blending
                                </label>
                                <div className="flex items-center gap-2 pt-1.5">
                                    <input
                                        type="checkbox"
                                        checked={bs.enabled}
                                        onChange={(e) =>
                                            updateBlendState(bs.id, { enabled: e.target.checked })
                                        }
                                        className="w-4 h-4 accent-blue-500"
                                    />
                                    <span className="text-xs text-zinc-400">Enabled</span>
                                </div>
                            </div>
                        </div>
                        {bs.enabled && (
                            <>
                                <div className="grid grid-cols-3 gap-2">
                                    <Select
                                        label="Src Color"
                                        options={BLEND_FACTOR_OPTS}
                                        value={bs.srcColor}
                                        onChange={(e) =>
                                            updateBlendState(bs.id, {
                                                srcColor: e.target.value as BlendFactor,
                                            })
                                        }
                                    />
                                    <Select
                                        label="Dst Color"
                                        options={BLEND_FACTOR_OPTS}
                                        value={bs.dstColor}
                                        onChange={(e) =>
                                            updateBlendState(bs.id, {
                                                dstColor: e.target.value as BlendFactor,
                                            })
                                        }
                                    />
                                    <Select
                                        label="Color Op"
                                        options={BLEND_OP_OPTS}
                                        value={bs.colorOp}
                                        onChange={(e) =>
                                            updateBlendState(bs.id, {
                                                colorOp: e.target.value as BlendOp,
                                            })
                                        }
                                    />
                                </div>
                                <div className="grid grid-cols-3 gap-2">
                                    <Select
                                        label="Src Alpha"
                                        options={BLEND_FACTOR_OPTS}
                                        value={bs.srcAlpha}
                                        onChange={(e) =>
                                            updateBlendState(bs.id, {
                                                srcAlpha: e.target.value as BlendFactor,
                                            })
                                        }
                                    />
                                    <Select
                                        label="Dst Alpha"
                                        options={BLEND_FACTOR_OPTS}
                                        value={bs.dstAlpha}
                                        onChange={(e) =>
                                            updateBlendState(bs.id, {
                                                dstAlpha: e.target.value as BlendFactor,
                                            })
                                        }
                                    />
                                    <Select
                                        label="Alpha Op"
                                        options={BLEND_OP_OPTS}
                                        value={bs.alphaOp}
                                        onChange={(e) =>
                                            updateBlendState(bs.id, {
                                                alphaOp: e.target.value as BlendOp,
                                            })
                                        }
                                    />
                                </div>
                            </>
                        )}
                    </>
                )}

                {/* ── Shader ── */}
                {sh && (
                    <>
                        <Section label="Properties" />
                        <div className="grid grid-cols-2 gap-2">
                            <Input
                                label="Name"
                                value={sh.name}
                                onChange={(e) => updateShader(sh.id, { name: e.target.value })}
                            />
                            <Select
                                label="Stage"
                                options={STAGE_OPTS}
                                value={sh.stage}
                                onChange={(e) =>
                                    updateShader(sh.id, { stage: e.target.value as ShaderStage })
                                }
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <Input
                                label="Path"
                                value={sh.path}
                                placeholder="shaders/foo.hlsl"
                                onChange={(e) => updateShader(sh.id, { path: e.target.value })}
                            />
                            <Input
                                label="Entry Point"
                                value={sh.entryPoint}
                                placeholder="CSMain"
                                onChange={(e) =>
                                    updateShader(sh.id, { entryPoint: e.target.value })
                                }
                            />
                        </div>
                        <Input
                            label="Description"
                            value={sh.description ?? ""}
                            placeholder="Optional…"
                            onChange={(e) => updateShader(sh.id, { description: e.target.value })}
                        />
                    </>
                )}

                {/* ── Input Parameter ── */}
                {param && (
                    <>
                        <Section label="Properties" />
                        <div className="grid grid-cols-2 gap-2">
                            <Input
                                label="Name"
                                value={param.name}
                                onChange={(e) =>
                                    updateInputParameter(param.id, { name: e.target.value })
                                }
                            />
                            <Select
                                label="Type"
                                options={PARAM_TYPE_OPTS}
                                value={param.type}
                                onChange={(e) =>
                                    updateInputParameter(param.id, {
                                        type: e.target.value as InputParamType,
                                    })
                                }
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <Input
                                label="Default Value"
                                value={param.defaultValue}
                                onChange={(e) =>
                                    updateInputParameter(param.id, { defaultValue: e.target.value })
                                }
                            />
                            <Input
                                label="Description"
                                value={param.description ?? ""}
                                placeholder="Optional…"
                                onChange={(e) =>
                                    updateInputParameter(param.id, { description: e.target.value })
                                }
                            />
                        </div>
                    </>
                )}

                {/* ── Usage ── */}
                {usage && (usage.writers.length > 0 || usage.readers.length > 0) && (
                    <>
                        <Section label="Usage" />
                        {isDead && (
                            <div className="flex items-center gap-1.5 text-[10px] text-amber-400/80 bg-amber-950/20 border border-amber-800/30 rounded px-2 py-1.5">
                                <span>⚠</span>
                                <span>Written but never read — result is discarded</span>
                            </div>
                        )}
                        <div className="flex flex-col gap-1">
                            {usage.writers.map((w, i) => (
                                <div key={i} className="flex items-center gap-2 text-[10px]">
                                    <span className="text-amber-400 font-mono font-bold w-3 shrink-0">
                                        W
                                    </span>
                                    <button
                                        className="text-zinc-300 hover:text-white hover:underline text-left flex-1 truncate"
                                        onClick={() => selectPass(w.passId)}
                                        title={`Jump to pass: ${w.passName}`}
                                    >
                                        {w.passName}
                                    </button>
                                    <span className="text-zinc-600 shrink-0 text-[9px]">
                                        {w.timelineName}
                                    </span>
                                </div>
                            ))}
                            {usage.readers.map((r, i) => (
                                <div key={i} className="flex items-center gap-2 text-[10px]">
                                    <span className="text-sky-400 font-mono font-bold w-3 shrink-0">
                                        R
                                    </span>
                                    <button
                                        className="text-zinc-300 hover:text-white hover:underline text-left flex-1 truncate"
                                        onClick={() => selectPass(r.passId)}
                                        title={`Jump to pass: ${r.passName}`}
                                    >
                                        {r.passName}
                                    </button>
                                    <span className="text-zinc-600 shrink-0 text-[9px]">
                                        {r.timelineName}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </>
                )}

                {isUnused && (
                    <>
                        <Section label="Usage" />
                        <div className="flex items-center gap-1.5 text-[10px] text-zinc-500/80 bg-zinc-800/40 border border-zinc-700/40 rounded px-2 py-1.5">
                            <span>⚠</span>
                            <span>Not referenced by any pass</span>
                        </div>
                    </>
                )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-3 py-2 border-t border-zinc-700/60 shrink-0">
                <button
                    onClick={handleDelete}
                    className="text-[10px] text-zinc-600 hover:text-red-400 transition-colors"
                >
                    Delete resource
                </button>
            </div>
        </div>
    );
}
