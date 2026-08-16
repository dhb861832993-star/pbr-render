/**
 * Generate a test GLB model with PBR textures (a low-poly robot/creature with
 * baseColor + normal-ish variation) for verifying PBRRender. Writes
 * test-model.glb in the plugin dir. Run: node scripts/gen-test-model.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// GLTFExporter's binary path uses FileReader (browser API). Node 24 has Blob
// but no FileReader; inject a minimal polyfill backed by Blob.arrayBuffer().
if (typeof globalThis.FileReader === "undefined") {
  globalThis.FileReader = class FileReader {
    constructor() { this.result = null; }
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((buf) => {
        this.result = buf;
        if (this.onloadend) this.onloadend();
      });
    }
  };
}

// --- Build a scene: body box + head box + eyes + metalic arms ---
const scene = new THREE.Scene();

const bodyMat = new THREE.MeshStandardMaterial({
  color: 0x4a7dff,
  metalness: 0.15,
  roughness: 0.55
});
const body = new THREE.Mesh(new THREE.BoxGeometry(1, 1.2, 0.8), bodyMat);
body.position.y = 0.85;
scene.add(body);

const headMat = new THREE.MeshStandardMaterial({
  color: 0x2b2f36,
  metalness: 0.35,
  roughness: 0.4
});
const head = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.6, 0.66), headMat);
head.position.y = 1.85;
scene.add(head);

const eyeMat = new THREE.MeshStandardMaterial({
  color: 0x00e5ff,
  emissive: 0x00aabb,
  emissiveIntensity: 1.6,
  metalness: 0.0,
  roughness: 0.2
});
for (const side of [-1, 1]) {
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 16), eyeMat);
  eye.position.set(side * 0.16, 1.92, 0.32);
  scene.add(eye);
}

const armMat = new THREE.MeshStandardMaterial({
  color: 0xb9c1cc,
  metalness: 0.85,
  roughness: 0.25
});
for (const side of [-1, 1]) {
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.1, 12), armMat);
  arm.position.set(side * 0.7, 0.95, 0);
  arm.rotation.z = side * -0.35;
  scene.add(arm);
}

const baseMat = new THREE.MeshStandardMaterial({
  color: 0x22262e,
  metalness: 0.4,
  roughness: 0.6
});
const base = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 0.18, 24), baseMat);
base.position.y = 0.09;
scene.add(base);

// --- Export to GLB ---
const exporter = new GLTFExporter();
const glb = await exporter.parseAsync(scene, { binary: true });
const out = join(root, "test-model.glb");
mkdirSync(dirname(out), { recursive: true });
// parseAsync binary returns ArrayBuffer in Node; Buffer.from wraps it.
writeFileSync(out, Buffer.from(glb));
console.log(`✓ wrote ${out} (${glb.byteLength} bytes)`);
