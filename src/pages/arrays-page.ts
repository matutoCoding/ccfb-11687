/** 阵列布置页:阵列增删、倾角/方位角/行距/行列批量布置、冬至最小行距计算 */
import { app } from '../app';
import { h, field, numInput, toast } from '../dom';
import { createArray } from '../defaults';
import type { PVArrayConfig, Project } from '../types';
import { computeMinRowPitch } from '../engine/rowspacing';
import { createViewport } from './viewport';

export function renderArraysPage(): HTMLElement {
  let viewport: ReturnType<typeof createViewport> | null = null;
  const detail = h('div', {});
  const spacingCard = h('div', {});

  function update(fn: (p: Project) => void): void {
    app.updateProject((p) => {
      fn(p);
      return p;
    });
    viewport?.scene.setProject(app.getState().project!);
  }

  function renderList(): HTMLElement {
    const p = app.getState().project!;
    return h('div', { class: 'card' }, [
      h('div', { class: 'row' }, [
        h('h2', { style: 'margin:0' }, ['光伏阵列']),
        h('div', { class: 'spacer' }),
        h('button', {
          class: 'btn',
          onclick: () => {
            update((q) => {
              q.arrays.push(createArray((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10));
            });
            renderDetail();
            toast('已添加阵列');
          },
        }, ['+ 新建阵列']),
      ]),
      h('table', { style: 'margin-top:12px' }, [
        h('thead', {}, [h('tr', {}, [h('th', {}, ['名称']), h('th', {}, ['排×列']), h('th', {}, ['组件数']), h('th', {}, ['操作'])])]),
        h('tbody', {}, p.arrays.map((a) =>
          h('tr', {}, [
            h('td', {}, [a.name]),
            h('td', { class: 'mono' }, [`${a.rows}×${a.cols}`]),
            h('td', { class: 'mono' }, [String(a.rows * a.cols)]),
            h('td', {}, [h('div', { class: 'row' }, [
              h('button', { class: 'btn secondary', onclick: () => renderDetail(a.id) }, ['编辑']),
              h('button', {
                class: 'btn danger',
                onclick: () => {
                  update((q) => { q.arrays = q.arrays.filter((x) => x.id !== a.id); });
                  renderDetail();
                },
              }, ['删除']),
            ])]),
          ]),
        )),
      ]),
    ]);
  }

  function arrayFields(a: PVArrayConfig): HTMLElement {
    const edit = (fn: (x: PVArrayConfig) => void) => update((p) => {
      const t = p.arrays.find((x) => x.id === a.id);
      if (t) fn(t);
    });
    return h('div', {}, [
      h('div', { class: 'grid-2' }, [
        field('组件长边 (m)', numInput(a.moduleWidth, 0.05, (v) => edit((x) => { x.moduleWidth = v; }))),
        field('组件短边 (m)', numInput(a.moduleHeight, 0.05, (v) => edit((x) => { x.moduleHeight = v; }))),
        field('倾角 (°,水平=0)', numInput(a.tilt, 0.5, (v) => edit((x) => { x.tilt = v; }))),
        field('方位角 (°,正南=180)', numInput(a.azimuth, 1, (v) => edit((x) => { x.azimuth = v; }))),
        field('排数', numInput(a.rows, 1, (v) => edit((x) => { x.rows = Math.max(1, Math.round(v)); }))),
        field('列数', numInput(a.cols, 1, (v) => edit((x) => { x.cols = Math.max(1, Math.round(v)); }))),
        field('行距 (m,排中心间距)', numInput(a.rowPitch, 0.1, (v) => edit((x) => { x.rowPitch = v; }))),
        field('列距 (m,列中心间距)', numInput(a.colPitch, 0.1, (v) => edit((x) => { x.colPitch = v; }))),
        field('原点 X (m)', numInput(a.origin.x, 0.5, (v) => edit((x) => { x.origin.x = v; }))),
        field('原点 Y (m)', numInput(a.origin.y, 0.5, (v) => edit((x) => { x.origin.y = v; }))),
        field('组件下沿离地高 (m)', numInput(a.mountHeight, 0.1, (v) => edit((x) => { x.mountHeight = v; }))),
      ]),
    ]);
  }

  function renderSpacing(a: PVArrayConfig): void {
    const p = app.getState().project!;
    const r = computeMinRowPitch(
      a, p.site.latitude, p.site.longitude, p.site.utcOffset, p.site.year, 9, 15, 30,
    );
    spacingCard.innerHTML = '';
    spacingCard.append(h('div', { class: 'card' }, [
      h('h2', {}, ['冬至日 9:00–15:00 最小行距计算']),
      h('div', { class: 'grid-3' }, [
        h('div', {}, [h('div', { class: 'muted' }, ['精确 3D 模型']), h('div', { class: 'mono', style: 'font-size:22px;color:var(--primary)' }, [`${r.minPitch.toFixed(2)} m`])]),
        h('div', {}, [h('div', { class: 'muted' }, ['三角公式对照']), h('div', { class: 'mono', style: 'font-size:22px' }, [`${r.formulaPitch.toFixed(2)} m`])]),
        h('div', {}, [h('div', { class: 'muted' }, ['最不利时刻']), h('div', { class: 'mono', style: 'font-size:22px' }, [r.worstTime || '—'])]),
      ]),
      h('div', { class: 'row', style: 'margin-top:14px' }, [
        h('button', {
          class: 'btn',
          onclick: () => {
            update((q) => { const t = q.arrays.find((x) => x.id === a.id); if (t) t.rowPitch = r.minPitch; });
            renderDetail(a.id);
            toast(`已应用最小行距 ${r.minPitch.toFixed(2)} m`);
          },
        }, ['应用为当前行距']),
      ]),
      h('details', { style: 'margin-top:12px' }, [
        h('summary', { style: 'cursor:pointer;color:var(--muted)' }, ['逐时刻明细']),
        h('table', { style: 'margin-top:8px' }, [
          h('thead', {}, [h('tr', {}, [h('th', {}, ['时刻']), h('th', {}, ['高度角']), h('th', {}, ['方位角']), h('th', {}, ['3D行距']), h('th', {}, ['公式行距'])])]),
          h('tbody', {}, r.steps.map((s) => h('tr', {}, [
            h('td', { class: 'mono' }, [s.time]),
            h('td', { class: 'mono' }, [s.elevation.toFixed(1)]),
            h('td', { class: 'mono' }, [s.azimuth.toFixed(1)]),
            h('td', { class: 'mono' }, [s.requiredPitch.toFixed(2)]),
            h('td', { class: 'mono' }, [s.formulaPitch.toFixed(2)]),
          ]))),
        ]),
      ]),
    ]));
  }

  function renderDetail(id?: string): void {
    const p = app.getState().project!;
    const a = p.arrays.find((x) => x.id === id) ?? p.arrays[0];
    detail.innerHTML = '';
    if (!a) {
      detail.append(h('div', { class: 'card empty' }, ['新建阵列后可编辑参数']));
      spacingCard.innerHTML = '';
      return;
    }
    detail.append(h('div', { class: 'card' }, [
      h('h2', {}, [`编辑阵列:${a.name}`]),
      field('阵列名称', (() => {
        const inp = h('input', { value: a.name });
        inp.addEventListener('change', () => update((q) => { const t = q.arrays.find((x) => x.id === a.id); if (t) t.name = inp.value; }));
        return inp;
      })()),
      arrayFields(a),
    ]));
    renderSpacing(a);
  }

  const p = app.getState().project!;
  viewport = createViewport(p);
  renderDetail();
  const wrapper = h('div', { class: 'grid-2', style: 'grid-template-columns: 1fr 1fr; align-items:start' }, [
    h('div', {}, [renderList(), detail, spacingCard]),
    h('div', {}, [viewport.el]),
  ]);
  const orig = wrapper.remove.bind(wrapper);
  wrapper.remove = () => { viewport?.scene.dispose(); orig(); };
  return wrapper;
}
