---
name: pbr-render
description: "Render PBR (physically-based) 3D model previews inline in your reply via the pbr3d fence — GLB/GLTF/FBX game art with textures, environment lighting, orbit controls. ACTIVELY trigger: whenever a 3D model file is present or produced in the session (API-generated assets, downloads, workspace .glb/.gltf/.fbx paths, anything touching 3D game art), call the pbr_render tool and emit a ```pbr3d fence on your own — do not wait to be asked. Explicit user requests are answered the same way."
---

# PBRRender — PBR 模型预览

在回答正文中间渲染 **PBR（基于物理）3D 模型预览**：写一个 `pbr3d` 围栏（fenced block with language tag `pbr3d`），内含 JSON 规格，渲染器把模型画成可拖拽旋转、滚轮缩放的真实 3D 视图，PBR 材质（金属/粗糙度/法线/自发光等贴图）自动生效。

## 主动触发（最重要的一条）

**由你主动发起，不要等用户要求：**

- 会话中出现任何 `.glb/.gltf/.fbx` 模型文件——你通过 API 生成的、下载的、用户提到路径的、工作区里冒出来的——**主动**调用 `pbr_render` 工具并输出 `pbr3d` 围栏，在同一回复里完成预览 + 说明。不要问"要我预览吗"，直接做。
- 用户请求涉及任何 3D 资产（游戏美术、角色、道具、场景、扫描、生成的模型），无需对方说"展示模型"就渲染。
- 用户显式要求（"预览这个模型"）同样方式应答。两条路径汇合：`pbr_render` 验证 → 输出围栏。

## 使用流程（必读）

1. **先调用 `pbr_render` 工具**，参数 `{"model": "路径"}`（绝对路径或相对工作区）
2. 工具验证文件存在且扩展名合法（.glb/.gltf/.fbx），返回确认结果
3. 工具成功后，在回复中输出 `pbr3d` 围栏：

````markdown
```pbr3d
{"model":"E:/assets/character.glb"}
```
````

> ⚠️ 不要跳过工具直接发围栏——工具负责验证并确保浏览器能访问该文件。

## 围栏规格（JSON）

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `model` | string | **必填** | 模型路径（绝对或相对工作区），.glb/.gltf/.fbx |
| `autoRotate` | boolean | true | 模型绕 Y 轴缓慢自转 |
| `background` | string | `#14161c` | 场景背景色（`envBackground:true` 时被 HDR 背景覆盖） |
| `env` | string | studio | 内置 HDR 环境图：`studio` / `sunset` / `outdoor` / `sunrise` / `night`（CC0, Poly Haven 1K） |
| `envBackground` | boolean | false | 同时把 HDR 环境图显示为场景背景 |
| `envIntensity` | number | 1.0 | 环境光照强度（HDR/IBL 亮度） |
| `exposure` | number | 1.0 | 曝光 0.2–3 |
| `wireframe` | boolean | false | 线框叠加 |
| `viewMode` | string | pbr | 初始材质视图（见下方模式列表） |
| `label` | string | — | 视图下方说明文字 |

### 材质视图模式（viewer 顶部模式栏可随时切换）

| 模式 | 显示内容 |
|---|---|
| `pbr` | 完整物理渲染（默认） |
| `basecolor` | 基础色贴图（albedo） |
| `normal` | 法线贴图 |
| `roughness` | 粗糙度贴图 |
| `metallic` | 金属度贴图 |
| `ao` | 环境光遮蔽 |
| `emissive` | 自发光贴图 |
| `wireframe` | 线框 |

模型加载后，viewer 顶部会出现一行模式按钮，点击即可切换查看各贴图通道；没有对应贴图的通道保持原样。

### 示例

````markdown
```pbr3d
{"model":"E:/generated/robot.glb","env":"sunset","envBackground":true,"exposure":1.2,"label":"黄昏下的机器人"}
```
````

## 能力边界

- **格式**：GLB（贴图内嵌）、GLTF（贴图为兄弟文件）与 FBX（二进制/ASCII v7，内嵌贴图）都支持
- **贴图**：baseColor/normal/roughness/metallic/AO/emissive 自动加载（GLB/FBX 内嵌或同目录）
- **交互**：拖拽旋转、滚轮缩放、自动旋转
- **光照**：内置 HDR 环境图（IBL，`env` 切换）+ ACES 色调映射，PBR 材质反光真实；HDR 加载失败自动回退 RoomEnvironment
- **限制**：单模型/围栏；文件大小上限 512 MiB；路径必须在工作区内（越权返回错误）；同一模型会话内不重复渲染（除非文件变了或用户再要求）
