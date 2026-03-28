// ─── Core IDs ────────────────────────────────────────────────────────────────

export type PassId = string;
export type StepId = string;
export type CommandId = string;
export type ResourceId = string;
export type TimelineId = string;
export type VariantId = string;

// ─── Resource Library ────────────────────────────────────────────────────────

export type InputParamType = "bool" | "float" | "uint" | "int" | "vec2" | "vec3" | "vec4" | "color";

export interface InputParameter {
    id: ResourceId;
    name: string;
    type: InputParamType;
    defaultValue: string;
    description?: string;
}

export type TextureFormat =
    | "rgba8"
    | "rgba16f"
    | "rgba32f"
    | "r11g11b10f"
    | "rg16f"
    | "r32f"
    | "d32f"
    | "d24s8"
    | "bc1"
    | "bc3"
    | "bc5"
    | "bc7";

export interface RenderTarget {
    id: ResourceId;
    name: string;
    format: TextureFormat;
    width: number | string;
    height: number | string;
    mips: number;
    layers: number;
    sampleCount?: number;
    description?: string;
}

export interface Buffer {
    id: ResourceId;
    name: string;
    size: number | string;
    description?: string;
}

export type BlendFactor =
    | "zero"
    | "one"
    | "srcColor"
    | "oneMinusSrcColor"
    | "dstColor"
    | "oneMinusDstColor"
    | "srcAlpha"
    | "oneMinusSrcAlpha"
    | "dstAlpha"
    | "oneMinusDstAlpha";

export type BlendOp = "add" | "subtract" | "reverseSubtract" | "min" | "max";

export interface BlendState {
    id: ResourceId;
    name: string;
    enabled: boolean;
    srcColor: BlendFactor;
    dstColor: BlendFactor;
    colorOp: BlendOp;
    srcAlpha: BlendFactor;
    dstAlpha: BlendFactor;
    alphaOp: BlendOp;
    description?: string;
}

export type ShaderStage = "vertex" | "fragment" | "compute" | "raygen" | "miss" | "closesthit";

export interface Shader {
    id: ResourceId;
    /** Raw 3dverse asset UUID — used to look up the shader descriptor via the API */
    uuid?: string;
    name: string;
    stage: ShaderStage;
    path: string;
    entryPoint: string;
    description?: string;
}

// ─── Material Interface ───────────────────────────────────────────────────────

export type MaterialInputType = "rt" | "number" | "boolean";

export interface MaterialInputEntry {
    name: string;
    type: MaterialInputType;
}

export interface MaterialInterface {
    id: ResourceId;
    name: string;
    inputs: MaterialInputEntry[];
    description?: string;
}

export interface ResourceLibrary {
    renderTargets: RenderTarget[];
    buffers: Buffer[];
    blendStates: BlendState[];
    shaders: Shader[];
    inputParameters: InputParameter[];
    materialInterfaces: MaterialInterface[];
}

// ─── Value Sources / Data Selectors ───────────────────────────────────────────
//
// A ValueSource<T> describes how a step field gets its value.
// Instead of always hard-coding a constant, a field can reference a graph input
// (InputParameter) or pick between two values based on a boolean condition.
//
// Use cases:
//   - applyToBackground = { kind:"input", inputId:"displayBackground" }
//   - colorIn = { kind:"select", condition:"displayBackground",
//                 trueValue:{kind:"constant",value:"color_rt"},
//                 falseValue:{kind:"constant",value:"no_bg_rt"} }
//   - sharpenStrength = { kind:"select", condition:"debugMode",
//                         trueValue:{kind:"constant",value:1.0},
//                         falseValue:{kind:"constant",value:0.25} }
//
// When to use selectors vs other branching mechanisms:
//   - Pass condition   → whether a whole pass runs
//   - Variant          → which implementation family a pass uses
//   - IfBlock          → local execution branching inside a step list
//   - Data selector    → same step, different bound value per condition

export type ValueSource<T = unknown> =
    | { kind: "constant"; value: T }
    | { kind: "input"; inputId: string }
    | { kind: "select"; condition: string; trueValue: ValueSource<T>; falseValue: ValueSource<T> };

// ─── Timeline ─────────────────────────────────────────────────────────────────

export type TimelineType = "graphics" | "asyncCompute" | "transfer" | "raytracing" | "custom";

