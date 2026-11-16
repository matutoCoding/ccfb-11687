/**
 * three.js 三维场景:地面网格、光伏组件、遮挡物、观察点、实时地面阴影。
 * 纯渲染层,数据来自 Project;交互(选中/拖拽)通过回调上抛。
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Obstacle, Project, Vec3 } from './types';
import { buildModules } from './engine/layout';
import { groundShadowPolygons } from './engine/shadow';
import { solarPosition } from './engine/solar';
import { v3 as v3f } from './engine/geometry';

const DEG = Math.PI / 180;

export interface SceneHandle {
  dispose(): void;
  setProject(project: Project): void;
  setSunTime(date: { year: number; month: number; day: number; hour: number }): void;
  setSelected(id: string | null): void;
  onPick(cb: (id: string | null) => void): void;
  moveSelected(dx: number, dy: number): void;
  resize(): void;
}

const MAT = {
  module: new THREE.MeshStandardMaterial({ color: 0x1f4fa0, metalness: 0.4, roughness: 0.35, side: THREE.DoubleSide }),
  moduleFrame: new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.7, roughness: 0.4 }),
  building: new THREE.MeshStandardMaterial({ color: 0xb08968, roughness: 0.9 }),
  pole: new THREE.MeshStandardMaterial({ color: 0x6b705c, roughness: 0.6 }),
  trunk: new THREE.MeshStandardMaterial({ color: 0x7f5539 }),
  crown: new THREE.MeshStandardMaterial({ color: 0x588157, roughness: 0.9 }),
  observer: new THREE.MeshStandardMaterial({ color: 0xe63946, emissive: 0x7a1f26 }),
  ground: new THREE.MeshStandardMaterial({ color: 0xe9ece5, roughness: 1 }),
  shadow: new THREE.MeshBasicMaterial({ color: 0x1d3557, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }),
  selected: new THREE.MeshBasicMaterial({ color: 0xffb703, wireframe: true }),
};

function toVec(p: Vec3): THREE.Vector3 {
  return new THREE.Vector3(p.x, p.z, p.y); // ENU(x,y,z) -> three(x,z,y),y 轴作高度
}

/** 无 WebGL 环境(如 jsdom 测试)的空实现,保证上层页面可挂载 */
function createFallbackHandle(container: HTMLElement): SceneHandle {
  const note = document.createElement('div');
  note.textContent = '当前环境不支持 WebGL,三维视图不可用(数据与分析功能正常)。';
  note.style.cssText = 'padding:24px;color:#64748b;';
  container.appendChild(note);
  return {
    dispose() { note.remove(); },
    setProject() {},
    setSunTime() {},
    setSelected() {},
    onPick() {},
    moveSelected() {},
    resize() {},
  };
}

