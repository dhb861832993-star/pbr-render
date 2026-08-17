import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, normalize, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * PBRRender host half: registers the `pbr_render` tool (validates a model
 * path, exposes a file-service route so the browser can fetch the model and
 * its textures) and the system-prompt section teaching the `pbr3d` fence.
 *
 * Security model: the browser cannot read the local disk, so the host serves
 * model files through an authenticated-by-loopback route. Only files under a
 * caller-supplied root (default: the session workspace) are ever served, and
 * paths are normalized + prefix-checked to prevent traversal. Binary
 * extensions (glb/bin/ktx2) and image textures pass through; everything else
 * is refused.
 * @module pbr-render
 */

const ASSET_ROUTE = "/plugins/pbr-render/assets";
const FILE_ROUTE = "/plugins/pbr-render/files";

const MODEL_EXTS = new Set([".glb", ".gltf", ".fbx", ".bin", ".ktx2", ".hdr"]);
const TEXTURE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".avif"]);
const MAX_FILE_BYTES = 512 * 1024 * 1024; // 512 MiB safety ceiling

const ASSET_FILE_RE = /^[a-zA-Z0-9._-]+$/;

/** The fence language section injected into every assembled system prompt. */
const PBR_SECTION_TEXT = `You can render PBR (physically-based) 3D model previews INSIDE your reply by emitting a fenced block with the language tag \`pbr3d\` containing a JSON spec. The preview is a real interactive 3D viewport: orbit by dragging, zoom by scrolling, PBR materials (metalness/roughness/normal/emissive textures) render automatically.

ACTIVE TRIGGERING — you initiate, never wait to be asked:
- Whenever a 3D model file (.glb/.gltf/.fbx) is present or produced in the session — you generated it via an API, downloaded it, the user mentioned a path, or one appeared in the workspace — you PREEMPTIVELY call \`pbr_render\` and emit a \`pbr3d\` fence as part of the same reply. Do not ask "want me to preview it?" — just do it, then summarize alongside.
- Whenever the user's request touches a 3D asset (game art, character, prop, scene, scan, generated model), render it without being asked to "show the model".
- The user may of course also ask explicitly ("预览这个模型", "show me the glb"); explicit requests are answered the same way. Both paths converge on: validate with \`pbr_render\`, then emit the fence.

\`\`\`pbr3d
{"model":"absolute-or-workspace-relative/path/to/model.glb"}
\`\`\`

Spec fields (all optional except \`model\`):
- model: required — path to a .glb/.gltf/.fbx file (absolute, or relative to the session workspace)
- autoRotate: boolean (default true) — slowly spin the model on its Y axis
- background: "#hex" — scene background color (default a dark studio tone)
- env: "studio"|"outdoor"|"neutral" (default "studio") — environment lighting preset
- exposure: number 0.2–3 (default 1.0) — tone-mapping exposure
- wireframe: boolean — overlay wireframe
- viewMode: "pbr"|"basecolor"|"normal"|"roughness"|"metallic"|"ao"|"emissive"|"wireframe" (default "pbr") — initial material view; the on-viewer mode bar lets the user switch at any time
- label: string — caption under the viewer

Rules:
- Call the \`pbr_render\` tool FIRST with the model path; it validates the file, may register a file-serving route, and confirms the path is servable. Only emit the fence after the tool succeeds.
- If the tool reports an error (missing file, unsupported extension), report it to the user; do not emit a fence.
- One model per fence. The model's own PBR textures (baseColor/normal/roughness/metallic/AO/emissive maps embedded in GLB, sibling files for GLTF, or embedded in FBX) render automatically.
- Do not render the same model twice in one conversation unless the file changed or the user asks again — deduplicate by path.`;

/**
 * Resolve a user-supplied model path against the allowed roots. Absolute
 * paths are used as-is; relative paths are tried under EVERY root and the
 * first existing match wins (so "pbr-render/test.glb" resolves inside
 * whichever workspace actually contains it). The result is normalized and
 * must stay within one of the roots.
 * @param raw - user-supplied path.
 * @param roots - allowed root directories (absolute, normalized).
 * @returns the normalized absolute path, or null when it escapes every root.
 */
