import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Obstruction, Project } from '../types';
import { arrayBasis, moduleCenter } from '../solar/geometry';
import { sunVector, SunPos } from '../solar/sun';

export type DragMode = 'obstruction' | 'array' | 'observer';

export interface ViewerCallbacks {
  onSelect?: (obstructionId: string | null) => void;
  onMoveObstruction?: (id: string, x: number, y: number) => void;
  onMoveArray?: (x: number, y: number) => void;
  onMoveObserver?: (x: number, y: number) => void;
  onDragEnd?: () => void;
}

const OBSTRUCTION_COLORS: Record<string, number> = {
  building: 0x8a94a6,
  tree: 0x3d7a3d,
  pole: 0x9a7b4f,
};

export class Viewer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

  private obsGroup = new THREE.Group();
  private arrayGroup = new THREE.Group();
  private moduleMesh: THREE.InstancedMesh | null = null;
  private observerMarker: THREE.Group | null = null;
  private sunLight: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private sunBall: THREE.Mesh;

  private project: Project | null = null;
  private callbacks: ViewerCallbacks = {};
  enabledDrags: Set<DragMode> = new Set();
  selectedObsId: string | null = null;

  private dragging: DragMode | null = null;
  private dragObsId: string | null = null;
  private dragOffset = new THREE.Vector2();
  private raf = 0;
  private disposed = false;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 5000);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(60, -90, 70);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02;
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };

    this.scene.background = new THREE.Color(0x87a8c8);
    this.scene.fog = new THREE.Fog(0x87a8c8, 400, 1500);

    this.hemi = new THREE.HemisphereLight(0xbfd6ee, 0x54503f, 0.9);
    this.scene.add(this.hemi);

    this.sunLight = new THREE.DirectionalLight(0xfff2dd, 2.2);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(4096, 4096);
    const sc = this.sunLight.shadow.camera;
    sc.near = 1; sc.far = 1200;
    sc.left = -220; sc.right = 220; sc.top = 220; sc.bottom = -220;
    this.sunLight.shadow.bias = -0.0002;
    this.sunLight.shadow.normalBias = 0.05;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    this.sunBall = new THREE.Mesh(
      new THREE.SphereGeometry(6, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xffdd55, fog: false }),
    );
    this.scene.add(this.sunBall);

    // 地面
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(2000, 2000),
      new THREE.MeshLambertMaterial({ color: 0x6f7d5c }),
    );
    ground.receiveShadow = true;
    ground.name = 'ground';
    this.scene.add(ground);

    const grid = new THREE.GridHelper(400, 80, 0xffffff, 0x44503a);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = 0.02;
    (grid.material as THREE.Material).opacity = 0.35;
    (grid.material as THREE.Material).transparent = true;
    this.scene.add(grid);

    // 指北针: 红=东(X) 绿=北(Y) 蓝=天(Z)
    const axes = new THREE.AxesHelper(15);
    this.scene.add(axes);

    this.scene.add(this.obsGroup, this.arrayGroup);

    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);

    this.resize();
    this.loop();
  }

  setCallbacks(cb: ViewerCallbacks) {
    this.callbacks = cb;
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }

  /** 设置太阳(实时阴影)。夜晚降低环境光。 */
  setSun(pos: SunPos | null) {
    if (!pos || pos.elevation <= 0) {
      this.sunLight.intensity = 0;
      this.hemi.intensity = 0.25;
      this.sunBall.visible = false;
      (this.scene.background as THREE.Color).setHex(0x1a2332);
      return;
    }
    const [sx, sy, sz] = sunVector(pos);
    this.sunLight.position.set(sx * 500, sy * 500, sz * 500);
    this.sunLight.target.position.set(0, 0, 0);
    this.sunLight.intensity = 2.2;
    this.hemi.intensity = 0.9;
    this.sunBall.visible = true;
    this.sunBall.position.set(sx * 800, sy * 800, sz * 800);
    (this.scene.background as THREE.Color).setHex(0x87a8c8);
  }

  /** 全量重建场景网格 */
  rebuild(project: Project) {
    this.project = project;
    this.rebuildObstructions();
    this.rebuildArray();
    this.rebuildObserver();
  }

  private rebuildObstructions() {
    if (!this.project) return;
    this.obsGroup.clear();
    for (const obs of this.project.obstructions) {
      const mesh = buildObstructionMesh(obs);
      mesh.userData.obsId = obs.id;
      mesh.traverse(o => { o.userData.obsId = obs.id; });
      this.obsGroup.add(mesh);
    }
    this.applySelection();
  }

  private rebuildArray() {
    if (!this.project) return;
    this.arrayGroup.clear();
    const cfg = this.project.array;
    const basis = arrayBasis(cfg.azimuth, cfg.tilt);
    const n = cfg.rows * cfg.modulesPerRow;
    const geo = new THREE.BoxGeometry(cfg.moduleWidth, cfg.moduleLength, 0.05);
    const mat = new THREE.MeshLambertMaterial({ color: 0x1a3a8f });
    const inst = new THREE.InstancedMesh(geo, mat, n);
    inst.castShadow = true;
    inst.receiveShadow = true;
    const m = new THREE.Matrix4();
    const bx = new THREE.Vector3(basis.rowDir.x, basis.rowDir.y, basis.rowDir.z);
    const by = new THREE.Vector3(basis.slopeUp.x, basis.slopeUp.y, basis.slopeUp.z);
    const bz = new THREE.Vector3(basis.normal.x, basis.normal.y, basis.normal.z);
    let i = 0;
    for (let r = 0; r < cfg.rows; r++) {
      for (let c = 0; c < cfg.modulesPerRow; c++) {
        const ctr = moduleCenter(cfg, basis, r, c);
        m.makeBasis(bx, by, bz).setPosition(ctr.x, ctr.y, ctr.z);
        inst.setMatrixAt(i++, m);
      }
    }
    inst.instanceMatrix.needsUpdate = true;
    this.moduleMesh = inst;
    this.arrayGroup.add(inst);

    // 阵列区块边框(便于拖选)
    const halfW = (cfg.modulesPerRow * (cfg.moduleWidth + cfg.moduleGap)) / 2;
    const halfL = (cfg.rows * cfg.rowPitch) / 2;
    const cx = cfg.originX + basis.behindDir.x * (halfL - cfg.rowPitch / 2);
    const cy = cfg.originY + basis.behindDir.y * (halfL - cfg.rowPitch / 2);
    const outline = new THREE.Mesh(
      new THREE.PlaneGeometry(halfW * 2 + 1, halfL * 2 + 1),
      new THREE.MeshBasicMaterial({ color: 0xffcc00, transparent: true, opacity: 0.08, side: THREE.DoubleSide }),
    );
    outline.position.set(cx, cy, 0.05);
    outline.rotation.z = Math.atan2(basis.rowDir.y, basis.rowDir.x);
    outline.name = 'arrayOutline';
    this.arrayGroup.add(outline);
  }

  private rebuildObserver() {
    if (!this.project) return;
    if (this.observerMarker) {
      this.scene.remove(this.observerMarker);
      this.observerMarker = null;
    }
    const o = this.project.observer;
    const g = new THREE.Group();
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.6, 1.8, 12),
      new THREE.MeshLambertMaterial({ color: 0xff5533 }),
    );
    cone.position.z = o.z / 2;
    cone.castShadow = true;
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.35, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xffdd00 }),
    );
    head.position.z = o.z;
    g.add(cone, head);
    g.position.set(o.x, o.y, 0);
    g.userData.isObserver = true;
    g.traverse(t => { t.userData.isObserver = true; });
    this.observerMarker = g;
    this.scene.add(g);
  }

  /** 按年遮挡损失给组件着色(绿→黄→红) */
  setModuleHeat(frac: Float32Array | null) {
    if (!this.moduleMesh) return;
    const c = new THREE.Color();
    const n = this.moduleMesh.count;
    for (let i = 0; i < n; i++) {
      const f = frac ? Math.min(1, frac[i] * 8) : 0; // 12.5% 损失即全红
      if (!frac) c.setHex(0x1a3a8f);
      else c.setHSL((1 - f) * 0.33, 0.9, 0.45);
      this.moduleMesh.setColorAt(i, c);
    }
    if (this.moduleMesh.instanceColor) this.moduleMesh.instanceColor.needsUpdate = true;
  }

  setSelected(id: string | null) {
    this.selectedObsId = id;
    this.applySelection();
  }

  private applySelection() {
    this.obsGroup.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as THREE.MeshLambertMaterial;
      if (!mat.emissive) return;
      const sel = mesh.userData.obsId && mesh.userData.obsId === this.selectedObsId;
      mat.emissive.setHex(sel ? 0x3366ff : 0x000000);
    });
  }

  private pick(ev: PointerEvent): { obsId?: string; array?: boolean; observer?: boolean; point?: THREE.Vector3 } {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    if (this.observerMarker) {
      const hitO = this.raycaster.intersectObject(this.observerMarker, true);
      if (hitO.length) return { observer: true };
    }
    const hitObs = this.raycaster.intersectObjects(this.obsGroup.children, true);
    if (hitObs.length) return { obsId: hitObs[0].object.userData.obsId };
    const hitArr = this.raycaster.intersectObjects(this.arrayGroup.children, false);
    if (hitArr.length) return { array: true };
    const p = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.groundPlane, p)) return { point: p };
    return {};
  }

  private groundPoint(ev: PointerEvent): THREE.Vector3 | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const p = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.groundPlane, p) ? p : null;
  }

  private onPointerDown = (ev: PointerEvent) => {
    if (ev.button !== 0 || !this.project) return;
    const hit = this.pick(ev);
    if (hit.observer && this.enabledDrags.has('observer')) {
      this.dragging = 'observer';
      this.controls.enabled = false;
      return;
    }
    if (hit.obsId && this.enabledDrags.has('obstruction')) {
      this.dragging = 'obstruction';
      this.dragObsId = hit.obsId;
      const obs = this.project.obstructions.find(o => o.id === hit.obsId);
      const gp = this.groundPoint(ev);
      if (obs && gp) this.dragOffset.set(obs.x - gp.x, obs.y - gp.y);
      this.controls.enabled = false;
      this.callbacks.onSelect?.(hit.obsId);
      return;
    }
    if (hit.array && this.enabledDrags.has('array')) {
      this.dragging = 'array';
      const gp = this.groundPoint(ev);
      if (gp) this.dragOffset.set(this.project.array.originX - gp.x, this.project.array.originY - gp.y);
      this.controls.enabled = false;
      return;
    }
    this.callbacks.onSelect?.(hit.obsId ?? null);
  };

  private onPointerMove = (ev: PointerEvent) => {
    if (!this.dragging || !this.project) return;
    const gp = this.groundPoint(ev);
    if (!gp) return;
    const x = gp.x + this.dragOffset.x;
    const y = gp.y + this.dragOffset.y;
    if (this.dragging === 'obstruction' && this.dragObsId) {
      this.callbacks.onMoveObstruction?.(this.dragObsId, x, y);
    } else if (this.dragging === 'array') {
      this.callbacks.onMoveArray?.(x, y);
    } else if (this.dragging === 'observer') {
      this.callbacks.onMoveObserver?.(gp.x, gp.y);
    }
  };

  private onPointerUp = () => {
    if (this.dragging) {
      this.dragging = null;
      this.dragObsId = null;
      this.controls.enabled = true;
      this.callbacks.onDragEnd?.();
    }
  };
}

