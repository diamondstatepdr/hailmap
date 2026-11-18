"use client";

import { useEffect } from "react";
import { MercatorCoordinate, type CustomLayerInterface, type CustomRenderMethodInput, type Map as MapLibreMap } from "maplibre-gl";
import { useMap } from "react-map-gl/maplibre";
import { hillMeters, hillZoomScale, radarRampGlsl, radarRimGlsl, radarTexture, type HailPatch } from "@/lib/hail-terrain";
import { SWATH_HEIGHT_ZOOM } from "@/lib/swath-extrusion";

const LAYER_ID = "hail-ridge";
/** Screen-space lift. The stored meters stay gentle; this makes the hills readable when the map is tilted. */
const HILL_EXAGGERATION = 3.1;

type PatchDraw = {
  width: number;
  height: number;
  rgba: Uint8Array;
  indexOffset: number;
  indexCount: number;
};

/**
 * Low hail surface. Color and the outline come from a finely sampled texture
 * with linear filtering, so the fringe is a continuous fade. The triangle
 * grid only carries the height and always covers the whole patch, including
 * the clear skirt, so the visible edge is not the edge of a grid square.
 */
function createRidgeLayer(patches: HailPatch[]): CustomLayerInterface & { map: MapLibreMap | null } {
  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  let indexBuffer: WebGLBuffer | null = null;
  const textures: WebGLTexture[] = [];
  let draws: PatchDraw[] = [];
  const layer = {
    id: LAYER_ID,
    type: "custom" as const,
    renderingMode: "3d" as const,
    map: null as MapLibreMap | null,
    onAdd(map: MapLibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
      this.map = map;
      const built = buildMesh(patches);
      draws = built.draws;
      program = createProgram(gl);
      if (!program) console.error("[hail-ridge] shader failed");
      buffer = gl.createBuffer();
      indexBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, built.vertices, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, built.indices, gl.STATIC_DRAW);
      for (const draw of draws) {
        const texture = gl.createTexture();
        if (!texture) continue;
        textures.push(texture);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, draw.width, draw.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, draw.rgba);
      }
    },
    onRemove(_map: MapLibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
      if (program) gl.deleteProgram(program);
      if (buffer) gl.deleteBuffer(buffer);
      if (indexBuffer) gl.deleteBuffer(indexBuffer);
      for (const texture of textures) gl.deleteTexture(texture);
      textures.length = 0;
      program = null;
      buffer = null;
      indexBuffer = null;
      draws = [];
      this.map = null;
    },
    render(gl: WebGLRenderingContext | WebGL2RenderingContext, options: CustomRenderMethodInput) {
      if (!program || !buffer || !indexBuffer || textures.length === 0) return;
      const zoom = this.map?.getZoom() ?? SWATH_HEIGHT_ZOOM;
      const scale = hillZoomScale(zoom);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      const stride = 8 * 4;
      const pos = gl.getAttribLocation(program, "a_pos");
      const normal = gl.getAttribLocation(program, "a_normal");
      const uv = gl.getAttribLocation(program, "a_uv");
      gl.enableVertexAttribArray(pos);
      gl.vertexAttribPointer(pos, 3, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(normal);
      gl.vertexAttribPointer(normal, 3, gl.FLOAT, false, stride, 3 * 4);
      gl.enableVertexAttribArray(uv);
      gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, stride, 6 * 4);
      const matrix = options.modelViewProjectionMatrix;
      gl.uniformMatrix4fv(gl.getUniformLocation(program, "u_matrix"), false, matrix instanceof Float32Array ? matrix : new Float32Array(matrix));
      const worldSize = this.map?.transform?.worldSize ?? 512 * 2 ** zoom;
      gl.uniform1f(gl.getUniformLocation(program, "u_world"), worldSize);
      gl.uniform1f(gl.getUniformLocation(program, "u_scale"), scale);
      const field = gl.getUniformLocation(program, "u_field");
      gl.uniform1i(field, 0);
      const depthTest = gl.isEnabled(gl.DEPTH_TEST);
      const cull = gl.isEnabled(gl.CULL_FACE);
      const stencil = gl.isEnabled(gl.STENCIL_TEST);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.STENCIL_TEST);
      gl.depthMask(true);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.colorMask(true, true, true, true);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.activeTexture(gl.TEXTURE0);
      for (let index = 0; index < textures.length; index += 1) {
        const draw = draws[index];
        const texture = textures[index];
        if (!draw || !texture || draw.indexCount === 0) continue;
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.drawElements(gl.TRIANGLES, draw.indexCount, gl.UNSIGNED_INT, draw.indexOffset * 4);
      }
      gl.clear(gl.DEPTH_BUFFER_BIT);
      if (depthTest) gl.enable(gl.DEPTH_TEST);
      else gl.disable(gl.DEPTH_TEST);
      if (cull) gl.enable(gl.CULL_FACE);
      if (stencil) gl.enable(gl.STENCIL_TEST);
    },
  };
  return layer;
}

