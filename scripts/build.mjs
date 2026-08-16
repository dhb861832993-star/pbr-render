/**
 * Build script: bundles the three.js engine asset into lib/assets/three.js
 * (IIFE, ~1.4MB) using esbuild. The client half is plain (no bundling needed).
 * Run: node scripts/build.mjs  (after `pnpm install` for esbuild+three)
 */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

await build({
  entryPoints: [join(root, "src", "three-entry.js")],
  outfile: join(root, "lib", "assets", "three.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  minify: true,
  legalComments: "none",
  logLevel: "info"
});

console.log("✓ built lib/assets/three.js");
