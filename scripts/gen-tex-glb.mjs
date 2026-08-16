/**
 * Hand-write a GLB with a full PBR texture set (baseColor/normal/
 * metallicRoughness/emissive) so the PBRRender mode bar has real channels
 * to switch between. Bypasses GLTFExporter (which needs a canvas in Node).
 * Run: node scripts/gen-tex-glb.mjs
 */
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SIZE = 64;

/** Build an RGBA PNG buffer from a per-pixel fn returning [r,g,b] 0..255. */
function makePng(fn) {
  const png = new PNG({ width: SIZE, height: SIZE });
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const [r, g, b] = fn(x, y);
      const i = (y * SIZE + x) << 2;
      png.data[i] = r;
      png.data[i + 1] = g;
      png.data[i + 2] = b;
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

// baseColor: blue/orange checker + green accents
const baseColorPng = makePng((x, y) => {
  const c = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0;
  const accent = (Math.floor(x / 4) + Math.floor(y / 4)) % 4 === 3;
  if (accent) return [30, 220, 90];
  return c ? [74, 125, 255] : [255, 140, 51];
});

// normal: standard tangent-space normal map (mostly up +Z, slight waves)
const normalPng = makePng((x, y) => {
  const nx = Math.round(128 + Math.sin(x / 6) * 60);
  const ny = Math.round(128 + Math.cos(y / 6) * 60);
  return [nx, ny, 255];
});

// metallicRoughness: R=roughness (left smooth→right rough), G=metallic
// (top dielectric→bottom metal), B unused
const mrPng = makePng((x, y) => {
  const rough = Math.round((x / (SIZE - 1)) * 255);
  const metal = Math.round((1 - y / (SIZE - 1)) * 255);
  return [rough, metal, 128];
});

// emissive: cyan glow spots
const emissivePng = makePng((x, y) => {
  const gx = ((x - 16) / 12) ** 2 + ((y - 16) / 12) ** 2;
  const gy = ((x - 48) / 14) ** 2 + ((y - 48) / 14) ** 2;
  const g = Math.max(0, Math.min(255, Math.round(255 * (Math.exp(-gx) + Math.exp(-gy)))));
  return [0, Math.round(g * 0.7), g];
});

// AO: dark corners → bright center (R channel in GLTF is the AO map)
const aoPng = makePng((x, y) => {
  const dx = (x - SIZE / 2) / (SIZE / 2);
  const dy = (y - SIZE / 2) / (SIZE / 2);
  const d = Math.sqrt(dx * dx + dy * dy);
  const v = Math.round(255 * (1 - Math.min(1, d)));
  return [v, 255, 255];
});

// ---- Build the GLB: a cube with 24 vertices (per-face) ----
// Box: 6 faces, 4 verts each = 24 verts; 6 faces × 2 tris = 36 indices.
const size = 1.0;
const faces = [
  // [normal, 4 corners (x,y,z)]
  [[0, 0, 1], [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]],
  [[0, 0, -1], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]],
  [[1, 0, 0], [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]]],
  [[-1, 0, 0], [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]]],
  [[0, 1, 0], [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]]],
  [[0, -1, 0], [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]]]
];
const uvCorners = [[0, 0], [1, 0], [1, 1], [0, 1]];
const positions = [];
const normals = [];
const uvs = [];
const indices = [];
let vi = 0;
for (const [n, corners] of faces) {
  for (let c = 0; c < 4; c++) {
    positions.push(corners[c][0] * size, corners[c][1] * size, corners[c][2] * size);
    normals.push(n[0], n[1], n[2]);
    uvs.push(uvCorners[c][0], uvCorners[c][1]);
  }
  // two triangles per face (CCW)
  indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
  vi += 4;
}

// ---- Serialize GLB ----
const posBuf = Buffer.from(new Float32Array(positions).buffer);
const nrmBuf = Buffer.from(new Float32Array(normals).buffer);
const uvBuf = Buffer.from(new Float32Array(uvs).buffer);
const idxBuf = Buffer.from(new Uint16Array(indices).buffer);
const texPngs = [baseColorPng, normalPng, mrPng, emissivePng, aoPng];

// Build the binary buffer: positions, normals, uvs, indices, 5 textures.
const parts = [posBuf, nrmBuf, uvBuf, idxBuf, ...texPngs];
const bin = Buffer.concat(parts);
let offset = 0;
const bufferViews = [];
const addView = (buf, target) => {
  const view = { buffer: 0, byteOffset: offset, byteLength: buf.length };
  if (target) view.target = target;
  bufferViews.push(view);
  offset += buf.length;
  return bufferViews.length - 1;
};
const posView = addView(posBuf, 34962);
const nrmView = addView(nrmBuf, 34962);
const uvView = addView(uvBuf, 34962);
const idxView = addView(idxBuf, 34963);
const texViews = texPngs.map((p) => addView(p));

const images = texViews.map((view, i) => ({ bufferView: view, mimeType: "image/png" }));
const textures = images.map((_, i) => ({ sampler: 0, source: i }));

const json = {
  asset: { version: "2.0", generator: "pbr-render-test" },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0, name: "PBRTestCube" }],
  meshes: [
    {
      primitives: [
        {
          attributes: {
            POSITION: 0,
            NORMAL: 1,
            TEXCOORD_0: 2
          },
          indices: 3,
          material: 0,
          mode: 4
        }
      ]
    }
  ],
  accessors: [
    { bufferView: posView, componentType: 5126, count: 24, type: "VEC3", min: [-1, -1, -1], max: [1, 1, 1] },
    { bufferView: nrmView, componentType: 5126, count: 24, type: "VEC3" },
    { bufferView: uvView, componentType: 5126, count: 24, type: "VEC2" },
    { bufferView: idxView, componentType: 5123, count: 36, type: "SCALAR" }
  ],
  materials: [
    {
      name: "PBRFull",
      pbrMetallicRoughness: {
        baseColorTexture: { index: 0 },
        metallicRoughnessTexture: { index: 2 },
        roughnessFactor: 1,
        metalnessFactor: 1
      },
      normalTexture: { index: 1, scale: 1 },
      emissiveTexture: { index: 3 },
      emissiveFactor: [1, 1, 1],
      occlusionTexture: { index: 4 },
      doubleSided: true
    }
  ],
  textures,
  images,
  samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
  bufferViews,
  buffers: [{ byteLength: bin.length }]
};

const jsonBuf = Buffer.from(JSON.stringify(json));
// Pad JSON to 4-byte boundary with spaces.
const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
const jsonPadded = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]);
// Pad BIN to 4-byte boundary with zeros.
const binPad = (4 - (bin.length % 4)) % 4;
const binPadded = Buffer.concat([bin, Buffer.alloc(binPad, 0)]);

const total = 12 + 8 + jsonPadded.length + 8 + binPadded.length;
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0); // "glTF"
header.writeUInt32LE(2, 4);
header.writeUInt32LE(total, 8);
const jsonChunk = Buffer.alloc(8);
jsonChunk.writeUInt32LE(jsonPadded.length, 0);
jsonChunk.write("JSON", 4);
const binChunk = Buffer.alloc(8);
binChunk.writeUInt32LE(binPadded.length, 0);
binChunk.write("BIN\u0000", 4);

const glb = Buffer.concat([header, jsonChunk, jsonPadded, binChunk, binPadded]);
const out = join(root, "test-tex.glb");
writeFileSync(out, glb);
console.log(`✓ wrote ${out} (${glb.length} bytes)`);