function sampleField(patch: HailPatch, gx: number, gy: number): number {
  const x0 = Math.max(0, Math.min(patch.columns - 1, Math.floor(gx)));
  const y0 = Math.max(0, Math.min(patch.rows - 1, Math.floor(gy)));
  const x1 = Math.min(patch.columns - 1, x0 + 1);
  const y1 = Math.min(patch.rows - 1, y0 + 1);
  const tx = Math.min(1, Math.max(0, gx - x0));
  const ty = Math.min(1, Math.max(0, gy - y0));
  const a = patch.values[y0 * patch.columns + x0] ?? 0;
  const b = patch.values[y0 * patch.columns + x1] ?? 0;
  const c = patch.values[y1 * patch.columns + x0] ?? 0;
  const d = patch.values[y1 * patch.columns + x1] ?? 0;
  return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
}

function buildMesh(patches: HailPatch[]): { vertices: Float32Array; indices: Uint32Array; draws: PatchDraw[] } {
  const vertices: number[] = [];
  const indices: number[] = [];
  const draws: PatchDraw[] = [];
  for (const patch of patches) {
    const raster = radarTexture(patch);
    const divX = Math.min(84, Math.max(10, patch.columns - 1));
    const divY = Math.min(84, Math.max(10, patch.rows - 1));
    const base = vertices.length / 8;
    const heights: number[] = [];
    for (let iy = 0; iy <= divY; iy += 1) {
      for (let ix = 0; ix <= divX; ix += 1) {
        const gx = (ix / divX) * (patch.columns - 1);
        const gy = (iy / divY) * (patch.rows - 1);
        heights.push(hillMeters(sampleField(patch, gx, gy)) * HILL_EXAGGERATION);
      }
    }
    const stride = divX + 1;
    for (let iy = 0; iy <= divY; iy += 1) {
      for (let ix = 0; ix <= divX; ix += 1) {
        const fx = ix / divX;
        const fy = iy / divY;
        const lon = patch.west + fx * (patch.columns - 1) * patch.step;
        const lat = patch.south + fy * (patch.rows - 1) * patch.step;
        const mercator = MercatorCoordinate.fromLngLat({ lng: lon, lat });
        const here = heights[iy * stride + ix] ?? 0;
        const left = heights[iy * stride + Math.max(0, ix - 1)] ?? here;
        const right = heights[iy * stride + Math.min(divX, ix + 1)] ?? here;
        const down = heights[Math.max(0, iy - 1) * stride + ix] ?? here;
        const up = heights[Math.min(divY, iy + 1) * stride + ix] ?? here;
        const spanX = ((patch.columns - 1) * patch.step) / divX;
        const spanY = ((patch.rows - 1) * patch.step) / divY;
        const dxM = Math.max(spanX, 1e-6) * 111000;
        const dyM = Math.max(spanY, 1e-6) * 111000;
        const nx = -(right - left) / (2 * dxM);
        const ny = -(up - down) / (2 * dyM);
        const length = Math.hypot(nx, ny, 1) || 1;
        vertices.push(mercator.x, mercator.y, here, nx / length, ny / length, 1 / length, fx, fy);
      }
    }
    const indexOffset = indices.length;
    for (let iy = 0; iy < divY; iy += 1) {
      for (let ix = 0; ix < divX; ix += 1) {
        const a = base + iy * stride + ix;
        const b = a + 1;
        const c = a + stride;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    draws.push({
      width: raster.width,
      height: raster.height,
      rgba: raster.rgba,
      indexOffset,
      indexCount: indices.length - indexOffset,
    });
  }
  return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices), draws };
}