function buildObstructionMesh(obs: Obstruction): THREE.Group {
  const g = new THREE.Group();
  const color = OBSTRUCTION_COLORS[obs.type];
  const mat = new THREE.MeshLambertMaterial({ color });
  if (obs.type === 'building') {
    const box = new THREE.Mesh(new THREE.BoxGeometry(obs.length, obs.width, obs.height), mat);
    box.position.z = obs.height / 2;
    box.castShadow = true;
    box.receiveShadow = true;
    g.add(box);
    g.rotation.z = (obs.rotation * Math.PI) / 180;
  } else if (obs.type === 'tree') {
    const trunkH = Math.max(0.5, obs.height - obs.radius);
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25, 0.35, trunkH, 8),
      new THREE.MeshLambertMaterial({ color: 0x6b4a2f }),
    );
    trunk.rotation.x = Math.PI / 2;
    trunk.position.z = trunkH / 2;
    trunk.castShadow = true;
    const crown = new THREE.Mesh(new THREE.SphereGeometry(obs.radius, 16, 12), mat);
    crown.position.z = obs.height;
    crown.castShadow = true;
    g.add(trunk, crown);
  } else {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(obs.radius, obs.radius, obs.height, 10),
      mat,
    );
    pole.rotation.x = Math.PI / 2;
    pole.position.z = obs.height / 2;
    pole.castShadow = true;
    g.add(pole);
  }
  g.position.set(obs.x, obs.y, 0);
  return g;
}
