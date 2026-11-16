/** 场地建模页:场地参数、遮挡物(厂房/杆/树)增删改、三维布置 */
import { app } from '../app';
import { h, field, numInput, toast } from '../dom';
import { createObstacle } from '../defaults';
import type { Obstacle } from '../types';
import { createViewport } from './viewport';

export function renderSitePage(): HTMLElement {
  const project = app.getState().project!;
  let selectedId: string | null = null;
  let viewport: ReturnType<typeof createViewport> | null = null;

  const form = h('div', {});

  function renderForm(): void {
    form.innerHTML = '';
    const p = app.getState().project!;

    const siteFields = h('div', {}, [
      h('h3', {}, ['场地与坐标']),
      field('场地宽度 (m)', numInput(p.site.groundWidth, 1, (v) => app.updateProject((q) => { q.site.groundWidth = v; return q; }))),
      field('场地深度 (m)', numInput(p.site.groundDepth, 1, (v) => app.updateProject((q) => { q.site.groundDepth = v; return q; }))),
      field('纬度 (°)', numInput(p.site.latitude, 0.1, (v) => app.updateProject((q) => { q.site.latitude = v; return q; }))),
      field('经度 (°)', numInput(p.site.longitude, 0.1, (v) => app.updateProject((q) => { q.site.longitude = v; return q; }))),
      field('UTC 偏移 (小时,中国 +8)', numInput(p.site.utcOffset, 0.5, (v) => app.updateProject((q) => { q.site.utcOffset = v; return q; }))),
      field('分析年份', numInput(p.site.year, 1, (v) => app.updateProject((q) => { q.site.year = Math.round(v); return q; }))),
    ]);

    const addButtons = h('div', { class: 'grid-3' }, [
      h('button', { class: 'btn secondary', onclick: () => addObstacle('building') }, ['+ 厂房']),
      h('button', { class: 'btn secondary', onclick: () => addObstacle('pole') }, ['+ 电线杆']),
      h('button', { class: 'btn secondary', onclick: () => addObstacle('tree') }, ['+ 树木']),
    ]);

    const list = h('div', {}, p.obstacles.map((o) =>
      h('div', {
        class: 'card',
        style: `cursor:pointer;${o.id === selectedId ? 'outline:2px solid var(--primary)' : ''}`,
        onclick: () => selectObstacle(o.id),
      }, [
        h('div', { class: 'row' }, [
          h('strong', {}, [o.name]),
          h('div', { class: 'spacer' }),
          h('button', {
            class: 'btn danger',
            onclick: (e: Event) => { e.stopPropagation(); removeObstacle(o.id); },
          }, ['删除']),
        ]),
        renderObstacleFields(o),
      ]),
    ));

    form.append(
      h('div', { class: 'card' }, [siteFields]),
      h('div', { class: 'card' }, [h('h2', {}, ['遮挡物']), addButtons, h('div', { style: 'margin-top:12px' }, [list])]),
    );
  }

  function renderObstacleFields(o: Obstacle): HTMLElement {
    const update = (fn: (x: Obstacle) => void) => app.updateProject((p) => {
      const target = p.obstacles.find((x) => x.id === o.id);
      if (target) fn(target);
      return p;
    });

    const pos = h('div', { class: 'grid-3' }, [
      field('X (m,东)', numInput(o.position.x, 0.5, (v) => update((x) => { x.position.x = v; }))),
      field('Y (m,北)', numInput(o.position.y, 0.5, (v) => update((x) => { x.position.y = v; }))),
      field('Z 高度 (m)', numInput(o.position.z, 0.5, (v) => update((x) => { x.position.z = v; }))),
    ]);

    let params: HTMLElement;
    if (o.type === 'building' && o.building) {
      const b = o.building;
      params = h('div', { class: 'grid-4' }, [
        field('宽 (m)', numInput(b.width, 0.5, (v) => update((x) => { x.building!.width = v; }))),
        field('深 (m)', numInput(b.depth, 0.5, (v) => update((x) => { x.building!.depth = v; }))),
        field('高 (m)', numInput(b.height, 0.5, (v) => update((x) => { x.building!.height = v; }))),
        field('旋转 (°)', numInput(b.rotation, 1, (v) => update((x) => { x.building!.rotation = v; }))),
      ]);
    } else if (o.type === 'pole' && o.pole) {
      const pl = o.pole;
      params = h('div', { class: 'grid-2' }, [
        field('半径 (m)', numInput(pl.radius, 0.05, (v) => update((x) => { x.pole!.radius = v; }))),
        field('高度 (m)', numInput(pl.height, 0.5, (v) => update((x) => { x.pole!.height = v; }))),
      ]);
    } else {
      const t = o.tree!;
      params = h('div', { class: 'grid-4' }, [
        field('树干半径', numInput(t.trunkRadius, 0.05, (v) => update((x) => { x.tree!.trunkRadius = v; }))),
        field('树干高', numInput(t.trunkHeight, 0.5, (v) => update((x) => { x.tree!.trunkHeight = v; }))),
        field('树冠 X 半径', numInput(t.crownRx, 0.5, (v) => update((x) => { x.tree!.crownRx = v; }))),
        field('树冠 Y 半径', numInput(t.crownRy, 0.5, (v) => update((x) => { x.tree!.crownRy = v; }))),
        field('树冠 Z 半径', numInput(t.crownRz, 0.5, (v) => update((x) => { x.tree!.crownRz = v; }))),
      ]);
    }
    return h('div', { style: 'margin-top:10px' }, [pos, params]);
  }

  function addObstacle(type: Obstacle['type']): void {
    app.updateProject((p) => {
      const o = createObstacle(type, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20);
      p.obstacles.push(o);
      selectedId = o.id;
      return p;
    });
    renderForm();
    viewport?.scene.setProject(app.getState().project!);
    viewport?.scene.setSelected(selectedId);
    toast('已添加遮挡物,可在左侧修改尺寸');
  }

  function removeObstacle(id: string): void {
    app.updateProject((p) => {
      p.obstacles = p.obstacles.filter((o) => o.id !== id);
      return p;
    });
    if (selectedId === id) selectedId = null;
    renderForm();
    viewport?.scene.setProject(app.getState().project!);
  }

  function selectObstacle(id: string): void {
    selectedId = id;
    viewport?.scene.setSelected(id);
    renderForm();
  }

  renderForm();

  // 数据变化(表单编辑)后刷新三维
  const unsubscribe = app.subscribe(() => {
    if (viewport) viewport.scene.setProject(app.getState().project!);
  });

  viewport = createViewport(project, {
    onPick: (id) => { if (id) selectObstacle(id); },
    selectedId,
  });

  const wrapper = h('div', { class: 'grid-2', style: 'grid-template-columns: 380px 1fr; align-items:start' }, [
    form,
    h('div', {}, [viewport.el, h('p', { class: 'muted', style: 'margin-top:8px' }, [
      '提示:在三维视图中点击遮挡物可选中;左侧表单精确调整位置与尺寸。坐标 X 朝东、Y 朝北、Z 为高度。',
    ])]),
  ]);

  const originalRemove = wrapper.remove.bind(wrapper);
  wrapper.remove = () => { unsubscribe(); viewport?.scene.dispose(); originalRemove(); };
  return wrapper;
}