function createProgram(gl: WebGLRenderingContext | WebGL2RenderingContext): WebGLProgram | null {
  const vertex = compile(gl, gl.VERTEX_SHADER, `#version 300 es
precision highp float;
uniform mat4 u_matrix;
uniform float u_world;
uniform float u_scale;
in vec3 a_pos;
in vec3 a_normal;
in vec2 a_uv;
out vec3 v_normal;
out vec2 v_uv;
void main() {
  vec3 pos = vec3(a_pos.xy * u_world, a_pos.z * u_scale);
  gl_Position = u_matrix * vec4(pos, 1.0);
  v_normal = a_normal;
  v_uv = a_uv;
}`);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, `#version 300 es
precision highp float;
uniform sampler2D u_field;
in vec3 v_normal;
in vec2 v_uv;
out vec4 fragColor;
vec3 ramp(float inches) {
  ${radarRampGlsl()}
}
void main() {
  vec4 texel = texture(u_field, v_uv);
  float inches = texel.r * 6.0;
  float hot = texel.g;
  vec3 color = ramp(inches);
  vec3 n = normalize(v_normal);
  vec3 light = normalize(vec3(-0.62, 0.28, 0.62));
  float shade = clamp(dot(n, light), 0.0, 1.0);
  float lit = 0.46 + 0.92 * shade;
  float contact = smoothstep(1.15, 0.5, inches) * (1.0 - shade);
  color *= lit * (1.0 - 0.22 * contact);
  float w = max(fwidth(inches), 0.02);
  float rim = 0.0;
  ${radarRimGlsl()}
  color = mix(color, min(vec3(1.0), color + vec3(0.12)), rim * 0.16);
  color = mix(color, vec3(1.0, 0.98, 0.96), smoothstep(0.78, 1.0, hot));
  color += vec3(1.0, 0.98, 0.96) * hot * hot * 0.22;
  float t = clamp((inches - 0.50) / 0.70, 0.0, 1.0);
  float fade = t * t * (3.0 - 2.0 * t);
  float alpha = min(0.66, 0.64 * fade);
  if (alpha < 0.03) discard;
  fragColor = vec4(color * alpha, alpha);
}`);
  if (!vertex || !fragment) return null;
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.bindAttribLocation(program, 0, "a_pos");
  gl.bindAttribLocation(program, 1, "a_normal");
  gl.bindAttribLocation(program, 2, "a_uv");
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

function compile(gl: WebGLRenderingContext | WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export default function HailRidge({ patches, active }: { patches: HailPatch[] | null; active: boolean }) {
  const mapRef = useMap().current;
  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map || !active || !patches?.length) return;
    let layer = createRidgeLayer(patches);
    const place = () => {
      if (!map.getStyle()) return;
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      const before = map.getStyle()?.layers?.find((item) => item.type === "symbol")?.id;
      layer = createRidgeLayer(patches);
      map.addLayer(layer, before);
      map.triggerRepaint();
    };
    if (map.isStyleLoaded()) place();
    else map.once("load", place);
    const onStyle = () => {
      if (!map.getLayer(LAYER_ID)) place();
    };
    map.on("styledata", onStyle);
    return () => {
      map.off("styledata", onStyle);
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
    };
  }, [mapRef, active, patches]);
  return null;
}
