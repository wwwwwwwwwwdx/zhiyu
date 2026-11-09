import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

// 用程序化几何体拼一条最小"鱼"，导出为 glTF data URI。
// 仅用于 M2 管线验证，不依赖任何外部正式美术资产。
export function buildProceduralFish(): THREE.Group {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.ConeGeometry(0.18, 0.7, 8),
    new THREE.MeshStandardMaterial({ color: 0xff8a5c }),
  );
  body.rotation.z = Math.PI / 2;
  group.add(body);
  const tail = new THREE.Mesh(
    new THREE.ConeGeometry(0.1, 0.22, 6),
    new THREE.MeshStandardMaterial({ color: 0xff7043 }),
  );
  tail.rotation.z = -Math.PI / 2;
  tail.position.x = -0.42;
  group.add(tail);
  return group;
}

// 导出为可直接被 loadModel 消费的 data URI
export function exportProceduralFishGLTF(): Promise<string> {
  return new Promise((resolve, reject) => {
    new GLTFExporter().parse(
      buildProceduralFish(),
      (result) => {
        const json = JSON.stringify(result);
        resolve(`data:application/json;charset=utf-8,${encodeURIComponent(json)}`);
      },
      (err) => reject(new Error(`测试 glTF 导出失败：${err}`)),
    );
  });
}
