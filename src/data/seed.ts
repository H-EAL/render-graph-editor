import type { PipelineDocument } from '../types';
import rawSeed from '../assets/newrg.json';

export const seedDocument: PipelineDocument = rawSeed as unknown as PipelineDocument;

// ─── Deferred Rendering — 2-timeline example ──────────────────────────────────

export const deferredSeed: PipelineDocument = {
  pipeline: {
    id: 'deferred-example',
    name: 'Deferred Rendering',
    version: 1,
    timelines: [
      { id: 'tl-gfx',   name: 'Graphics',      type: 'graphics',     passIds: ['pass-gbuffer', 'pass-shadow', 'pass-composite', 'pass-postprocess', 'pass-ui'] },
      { id: 'tl-async', name: 'Async Compute',  type: 'asyncCompute', passIds: ['pass-ssao', 'pass-lightculling', 'pass-particles'] },
    ],
    passes: {
      'pass-gbuffer': {
        id: 'pass-gbuffer', name: 'GBuffer Fill', kind: 'raster',
        timelineId: 'tl-gfx', enabled: true, conditions: [],
        reads: [], writes: ['rt-albedo', 'rt-normal', 'rt-depth'],
        steps: ['step-gbuffer-vp', 'step-gbuffer-draw'],
        rasterAttachments: {
          colorAttachments: [
            { target: 'rt-albedo', loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] },
            { target: 'rt-normal', loadOp: 'clear', storeOp: 'store', clearValue: [0.5, 0.5, 1, 0] },
          ],
          depthAttachment: { target: 'rt-depth', loadOp: 'clear', storeOp: 'store', clearValue: 1 },
        },
      },
      'pass-shadow': {
        id: 'pass-shadow', name: 'Shadow Map', kind: 'raster',
        timelineId: 'tl-gfx', enabled: true, conditions: ['castsShadows'],
        reads: [], writes: ['rt-shadow'],
        steps: ['step-shadow-draw'],
        rasterAttachments: {
          colorAttachments: [],
          depthAttachment: { target: 'rt-shadow', loadOp: 'clear', storeOp: 'store', clearValue: 1 },
        },
      },
      'pass-composite': {
        id: 'pass-composite', name: 'Main Composite', kind: 'raster',
        timelineId: 'tl-gfx', enabled: true, conditions: [],
        reads: ['rt-albedo', 'rt-normal', 'rt-depth', 'rt-ssao', 'buf-light-list'],
        writes: ['rt-hdr'],
        steps: ['step-composite-fs'],
        rasterAttachments: {
          colorAttachments: [{ target: 'rt-hdr', loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
        },
      },
      'pass-postprocess': {
        id: 'pass-postprocess', name: 'Post-Process', kind: 'raster',
        timelineId: 'tl-gfx', enabled: true, conditions: [],
        reads: ['rt-hdr'], writes: ['rt-ldr'],
        steps: ['step-pp-tonemap'],
        rasterAttachments: {
          colorAttachments: [{ target: 'rt-ldr', loadOp: 'dontCare', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
        },
      },
      'pass-ui': {
        id: 'pass-ui', name: 'UI Overlay', kind: 'raster',
        timelineId: 'tl-gfx', enabled: true, conditions: ['showUI'],
        reads: [], writes: ['rt-ldr'],
        steps: ['step-ui-draw'],
        rasterAttachments: {
          colorAttachments: [{ target: 'rt-ldr', loadOp: 'load', storeOp: 'store', clearValue: [0, 0, 0, 0], blendState: 'bs-alpha' }],
        },
      },
      'pass-ssao': {
        id: 'pass-ssao', name: 'SSAO', kind: 'compute',
        timelineId: 'tl-async', enabled: true, conditions: ['ssaoEnabled'],
        reads: ['rt-depth', 'rt-normal'], writes: ['rt-ssao'],
        steps: ['step-ssao-dispatch'],
        rasterAttachments: { colorAttachments: [] },
      },
      'pass-lightculling': {
        id: 'pass-lightculling', name: 'Light Culling', kind: 'compute',
        timelineId: 'tl-async', enabled: true, conditions: [],
        reads: ['rt-depth', 'rt-shadow'], writes: ['buf-light-list'],
        steps: ['step-cull-dispatch'],
        rasterAttachments: { colorAttachments: [] },
      },
      'pass-particles': {
        id: 'pass-particles', name: 'Particle Update', kind: 'compute',
        timelineId: 'tl-async', enabled: true, conditions: ['particlesEnabled'],
        reads: ['rt-depth'], writes: ['buf-particles'],
        steps: ['step-particles-dispatch'],
        rasterAttachments: { colorAttachments: [] },
      },
    },
    steps: {
      'step-gbuffer-vp':         { id: 'step-gbuffer-vp',         name: 'Set Viewport',          type: 'viewport',              reads: [], writes: [], conditions: [], x: 0, y: 0, width: 'viewport.width', height: 'viewport.height', minDepth: 0, maxDepth: 1 },
      'step-gbuffer-draw':       { id: 'step-gbuffer-draw',       name: 'Draw Geometry',          type: 'drawBatchWithMaterials', reads: [], writes: [], conditions: [], shader: 'sh-gbuffer',   depthTest: true,  depthWrite: true,  cullMode: 'back'  },
      'step-shadow-draw':        { id: 'step-shadow-draw',        name: 'Draw Shadow Casters',    type: 'drawBatch',             reads: [], writes: [], conditions: [], shader: 'sh-shadow',    depthTest: true,  depthWrite: true,  cullMode: 'front' },
      'step-composite-fs':       { id: 'step-composite-fs',       name: 'Deferred Composite',     type: 'drawFullscreen',        reads: [], writes: [], conditions: [], shader: 'sh-composite' },
      'step-pp-tonemap':         { id: 'step-pp-tonemap',         name: 'Tonemap + Film Grain',   type: 'drawFullscreen',        reads: [], writes: [], conditions: [], shader: 'sh-tonemap'   },
      'step-ui-draw':            { id: 'step-ui-draw',            name: 'Draw UI Batch',          type: 'drawBatch',             reads: [], writes: [], conditions: [], shader: 'sh-ui', blendState: 'bs-alpha', depthTest: false, depthWrite: false, cullMode: 'none' },
      'step-ssao-dispatch':      { id: 'step-ssao-dispatch',      name: 'SSAO Kernel',            type: 'dispatchCompute',       reads: [], writes: [], conditions: [], shader: 'sh-ssao',      groupsX: 'ceil(viewport.width/8)',  groupsY: 'ceil(viewport.height/8)',  groupsZ: 1 },
      'step-cull-dispatch':      { id: 'step-cull-dispatch',      name: 'Cull Lights',            type: 'dispatchCompute',       reads: [], writes: [], conditions: [], shader: 'sh-lightcull', groupsX: 'ceil(viewport.width/16)', groupsY: 'ceil(viewport.height/16)', groupsZ: 1 },
      'step-particles-dispatch': { id: 'step-particles-dispatch', name: 'Simulate Particles',     type: 'dispatchCompute',       reads: [], writes: [], conditions: [], shader: 'sh-particles', groupsX: 256, groupsY: 1, groupsZ: 1 },
    },
  },
  resources: {
    renderTargets: [
      { id: 'rt-albedo', name: 'rt-albedo', format: 'rgba8',   width: 'viewport.width', height: 'viewport.height', mips: 1, layers: 1, description: 'GBuffer albedo + roughness' },
      { id: 'rt-normal', name: 'rt-normal', format: 'rgba16f', width: 'viewport.width', height: 'viewport.height', mips: 1, layers: 1, description: 'GBuffer view-space normals' },
      { id: 'rt-depth',  name: 'rt-depth',  format: 'd32f',    width: 'viewport.width', height: 'viewport.height', mips: 1, layers: 1, description: 'Main depth buffer' },
      { id: 'rt-shadow', name: 'rt-shadow', format: 'd32f',    width: 2048,             height: 2048,              mips: 1, layers: 1, description: 'Shadow map atlas' },
      { id: 'rt-ssao',   name: 'rt-ssao',   format: 'r32f',    width: 'viewport.width', height: 'viewport.height', mips: 1, layers: 1, description: 'SSAO occlusion factor' },
      { id: 'rt-hdr',    name: 'rt-hdr',    format: 'rgba16f', width: 'viewport.width', height: 'viewport.height', mips: 1, layers: 1, description: 'HDR lit scene' },
      { id: 'rt-ldr',    name: 'rt-ldr',    format: 'rgba8',   width: 'viewport.width', height: 'viewport.height', mips: 1, layers: 1, description: 'Final LDR output' },
    ],
    buffers: [
      { id: 'buf-light-list', name: 'buf-light-list', size: '65536',   description: 'Per-tile visible light indices' },
      { id: 'buf-particles',  name: 'buf-particles',  size: '1048576', description: 'Particle state SSBO' },
    ],
    blendStates: [
      { id: 'bs-alpha', name: 'bs-alpha', enabled: true, srcColor: 'srcAlpha', dstColor: 'oneMinusSrcAlpha', colorOp: 'add', srcAlpha: 'one', dstAlpha: 'oneMinusSrcAlpha', alphaOp: 'add' },
    ],
    shaders: [
      { id: 'sh-gbuffer',   name: 'GBuffer Fill',        stage: 'vertex',   path: 'shaders/gbuffer.hlsl',   entryPoint: 'VSMain' },
      { id: 'sh-shadow',    name: 'Shadow Depth',         stage: 'vertex',   path: 'shaders/shadow.hlsl',    entryPoint: 'VSMain' },
      { id: 'sh-composite', name: 'Deferred Composite',   stage: 'fragment', path: 'shaders/composite.hlsl', entryPoint: 'PSMain' },
      { id: 'sh-tonemap',   name: 'Tonemap + Film Grain', stage: 'fragment', path: 'shaders/tonemap.hlsl',   entryPoint: 'PSMain' },
      { id: 'sh-ui',        name: 'UI Sprite',            stage: 'vertex',   path: 'shaders/ui.hlsl',        entryPoint: 'VSMain' },
      { id: 'sh-ssao',      name: 'SSAO Kernel',          stage: 'compute',  path: 'shaders/ssao.hlsl',      entryPoint: 'CSMain' },
      { id: 'sh-lightcull', name: 'Light Culling',        stage: 'compute',  path: 'shaders/lightcull.hlsl', entryPoint: 'CSMain' },
      { id: 'sh-particles', name: 'Particle Simulation',  stage: 'compute',  path: 'shaders/particles.hlsl', entryPoint: 'CSMain' },
    ],
    inputParameters: [
      { id: 'ip-ssao',      name: 'ssaoEnabled',      type: 'bool', defaultValue: 'true'  },
      { id: 'ip-shadows',   name: 'castsShadows',     type: 'bool', defaultValue: 'true'  },
      { id: 'ip-ui',        name: 'showUI',           type: 'bool', defaultValue: 'true'  },
      { id: 'ip-particles', name: 'particlesEnabled', type: 'bool', defaultValue: 'false' },
    ],
  },
};

// ─── Example registry ─────────────────────────────────────────────────────────

export const examples = [
  { id: 'newrg',    label: 'newrg',    doc: seedDocument  },
  { id: 'deferred', label: 'Deferred', doc: deferredSeed  },
] as const;

export type ExampleId = typeof examples[number]['id'];