export function createScene(container: HTMLElement): SceneHandle {
  // WebGL 不可用时优雅降级
  try {
    const testCanvas = document.createElement('canvas');
    if (!testCanvas.getContext('webgl2') && !testCanvas.getContext('webgl')) {
      return createFallbackHandle(container);
    }
  } catch {
    return createFallbackHandle(container);
  }
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xdfe7ee);

  const camera = new THREE.PerspectiveCamera(55, container.clientWidth / container.clientHeight, 0.1, 2000);
  camera.position.set(90, 80, 110);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = false; // 阴影走解析几何,不用阴影贴图
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 0, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const dir = new THREE.DirectionalLight(0xffffff, 1.1);
  dir.position.set(60, 120, 40);
  scene.add(dir);

  const root = new THREE.Group();
  scene.add(root);
  const shadowGroup = new THREE.Group();
  root.add(shadowGroup);
  const entityGroup = new THREE.Group();
  root.add(entityGroup);

  let project: Project | null = null;
  let sunVec = new THREE.Vector3(0, 1, 0);
  let selectedId: string | null = null;
  const pickables: THREE.Object3D[] = [];
  const idByObject = new Map<THREE.Object3D, string>();
  let pickCb: ((id: string | null) => void) | null = null;

  // ---- 地面 ----
  function buildGround(p: Project): void {
    const existing = root.getObjectByName('ground');
    if (existing) root.remove(existing);
    const { groundWidth: w, groundDepth: d } = p.site;
    const geo = new THREE.PlaneGeometry(w, d);
    const mesh = new THREE.Mesh(geo, MAT.ground);
    mesh.name = 'ground';
    mesh.rotation.x = -Math.PI / 2;
    root.add(mesh);
    const grid = new THREE.GridHelper(Math.max(w, d), 40, 0x94a3b8, 0xcbd5e1);
    grid.name = 'grid';
    (grid.material as THREE.Material).opacity = 0.5;
    (grid.material as THREE.Material).transparent = true;
    root.add(grid);
  }

  // ---- 光伏组件 ----
  function buildModules3D(p: Project): void {
    const group = new THREE.Group();
    group.name = 'modules';
    for (const arr of p.arrays) {
      const mods = buildModules([arr]);
      for (const m of mods) {
        const w = m.width;
        const h = m.height;
        const geo = new THREE.PlaneGeometry(w, h);
        const mesh = new THREE.Mesh(geo, MAT.module);
        const c = toVec(m.center);
        mesh.position.copy(c);
        // 局部 u -> three x, vUp -> three 平面内另一轴;用四元数对齐法线
        const n = toVec(m.normal).normalize();
        const u = toVec(m.u).normalize();
        const v = toVec(m.vUp).normalize();
        const basis = new THREE.Matrix4().makeBasis(u, v, n);
        mesh.setRotationFromMatrix(basis);
        mesh.userData.kind = 'module';
        const holder = new THREE.Group();
        holder.add(mesh);
        holder.userData.id = m.id;
        group.add(holder);
      }
    }
    const old = entityGroup.getObjectByName('modules');
    if (old) entityGroup.remove(old);
    group.name = 'modules';
    entityGroup.add(group);
  }

  // ---- 遮挡物 ----
  function buildObstacle(o: Obstacle): THREE.Object3D {
    const g = new THREE.Group();
    const pos = new THREE.Vector3(o.position.x, 0, o.position.y);
    if (o.type === 'building' && o.building) {
      const b = o.building;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.width, b.height, b.depth), MAT.building);
      mesh.position.set(0, b.height / 2, 0);
      g.add(mesh);
      g.position.copy(pos);
      g.rotation.y = -(b.rotation || 0) * DEG;
    } else if (o.type === 'pole' && o.pole) {
      const pl = o.pole;
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(pl.radius, pl.radius, pl.height, 12), MAT.pole);
      mesh.position.set(0, pl.height / 2, 0);
      g.add(mesh);
      g.position.copy(pos);
    } else if (o.type === 'tree' && o.tree) {
      const t = o.tree;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(t.trunkRadius, t.trunkRadius, t.trunkHeight, 8), MAT.trunk);
      trunk.position.set(0, t.trunkHeight / 2, 0);
      g.add(trunk);
      const crown = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 14), MAT.crown);
      crown.scale.set(t.crownRx, t.crownRz, t.crownRy);
      crown.position.set(0, t.trunkHeight + t.crownRz, 0);
      g.add(crown);
      g.position.copy(pos);
    }
    g.userData.id = o.id;
    g.userData.kind = 'obstacle';
    return g;
  }

  function buildObstacles3D(p: Project): void {
    const group = new THREE.Group();
    group.name = 'obstacles';
    for (const o of p.obstacles) group.add(buildObstacle(o));
    const old = entityGroup.getObjectByName('obstacles');
    if (old) entityGroup.remove(old);
    entityGroup.add(group);
  }

  // ---- 观察点 ----
  function buildObservers3D(p: Project): void {
    const group = new THREE.Group();
    group.name = 'observers';
    for (const ob of p.observers) {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(1.2, 16, 12), MAT.observer);
      mesh.position.set(ob.position.x, ob.position.z, ob.position.y);
      mesh.userData.id = ob.id;
      mesh.userData.kind = 'observer';
      group.add(mesh);
    }
    const old = entityGroup.getObjectByName('observers');
    if (old) entityGroup.remove(old);
    entityGroup.add(group);
  }

  // ---- 实时地面阴影(解析多边形) ----
  function buildShadows(p: Project): void {
    while (shadowGroup.children.length) {
      const c = shadowGroup.children[0];
      shadowGroup.remove(c);
      (c as THREE.Mesh).geometry?.dispose();
    }
    if (sunVec.y <= 0.02) return;
    const s: Vec3 = { x: sunVec.x, y: sunVec.z, z: sunVec.y }; // three -> ENU
    const polys = groundShadowPolygons(p.arrays, p.obstacles, s);
    for (const poly of polys) {
      const shape = new THREE.Shape();
      poly.pts.forEach((pt, i) => {
        if (i === 0) shape.moveTo(pt.x, pt.y);
        else shape.lineTo(pt.x, pt.y);
      });
      shape.closePath();
      const geo = new THREE.ShapeGeometry(shape);
      const mesh = new THREE.Mesh(geo, MAT.shadow);
      mesh.rotation.x = Math.PI / 2; // xy(ENU) -> three xz 地面
      shadowGroup.add(mesh);
    }
  }

  function rebuildPickables(): void {
    pickables.length = 0;
    idByObject.clear();
    entityGroup.traverse((obj) => {
      const id = (obj.userData?.id as string) || (obj.parent?.userData?.id as string);
      if (id) {
        pickables.push(obj);
        idByObject.set(obj, id);
      }
    });
  }

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  function onPointerDown(e: PointerEvent): void {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(pickables, true);
    const id = hits.length ? (hits[0].object.userData.id as string) ?? null : null;
    selectedId = id;
    pickCb?.(id);
    updateSelection();
  }
  renderer.domElement.addEventListener('pointerdown', onPointerDown);

  function updateSelection(): void {
    const old = scene.getObjectByName('selection');
    if (old) scene.remove(old);
    if (!selectedId || !project) return;
    const obs = project.obstacles.find((o) => o.id === selectedId);
    if (!obs) return;
    const helper = new THREE.BoxHelper(
      entityGroup.getObjectByProperty('userData.id', selectedId) as THREE.Object3D,
      0xffb703,
    );
    helper.name = 'selection';
    scene.add(helper);
  }

  let raf = 0;
  function animate(): void {
    raf = requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  return {
    dispose(): void {
      cancelAnimationFrame(raf);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
    setProject(p: Project): void {
      project = p;
      buildGround(p);
      buildModules3D(p);
      buildObstacles3D(p);
      buildObservers3D(p);
      rebuildPickables();
      buildShadows(p);
      updateSelection();
    },
    setSunTime({ year, month, day, hour }): void {
      if (!project) return;
      const sp = solarPosition({
        year, month, day, localHour: hour,
        latitude: project.site.latitude,
        longitude: project.site.longitude,
        utcOffset: project.site.utcOffset,
      });
      sunVec = new THREE.Vector3(sp.sunVector.x, sp.sunVector.z, sp.sunVector.y);
      dir.position.copy(sunVec.clone().multiplyScalar(120));
      buildShadows(project);
    },
    setSelected(id: string | null): void {
      selectedId = id;
      updateSelection();
    },
    onPick(cb): void {
      pickCb = cb;
    },
    moveSelected(dx: number, dy: number): void {
      if (!selectedId || !project) return;
      const o = project.obstacles.find((x) => x.id === selectedId);
      if (o) {
        o.position.x += dx;
        o.position.y += dy;
        const obj = entityGroup.getObjectByProperty('userData.id', selectedId);
        if (obj) obj.position.set(o.position.x, obj.position.y, o.position.y);
        buildShadows(project);
      }
    },
    resize(): void {
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    },
  };
}

// 保持 v3f 引用(几何工具在其他场景扩展中可能使用)
void v3f;
