import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface LoadedModel {
  group: THREE.Group;
  animations: THREE.AnimationClip[];
}

// 全渲染层共用一个 loader 实例，避免重复创建
const loader = new GLTFLoader();

// 加载 glTF/glb，支持 http URL 与 data URI；失败统一转成可读错误，供调用方降级
export function loadModel(url: string): Promise<LoadedModel> {
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => resolve({ group: gltf.scene, animations: gltf.animations }),
      undefined,
      (err) => {
        const detail = err instanceof Error ? err.message : '未知错误';
        reject(new Error(`模型加载失败 ${url}：${detail}`));
      },
    );
  });
}

// 深拷贝已加载模型，使同一资产可被多个实例复用且互不影响
export function cloneModel(model: LoadedModel): LoadedModel {
  return {
    group: model.group.clone(true),
    animations: model.animations.map((clip) => clip.clone()),
  };
}
