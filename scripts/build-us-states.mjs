/**
 * Build a compact US state overlay for the map: boundary polygons plus an
 * interior label point per state. Source is the public us-atlas 1:10m file.
 *
 *   node scripts/build-us-states.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { feature } from "topojson-client";

const SOURCE = "https://cdn.jsdelivr.net/npm/us-atlas@3.0.1/states-10m.json";
const OUT = new URL("../src/data/us-states.json", import.meta.url);

const FIPS = {
  "01": ["AL", "Alabama"],
  "02": ["AK", "Alaska"],
  "04": ["AZ", "Arizona"],
  "05": ["AR", "Arkansas"],
  "06": ["CA", "California"],
  "08": ["CO", "Colorado"],
  "09": ["CT", "Connecticut"],
  "10": ["DE", "Delaware"],
  "11": ["DC", "D.C."],
  "12": ["FL", "Florida"],
  "13": ["GA", "Georgia"],
  "15": ["HI", "Hawaii"],
  "16": ["ID", "Idaho"],
  "17": ["IL", "Illinois"],
  "18": ["IN", "Indiana"],
  "19": ["IA", "Iowa"],
  "20": ["KS", "Kansas"],
  "21": ["KY", "Kentucky"],
  "22": ["LA", "Louisiana"],
  "23": ["ME", "Maine"],
  "24": ["MD", "Maryland"],
  "25": ["MA", "Massachusetts"],
  "26": ["MI", "Michigan"],
  "27": ["MN", "Minnesota"],
  "28": ["MS", "Mississippi"],
  "29": ["MO", "Missouri"],
  "30": ["MT", "Montana"],
  "31": ["NE", "Nebraska"],
  "32": ["NV", "Nevada"],
  "33": ["NH", "New Hampshire"],
  "34": ["NJ", "New Jersey"],
  "35": ["NM", "New Mexico"],
  "36": ["NY", "New York"],
  "37": ["NC", "North Carolina"],
  "38": ["ND", "North Dakota"],
  "39": ["OH", "Ohio"],
  "40": ["OK", "Oklahoma"],
  "41": ["OR", "Oregon"],
  "42": ["PA", "Pennsylvania"],
  "44": ["RI", "Rhode Island"],
  "45": ["SC", "South Carolina"],
  "46": ["SD", "South Dakota"],
  "47": ["TN", "Tennessee"],
  "48": ["TX", "Texas"],
  "49": ["UT", "Utah"],
  "50": ["VT", "Vermont"],
  "51": ["VA", "Virginia"],
  "53": ["WA", "Washington"],
  "54": ["WV", "West Virginia"],
  "55": ["WI", "Wisconsin"],
  "56": ["WY", "Wyoming"],
};

function roundCoord(value) {
  return Math.round(value * 1000) / 1000;
}

function roundRing(ring) {
  const next = [];
  for (const [lon, lat] of ring) {
    const point = [roundCoord(lon), roundCoord(lat)];
    const prev = next[next.length - 1];
    if (prev && prev[0] === point[0] && prev[1] === point[1]) continue;
    next.push(point);
  }
  if (next.length > 1) {
    const first = next[0];
    const last = next[next.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) next.push([first[0], first[1]]);
  }
  return next;
}

function roundGeometry(geometry) {
  if (geometry.type === "Polygon") {
    return { type: "Polygon", coordinates: geometry.coordinates.map(roundRing) };
  }
  return {
    type: "MultiPolygon",
    coordinates: geometry.coordinates.map((polygon) => polygon.map(roundRing)),
  };
}

function polygonsOf(geometry) {
  return geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
}

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function insidePolygon(x, y, polygon) {
  if (!pointInRing(x, y, polygon[0])) return false;
  for (let hole = 1; hole < polygon.length; hole += 1) {
    if (pointInRing(x, y, polygon[hole])) return false;
  }
  return true;
}

function segmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function clearance(x, y, polygon) {
  if (!insidePolygon(x, y, polygon)) return -1;
  let min = Infinity;
  for (const ring of polygon) {
    for (let i = 0; i < ring.length - 1; i += 1) {
      min = Math.min(min, segmentDistance(x, y, ring[i][0], ring[i][1], ring[i + 1][0], ring[i + 1][1]));
    }
  }
  return min;
}

function ringCentroid(ring) {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const cross = ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    area += cross;
    cx += (ring[i][0] + ring[i + 1][0]) * cross;
    cy += (ring[i][1] + ring[i + 1][1]) * cross;
  }
  area *= 0.5;
  if (Math.abs(area) < 1e-8) return null;
  return [cx / (6 * area), cy / (6 * area)];
}

function interiorPoint(geometry) {
  const polygons = polygonsOf(geometry);
  let largest = polygons[0];
  let largestArea = -1;
  for (const polygon of polygons) {
    const area = ringArea(polygon[0]);
    if (area > largestArea) {
      largest = polygon;
      largestArea = area;
    }
  }
  const centroid = ringCentroid(largest[0]);
  if (centroid && clearance(centroid[0], centroid[1], largest) >= 0.12) {
    return [roundCoord(centroid[0]), roundCoord(centroid[1])];
  }

  let best = null;
  for (const polygon of polygons) {
    const ring = polygon[0];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of ring) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    const steps = 36;
    for (let iy = 0; iy <= steps; iy += 1) {
      for (let ix = 0; ix <= steps; ix += 1) {
        const x = minX + (ix / steps) * (maxX - minX);
        const y = minY + (iy / steps) * (maxY - minY);
        const score = clearance(x, y, polygon);
        if (score > 0 && (!best || score > best.score)) best = { x, y, score };
      }
    }
  }
  if (!best) return null;
  return [roundCoord(best.x), roundCoord(best.y)];
}

function ringArea(ring) {
  let area = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return Math.abs(area) / 2;
}

const response = await fetch(SOURCE);
if (!response.ok) throw new Error(`Failed to download states: ${response.status}`);
const topo = await response.json();
const collection = feature(topo, topo.objects.states);
const features = [];

for (const item of collection.features) {
  const fips = String(item.id).padStart(2, "0");
  const names = FIPS[fips];
  if (!names) continue;
  const [abbr, name] = names;
  const geometry = roundGeometry(item.geometry);
  const area = Math.round(polygonsOf(geometry).reduce((sum, polygon) => sum + ringArea(polygon[0]), 0) * 100);
  const label = interiorPoint(item.geometry);
  if (!label) throw new Error(`No label point for ${name}`);
  const props = { abbr, name, area };
  features.push({ type: "Feature", properties: { ...props, kind: "boundary" }, geometry });
  features.push({
    type: "Feature",
    properties: { ...props, kind: "label" },
    geometry: { type: "Point", coordinates: label },
  });
}

features.sort((a, b) => a.properties.abbr.localeCompare(b.properties.abbr) || a.properties.kind.localeCompare(b.properties.kind));

const overlay = { type: "FeatureCollection", features };
mkdirSync(dirname(OUT.pathname), { recursive: true });
writeFileSync(OUT, JSON.stringify(overlay));
const labels = features.filter((item) => item.properties.kind === "label");
console.log(`wrote ${labels.length} states to ${OUT.pathname} (${Buffer.byteLength(JSON.stringify(overlay))} bytes)`);
for (const item of labels) {
  const [lon, lat] = item.geometry.coordinates;
  console.log(`${item.properties.abbr} ${item.properties.name} ${lon},${lat}`);
}
