/**
 * PBRRender three.js engine bundle: exports the three core plus the loaders
 * and controls PBR preview needs (GLTFLoader for glTF/GLB, FBXLoader for FBX,
 * OrbitControls for interaction, RoomEnvironment for IBL, RGBELoader for HDR
 * envs). esbuild bundles this IIFE; the client loads it lazily via the asset
 * route and reads `window.__PBRRenderAssets__`.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
// 定制版 FBXLoader：自动升级 Phong/Lambert → Standard 并挂载未连接的 ORM 纹理
// （AO/Roughness/Metallic 合并图），使粗糙度/金属度/AO 通道与 PBR 渲染可用。
import { FBXLoader } from "./vendor/FBXLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";

window.__PBRRenderAssets__ = {
  THREE,
  GLTFLoader,
  FBXLoader,
  OrbitControls,
  RoomEnvironment,
  RGBELoader
};
