/**
 * importRg.ts
 *
 * Converts the native "rg.json" render-graph format (as written by the engine)
 * into the editor's internal PipelineDocument format.
 *
 * rg.json schema overview
 * ─────────────────────────
 *  .name                        Pipeline display name
 *  .uuid                        Unique id
 *  .renderTargetDescriptions[]  Texture/RT declarations (Vulkan VkFormat ints)
 *  .blendStateDescriptions[]    Blend state declarations (Vulkan enum ints)
 *  .inputDescriptor[]           Scalar/bool exposed parameters
 *  .nodeDataDescriptions[]      Ordered list of all execution nodes (draw calls,
 *                               copies, computes, ray-traces, clears …)
 *  .renderPassDescriptions[]    Render-pass declarations: attachments + nodeIndices
 *  .graphOrder[]                [[passIdx|-1, nodeIdx], …] — execution order
 */

import type {
    PipelineDocument,
    Pipeline,
    Pass,
    Step,
    RasterStep,
    DispatchComputeStep,
    DispatchRayTracingStep,
    CopyImageStep,
    BlitImageStep,
    ClearImagesStep,
    FillBufferStep,
    GenerateMipChainStep,
    ColorAttachment,
    DepthAttachment,
    DrawBatchCommand,
    SetDynamicStateCommand,
    Timeline,
    ResourceLibrary,
    RenderTarget,
    BlendState,
    Shader,
    InputParameter,
    TextureFormat,
    BlendFactor,
    BlendOp,
    LoadOp,
    StoreOp,
    InputParamType,
} from "../types";

// ─── Vulkan enum → app enum maps ─────────────────────────────────────────────

/** VkFormat → TextureFormat (best-effort; unmapped formats fall back to 'rgba8') */
const VK_FORMAT: Record<number, TextureFormat> = {
    37: "rgba8", // VK_FORMAT_R8G8B8A8_UNORM
    43: "rgba8", // VK_FORMAT_R8G8B8A8_SRGB
    44: "rgba8", // VK_FORMAT_B8G8R8A8_UNORM
    50: "rgba8", // VK_FORMAT_B8G8R8A8_SRGB
    83: "rg16f", // VK_FORMAT_R16G16_SFLOAT
    97: "rgba16f", // VK_FORMAT_R16G16B16A16_SFLOAT
    100: "r32f", // VK_FORMAT_R32_SFLOAT
    109: "rgba32f", // VK_FORMAT_R32G32B32A32_SFLOAT
    122: "r11g11b10f", // VK_FORMAT_B10G11R11_UFLOAT_PACK32
    124: "d32f", // VK_FORMAT_D16_UNORM (approximated)
    125: "d32f", // VK_FORMAT_X8_D24_UNORM_PACK32 (approximated)
    126: "d32f", // VK_FORMAT_D32_SFLOAT
    127: "d24s8", // VK_FORMAT_S8_UINT (approximated)
    128: "d24s8", // VK_FORMAT_D16_UNORM_S8_UINT (approximated)
    129: "d24s8", // VK_FORMAT_D24_UNORM_S8_UINT
    130: "d32f", // VK_FORMAT_D32_SFLOAT_S8_UINT (approximated)
    131: "bc1", // VK_FORMAT_BC1_RGB_UNORM_BLOCK
    133: "bc1", // VK_FORMAT_BC1_RGBA_UNORM_BLOCK
    137: "bc3", // VK_FORMAT_BC3_UNORM_BLOCK
    141: "bc5", // VK_FORMAT_BC5_UNORM_BLOCK
    145: "bc7", // VK_FORMAT_BC7_UNORM_BLOCK
};

const VK_BLEND_FACTOR: Record<number, BlendFactor> = {
    0: "zero",
    1: "one",
    2: "srcColor",
    3: "oneMinusSrcColor",
    4: "dstColor",
    5: "oneMinusDstColor",
    6: "srcAlpha",
    7: "oneMinusSrcAlpha",
    8: "dstAlpha",
    9: "oneMinusDstAlpha",
};

const VK_BLEND_OP: Record<number, BlendOp> = {
    0: "add",
    1: "subtract",
    2: "reverseSubtract",
    3: "min",
    4: "max",
};

const VK_LOAD_OP: Record<number, LoadOp> = {
    0: "load",
    1: "clear",
    2: "dontCare",
};