export interface Timeline {
    id: TimelineId;
    name: string;
    type: TimelineType;
    passIds: PassId[];
}

// ─── Pass ─────────────────────────────────────────────────────────────────────

export type LoadOp = "load" | "clear" | "dontCare";
export type StoreOp = "store" | "dontCare";

export interface ColorAttachment {
    target: ResourceId;
    loadOp: LoadOp;
    storeOp: StoreOp;
    clearValue: [number, number, number, number];
}

export interface DepthAttachment {
    target: ResourceId;
    loadOp: LoadOp;
    storeOp: StoreOp;
    clearValue: number;
    stencilLoadOp?: LoadOp;
    stencilStoreOp?: StoreOp;
    clearStencil?: number;
}

export interface ResolveAttachment {
    source: ResourceId;      // MSAA source (read)
    destination: ResourceId; // resolved target (write)
}

export interface RasterAttachments {
    colorAttachments: ColorAttachment[];
    depthAttachment?: DepthAttachment;
    resolveAttachments?: ResolveAttachment[];
}

export interface Variant {
    id: VariantId;
    name: string;
    /** Optional future-facing selector key (e.g. "SSAO" | "HBAO") */
    selector?: string;
    activeSteps: StepId[];
}

export interface Pass {
    id: PassId;
    name: string;
    timelineId: TimelineId;
    enabled: boolean;
    conditions: string[];
    notes?: string;
    reads: ResourceId[];
    writes: ResourceId[];
    manualDeps?: PassId[];
    steps: StepId[];
    disabledSteps?: StepId[];
    variants?: Variant[];
    variantEnumInputId?: string;
}

// ─── Raster Commands ──────────────────────────────────────────────────────────

export type DynamicStateType = "viewport" | "scissor" | "depthBias" | "stencilRef";

export interface SetDynamicStateCommand {
    id: CommandId;
    type: "setDynamicState";
    name: string;
    stateType: DynamicStateType;
    // viewport / scissor rect
    x?: number;
    y?: number;
    width?: number | string;
    height?: number | string;
    // viewport depth range
    minDepth?: number;
    maxDepth?: number;
    // depthBias
    constantFactor?: number;
    clamp?: number;
    slopeFactor?: number;
    // stencilRef
    reference?: number;
}

export type VkPrimitiveTopology = "pointList" | "lineList" | "lineStrip" | "triangleList" | "triangleStrip" | "triangleFan";
export type VkPolygonMode = "fill" | "line" | "point";
export type VkCullMode = "none" | "front" | "back" | "frontAndBack";
export type VkFrontFace = "counterClockwise" | "clockwise";
export type VkCompareOp = "never" | "less" | "equal" | "lessOrEqual" | "greater" | "notEqual" | "greaterOrEqual" | "always";

export interface PipelineConfig {
    id: string;
    label?: string;
    // Input assembly
    topology?: VkPrimitiveTopology;
    // Rasterization
    polygonMode?: VkPolygonMode;
    cullMode?: VkCullMode;
    frontFace?: VkFrontFace;
    // Depth bias
    depthBiasEnable?: boolean;
    // Depth stencil
    depthTestEnable?: boolean;
    depthWriteEnable?: boolean;
    depthCompareOp?: VkCompareOp;
    // Stencil op state indices
    frontFaceStencilOpStateIndex?: number;
    backFaceStencilOpStateIndex?: number;
}

export interface BatchFilter {
    id: string;
    label?: string;
    /** Bitfield of batch_type enum values */
    flags: number;
}

export type DrawBatchType = "batch" | "batchWithMaterials" | "fullscreen" | "debugLines";

