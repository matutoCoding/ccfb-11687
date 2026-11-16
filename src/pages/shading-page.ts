/** 阴影分析页:实时阴影 + 全年逐时遮挡热力图(Worker)+ 遮挡损失 CSV */
import { app } from '../app';
import { h, heatColor, toast, download } from '../dom';
import { analysisClient } from '../analysis-client';
import { shadingLossCSV } from '../engine/csv';
import { buildModules } from '../engine/layout';
import type { AnnualResult } from '../engine/annual';
import { createViewport } from './viewport';

export function renderShadingPage(): HTMLElement {
  const project = app.getState().project!;
  const viewport = createViewport(project);
  const modules = buildModules(project.arrays);

  const progressBar = h('div', { class: 'progress' }, [h('div', { style: 'width:0%' })]);
  const status = h('div', { class: 'muted' }, ['尚未运行全年分析']);
  const heatPanel = h('div', { class: 'card' }, [h('h2', {}, ['全年平均遮挡比例热力图']), h('div', { class: 'empty' }, ['运行分析后按组件排布显示热力图'])]);

  let result: AnnualResult | null = null;
  let running = false;

  async function runAnnual(): Promise<void> {
    if (running) return;
    running = true;
    status.textContent = '分析中…(在后台线程运行,不影响交互)';
    (progressBar.firstChild as HTMLElement).style.width = '0%';
    try {
      result = await analysisClient.runAnnual(project, (done, total) => {
        (progressBar.firstChild as HTMLElement).style.width = `${(done / total) * 100}%`;
        status.textContent = `进度 ${done}/${total} 时间步`;
      });
      renderHeatmap();
      status.textContent = `完成:${result.totalDaylightSamples} 个日照时间步,${modules.length} 块组件`;
      toast('全年遮挡分析完成');
    } catch (err) {
      status.textContent = `分析失败:${(err as Error).message}`;
    } finally {
      running = false;
    }
  }

  function renderHeatmap(): void {
    if (!result) return;
    // 按阵列分组,每阵列一个网格(行=排,列=列)
    const blocks = project.arrays.map((arr) => {
      const ids = new Map<string, number>();
      modules.forEach((m, i) => { if (m.arrayId === arr.id) ids.set(`${m.row}:${m.col}`, i); });
      const cells: HTMLElement[] = [];
      for (let r = 0; r < arr.rows; r++) {
        for (let c = 0; c < arr.cols; c++) {
          const idx = ids.get(`${r}:${c}`);
          const v = idx === undefined ? 0 : result!.modules[idx].annualMean;
          cells.push(h('div', {
            class: 'heat-cell',
            title: `${arr.name} 第${r + 1}排第${c + 1}列:${(v * 100).toFixed(1)}%`,
            style: `background:${heatColor(v)}`,
          }));
        }
      }
      return h('div', { style: 'margin-bottom:18px' }, [
        h('div', { class: 'muted', style: 'margin-bottom:6px' }, [arr.name]),
        h('div', {
          class: 'heatmap',
          style: `grid-template-columns:repeat(${arr.cols}, minmax(14px,1fr));max-width:${arr.cols * 26}px`,
        }, cells),
      ]);
    });

    const legend = h('div', { class: 'row', style: 'margin-top:10px' }, [
      h('span', { class: 'muted' }, ['低']),
      ...[0, 0.25, 0.5, 0.75, 1].map((v) => h('span', { style: `width:28px;height:14px;background:${heatColor(v)};border-radius:2px` })),
      h('span', { class: 'muted' }, ['高遮挡']),
    ]);

    heatPanel.innerHTML = '';
    heatPanel.append(h('h2', {}, ['全年平均遮挡比例热力图']), ...blocks, legend);
  }

  const exportBtn = h('button', {
    class: 'btn ghost',
    onclick: () => {
      if (!result) { toast('请先运行分析'); return; }
      download('遮挡损失.csv', shadingLossCSV(project, result), 'text/csv;charset=utf-8');
    },
  }, ['导出遮挡损失 CSV']);

  const wrapper = h('div', {}, [
    h('div', { class: 'grid-2', style: 'grid-template-columns: 1fr 1fr; align-items:start' }, [
      h('div', {}, [
        h('div', { class: 'card' }, [
          h('h2', {}, ['实时阴影']),
          viewport.el,
          h('p', { class: 'muted', style: 'margin-top:8px' }, ['拖动时间滑块查看任意日期时刻的地面与组件阴影,几何计算与热力图同源。']),
        ]),
      ]),
      h('div', {}, [
        h('div', { class: 'card' }, [
          h('h2', {}, ['全年逐时遮挡分析']),
          h('div', { class: 'row' }, [
            h('button', { class: 'btn', onclick: runAnnual }, [running ? '分析中…' : '运行全年分析']),
            exportBtn,
          ]),
          h('div', { style: 'margin:14px 0 8px' }, [progressBar]),
          status,
        ]),
        heatPanel,
      ]),
    ]),
  ]);
  const orig = wrapper.remove.bind(wrapper);
  wrapper.remove = () => { viewport.scene.dispose(); orig(); };
  return wrapper;
}
