/**
 * PBRRender three.js engine bundle: exports the three core plus the loaders
 * and controls PBR preview needs (GLTFLoader for glTF/GLB, FBXLoader for FBX,
 * OrbitControls for interaction, RoomEnvironment for IBL, RGBELoader for HDR
 * envs). esbuild bundles this IIFE; the client loads it lazily via the asset
 * route and reads `window.__PBRRenderAssets__`.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
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
