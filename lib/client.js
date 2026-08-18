/**
 * PBRRender client half (browser): detects ```pbr3d fences in the session
 * DOM, loads the bundled three.js engine asset on demand, and renders a PBR
 * (physically-based) model preview — GLTF/GLB with embedded or sibling
 * textures, environment lighting, orbit controls, auto-rotate.
 *
 * Registration protocol: window.__ModuleLoader__.load({id, factory}). The
 * factory materializes lazily (on first import by the client cordis Loader)
 * and returns { apply, inject }. apply(ctx) starts the DOM watcher.
 *
 * Multi-surface fence discovery mirrors dsh-genui: it matches standard
 * `md-code-block` surfaces, deepsuite-style `.code-block` / `.code-block-small`
 * surfaces, and a generic label+`<pre>` fallback — any element whose text
 * opens with the `pbr3d` language tag.
 */

window.__ModuleLoader__.load({
  id: "pbr-render",
  factory: (require) => {
    "use strict";

    const ASSET_BASE = "/plugins/pbr-render/assets";
    const FILE_BASE = "/plugins/pbr-render/files";
    const ASSET_REV = "v3";
    const LANG = "pbr3d";

    /**
     * Built-in HDR environment presets (CC0, Poly Haven 1K). The host serves
     * them under the asset route; the client loads the .hdr via RGBELoader and
     * converts it with PMREMGenerator for PBR IBL. `spec.env` selects one;
     * unknown/missing falls back to the procedural RoomEnvironment.
     */
    const ENV_PRESETS = {
      studio: "env/studio.hdr",
      sunset: "env/sunset.hdr",
      outdoor: "env/outdoor.hdr",
      sunrise: "env/sunrise.hdr",
      night: "env/night.hdr"
    };

    /** Lazy script loader keyed by URL; resolves to window.__PBRRenderAssets__. */
    const scriptCache = new Map();
    function loadThree() {
      const url = `${ASSET_BASE}/three.js?rev=${ASSET_REV}`;
      const cached = scriptCache.get(url);
      if (cached) return cached;
      const promise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = url;
        script.async = true;
        script.onload = () => {
          const api = window.__PBRRenderAssets__;
          if (!api || !api.THREE) {
            reject(new Error("pbr-render: three.js asset loaded but registered no engine"));
            return;
          }
          resolve(api);
        };
        script.onerror = () => reject(new Error("pbr-render: three.js asset failed to load (host asset route missing?)"));
        document.head.appendChild(script);
      });
      scriptCache.set(url, promise);
      return promise;
    }

    /** Encode an absolute model path into a servable URL under the file route. */
    function modelUrlFor(raw) {
      if (raw.startsWith("/") && raw.includes("/files/")) return raw;
      const enc = raw.split("/").map((seg) => encodeURIComponent(seg)).join("/");
      return `${FILE_BASE}/${enc}`;
    }

    /**
     * Given a detected code block element (the md-code-block container or a
     * bare pre), insert the viewer container after it and hide the source.
     */
    function mountTarget(block) {
      const container = document.createElement("div");
      container.className = "pbr-render-viewer";
      container.style.cssText =
        "position:relative;width:100%;min-height:240px;margin:8px 0;border-radius:10px;overflow:hidden;background:#14161c;";
      block.after(container);
      return container;
    }

    /** Hides the original block so the viewer stands alone. */
    function hideSource(el) {
      el.style.display = "none";
    }

    /**
     * Compute the renderer size from the container (falls back gracefully).
     * In normal chat flow the width is capped at 960px so a wide viewport
     * does not stretch the preview; when the viewer is fullscreen (native
     * Fullscreen API or the fixed-overlay fallback) the cap is lifted and the
     * renderer fills the actual viewport.
     */
    function sizeOf(container) {
      const fullscreen =
        document.fullscreenElement === container ||
        document.webkitFullscreenElement === container ||
        container.dataset?.dshFsFallback === "1";
      if (fullscreen) {
        const width = Math.max(280, container.clientWidth || window.innerWidth || 480);
        const height = Math.max(240, container.clientHeight || window.innerHeight || Math.round(width * 0.58));
        return { width, height };
      }
      const width = Math.max(280, Math.min(960, container.clientWidth || 480));
      const height = Math.max(240, Math.round(width * 0.58));
      return { width, height };
    }

    /** Fit the camera to the model's bounding box. */
    function frameScene(THREE, camera, controls, scene) {
      const box = new THREE.Box3().setFromObject(scene);
      if (box.isEmpty()) return;
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z, 0.001);
      const dist = maxDim * 2.6;
      camera.position.set(center.x + dist * 0.7, center.y + dist * 0.55, center.z + dist);
      camera.near = Math.max(0.001, maxDim / 1000);
      camera.far = maxDim * 50;
      camera.updateProjectionMatrix();
      controls.target.copy(center);
      controls.update();
    }

    /**
     * Build one PBR viewer for a parsed spec. Includes a mode bar letting the
     * user switch between PBR shading, individual texture channels
     * (baseColor/normal/roughness/metallic/AO/emissive), and wireframe.
     */
    async function buildViewer(container, spec) {
      const { THREE, GLTFLoader, FBXLoader, OrbitControls, RoomEnvironment, RGBELoader } = await loadThree();
      const { width, height } = sizeOf(container);

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = typeof spec.exposure === "number" ? spec.exposure : 1.0;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.domElement.style.cssText = "display:block;width:100%;height:100%;cursor:grab;";
      renderer.domElement.addEventListener("mousedown", () => (renderer.domElement.style.cursor = "grabbing"));
      renderer.domElement.addEventListener("mouseup", () => (renderer.domElement.style.cursor = "grab"));
      container.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(spec.background || "#14161c");

      const camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 1000);
      camera.position.set(2.5, 1.8, 3);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.autoRotate = spec.autoRotate !== false;
      controls.autoRotateSpeed = 2.2;
      controls.minDistance = 0.05;

      // Environment lighting: built-in HDR maps (spec.env) drive PBR IBL and
      // (optionally) the scene background. `setEnv` can swap environments at
      // runtime from the viewer's env bar. Falls back to the procedural
      // RoomEnvironment when env is unset/unknown or an HDR fails to load.
      // NOTE: PMREMGenerator is kept alive for the viewer's lifetime so it can
      // re-convert new equirectangular HDRs on every env switch; it is
      // disposed in cleanup, together with the current env maps.
      const pmrem = new THREE.PMREMGenerator(renderer);
      const backgroundBase = new THREE.Color(spec.background || "#14161c");
      scene.background = backgroundBase;

      /** @type {THREE.Texture|null} current IBL env map */
      let envMap = null;
      /** @type {THREE.Texture|null} current HDR used as background (owned here) */
      let envBackgroundTex = null;
      /** monotonically increasing token to drop stale async env loads */
      let envToken = 0;
      /** the env id currently shown in the bar ("room" = procedural) */
      let currentEnv = null;

      /**
       * Apply an environment preset. `envId` is one of ENV_PRESETS keys, or
       * "room" for the procedural RoomEnvironment. Loads the HDR (cached per
       * viewer), converts it with PMREM, swaps scene.environment and, when
       * spec.envBackground is on, the scene background too.
       */
      const hdrCache = new Map();
      const hdrPending = new Map();
      async function loadEnvTexture(envId) {
        const key = ENV_PRESETS[envId];
        if (!key) return null;
        const cached = hdrCache.get(key);
        if (cached) return cached;
        if (hdrPending.has(key)) return hdrPending.get(key);
        const promise = new RGBELoader().loadAsync(`${ASSET_BASE}/${key}?rev=${ASSET_REV}`);
        hdrPending.set(key, promise);
        try {
          const tex = await promise;
          hdrCache.set(key, tex);
          return tex;
        } finally {
          hdrPending.delete(key);
        }
      }

      async function setEnv(envId) {
        const token = ++envToken;
        // Free the previous environment.
        if (envMap) {
          envMap.dispose();
          envMap = null;
        }
        if (envBackgroundTex) {
          envBackgroundTex.dispose();
          envBackgroundTex = null;
        }
        scene.environment = null;
        scene.background = backgroundBase;

        if (envId === "room" || !ENV_PRESETS[envId]) {
          envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
          scene.environment = envMap;
          currentEnv = envId === "room" ? "room" : null;
        } else {
          try {
            const hdr = await loadEnvTexture(envId);
            if (token !== envToken) {
              // A newer setEnv call superseded this one — drop the map.
              hdr.dispose();
              return;
            }
            envMap = pmrem.fromEquirectangular(hdr).texture;
            scene.environment = envMap;
            if (spec.envBackground) {
              hdr.mapping = THREE.EquirectangularReflectionMapping;
              scene.background = hdr;
              envBackgroundTex = hdr; // owned by the viewer now; do NOT dispose
            } else {
              hdr.dispose(); // IBL only — the PMREM copy is what we keep
            }
            currentEnv = envId;
          } catch (error) {
            if (token !== envToken) return;
            console.warn(
              `pbr-render: env "${envId}" failed to load (${error?.message ?? error}), falling back to RoomEnvironment`
            );
            envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
            scene.environment = envMap;
            currentEnv = "room";
          }
        }
        scene.environmentIntensity = typeof spec.envIntensity === "number" ? spec.envIntensity : 1.0;
        // Sync the env bar highlight.
        for (const [id, b] of envButtons) {
          b.style.background = id === currentEnv ? "rgba(99,142,255,0.35)" : "transparent";
          b.style.color = id === currentEnv ? "#fff" : "#c9ced8";
        }
      }

      // Ground grid: subtle, helps judge scale/orientation.
      const gridHelper = new THREE.GridHelper(10, 20, 0x3a3f4b, 0x23262e);
      gridHelper.position.y = -0.001;
      scene.add(gridHelper);

      // Load the model: GLB/GLTF via GLTFLoader (embedded textures, or
      // sibling files via the file route); FBX via FBXLoader (binary or
      // ASCII v7, embedded textures decoded by fflate).
      const url = modelUrlFor(spec.model);
      const isFbx = /\.fbx$/i.test(spec.model);
      let root;
      try {
        if (isFbx) {
          const fbx = await new FBXLoader().loadAsync(url);
          root = fbx;
          scene.add(root);
        } else {
          const gltf = await new GLTFLoader().loadAsync(url);
          root = gltf.scene;
          scene.add(root);
        }
      } catch (error) {
        container.innerHTML =
          `<div style="padding:16px;color:#f87171;font:12px/1.6 system-ui,monospace;">` +
          `⚠️ pbr3d 模型加载失败：${String(error?.message ?? error)}<br>模型：${spec.model}</div>`;
        // Release the environment resources we may have started.
        pmrem.dispose();
        if (envMap) envMap.dispose();
        if (envBackgroundTex) envBackgroundTex.dispose();
        for (const tex of hdrCache.values()) tex.dispose();
        hdrCache.clear();
        return;
      }

      // ---- PBR material normalization ----
      // Generated FBX files (e.g. tripo3d) often ship Phong/Lambert materials
      // with only base-color + normal maps and no roughness/metalness data
      // (and the bundled FBXLoader skips its Phong→Standard upgrade when no
      // ORM texture exists). Upgrade them here so every surface renders PBR
      // with a sensible default (slight sheen, non-metal) while keeping the
      // loaded maps; materials that already carry PBR maps keep their values.
      root.traverse((obj) => {
        if (!obj.isMesh || !obj.material) return;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        let changed = false;
        for (let i = 0; i < mats.length; i++) {
          const m = mats[i];
          if (!m || typeof m.isMaterial !== "boolean") continue;
          if (m.isMeshPhongMaterial || m.isMeshLambertMaterial) {
            const std = new THREE.MeshStandardMaterial();
            std.name = m.name;
            std.color.copy(m.color);
            std.map = m.map;
            std.normalMap = m.normalMap;
            if (m.normalScale) std.normalScale.copy(m.normalScale);
            std.emissive.copy(m.emissive ?? new THREE.Color());
            std.emissiveMap = m.emissiveMap;
            if (typeof m.emissiveIntensity === "number") std.emissiveIntensity = m.emissiveIntensity;
            std.transparent = !!m.transparent;
            std.opacity = typeof m.opacity === "number" ? m.opacity : 1;
            std.alphaMap = m.alphaMap;
            std.side = m.side ?? THREE.FrontSide;
            // No roughness/metalness data in the source — pick a neutral sheen.
            std.roughness = 0.6;
            std.metalness = 0;
            m.dispose?.();
            mats[i] = std;
            changed = true;
          } else if (
            (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial) &&
            !m.roughnessMap &&
            !m.metalnessMap &&
            !m.aoMap
          ) {
            // Standard material without any PBR maps: snap extreme defaults
            // back to a neutral, visually pleasing range.
            if (m.roughness === 1) m.roughness = 0.6;
            if (m.metalness === 1) m.metalness = 0;
            m.needsUpdate = true;
          }
        }
        if (changed) {
          if (Array.isArray(obj.material)) obj.material = mats;
          else obj.material = mats[0];
        }
      });

      frameScene(THREE, camera, controls, root);

      // ---- material mode switching ----
      // Collect every mesh and its ORIGINAL materials once; modes swap
      // material slot → map or wireframe, and pbr restores the originals.
      /** @type {{mesh:any, originals:any[]}[]} */
      const meshes = [];
      root.traverse((obj) => {
        if (obj.isMesh && obj.material) {
          const originals = Array.isArray(obj.material) ? obj.material.slice() : [obj.material];
          meshes.push({ mesh: obj, originals });
        }
      });

      /** Mode definitions. `channel` selects the texture component to show
       *  as grayscale (1=R, 2=G, 4=B, 7=RGB full color); null = special mode.
       *  Scalar channels follow the glTF ORM convention for merged maps:
       *  R=AO, G=Roughness, B=Metallic (a standalone grayscale map shows the
       *  same value on every channel, so this is safe for both layouts). */
      const MODES = [
        { id: "pbr", label: "PBR", slot: null, channel: 0 },
        { id: "basecolor", label: "基础色", slot: "map", channel: 7 },
        { id: "normal", label: "法线", slot: "normalMap", channel: 7 },
        { id: "roughness", label: "粗糙度", slot: "roughnessMap", channel: 2 },
        { id: "metallic", label: "金属度", slot: "metalnessMap", channel: 4 },
        { id: "ao", label: "AO", slot: "aoMap", channel: 1 },
        { id: "emissive", label: "自发光", slot: "emissiveMap", channel: 7 },
        { id: "wireframe", label: "线框", slot: null, channel: 0 }
      ];

      /**
       * Build a flat shader that samples ONE channel of a texture as
       * grayscale (scalar data like roughness/metallic/AO), or full RGB for
       * color data (baseColor/normal/emissive). Keeps the source material
       * untouched; the created material is swapped back on pbr restore.
       */
      const channelViewMaterial = (tex, channel) => {
        if (channel === 7) {
          return new THREE.MeshBasicMaterial({ map: tex, wireframe: false });
        }
        // channel 1=R, 2=G, 4=B; fall back to R when unknown.
        const comp = channel === 2 ? "g" : channel === 4 ? "b" : "r";
        return new THREE.ShaderMaterial({
          uniforms: { tMap: { value: tex } },
          vertexShader: `
            varying vec2 vUv;
            void main() {
              vUv = uv;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }`,
          fragmentShader: `
            uniform sampler2D tMap;
            varying vec2 vUv;
            void main() {
              vec4 c = texture2D(tMap, vUv);
              float v = c.${comp};
              gl_FragColor = vec4(vec3(v), 1.0);
            }`,
          wireframe: false
        });
      };

      /** Apply one mode across every mesh (mutates materials in place). */
      const applyMode = (modeId) => {
        for (const { mesh, originals } of meshes) {
          const targets = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          if (modeId === "pbr") {
            // Restore original materials (by reference).
            mesh.material = originals.length === 1 ? originals[0] : originals.slice();
            continue;
          }
          const mode = MODES.find((m) => m.id === modeId);
          if (modeId === "wireframe") {
            for (let i = 0; i < targets.length; i++) {
              const base = originals[i] ?? originals[0];
              if (!base) continue;
              // Clone the original so wireframe never mutates the pristine
              // material (pbr restore stays clean).
              const wf = base.clone();
              wf.wireframe = true;
              targets[i] = wf;
            }
            mesh.material = targets.length === 1 ? targets[0] : targets;
            continue;
          }
          // Channel view: swap the slot's texture into a flat material that
          // shows the target channel (grayscale for scalar data, RGB for color).
          for (let i = 0; i < targets.length; i++) {
            const base = originals[i] ?? originals[0];
            if (!base) continue;
            const tex = base[mode.slot];
            if (targets[i] !== base) {
              targets[i].dispose?.();
              targets[i] = base;
            }
            if (!tex) continue; // no texture for this channel — keep original
            targets[i] = channelViewMaterial(tex, mode.channel);
          }
          mesh.material = targets.length === 1 ? targets[0] : targets;
        }
      };

      // Initial mode (spec.viewMode overrides the default pbr; wireframe flag maps to wireframe).
      let currentMode = spec.wireframe === true ? "wireframe" : "pbr";
      if (spec.viewMode && MODES.some((m) => m.id === spec.viewMode)) {
        currentMode = spec.viewMode;
      }
      applyMode(currentMode);

      // ---- mode bar (overlay) ----
      const bar = document.createElement("div");
      bar.className = "pbr-render-modes";
      bar.style.cssText =
        "position:absolute;top:8px;left:50%;transform:translateX(-50%);display:flex;gap:4px;" +
        "flex-wrap:wrap;justify-content:center;max-width:96%;z-index:5;" +
        "background:rgba(10,12,16,0.72);border:1px solid rgba(255,255,255,0.10);" +
        "border-radius:9px;padding:4px 6px;backdrop-filter:blur(4px);";
      const buttons = new Map();
      for (const mode of MODES) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = mode.label;
        btn.dataset.mode = mode.id;
        btn.style.cssText =
          "border:0;border-radius:6px;padding:3px 10px;font:11px/1.4 system-ui,sans-serif;" +
          "cursor:pointer;color:#c9ced8;background:transparent;";
        btn.addEventListener("click", () => {
          currentMode = mode.id;
          applyMode(currentMode);
          for (const [id, b] of buttons) {
            b.style.background = id === currentMode ? "rgba(99,142,255,0.35)" : "transparent";
            b.style.color = id === currentMode ? "#fff" : "#c9ced8";
          }
        });
        buttons.set(mode.id, btn);
        bar.appendChild(btn);
      }
      // Highlight the active mode.
      const activeBtn = buttons.get(currentMode);
      if (activeBtn) {
        activeBtn.style.background = "rgba(99,142,255,0.35)";
        activeBtn.style.color = "#fff";
      }
      container.appendChild(bar);

      // ---- env bar (overlay): switch between built-in HDR environments ----
      const envBar = document.createElement("div");
      envBar.className = "pbr-render-envs";
      envBar.style.cssText =
        "position:absolute;top:44px;left:50%;transform:translateX(-50%);display:flex;gap:4px;" +
        "flex-wrap:wrap;justify-content:center;align-items:center;max-width:96%;z-index:5;" +
        "background:rgba(10,12,16,0.72);border:1px solid rgba(255,255,255,0.10);" +
        "border-radius:9px;padding:4px 6px;backdrop-filter:blur(4px);";
      const envLabel = document.createElement("span");
      envLabel.textContent = "环境";
      envLabel.style.cssText = "font:11px/1.4 system-ui,sans-serif;color:#8b93a3;padding:0 4px;";
      envBar.appendChild(envLabel);
      const envButtons = new Map();
      const ENV_OPTIONS = [
        { id: "room", label: "默认" },
        { id: "studio", label: "棚拍" },
        { id: "sunset", label: "黄昏" },
        { id: "outdoor", label: "户外" },
        { id: "sunrise", label: "日出" },
        { id: "night", label: "夜景" }
      ];
      for (const option of ENV_OPTIONS) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = option.label;
        btn.dataset.env = option.id;
        btn.style.cssText =
          "border:0;border-radius:6px;padding:3px 10px;font:11px/1.4 system-ui,sans-serif;" +
          "cursor:pointer;color:#c9ced8;background:transparent;";
        btn.addEventListener("click", () => {
          setEnv(option.id).catch((error) =>
            console.warn(`pbr-render: env switch to "${option.id}" failed: ${error?.message ?? error}`)
          );
        });
        envButtons.set(option.id, btn);
        envBar.appendChild(btn);
      }
      container.appendChild(envBar);

      // ---- fullscreen toggle (top-right) ----
      // Browser Fullscreen API with a fixed-overlay fallback (iOS Safari
      // lacks requestFullscreen on arbitrary elements). On entering
      // fullscreen the container fills the viewport, which changes its size —
      // the existing onResize hook (window resize) re-fits the renderer, and
      // we additionally re-sync on fullscreenchange for browsers that do not
      // emit a resize event (Safari).
      const fsBtn = document.createElement("button");
      fsBtn.type = "button";
      fsBtn.textContent = "⛶";
      fsBtn.title = "全屏 / 退出全屏";
      fsBtn.style.cssText =
        "position:absolute;top:8px;right:8px;z-index:6;border:0;border-radius:6px;" +
        "padding:2px 9px;font:13px/1.4 system-ui,sans-serif;cursor:pointer;" +
        "color:#c9ced8;background:rgba(10,12,16,0.72);border:1px solid rgba(255,255,255,0.10);";
      let fsFallback = false;
      const isFsActive = () =>
        document.fullscreenElement === container ||
        document.webkitFullscreenElement === container ||
        (fsFallback && container.dataset.dshFsFallback === "1");
      const resizeAfterFs = () => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => onResize());
        });
      };
      const toggleFullscreen = () => {
        if (isFsActive()) {
          if (fsFallback) {
            fsFallback = false;
            delete container.dataset.dshFsFallback;
            container.style.position = "";
            container.style.width = "";
            container.style.height = "";
            container.style.minHeight = "";
            container.style.zIndex = "";
            container.style.inset = "";
            document.body.style.overflow = "";
          } else {
            (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
          }
          resizeAfterFs();
          return;
        }
        const req = container.requestFullscreen || container.webkitRequestFullscreen;
        if (req) {
          try {
            req.call(container);
            return;
          } catch (error) {
            console.warn("pbr-render: requestFullscreen failed, using overlay fallback", error);
          }
        }
        // Fallback: fixed overlay covering the viewport.
        fsFallback = true;
        container.dataset.dshFsFallback = "1";
        container.style.position = "fixed";
        container.style.inset = "0";
        container.style.width = "100vw";
        container.style.height = "100vh";
        container.style.minHeight = "100vh";
        container.style.zIndex = "2147483000";
        document.body.style.overflow = "hidden";
        resizeAfterFs();
      };
      fsBtn.addEventListener("click", toggleFullscreen);
      container.appendChild(fsBtn);
      const onFsChange = () => {
        if (!isFsActive()) {
          // exited native fullscreen — restore anything the browser did not
          fsFallback = false;
          delete container.dataset.dshFsFallback;
        }
        resizeAfterFs();
      };
      document.addEventListener("fullscreenchange", onFsChange);
      document.addEventListener("webkitfullscreenchange", onFsChange);
      const fsCleanup = () => {
        document.removeEventListener("fullscreenchange", onFsChange);
        document.removeEventListener("webkitfullscreenchange", onFsChange);
      };

      // Kick off the initial environment (spec.env preset or the procedural default).
      setEnv(ENV_PRESETS[spec.env] ? spec.env : "room").catch((error) =>
        console.warn(`pbr-render: initial env failed: ${error?.message ?? error}`)
      );

      const animate = () => {
        controls.update();
        renderer.render(scene, camera);
      };
      renderer.setAnimationLoop(animate);

      // Resize handling.
      const onResize = () => {
        const s = sizeOf(container);
        renderer.setSize(s.width, s.height);
        camera.aspect = s.width / s.height;
        camera.updateProjectionMatrix();
      };
      window.addEventListener("resize", onResize);

      // Label caption.
      if (spec.label) {
        const caption = document.createElement("div");
        caption.textContent = spec.label;
        caption.style.cssText =
          "position:absolute;left:10px;bottom:8px;padding:3px 10px;border-radius:6px;background:rgba(0,0,0,0.55);" +
          "color:#d7dae0;font:11px/1.5 system-ui,sans-serif;pointer-events:none;";
        container.appendChild(caption);
      }

      const cleanup = () => {
        window.removeEventListener("resize", onResize);
        if (typeof fsCleanup === "function") fsCleanup();
        renderer.setAnimationLoop(null);
        controls.dispose();
        renderer.dispose();
        pmrem.dispose();
        if (envMap) envMap.dispose();
        if (envBackgroundTex) envBackgroundTex.dispose();
        for (const tex of hdrCache.values()) tex.dispose();
        hdrCache.clear();
      };
      container._pbrCleanup = cleanup;
    }

    // ---- DOM watcher ----
    // The host renders a fenced block as:
    //   <div class="md-code-block"> <div class=bannerWrap><div class=banner>
    //     <div class=infostring>LANG</div> ... </div></div> BODY </div>
    // where BODY is either <pre><code>…</code></pre> (plain, includes the
    // ```pbr3d opener) or a highlighted <div> (banner carries the language).
    // We therefore detect by the container's full text (banner + body), which
    // always contains the language tag AND the JSON spec regardless of shape.

    /** @type {Map<Element, {lastRaw:string}>} handled blocks. */
    const handled = new Map();

    /** Full text of a code block container (banner lang + body). */
    function blockText(block) {
      return (block.textContent ?? "").trim();
    }

    /**
     * Whether a block is a pbr3d fence. Two shapes are recognized:
     * 1) pre-mode: full text opens with the ```pbr3d fence marker;
     * 2) banner-mode: the block contains a <pre> whose text parses as a JSON
     *    spec carrying a `model` string (the host renders the language tag in
     *    an obfuscated banner class, so we key off the JSON body instead).
     */
    function isPbrBlock(block) {
      if (/^```pbr3d/i.test(blockText(block))) return true;
      return specOfBlock(block) !== null;
    }

    /**
     * Extract the JSON spec from a block. Two shapes:
     * 1) banner-mode (.md-code-block): the JSON lives in the body below the
     *    banner — find the deepest <pre> or the container after .infostring.
     * 2) pre-mode: the whole text is ```pbr3d + JSON.
     */
    function specOfBlock(block) {
      // banner-mode: try the <pre> inside first (its text is pure JSON).
      const pre = block.querySelector("pre");
      if (pre) {
        const preText = (pre.textContent ?? "").trim();
        const parsed = tryParseSpec(preText);
        if (parsed !== null) return parsed;
      }
      // fall back to the full container text (pre-mode or concatenated banner+body).
      const text = blockText(block);
      const stripped = text.replace(/^```pbr3d\s*/i, "").replace(/\s*```\s*$/, "").trim();
      return tryParseSpec(stripped);
    }

    /** JSON.parse a candidate spec body, returning the object or null. */
    function tryParseSpec(body) {
      if (typeof body !== "string" || body.trim() === "") return null;
      try {
        const value = JSON.parse(body.trim());
        return value && typeof value === "object" && typeof value.model === "string" && value.model !== ""
          ? value
          : null;
      } catch {
        return null;
      }
    }

    function scan() {
      for (const [el, state] of handled) {
        if (!el.isConnected) {
          if (el._pbrCleanup) el._pbrCleanup();
          handled.delete(el);
        }
      }

      // Host surfaces: .md-code-block (standard), .code-block/.code-block-small
      // (deepsuite style), plus a bare <pre> fallback.
      const candidates = document.querySelectorAll(
        ".md-code-block, .code-block, .code-block-small, pre"
      );
      for (const block of candidates) {
        if (!isPbrBlock(block)) continue;
        if (handled.has(block)) continue;

        const raw = blockText(block);
        const spec = specOfBlock(block);
        if (spec === null || typeof spec.model !== "string" || spec.model === "") continue;

        // Skip while the block is still streaming (incomplete JSON).
        const streaming = block.closest("[data-streaming]") !== null;
        if (streaming) continue;

        handled.set(block, { lastRaw: raw });
        const container = mountTarget(block);
        hideSource(block);
        buildViewer(container, spec).catch((error) => {
          container.innerHTML =
            `<div style="padding:16px;color:#f87171;font:12px/1.6 system-ui,monospace;">` +
            `⚠️ pbr3d 渲染失败：${String(error?.message ?? error)}</div>`;
        });
      }
    }

    let scheduled = false;
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        scan();
      });
    };

    let observer = null;
    let interval = null;

    const apply = () => {
      if (observer) return;
      observer = new MutationObserver(() => schedule());
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
      });
      interval = window.setInterval(scan, 1500);
      scan();
    };
    const dispose = () => {
      if (observer) observer.disconnect();
      if (interval !== null) window.clearInterval(interval);
      observer = null;
      interval = null;
      for (const [el] of handled) {
        if (el._pbrCleanup) el._pbrCleanup();
      }
      handled.clear();
    };

    return {
      apply,
      inject: ["sessions"],
      dispose,
      renderFence: buildViewer
    };
  }
});