function resolveModelPath(raw, roots) {
  const normalizedRoots = roots.map((r) => normalize(r));
  if (isAbsolute(raw)) {
    const normalized = normalize(raw);
    return withinAnyRoot(normalized, normalizedRoots) ? normalized : null;
  }
  for (const rootNorm of normalizedRoots) {
    const candidate = normalize(resolve(rootNorm, raw));
    if (existsSync(candidate) && withinAnyRoot(candidate, normalizedRoots)) {
      return candidate;
    }
  }
  // Fall back to the first root even when missing (so the caller reports a
  // clear "file not found" rather than a confusing escape error).
  return normalize(resolve(normalizedRoots[0] ?? "", raw));
}

/** Whether a normalized absolute path stays inside one of the roots. */
function withinAnyRoot(normalized, normalizedRoots) {
  for (const rootNorm of normalizedRoots) {
    if (normalized === rootNorm || normalized.startsWith(rootNorm + "\\") || normalized.startsWith(rootNorm + "/")) {
      return true;
    }
  }
  return false;
}

/** True when the extension is servable (model binary or texture image). */
function isServableExt(ext) {
  return MODEL_EXTS.has(ext) || TEXTURE_EXTS.has(ext);
}

/** Content-type for a file extension. */
function contentTypeFor(ext) {
  const table = {
    ".glb": "model/gltf-binary",
    ".gltf": "model/gltf+json",
    ".fbx": "application/octet-stream",
    ".bin": "application/octet-stream",
    ".ktx2": "image/ktx2",
    ".hdr": "image/vnd.radiance",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".avif": "image/avif"
  };
  return table[ext] ?? "application/octet-stream";
}

/**
 * Serve one local file through the loopback file route. The URL encodes an
 * absolute path produced by the pbr_render tool (already validated to exist
 * with a servable extension). The handler re-validates extension and size and
 * normalizes the path; it does not re-check workspace membership because the
 * tool is the sole URL minting authority and runs inside the session.
 */
function createFileHandler() {
  return async (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405);
      res.end();
      return;
    }
    let url;
    try {
      url = new URL(req.url ?? "/", "http://x");
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    const rel = url.pathname.startsWith(`${FILE_ROUTE}/`) ? url.pathname.slice(FILE_ROUTE.length + 1) : null;
    if (rel === null || rel === "") {
      res.writeHead(404);
      res.end();
      return;
    }
    let decoded;
    try {
      decoded = decodeURIComponent(rel);
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    // URL 里用正斜杠编码的路径（Windows 盘符 E:/...），解码后转为本地形式
    const target = normalize(decoded.replace(/\//g, "\\"));
    if (!existsSync(target)) {
      res.writeHead(404);
      res.end();
      return;
    }
    const ext = target.slice(target.lastIndexOf(".")).toLowerCase();
    if (!isServableExt(ext)) {
      res.writeHead(403);
      res.end();
      return;
    }
    let body;
    try {
      const stat = await import("node:fs/promises").then((m) => m.stat(target));
      if (stat.size > MAX_FILE_BYTES) {
        res.writeHead(413);
        res.end();
        return;
      }
      body = await readFile(target);
    } catch {
      res.writeHead(500);
      res.end();
      return;
    }
    res.writeHead(200, {
      "content-type": contentTypeFor(ext),
      "content-length": String(body.length),
      "cache-control": "no-cache",
      "access-control-allow-origin": "*"
    });
    res.end(req.method === "HEAD" ? undefined : body);
  };
}

/** Serve the bundled three.js asset (built from src/three-entry.js). */
function createAssetHandler() {
  return async (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405);
      res.end();
      return;
    }
    const pathname = new URL(req.url ?? "/", "http://x").pathname;
    const rel = pathname.startsWith(`${ASSET_ROUTE}/`) ? pathname.slice(ASSET_ROUTE.length + 1) : null;
    if (rel === null || !ASSET_FILE_RE.test(rel)) {
      res.writeHead(404);
      res.end();
      return;
    }
    try {
      const dir = fileURLToPath(new URL("./assets/", import.meta.url));
      const body = await readFile(join(dir, rel));
      res.writeHead(200, {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "no-cache"
      });
      res.end(req.method === "HEAD" ? undefined : body);
    } catch {
      res.writeHead(404);
      res.end();
      return;
    }
  };
}

