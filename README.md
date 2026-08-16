# PBRRender 🎨

**PBR（基于物理）3D 模型预览插件 for DeepSeek Harness** —— 渲染 GLB/GLTF 游戏美术资源，带贴图纹理、环境光照、轨道控制、材质通道检查，直接在模型回答里交互预览。

> 🔌 生态：仓库已挂 `#dsh` · `#dsh-plugin` · `#pbr` · `#gltf` topic，欢迎社区收录。

## ✨ 特性

- **PBR 渲染**：金属/粗糙度/法线/自发光/AO 贴图自动加载（GLB 内嵌或 GLTF 兄弟文件）
- **材质通道检查**：viewer 顶部模式栏一键切换 —— PBR / 基础色 / 法线 / 粗糙度 / 金属度 / AO / 自发光 / 线框（标量通道以**灰度**显示，符合 PBR 规范）
- **环境光照**：RoomEnvironment IBL + ACES 色调映射，材质反光真实
- **交互**：拖拽旋转、滚轮缩放、自动旋转、曝光调节
- **主动触发**：模型发现 3D 模型文件（API 生成/下载/工作区出现）时自动调用 `pbr_render` 工具并渲染预览，无需用户提示
- **安全**：文件服务工作区限定 + 扩展名白名单 + 512 MiB 上限

## 安装

```sh
# GitHub 仓库安装
dsh plugin --profile web add github:你的用户名/pbr-render

# 或本地开发
pnpm install
node scripts/build.mjs
dsh plugin --profile web add link:/path/to/pbr-render
```

重启 dsh web，新会话生效。

## 使用

插件自动注入系统提示教学。模型在合适场景主动调用 `pbr_render` 工具验证路径，然后输出 `pbr3d` 围栏：

````markdown
```pbr3d
{"model":"E:/generated/robot.glb","autoRotate":true,"label":"API 生成的机器人"}
```
````

### 围栏规格

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `model` | string | **必填** | 模型路径（绝对或相对工作区），.glb/.gltf |
| `autoRotate` | boolean | true | 自动旋转 |
| `background` | string | `#14161c` | 场景背景色 |
| `env` | string | studio | 环境光预设 |
| `exposure` | number | 1.0 | 曝光 0.2–3 |
| `viewMode` | string | pbr | 初始材质视图 |
| `label` | string | — | 视图说明文字 |

### 材质通道模式

| 模式 | 显示 |
|---|---|
| `pbr` | 完整物理渲染 |
| `basecolor` / `normal` / `emissive` | 彩色贴图通道 |
| `roughness` / `metallic` / `ao` | 标量通道灰度显示（R/G/R 通道提取） |
| `wireframe` | 线框 |

## 架构

- `lib/index.js` — host 半边：`pbr_render` 工具 + 文件服务路由 + 系统提示段
- `lib/client.js` — 浏览器半边：DOM 观察 `pbr3d` 围栏 → 按需加载 three 资产 → PBR 渲染
- `src/three-entry.js` + `scripts/build.mjs` — three.js 引擎打包（esbuild）
- `test-model.glb` / `test-tex.glb` — 演示模型（单色 + 全套贴图）

## 安全

- 文件服务仅暴露工作区内的路径（防目录穿越）
- 仅放行模型/纹理扩展名（.glb/.gltf/.bin/.ktx2/.hdr/.png/.jpg/.webp/.avif）
- 文件上限 512 MiB

## License

MIT
