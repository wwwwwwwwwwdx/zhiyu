// 离屏图标渲染器：把已加载的 glb 模型用固定灯光与浅色背景渲染成正方形 dataURL，
// 作为商店/图鉴的商品缩略图，保证"所见即所得"。独立 WebGLRenderer，不干扰主场景。
import * as THREE from 'three';

export class IconRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;

  constructor(size = 256) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setSize(size, size);
    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf3f8fb);

    // 三点布光：环境光打底，主光塑形，冷色补光消除死黑
    const ambient = new THREE.AmbientLight(0xffffff, 0.9);
    const key = new THREE.DirectionalLight(0xffffff, 1.7);
    key.position.set(4, 6, 6);
    const fill = new THREE.DirectionalLight(0xbfe0ff, 0.55);
    fill.position.set(-5, 2, -3);
    this.scene.add(ambient, key, fill);

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    this.camera.position.set(3.0, 2.3, 4.0);
    this.camera.lookAt(0, 0, 0);
  }

  // 渲染单个模型：克隆、居中、按最大边等比缩放到统一尺寸，返回 PNG dataURL
  renderIcon(source: THREE.Object3D): string {
    const obj = source.clone(true);
    const box = new THREE.Box3().setFromObject(obj);
    const center = new THREE.Vector3();
    box.getCenter(center);
    const dims = new THREE.Vector3();
    box.getSize(dims);
    const maxDim = Math.max(dims.x, dims.y, dims.z) || 1;

    obj.position.sub(center);
    const wrap = new THREE.Group();
    wrap.add(obj);
    wrap.scale.setScalar(2.2 / maxDim);
    wrap.position.y = -0.18; // 略微下沉，视觉重心落在展示台中央
    this.scene.add(wrap);

    this.renderer.render(this.scene, this.camera);
    const url = this.renderer.domElement.toDataURL('image/png');
    this.scene.remove(wrap);
    return url;
  }

  dispose(): void {
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