const VK_STORE_OP: Record<number, StoreOp> = {
    0: "store",
    1: "dontCare",
};

const VK_CULL_MODE: Record<number, "none" | "front" | "back"> = {
    0: "none",
    1: "front",
    2: "back",
};

const INPUT_TYPE_MAP: Record<string, InputParamType> = {
    bool: "bool",
    float: "float",
    int: "int",
    uint: "uint",
    vec2: "vec2",
    vec3: "vec3",
    vec4: "vec4",
    color: "color",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mapFormat(fmt: number): TextureFormat {
    return VK_FORMAT[fmt] ?? "rgba8";
}

/** Create a slug from a name for use in IDs */
function slug(name: string): string {
    return (
        (name ?? "")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "")
            .slice(0, 40) || "item"
    );
}

/** Generate a unique ID given a preferred string and a set of already-used IDs */
function uniqueId(preferred: string, used: Set<string>): string {
    if (!used.has(preferred)) {
        used.add(preferred);
        return preferred;
    }
    let n = 2;
    while (used.has(`${preferred}-${n}`)) n++;
    const id = `${preferred}-${n}`;
    used.add(id);
    return id;
}

// ─── Main importer ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function importRgJson(raw: unknown): PipelineDocument {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rg = raw as Record<string, any>;

    const rtCount = (rg.renderTargetDescriptions ?? []).length;

    /** Validates that an RT index actually exists in renderTargetDescriptions */
    function validRtIdx(idx: number): boolean {
        return Number.isFinite(idx) && idx >= 0 && idx < rtCount;
    }

    // ── Render targets ──────────────────────────────────────────────────────────
    const rtById = new Map<number, string>(); // index → ResourceId
    const rtByName = new Map<string, string>(); // name  → ResourceId

    const renderTargets: RenderTarget[] = (rg.renderTargetDescriptions ?? []).map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (rt: any, i: number) => {
            const id = `rt-${i}`;
            rtById.set(i, id);
            rtByName.set(rt.name, id);
            const w = rt.extent?.[0] ?? 0;
            const h = rt.extent?.[1] ?? 0;
            return {
                id,
                name: rt.name ?? `RT ${i}`,
                format: mapFormat(rt.format ?? 0),
                width: w === 0 ? "viewport.width" : w,
                height: h === 0 ? "viewport.height" : h,
                mips: rt.mipLevels ?? 1,
                layers: 1,
                sampleCount: (rt.sampleCount ?? 1) > 1 ? rt.sampleCount : undefined,
            } satisfies RenderTarget;
        },
    );

    // ── Blend states ────────────────────────────────────────────────────────────
    const blendStates: BlendState[] = (rg.blendStateDescriptions ?? []).map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (bs: any, i: number): BlendState => ({
            id: `bs-${i}`,
            name: bs.name ?? `BlendState ${i}`,
            enabled: bs.blendEnable ?? false,
            srcColor: VK_BLEND_FACTOR[bs.srcColorBlendFactor] ?? "one",
            dstColor: VK_BLEND_FACTOR[bs.dstColorBlendFactor] ?? "zero",
            colorOp: VK_BLEND_OP[bs.colorBlendOp] ?? "add",
            srcAlpha: VK_BLEND_FACTOR[bs.srcAlphaBlendFactor] ?? "one",
            dstAlpha: VK_BLEND_FACTOR[bs.dstAlphaBlendFactor] ?? "zero",
            alphaOp: VK_BLEND_OP[bs.alphaBlendOp] ?? "add",
        }),
    );

    // ── Shaders — one resource per unique UUID ───────────────────────────────────
    // Deduplicated so that multiple nodes sharing the same shader program produce
    // a single resource entry.  The uuid field is the authoritative 3dverse UUID
    // used for the shader-descriptor API lookup.
    const uuidShaderMap = new Map<string, Shader>(); // uuid → Shader resource
    const nodeShaderMap = new Map<number, string>(); // nodeIndex → shader resource id
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const node of (rg.nodeDataDescriptions ?? []) as any[]) {
        const ref: string | undefined = node.shaderRef;
        if (!ref) continue;
        if (!uuidShaderMap.has(ref)) {
            const stage = node.type === 19 ? "raygen" : node.type === 17 ? "compute" : "fragment";
            uuidShaderMap.set(ref, {
                id: `shader-${slug(ref)}`,
                uuid: ref,
                name: ref,
                stage,
                path: "",
                entryPoint: "main",
            });
        }
        nodeShaderMap.set(node.nodeIndex as number, uuidShaderMap.get(ref)!.id);
    }
    const shaders: Shader[] = Array.from(uuidShaderMap.values());

    // ── Input parameters ────────────────────────────────────────────────────────
    const inputParameters: InputParameter[] = (rg.inputDescriptor ?? []).map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (ip: any, i: number): InputParameter => ({
            id: `ip-${i}`,
            name: ip.name ?? `param-${i}`,
            type: INPUT_TYPE_MAP[ip.type] ?? "bool",
            defaultValue: String(ip.default ?? ""),
            description: ip.description ?? "",
        }),
    );

    const resources: ResourceLibrary = {
        renderTargets,
        buffers: [],
        blendStates,
        shaders,
        inputParameters,
    };

    // ── Node lookup ──────────────────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nodeByIndex = new Map<number, any>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const n of (rg.nodeDataDescriptions ?? []) as any[]) {
        nodeByIndex.set(n.nodeIndex, n);
    }

    // ── Build passes + steps ────────────────────────────────────────────────────
    const passes: Record<string, Pass> = {};
    const steps: Record<string, Step> = {};
    const timelinePassIds: string[] = [];
    const usedIds = new Set<string>();

    /** Map a list of raw RT indices → ResourceIds, filtering invalid indices */
    function rtIds(indices: number[] | undefined): string[] {
        return (indices ?? [])
            .filter(validRtIdx)
            .map((i) => rtById.get(i) ?? "")
            .filter(Boolean);
    }

    // ── Coalescing helpers ────────────────────────────────────────────────────────

    /**
     * Returns the longest common prefix of an array of strings,
     * stripping trailing word-separators.
     */
    function commonPrefix(strs: string[]): string {
        if (strs.length === 0) return "";
        let prefix = strs[0];
        for (const s of strs.slice(1)) {
            while (prefix && !s.startsWith(prefix)) prefix = prefix.slice(0, -1);
            if (!prefix) return "";
        }
        return prefix.replace(/[_\-\s]+$/, "");
    }

    interface PendingStep {
        step: Step;
        reads: string[];
        writes: string[];
    }
    let pendingGroup: PendingStep[] = [];
    let pendingConditions: string[] = [];
    let pendingGroupWrites = new Set<string>();

    /** Flush the current pending group into a single pass. */
    function flushPendingGroup() {
        if (pendingGroup.length === 0) return;

        const names = pendingGroup.map((p) => p.step.name);
        const prefix = commonPrefix(names);
        const passName =
            pendingGroup.length === 1
                ? names[0]
                : prefix
                  ? `${prefix} (${pendingGroup.length})`
                  : `${names[0]} (+${pendingGroup.length - 1})`;

        const passId = uniqueId(`pass-${slug(passName)}`, usedIds);
        const allReads = [...new Set(pendingGroup.flatMap((p) => p.reads))];
        const allWrites = [...new Set(pendingGroup.flatMap((p) => p.writes))];

        const pass: Pass = {
            id: passId,
            name: passName,
            timelineId: "tl-gfx",
            enabled: true,
            conditions: pendingConditions,
            reads: allReads,
            writes: allWrites,
            steps: pendingGroup.map((p) => p.step.id),
        };
        passes[passId] = pass;
        timelinePassIds.push(passId);

        pendingGroup = [];
        pendingConditions = [];
        pendingGroupWrites = new Set();
    }

    /**
     * Check whether a new standalone node can be merged into the current pending
     * group.  Returns false (meaning: flush first) when:
     *   1. The node has different conditions from the group.
     *   2. The node reads a resource that the group already wrote (WAR dependency
     *      that would require a pipeline barrier between the two nodes).
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function canCoalesceNode(node: any): boolean {
        if (pendingGroup.length === 0) return true;

        // Condition match
        const nodeConditions: string[] = node.conditions ?? [];
        if (
            nodeConditions.length !== pendingConditions.length ||
            !nodeConditions.every((c, i) => c === pendingConditions[i])
        )
            return false;

        // No WAR conflict: node's reads must not overlap group's accumulated writes
        const nodeReads = rtIds(node.inputRenderTargetIndices);
        for (const r of nodeReads) {
            if (pendingGroupWrites.has(r)) return false;
        }

        return true;
    }

    interface BindingParseResult {
        bindings: Record<string, string> | undefined;
        accessMap: Record<string, string>;
        sizeRefSlot: string | null;
        constants: Record<string, number | boolean>;
    }

    /** All __renderGraph__.* entries: RT bindings (ResourceId) + scalars (number | boolean) */
    type MaterialInputsResult = Record<string, string | number | boolean>;

    const RG_PREFIX = "__renderGraph__.";

    /**
     * Parse a draw-batch node's dataJson, extracting __renderGraph__.* entries.
     *   • Keys ending in _rt OR numeric value > 0xffff → RT binding (decoded to ResourceId)
     *   • Other bool/number values → stored as-is
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function materialInputsFromDataJson(dataJson: any): MaterialInputsResult {
        const result: MaterialInputsResult = {};
        for (const [key, rawValue] of Object.entries(dataJson ?? {})) {
            if (!key.startsWith(RG_PREFIX)) continue;
            const slot = key.slice(RG_PREFIX.length);
            if (typeof rawValue === "number" && (slot.endsWith("_rt") || rawValue > 0xffff)) {
                const rtIdx = rawValue & 0xffff;
                const rid = rtById.get(rtIdx);
                if (rid) result[slot] = rid;
            } else if (typeof rawValue === "number" || typeof rawValue === "boolean") {
                result[slot] = rawValue;
            }
        }
        return result;
    }

    /** Lookup map: inputParameter name → id, for resolving aliases */
    const inputParamByName = new Map(inputParameters.map((p) => [p.name, p.id]));

    /**
     * Decode a node's dataJson object (slot name → encoded value) into binding data.
     * Encoding: lower 16 bits = RT index; upper 16 bits (hi):
     *   hi & 0x1 = read, hi & 0x2 = write, hi & 0x100 = size-reference flag.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function shaderBindingsFromDataJson(dataJson: any, aliases?: Record<string, string>): BindingParseResult {
        const empty: BindingParseResult = { bindings: undefined, accessMap: {}, sizeRefSlot: null, constants: {} };
        if (!dataJson || typeof dataJson !== "object") return empty;
        const result: Record<string, string> = {};
        const accessMap: Record<string, string> = {};
        const constants: Record<string, number | boolean> = {};
        let sizeRefSlot: string | null = null;
        for (const [slotName, encodedValue] of Object.entries(dataJson)) {
            if (typeof encodedValue === "boolean") {
                constants[slotName] = encodedValue;
                continue;
            }
            if (typeof encodedValue !== "number") continue;
            // Non-integer (float) → scalar constant
            if (!Number.isInteger(encodedValue)) {
                constants[slotName] = encodedValue;
                continue;
            }
            const hi = (encodedValue as number) >>> 16;
            const rtIdx = (encodedValue as number) & 0xffff;
            const rid = rtById.get(rtIdx);
            if (!rid) {
                // Integer that doesn't resolve to a known RT → scalar constant
                constants[slotName] = encodedValue as number;
                continue;
            }
            result[slotName] = rid;
            const accessBits = hi & 0x3;
            accessMap[slotName] =
                accessBits === 3 ? "read_write" : accessBits === 2 ? "write" : "read";
            if (hi & 0x100) sizeRefSlot = slotName;
        }
        // Merge input-parameter aliases: { slotName: paramName } → resolve to param id
        for (const [slotName, paramName] of Object.entries(aliases ?? {})) {
            const pid = inputParamByName.get(paramName);
            if (pid && !result[slotName]) {
                result[slotName] = pid;
                accessMap[slotName] = "read";
            }
        }
        return {
            bindings: Object.keys(result).length > 0 ? result : undefined,
            accessMap,
            sizeRefSlot,
            constants,
        };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const entry of (rg.graphOrder ?? []) as [number, number][]) {
        const [gPassIdx, gNodeIdx] = entry;

        // ── Render pass ────────────────────────────────────────────────────────────
        if (gPassIdx >= 0) {
            // Flush any pending standalone steps before a render pass
            flushPendingGroup();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const rp: any = rg.renderPassDescriptions?.[gPassIdx];
            if (!rp) continue;

            const passId = uniqueId(`pass-${slug(rp.name)}`, usedIds);
            const stepId = uniqueId(`step-${slug(rp.name)}-raster`, usedIds);

            // Color attachments
            const colorAttachments: ColorAttachment[] = [];
            const colorIndices = (rp.colorAttachmentIndices ?? []) as number[];
            for (let i = 0; i < colorIndices.length; i++) {
                const globalRtIdx = colorIndices[i];
                // Local attachmentDescriptions is ordered: color[0..n-1], depth[n], resolve[n+1..]
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const att: any = rp.attachmentDescriptions?.[i];
                const target = rtById.get(globalRtIdx) ?? "";
                if (!target) continue;
                const clearColor = (rp.attachmentClearColors?.[i] ?? [0, 0, 0, 0]) as [
                    number,
                    number,
                    number,
                    number,
                ];
                colorAttachments.push({
                    target,
                    loadOp: VK_LOAD_OP[att?.loadOp] ?? "load",
                    storeOp: VK_STORE_OP[att?.storeOp] ?? "store",
                    clearValue: clearColor,
                });
            }

            // Depth attachment — depthAttachmentIndex is also a global RT index
            // Local attachment description for depth is at colorIndices.length
            let depthAttachment: DepthAttachment | undefined;
            const globalDepthIdx: number = rp.depthAttachmentIndex ?? -1;
            if (globalDepthIdx >= 0 && validRtIdx(globalDepthIdx)) {
                const depthLocalIdx = colorIndices.length;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const att: any = rp.attachmentDescriptions?.[depthLocalIdx];
                depthAttachment = {
                    target: rtById.get(globalDepthIdx) ?? "",
                    loadOp: VK_LOAD_OP[att?.loadOp] ?? "load",
                    storeOp: VK_STORE_OP[att?.storeOp] ?? "store",
                    clearValue: 1,
                    stencilLoadOp: VK_LOAD_OP[att?.stencilLoadOp],
                    stencilStoreOp: VK_STORE_OP[att?.stencilStoreOp],
                };
            }

            // Commands from nodeIndices
            const commands: (SetDynamicStateCommand | DrawBatchCommand)[] = [];
            for (const ni of (rp.nodeIndices ?? []) as number[]) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const node: any = nodeByIndex.get(ni);
                if (!node) continue;
                const cmdId = uniqueId(`cmd-${slug(node.name)}`, usedIds);

                if (node.type === 0) {
                    // Viewport
                    commands.push({
                        id: cmdId,
                        type: "setDynamicState",
                        name: node.name ?? "Set Viewport",
                        stateType: "viewport",
                        x: 0,
                        y: 0,
                        width: "viewport.width",
                        height: "viewport.height",
                        minDepth: 0,
                        maxDepth: 1,
                    } satisfies SetDynamicStateCommand);
                } else if (
                    node.type === 1 ||
                    node.type === 2 ||
                    node.type === 8 ||
                    node.type === 16
                ) {
                    // 1 = draw batch, 2 = draw batch with materials, 8 = fullscreen/quad, 16 = debug
                    const pd = node.pipelineDescription;
                    const matInputs = materialInputsFromDataJson(node.dataJson);
                    const aliasBindings: Record<string, string> = {};
                    for (const [slotName, paramName] of Object.entries(node.aliases ?? {})) {
                        const pid = inputParamByName.get(paramName as string);
                        if (pid) aliasBindings[slotName] = pid;
                    }
                    commands.push({
                        id: cmdId,
                        type: "drawBatch",
                        name: node.name ?? "Draw Batch",
                        shader: nodeShaderMap.get(node.nodeIndex as number) ?? "",
                        materialInputs:
                            Object.keys(matInputs).length > 0 ? matInputs : undefined,
                        shaderBindings:
                            Object.keys(aliasBindings).length > 0 ? aliasBindings : undefined,
                        withMaterials: node.type === 2 || undefined,
                        depthTest: pd?.depthTestEnable ?? true,
                        depthWrite: pd?.depthWriteEnable ?? false,
                        cullMode: VK_CULL_MODE[pd?.cullMode ?? 0] ?? "back",
                    } satisfies DrawBatchCommand);
                }
            }

            // Resolve attachments: resolveAttachmentIndices[i] is the destination (write),
            // colorAttachmentIndices[i] is the MSAA source being read for the resolve.
            const resolveIndices = (rp.resolveAttachmentIndices ?? []) as number[];
            const resolveAttachments = resolveIndices
                .map((ri, i) => ({
                    source: rtById.get(colorIndices[i]) ?? "",
                    destination: rtById.get(ri) ?? "",
                }))
                .filter((r) => r.source && r.destination);
            const resolveTargets = resolveAttachments.map((r) => r.destination);
            const resolveSources = resolveAttachments.map((r) => r.source);

            // Collect resource references
            const passReads = new Set<string>(resolveSources);
            const passWrites = new Set<string>(
                [
                    ...colorAttachments.map((ca) => ca.target),
                    ...(depthAttachment?.target ? [depthAttachment.target] : []),
                    ...resolveTargets,
                ].filter(Boolean),
            );

            // Derive pass conditions from the union of conditions on member nodes
            const passConditions: string[] = [
                ...new Set(
                    ((rp.nodeIndices ?? []) as number[]).flatMap(
                        (ni) => (nodeByIndex.get(ni)?.conditions as string[] | undefined) ?? [],
                    ),
                ),
            ];

            const rasterStep: RasterStep = {
                id: stepId,
                type: "raster",
                name: rp.name,
                reads: [...passReads],
                writes: [...passWrites],
                conditions: passConditions,
                attachments: {
                    colorAttachments,
                    depthAttachment,
                    resolveAttachments: resolveAttachments.length > 0 ? resolveAttachments : undefined,
                },
                commands,
            };
            steps[stepId] = rasterStep;

            const pass: Pass = {
                id: passId,
                name: rp.name,
                timelineId: "tl-gfx",
                enabled: true,
                conditions: passConditions,
                reads: [...passReads],
                writes: [...passWrites],
                steps: [stepId],
            };
            passes[passId] = pass;
            timelinePassIds.push(passId);

            // ── Standalone node ────────────────────────────────────────────────────────
        } else {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const node: any = nodeByIndex.get(gNodeIdx);
            if (!node) continue;

            const stepId = uniqueId(`step-${slug(node.name)}`, usedIds);

            const conditions: string[] = node.conditions ?? [];
            const reads = rtIds(node.inputRenderTargetIndices);
            const writes = rtIds(node.outputRenderTargetIndices);
            const shader = nodeShaderMap.get(node.nodeIndex as number) ?? "";

            let step: Step | null = null;

            switch (node.type as number) {
                case 4: // copy image (with optional blit semantics)
                    step = {
                        id: stepId,
                        type: "copyImage",
                        name: node.name,
                        reads,
                        writes,
                        conditions,
                        source: reads[0] ?? "",
                        destination: writes[0] ?? "",
                    } satisfies CopyImageStep;
                    break;

                case 5: // blit image (to output target)
                    step = {
                        id: stepId,
                        type: "blitImage",
                        name: node.name,
                        reads,
                        writes,
                        conditions,
                        source: reads[0] ?? "",
                        destination: writes[0] ?? "",
                        filter: "linear",
                    } satisfies BlitImageStep;
                    break;

                case 6: // copy image (variant)
                    step = {
                        id: stepId,
                        type: "copyImage",
                        name: node.name,
                        reads,
                        writes,
                        conditions,
                        source: reads[0] ?? "",
                        destination: writes[0] ?? "",
                    } satisfies CopyImageStep;
                    break;

                case 9: // generate mip chain
                    step = {
                        id: stepId,
                        type: "generateMipChain",
                        name: node.name,
                        reads,
                        writes,
                        conditions,
                        target: reads[0] ?? writes[0] ?? "",
                        filter: "linear",
                    } satisfies GenerateMipChainStep;
                    break;

                case 13: {
                    // clear images
                    const targets = (node.outputRenderTargetIndices ?? ([] as number[]))
                        .filter(validRtIdx)
                        .map((rtIdx: number, ci: number) => ({
                            target: rtById.get(rtIdx) ?? "",
                            clearValue: (node.clearColors?.[ci] ?? [0, 0, 0, 0]) as [
                                number,
                                number,
                                number,
                                number,
                            ],
                        }))
                        .filter((t: { target: string }) => t.target);
                    step = {
                        id: stepId,
                        type: "clearImages",
                        name: node.name,
                        reads: [],
                        writes: targets.map((t: { target: string }) => t.target),
                        conditions,
                        targets,
                    } satisfies ClearImagesStep;
                    break;
                }

                case 15: // fill buffer
                    step = {
                        id: stepId,
                        type: "fillBuffer",
                        name: node.name,
                        reads: [],
                        writes: [],
                        conditions,
                        target: "",
                        value: node.bufferValue ?? 0,
                    } satisfies FillBufferStep;
                    break;

                case 17: {
                    // dispatch compute
                    const parsed = shaderBindingsFromDataJson(node.dataJson, node.aliases);
                    step = {
                        id: stepId,
                        type: "dispatchCompute",
                        name: node.name,
                        reads,
                        writes,
                        conditions,
                        shader,
                        shaderBindings: parsed.bindings,
                        shaderBindingAccess:
                            Object.keys(parsed.accessMap).length > 0 ? parsed.accessMap : undefined,
                        shaderConstants:
                            Object.keys(parsed.constants).length > 0 ? parsed.constants : undefined,
                        sizeReferenceSlot: parsed.sizeRefSlot ?? undefined,
                        groupsX: "ceil(viewport.width / 8)",
                        groupsY: "ceil(viewport.height / 8)",
                        groupsZ: 1,
                    } satisfies DispatchComputeStep;
                    break;
                }

                case 19: {
                    // dispatch ray tracing
                    const parsed19 = shaderBindingsFromDataJson(node.dataJson, node.aliases);
                    step = {
                        id: stepId,
                        type: "dispatchRayTracing",
                        name: node.name,
                        reads,
                        writes,
                        conditions,
                        raygenShader: shader,
                        shaderBindings: parsed19.bindings,
                        shaderBindingAccess:
                            Object.keys(parsed19.accessMap).length > 0
                                ? parsed19.accessMap
                                : undefined,
                        shaderConstants:
                            Object.keys(parsed19.constants).length > 0
                                ? parsed19.constants
                                : undefined,
                        sizeReferenceSlot: parsed19.sizeRefSlot ?? undefined,
                        width: "viewport.width",
                        height: "viewport.height",
                    } satisfies DispatchRayTracingStep;
                    break;
                }

                default: {
                    // Types 2 (fullscreen shader), 3 (copy via shader), 8 (quad shader)
                    // → approximated as dispatchCompute
                    const parsedDef = shaderBindingsFromDataJson(node.dataJson, node.aliases);
                    step = {
                        id: stepId,
                        type: "dispatchCompute",
                        name: node.name,
                        reads,
                        writes,
                        conditions,
                        shader,
                        shaderBindings: parsedDef.bindings,
                        shaderBindingAccess:
                            Object.keys(parsedDef.accessMap).length > 0
                                ? parsedDef.accessMap
                                : undefined,
                        shaderConstants:
                            Object.keys(parsedDef.constants).length > 0
                                ? parsedDef.constants
                                : undefined,
                        sizeReferenceSlot: parsedDef.sizeRefSlot ?? undefined,
                        groupsX: "ceil(viewport.width / 8)",
                        groupsY: "ceil(viewport.height / 8)",
                        groupsZ: 1,
                    } satisfies DispatchComputeStep;
                    break;
                }
            }

            if (!step) continue;
            steps[stepId] = step;

            // ── Coalesce into pending group (or flush + start fresh) ───────────────
            if (!canCoalesceNode(node)) {
                flushPendingGroup();
                pendingConditions = conditions;
            } else if (pendingGroup.length === 0) {
                pendingConditions = conditions;
            }
            for (const w of writes) pendingGroupWrites.add(w);
            pendingGroup.push({ step, reads, writes });
        }
    }

    // Flush remaining standalone steps
    flushPendingGroup();

    // ── Assemble pipeline ────────────────────────────────────────────────────────
    const timeline: Timeline = {
        id: "tl-gfx",
        name: "Graphics",
        type: "graphics",
        passIds: timelinePassIds,
    };

    const pipeline: Pipeline = {
        id: rg.uuid ?? "imported",
        name: rg.name ?? "Imported Pipeline",
        version: 1,
        timelines: [timeline],
        passes,
        steps,
    };

    return { pipeline, resources };
}