export interface DrawBatchCommand {
    id: CommandId;
    type: "drawBatch";
    /** Distinguishes draw batch, fullscreen quad, and debug lines variants */
    drawType?: DrawBatchType;
    name: string;
    /** Shader resource ID — unused when withMaterials is true */
    shader: ResourceId;
    /** Named shader input slot → resource ID bindings, derived from the shader descriptor */
    shaderBindings?: Record<string, ResourceId>;
    /** __renderGraph__.* inputs passed to material shaders (RT ResourceId | number | boolean) */
    materialInputs?: Record<string, string | number | boolean>;
    withMaterials?: boolean;
    materialSet?: string;
    /** Material interface resource describing the __renderGraph__.* input schema */
    materialInterfaceId?: ResourceId;
    /** One or more batch type filter sets */
    batchFilters?: BatchFilter[];
    /**
     * Blend state per color attachment ("disabled" = no blend state).
     * Array length matches the parent raster step's color attachment count.
     */
    blendStateIndices?: Array<ResourceId | "disabled">;
    /** One or more pipeline state configurations (PSO variants) */
    pipelineConfigs?: PipelineConfig[];
    /**
     * Which (pipelineConfig × batchFilter) pairs are active.
     * When absent every combination is considered active.
     */
    enabledCombinations?: { configId: string; filterId: string }[];
    // ── Legacy flat fields (kept for document compatibility) ──────────────
    blendState?: ResourceId;
    depthTest?: boolean;
    depthWrite?: boolean;
    cullMode?: "none" | "front" | "back";
    batchTag?: string;
    batchFlags?: number;
}

export interface EnableIfCommand {
    id: CommandId;
    type: "enableIf";
    name: string;
    condition: string;
    thenCommands: RasterCommand[];
}

export type RasterCommand = SetDynamicStateCommand | DrawBatchCommand | EnableIfCommand;
export type RasterCommandType = RasterCommand["type"];

// ─── Steps ────────────────────────────────────────────────────────────────────

export type StepType =
    | "raster"
    | "dispatchCompute"
    | "dispatchComputeDecals"
    | "dispatchRayTracing"
    | "copyImage"
    | "blitImage"
    | "resolveImage"
    | "clearImages"
    | "fillBuffer"
    | "generateMipChain"
    | "ifBlock"
    | "enableIf";

export interface StepBase {
    id: StepId;
    name: string;
    reads: ResourceId[];
    writes: ResourceId[];
    conditions: string[];
}

export interface RasterStep extends StepBase {
    type: "raster";
    attachments: RasterAttachments;
    commands: RasterCommand[];
}

export interface DispatchComputeStep extends StepBase {
    type: "dispatchCompute";
    shader: ResourceId;
    /** Named shader input slot → resource ID bindings (from shader descriptor) */
    shaderBindings?: Record<string, ResourceId>;
    /** Per-slot access decoded from the encoded binding value ('read' | 'write' | 'read_write') */
    shaderBindingAccess?: Record<string, string>;
    /** Named shader input slot → constant scalar value (int, float, bool) */
    shaderConstants?: Record<string, number | boolean>;
    /** Data selectors: override any shaderBindings/shaderConstants slot with a ValueSource */
    fieldSelectors?: Record<string, ValueSource>;
    /** Slot that provides the dispatch size reference (its dimensions drive group counts) */
    sizeReferenceSlot?: string;
    groupsX: number | string;
    groupsY: number | string;
    groupsZ: number | string;
}

export interface DispatchComputeDecalsStep extends StepBase {
    type: "dispatchComputeDecals";
    shader: ResourceId;
    /** Named shader input slot → resource ID bindings (from shader descriptor) */
    shaderBindings?: Record<string, ResourceId>;
    /** Per-slot access decoded from the encoded binding value ('read' | 'write' | 'read_write') */
    shaderBindingAccess?: Record<string, string>;
    /** Named shader input slot → constant scalar value (int, float, bool) */
    shaderConstants?: Record<string, number | boolean>;
    /** Data selectors: override any shaderBindings/shaderConstants slot with a ValueSource */
    fieldSelectors?: Record<string, ValueSource>;
    /** Slot that provides the dispatch size reference (its dimensions drive group counts) */
    sizeReferenceSlot?: string;
    groupsX: number | string;
    groupsY: number | string;
    groupsZ: number | string;
    /** Decal material set to iterate over */
    materialSet?: string;
    batchTag?: string;
}

export interface DispatchRayTracingStep extends StepBase {
    type: "dispatchRayTracing";
    raygenShader: ResourceId;
    missShader?: ResourceId;
    closestHitShader?: ResourceId;
    /** Named shader input slot → resource ID bindings (from raygen shader descriptor) */
    shaderBindings?: Record<string, ResourceId>;
    /** Per-slot access decoded from the encoded binding value */
    shaderBindingAccess?: Record<string, string>;
    /** Named shader input slot → constant scalar value (int, float, bool) */
    shaderConstants?: Record<string, number | boolean>;
    /** Data selectors: override any shaderBindings/shaderConstants slot with a ValueSource */
    fieldSelectors?: Record<string, ValueSource>;
    /** Slot that provides the dispatch size reference */
    sizeReferenceSlot?: string;
    width: number | string;
    height: number | string;
}

