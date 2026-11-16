"use client";

import { useEffect } from "react";
import { MercatorCoordinate, type CustomLayerInterface, type CustomRenderMethodInput, type Map as MapLibreMap } from "maplibre-gl";
import { useMap } from "react-map-gl/maplibre";
import { hillColor, hillMeters, hillZoomScale, type HailPatch } from "@/lib/hail-terrain";
import { SWATH_HEIGHT_ZOOM } from "@/lib/swath-extrusion";

const LAYER_ID = "hail-ridge";

/**
 * A sloped hail surface. Each grid quad is two triangles whose corners sit at
 * different heights, so the outer edge stays on the ground and the middle rises
 * to a peak. Zoom only scales the height uniform.
 */
function createRidgeLayer(patches: HailPatch[]): CustomLayerInterface & { map: MapLibreMap | null } {
  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  let indexBuffer: WebGLBuffer | null = null;
  let count = 0;
  const layer = {
    id: LAYER_ID,
    type: "custom" as const,
    renderingMode: "3d" as const,
    map: null as MapLibreMap | null,
    onAdd(map: MapLibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
      this.map = map;
      const built = buildMesh(patches);
      count = built.count;
      program = createProgram(gl);
      if (!program) console.error("[hail-ridge] shader failed");
      buffer = gl.createBuffer();
      indexBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, built.vertices, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, built.indices, gl.STATIC_DRAW);
    },
    onRemove(_map: MapLibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
      if (program) gl.deleteProgram(program);
      if (buffer) gl.deleteBuffer(buffer);
      if (indexBuffer) gl.deleteBuffer(indexBuffer);
      program = null;
      buffer = null;
      indexBuffer = null;
      this.map = null;
    },
    render(gl: WebGLRenderingContext | WebGL2RenderingContext, options: CustomRenderMethodInput) {
      if (!program || !buffer || !indexBuffer || count === 0) return;
      const zoom = this.map?.getZoom() ?? SWATH_HEIGHT_ZOOM;
      const scale = hillZoomScale(zoom);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      const stride = 10 * 4;
      const pos = gl.getAttribLocation(program, "a_pos");
      const color = gl.getAttribLocation(program, "a_color");
      const normal = gl.getAttribLocation(program, "a_normal");
      gl.enableVertexAttribArray(pos);
      gl.vertexAttribPointer(pos, 3, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(color);
      gl.vertexAttribPointer(color, 4, gl.FLOAT, false, stride, 3 * 4);
      gl.enableVertexAttribArray(normal);
      gl.vertexAttribPointer(normal, 3, gl.FLOAT, false, stride, 7 * 4);
      const matrix = options.modelViewProjectionMatrix;
      gl.uniformMatrix4fv(gl.getUniformLocation(program, "u_matrix"), false, matrix instanceof Float32Array ? matrix : new Float32Array(matrix));
      const worldSize = this.map?.transform?.worldSize ?? 512 * 2 ** zoom;
      gl.uniform1f(gl.getUniformLocation(program, "u_world"), worldSize);
      gl.uniform1f(gl.getUniformLocation(program, "u_scale"), scale);
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
      gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_INT, 0);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      if (depthTest) gl.enable(gl.DEPTH_TEST);
      else gl.disable(gl.DEPTH_TEST);
      if (cull) gl.enable(gl.CULL_FACE);
      if (stencil) gl.enable(gl.STENCIL_TEST);
    },
  };
  return layer;
}

function buildMesh(patches: HailPatch[]): { vertices: Float32Array; indices: Uint32Array; count: number } {
  const vertices: number[] = [];
  const triangles: Array<{ far: number; ids: [number, number, number] }> = [];
  for (const patch of patches) {
    const columns = patch.columns;
    const rows = patch.rows;
    const base = vertices.length / 10;
    const meters: number[] = [];
    for (let i = 0; i < patch.values.length; i += 1) meters.push(hillMeters(patch.values[i]));
    const stepKm = patch.step * 111;
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < columns; x += 1) {
        const inches = patch.values[y * columns + x] ?? 0;
        const lon = patch.west + x * patch.step;
        const lat = patch.south + y * patch.step;
        const mercator = MercatorCoordinate.fromLngLat({ lng: lon, lat });
        const left = meters[y * columns + Math.max(0, x - 1)] ?? 0;
        const right = meters[y * columns + Math.min(columns - 1, x + 1)] ?? 0;
        const down = meters[Math.max(0, y - 1) * columns + x] ?? 0;
        const up = meters[Math.min(rows - 1, y + 1) * columns + x] ?? 0;
        const dzdx = (right - left) / (stepKm * 2);
        const dzdy = (up - down) / (stepKm * 2);
        const nx = -dzdx * 1.15;
        const ny = -dzdy * 1.15;
        const nz = 1;
        const length = Math.hypot(nx, ny, nz) || 1;
        const [r, g, b, a] = hillColor(inches);
        vertices.push(mercator.x, mercator.y, meters[y * columns + x] ?? 0, r, g, b, a, nx / length, ny / length, nz / length);
      }
    }
    for (let y = 0; y < rows - 1; y += 1) {
      for (let x = 0; x < columns - 1; x += 1) {
        const i00 = y * columns + x;
        const i10 = i00 + 1;
        const i01 = i00 + columns;
        const i11 = i01 + 1;
        const highest = Math.max(patch.values[i00] ?? 0, patch.values[i10] ?? 0, patch.values[i01] ?? 0, patch.values[i11] ?? 0);
        if (highest < 0.08) continue;
        const a = base + i00;
        const b = base + i10;
        const c = base + i01;
        const d = base + i11;
        const far = (vertices[a * 10 + 1] + vertices[c * 10 + 1] + vertices[b * 10 + 1]) / 3;
        const near = (vertices[b * 10 + 1] + vertices[c * 10 + 1] + vertices[d * 10 + 1]) / 3;
        triangles.push({ far, ids: [a, c, b] }, { far: near, ids: [b, c, d] });
      }
    }
  }
  triangles.sort((left, right) => left.far - right.far);
  const indices: number[] = [];
  for (const triangle of triangles) indices.push(triangle.ids[0], triangle.ids[1], triangle.ids[2]);
  return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices), count: indices.length };
}

function createProgram(gl: WebGLRenderingContext | WebGL2RenderingContext): WebGLProgram | null {
  const vertex = compile(gl, gl.VERTEX_SHADER, `#version 300 es
precision highp float;
uniform mat4 u_matrix;
uniform float u_world;
uniform float u_scale;
in vec3 a_pos;
in vec4 a_color;
in vec3 a_normal;
out vec4 v_color;
out vec3 v_normal;
void main() {
  vec3 pos = vec3(a_pos.xy * u_world, a_pos.z * u_scale);
  gl_Position = u_matrix * vec4(pos, 1.0);
  v_color = a_color;
  v_normal = a_normal;
}`);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, `#version 300 es
precision highp float;
in vec4 v_color;
in vec3 v_normal;
out vec4 fragColor;
void main() {
  vec3 light = normalize(vec3(-0.35, 0.45, 0.82));
  float shade = clamp(dot(normalize(v_normal), light), 0.0, 1.0);
  float lit = 0.8 + 0.75 * shade;
  vec3 color = v_color.rgb * lit;
  float alpha = v_color.a;
  fragColor = vec4(color * alpha, alpha);
}`);
  if (!vertex || !fragment) return null;
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.bindAttribLocation(program, 0, "a_pos");
  gl.bindAttribLocation(program, 1, "a_color");
  gl.bindAttribLocation(program, 2, "a_normal");
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
