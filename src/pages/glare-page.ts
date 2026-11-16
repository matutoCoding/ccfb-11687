/** 眩光分析页:观察点管理、全年反射眩光时刻、视线遮挡标记、CSV 导出 */
import { app } from '../app';
import { h, field, numInput, toast, download } from '../dom';
import { analysisClient } from '../analysis-client';
import { glareScheduleCSV } from '../engine/csv';
import { createObserver } from '../defaults';
import type { GlareResult } from '../types';
import { createViewport } from './viewport';

export function renderGlarePage(): HTMLElement {
  const project = app.getState().project!;
  const viewport = createViewport(project);
  const resultPanel = h('div', { class: 'card' }, [h('h2', {}, ['全年眩光时刻']), h('div', { class: 'empty' }, ['选择观察点并运行分析'])]);
  const status = h('div', { class: 'muted' }, ['']);
  const progressBar = h('div', { class: 'progress' }, [h('div', { style: 'width:0%' })]);
  let currentResult: GlareResult | null = null;
  let selectedObserver: string | null = project.observers[0]?.id ?? null;
  let running = false;

  function observerList(): HTMLElement {
    const p = app.getState().project!;
    if (p.observers.length === 0) {
      return h('div', {}, [h('p', { class: 'muted' }, ['暂无观察点,点击下方按钮添加(如道路旁、邻居窗户位置)。'])]);
    }
    const cards = p.observers.map((o) =>
      h('div', {
        class: 'card',
        style: `cursor:pointer;${o.id === selectedObserver ? 'outline:2px solid var(--primary)' : ''}`,
        onclick: () => { selectedObserver = o.id; refresh(); },
      }, [
        h('div', { class: 'row' }, [
          h('strong', {}, [o.name]),
          h('div', { class: 'spacer' }),
          h('button', {
            class: 'btn danger',
            onclick: (e: Event) => {
              e.stopPropagation();
              app.updateProject((q) => { q.observers = q.observers.filter((x) => x.id !== o.id); return q; });
              if (selectedObserver === o.id) selectedObserver = null;
              viewport.scene.setProject(app.getState().project!);
              refresh();
            },
          }, ['删除']),
        ]),
        h('div', { class: 'grid-3' }, [
          field('X (m)', numInput(o.position.x, 0.5, (v) => mutate(o.id, (x) => { x.position.x = v; }))),
          field('Y (m)', numInput(o.position.y, 0.5, (v) => mutate(o.id, (x) => { x.position.y = v; }))),
          field('视线高度 (m)', numInput(o.position.z, 0.1, (v) => mutate(o.id, (x) => { x.position.z = v; }))),
        ]),
      ]),
    );
    return h('div', {}, cards);
  }

  function mutate(id: string, fn: (o: import('../types').ObserverPoint) => void): void {
    app.updateProject((p) => {
      const t = p.observers.find((x) => x.id === id);
      if (t) fn(t);
      return p;
    });
    viewport.scene.setProject(app.getState().project!);
  }

  async function runGlare(): Promise<void> {
    if (running) return;
    if (!selectedObserver) { toast('请先选择或添加观察点'); return; }
    running = true;
    status.textContent = '眩光分析中…';
    (progressBar.firstChild as HTMLElement).style.width = '0%';
    try {
      currentResult = await analysisClient.runGlare(app.getState().project!, selectedObserver, (done, total) => {
        (progressBar.firstChild as HTMLElement).style.width = `${(done / total) * 100}%`;
        status.textContent = `进度 ${done}/${total}`;
      });
      renderResult();
      status.textContent = `共 ${currentResult.events.length} 个眩光时段(合计 ${currentResult.totalHours.toFixed(1)} 小时)`;
    } catch (err) {
      status.textContent = `分析失败:${(err as Error).message}`;
    } finally {
      running = false;
    }
  }

  function renderResult(): void {
    if (!currentResult) return;
    const r = currentResult;
    const rows = r.events.slice(0, 300).map((e) =>
      h('tr', {}, [
        h('td', { class: 'mono' }, [e.timestamp]),
        h('td', { class: 'mono' }, [e.dateLabel]),
        h('td', { class: 'mono' }, [e.hourLabel]),
        h('td', { class: 'mono' }, [`${e.angleDeg.toFixed(1)}°`]),
        h('td', { class: 'mono' }, [`${e.distance.toFixed(1)} m`]),
        h('td', {}, [e.blocked ? h('span', { class: 'tag no' }, ['被遮挡']) : h('span', { class: 'tag ok' }, ['可视'])]),
      ]),
    );
    resultPanel.innerHTML = '';
    resultPanel.append(
      h('h2', {}, ['全年眩光时刻']),
      h('div', { class: 'grid-3', style: 'margin-bottom:12px' }, [
        h('div', {}, [h('div', { class: 'muted' }, ['事件数']), h('div', { style: 'font-size:20px' }, [String(r.events.length)])]),
        h('div', {}, [h('div', { class: 'muted' }, ['总时长 (h)']), h('div', { style: 'font-size:20px' }, [r.totalHours.toFixed(1)])]),
        h('div', {}, [h('div', { class: 'muted' }, ['其中被遮挡']), h('div', { style: 'font-size:20px' }, [String(r.blockedHours.toFixed(1))])]),
      ]),
      h('button', {
        class: 'btn ghost',
        style: 'margin-bottom:12px',
        onclick: () => download('眩光时刻表.csv', glareScheduleCSV(r), 'text/csv;charset=utf-8'),
      }, ['导出眩光时刻 CSV']),
      h('div', { style: 'max-height:420px;overflow:auto' }, [
        h('table', {}, [
          h('thead', {}, [h('tr', {}, [h('th', {}, ['时间戳']), h('th', {}, ['日期']), h('th', {}, ['时刻']), h('th', {}, ['偏角']), h('th', {}, ['距离']), h('th', {}, ['视线状态'])])]),
          h('tbody', {}, rows),
        ]),
      ]),
      r.events.length > 300 ? h('p', { class: 'muted' }, ['仅展示前 300 条,完整数据请导出 CSV。']) : h('span', {}),
    );
  }

  function refresh(): void {
    wrapper.querySelector('.observer-wrap')?.replaceWith(observerSection());
  }

  function observerSection(): HTMLElement {
    return h('div', { class: 'observer-section' }, [
      h('div', { class: 'card' }, [
        h('div', { class: 'row' }, [
          h('h2', { style: 'margin:0' }, ['观察点']),
          h('div', { class: 'spacer' }),
          h('button', {
            class: 'btn secondary',
            onclick: () => {
              app.updateProject((p) => {
                const o = createObserver((Math.random() - 0.5) * 40, -40 - Math.random() * 30);
                p.observers.push(o);
                selectedObserver = o.id;
                return p;
              });
              viewport.scene.setProject(app.getState().project!);
              refresh();
            },
          }, ['+ 添加观察点']),
        ]),
        h('div', { class: 'observer-wrap', style: 'margin-top:12px' }, [observerList()]),
        h('div', { class: 'card', style: 'box-shadow:none;margin-top:12px' }, [
          h('div', { class: 'muted', style: 'margin-bottom:8px' }, [
            `眩光判定锥角阈值:${project.settings.glareThresholdDeg}°(可在设置页调整);视线遮挡检测:${project.settings.lineOfSightCheck ? '开启' : '关闭'}`,
          ]),
          h('button', { class: 'btn', onclick: runGlare }, [running ? '分析中…' : '运行全年眩光分析']),
          h('div', { style: 'margin:12px 0 8px' }, [progressBar]),
          status,
        ]),
      ]),
    ]);
  }

  const wrapper = h('div', { class: 'grid-2', style: 'grid-template-columns: 1fr 1fr; align-items:start' }, [
    h('div', {}, [observerSection()]),
    h('div', {}, [
      h('div', { class: 'card' }, [h('h2', {}, ['三维场景与观察点']), viewport.el]),
      resultPanel,
    ]),
  ]);
  const orig = wrapper.remove.bind(wrapper);
  wrapper.remove = () => { viewport.scene.dispose(); orig(); };
  return wrapper;
}