/** The `pbr_render` tool: validate a model path, ensure it is servable. */
function createPbrRenderTool(rootProvider) {
  return {
    name: "pbr_render",
    description:
      "Prepare a 3D model file for PBR preview: validates the path, verifies the extension (.glb/.gltf/.fbx), and confirms the file is servable to the browser. Call this BEFORE emitting a ```pbr3d fence. Returns the confirmed absolute path and a servable URL the browser will fetch.",
    parameters: {
      type: "object",
      properties: {
        model: {
          type: "string",
          description: "Path to the model file. Absolute, or relative to the session workspace. Must end in .glb, .gltf or .fbx."
        }
      },
      required: ["model"],
      additionalProperties: false
    },
    output: {
      schema: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          path: { type: "string" },
          url: { type: "string" },
          error: { type: "string" }
        },
        required: ["ok"],
        additionalProperties: false
      },
      render(args, value) {
        return [
          {
            type: "text",
            text: value.ok
              ? `pbr_render: ✅ ${value.path} is ready — emit a \`\`\`pbr3d fence with {"model":"${value.path}"} to preview.`
              : `pbr_render: ❌ ${value.error ?? "cannot serve this file"}`
          }
        ];
      },
      presentationMeta(args, value) {
        return value;
      }
    },
    async execute(args, exec) {
      const model = typeof args?.model === "string" ? args.model.trim() : "";
      if (model === "") {
        return { ok: false, error: "model path is required" };
      }
      // Prefer the calling session's cwd (its workspace); fall back to global roots.
      const sessionCwd = exec?.agent?.session?.header?.cwd;
      const roots = sessionCwd ? [sessionCwd, ...rootProvider()] : rootProvider();
      const resolved = resolveModelPath(model, roots);
      if (resolved === null) {
        return { ok: false, error: `path escapes every allowed workspace root` };
      }
      if (!existsSync(resolved)) {
        return { ok: false, error: `file not found: ${model}` };
      }
      const ext = resolved.slice(resolved.lastIndexOf(".")).toLowerCase();
      if (ext !== ".glb" && ext !== ".gltf" && ext !== ".fbx") {
        return { ok: false, error: `unsupported model extension "${ext}" — use .glb, .gltf or .fbx` };
      }
      const url = `${FILE_ROUTE}/${encodeURIComponent(resolved.replace(/\\/g, "/"))}`;
      return { ok: true, path: resolved, url };
    }
  };
}

/** Plugin entry: register tool, asset route, file route, prompt section. */
const inject = ["systemPrompt"];

function apply(ctx) {
  /** All allowed roots: every registered workspace + env/cwd fallback, deduped. */
  const rootProvider = () => {
    const roots = [];
    const seen = new Set();
    const add = (path) => {
      if (typeof path !== "string" || path === "") return;
      const norm = normalize(path);
      if (!seen.has(norm)) {
        seen.add(norm);
        roots.push(norm);
      }
    };
    try {
      const registry = ctx.workspaceRegistry ?? ctx.reflect.get("workspaceRegistry", false);
      const workspaces = registry?.list?.() ?? [];
      for (const ws of workspaces) add(ws.path);
    } catch {
      /* fall through */
    }
    add(process.env.DSH_WORKSPACE);
    add(process.cwd());
    return roots.length > 0 ? roots : [process.cwd()];
  };

  ctx.systemPrompt.section({
    name: "pbr-render:fence",
    order: 110,
    text: PBR_SECTION_TEXT
  });

  let registered = false;
  const tryRegister = (value) => {
    if (registered) return;
    const tools = value ?? ctx.reflect.get("tools", false);
    if (tools === void 0) return;
    tools.register(createPbrRenderTool(rootProvider));
    registered = true;
  };
  tryRegister(void 0);
  ctx.on("internal/service", (name, value) => {
    if (name === "tools") tryRegister(value);
  });

  let fileRegistered = false;
  const tryRegisterFiles = (value) => {
    if (fileRegistered) return;
    const webServer = value ?? ctx.reflect.get("webServer", false);
    if (webServer === void 0) return;
    webServer.register({
      kind: "prefix",
      path: FILE_ROUTE,
      handler: createFileHandler()
    });
    webServer.register({
      kind: "prefix",
      path: ASSET_ROUTE,
      handler: createAssetHandler()
    });
    fileRegistered = true;
  };
  tryRegisterFiles(void 0);
  ctx.on("internal/service", (name, value) => {
    if (name === "webServer") tryRegisterFiles(value);
  });
}

export { apply, inject };