export interface CopyImageStep extends StepBase {
    type: "copyImage";
    source: ResourceId;
    destination: ResourceId;
}

export interface BlitImageStep extends StepBase {
    type: "blitImage";
    source: ResourceId;
    destination: ResourceId;
    filter: "nearest" | "linear";
}

export interface ResolveImageStep extends StepBase {
    type: "resolveImage";
    source: ResourceId;
    destination: ResourceId;
}

export interface ClearTarget {
    target: ResourceId;
    clearValue: [number, number, number, number];
}

export interface ClearImagesStep extends StepBase {
    type: "clearImages";
    targets: ClearTarget[];
}

export interface FillBufferStep extends StepBase {
    type: "fillBuffer";
    target: ResourceId;
    value: number;
}

export interface GenerateMipChainStep extends StepBase {
    type: "generateMipChain";
    target: ResourceId;
    filter: "nearest" | "linear";
}

export interface IfBlockStep extends StepBase {
    type: "ifBlock";
    condition: string;
    thenSteps: StepId[];
    elseSteps: StepId[];
}

/** Like ifBlock but without an else branch. Semantically a guard — the whole block
 *  is skipped when the condition is false, rather than an alternative path being taken. */
export interface EnableIfStep extends StepBase {
    type: "enableIf";
    condition: string;
    thenSteps: StepId[];
}

export type Step =
    | RasterStep
    | DispatchComputeStep
    | DispatchComputeDecalsStep
    | DispatchRayTracingStep
    | CopyImageStep
    | BlitImageStep
    | ResolveImageStep
    | ClearImagesStep
    | FillBufferStep
    | GenerateMipChainStep
    | IfBlockStep
    | EnableIfStep;

// ─── Pipeline ─────────────────────────────────────────────────────────────────

export interface Pipeline {
    id: string;
    name: string;
    version: number;
    timelines: Timeline[];
    passes: Record<PassId, Pass>;
    steps: Record<StepId, Step>;
    /** ResourceId of the RT designated as the default canvas blit target (VIEW_RENDER_TARGET alias). */
    defaultViewRenderTargetId?: ResourceId;
}

// ─── Full Document ────────────────────────────────────────────────────────────

export type PipelineRole = "perView" | "global";

export interface PipelineEntry {
    pipeline: Pipeline;
    role: PipelineRole;
}

export interface PipelineDocument {
    /** New multi-pipeline format */
    pipelines?: PipelineEntry[];
    /** Legacy single-pipeline format (backward compat) */
    pipeline?: Pipeline;
    resources: ResourceLibrary;
    inputDefinitions?: InputDefinition[];
}

// ─── Validation ───────────────────────────────────────────────────────────────

export type ValidationSeverity = "error" | "warning";

export interface ValidationIssue {
    id: string;
    severity: ValidationSeverity;
    message: string;
    location?: string;
}

// ─── Input Definitions (Render Graph Input Editor) ───────────────────────────

export type InputId = string;

export type InputKind =
    | "bool"
    | "int"
    | "float"
    | "enum"
    | "color"
    | "vec2"
    | "vec3"
    | "vec4"
    | "texture"
    | "buffer";

export type InputCondition =
    | {
          type: "comparison";
          leftInput: InputId;
          operator: "==" | "!=" | ">" | ">=" | "<" | "<=";
          rightValue: boolean | number | string;
      }
    | { type: "and"; conditions: InputCondition[] }
    | { type: "or"; conditions: InputCondition[] }
    | { type: "not"; condition: InputCondition };

export interface InputDefinition {
    id: InputId;
    label: string;
    description?: string;
    kind: InputKind;
    defaultValue: unknown;
    categoryPath: string[];
    section?: string;
    order?: number;
    enumOptions?: { value: string; label: string }[];
    visibilityCondition?: InputCondition;
    enabledCondition?: InputCondition;
    advanced?: boolean;
    categoryToggle?: boolean;
    min?: number;
    max?: number;
    step?: number;
}

// ─── UI State ─────────────────────────────────────────────────────────────────
