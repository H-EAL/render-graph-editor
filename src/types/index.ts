// ─── Core IDs ────────────────────────────────────────────────────────────────

export type PassId = string;
export type StepId = string;
export type ResourceId = string;
export type TimelineId = string;

// ─── Resource Library ────────────────────────────────────────────────────────

export type InputParamType =
  | 'bool'
  | 'float'
  | 'uint'
  | 'int'
  | 'vec2'
  | 'vec3'
  | 'vec4'
  | 'color';

export interface InputParameter {
  id: ResourceId;
  name: string;
  type: InputParamType;
  defaultValue: string;
  description?: string;
}

export type TextureFormat =
  | 'rgba8'
  | 'rgba16f'
  | 'rgba32f'
  | 'r11g11b10f'
  | 'rg16f'
  | 'r32f'
  | 'd32f'
  | 'd24s8'
  | 'bc1'
  | 'bc3'
  | 'bc5'
  | 'bc7';

export interface RenderTarget {
  id: ResourceId;
  name: string;
  format: TextureFormat;
  width: number | string;
  height: number | string;
  mips: number;
  layers: number;
  description?: string;
}

export interface Buffer {
  id: ResourceId;
  name: string;
  size: number | string;
  description?: string;
}

export type BlendFactor =
  | 'zero'
  | 'one'
  | 'srcColor'
  | 'oneMinusSrcColor'
  | 'dstColor'
  | 'oneMinusDstColor'
  | 'srcAlpha'
  | 'oneMinusSrcAlpha'
  | 'dstAlpha'
  | 'oneMinusDstAlpha';

export type BlendOp = 'add' | 'subtract' | 'reverseSubtract' | 'min' | 'max';

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

export type ShaderStage = 'vertex' | 'fragment' | 'compute' | 'raygen' | 'miss' | 'closesthit';

export interface Shader {
  id: ResourceId;
  name: string;
  stage: ShaderStage;
  path: string;
  entryPoint: string;
  description?: string;
}

export interface ResourceLibrary {
  renderTargets: RenderTarget[];
  buffers: Buffer[];
  blendStates: BlendState[];
  shaders: Shader[];
  inputParameters: InputParameter[];
}

// ─── Timeline ─────────────────────────────────────────────────────────────────

export type TimelineType = 'graphics' | 'asyncCompute' | 'transfer' | 'raytracing' | 'custom';

export interface Timeline {
  id: TimelineId;
  name: string;
  type: TimelineType;
  passIds: PassId[];
}

// ─── Pass ─────────────────────────────────────────────────────────────────────

export type PassKind = 'raster' | 'compute' | 'transfer' | 'raytracing';

export type LoadOp = 'load' | 'clear' | 'dontCare';
export type StoreOp = 'store' | 'dontCare';

export interface ColorAttachment {
  target: ResourceId;
  loadOp: LoadOp;
  storeOp: StoreOp;
  clearValue: [number, number, number, number];
  blendState?: ResourceId;
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

export interface RasterAttachments {
  colorAttachments: ColorAttachment[];
  depthAttachment?: DepthAttachment;
}

export interface Pass {
  id: PassId;
  name: string;
  kind: PassKind;
  timelineId: TimelineId;
  enabled: boolean;
  conditions: string[];
  notes?: string;
  rasterAttachments?: RasterAttachments;
  reads: ResourceId[];
  writes: ResourceId[];
  steps: StepId[];
}

// ─── Steps ────────────────────────────────────────────────────────────────────

export type StepType =
  | 'drawBatch'
  | 'drawBatchWithMaterials'
  | 'dispatchCompute'
  | 'dispatchRayTracing'
  | 'drawFullscreen'
  | 'copyImage'
  | 'blitImage'
  | 'resolveImage'
  | 'clearImages'
  | 'fillBuffer'
  | 'generateMipChain'
  | 'viewport'
  | 'drawDebugLines';

export interface StepBase {
  id: StepId;
  name: string;
  reads: ResourceId[];
  writes: ResourceId[];
  conditions: string[];
}

export interface DrawBatchStep extends StepBase {
  type: 'drawBatch';
  shader: ResourceId;
  blendState?: ResourceId;
  depthTest: boolean;
  depthWrite: boolean;
  cullMode: 'none' | 'front' | 'back';
  batchTag?: string;
}

export interface DrawBatchWithMaterialsStep extends StepBase {
  type: 'drawBatchWithMaterials';
  shader: ResourceId;
  blendState?: ResourceId;
  depthTest: boolean;
  depthWrite: boolean;
  cullMode: 'none' | 'front' | 'back';
  batchTag?: string;
  materialSet?: string;
}

export interface DispatchComputeStep extends StepBase {
  type: 'dispatchCompute';
  shader: ResourceId;
  groupsX: number | string;
  groupsY: number | string;
  groupsZ: number | string;
}

export interface DispatchRayTracingStep extends StepBase {
  type: 'dispatchRayTracing';
  raygenShader: ResourceId;
  missShader?: ResourceId;
  closestHitShader?: ResourceId;
  width: number | string;
  height: number | string;
}

export interface DrawFullscreenStep extends StepBase {
  type: 'drawFullscreen';
  shader: ResourceId;
  blendState?: ResourceId;
}

export interface CopyImageStep extends StepBase {
  type: 'copyImage';
  source: ResourceId;
  destination: ResourceId;
}

export interface BlitImageStep extends StepBase {
  type: 'blitImage';
  source: ResourceId;
  destination: ResourceId;
  filter: 'nearest' | 'linear';
}

export interface ResolveImageStep extends StepBase {
  type: 'resolveImage';
  source: ResourceId;
  destination: ResourceId;
}

export interface ClearTarget {
  target: ResourceId;
  clearValue: [number, number, number, number];
}

export interface ClearImagesStep extends StepBase {
  type: 'clearImages';
  targets: ClearTarget[];
}

export interface FillBufferStep extends StepBase {
  type: 'fillBuffer';
  target: ResourceId;
  value: number;
}

export interface GenerateMipChainStep extends StepBase {
  type: 'generateMipChain';
  target: ResourceId;
  filter: 'nearest' | 'linear';
}

export interface ViewportStep extends StepBase {
  type: 'viewport';
  x: number;
  y: number;
  width: number | string;
  height: number | string;
  minDepth: number;
  maxDepth: number;
}

export interface DrawDebugLinesStep extends StepBase {
  type: 'drawDebugLines';
  shader?: ResourceId;
  lineWidth: number;
}

export type Step =
  | DrawBatchStep
  | DrawBatchWithMaterialsStep
  | DispatchComputeStep
  | DispatchRayTracingStep
  | DrawFullscreenStep
  | CopyImageStep
  | BlitImageStep
  | ResolveImageStep
  | ClearImagesStep
  | FillBufferStep
  | GenerateMipChainStep
  | ViewportStep
  | DrawDebugLinesStep;

// ─── Pipeline ─────────────────────────────────────────────────────────────────

export interface Pipeline {
  id: string;
  name: string;
  version: number;
  timelines: Timeline[];
  passes: Record<PassId, Pass>;
  steps: Record<StepId, Step>;
}

// ─── Full Document ────────────────────────────────────────────────────────────

export interface PipelineDocument {
  pipeline: Pipeline;
  resources: ResourceLibrary;
}

// ─── Validation ───────────────────────────────────────────────────────────────

export type ValidationSeverity = 'error' | 'warning';

export interface ValidationIssue {
  id: string;
  severity: ValidationSeverity;
  message: string;
  location?: string;
}

// ─── UI State ─────────────────────────────────────────────────────────────────

