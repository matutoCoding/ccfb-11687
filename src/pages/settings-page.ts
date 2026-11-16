/** 设置页:分析参数与显示选项 */
import { app } from '../app';
import { h, field, numInput, toast } from '../dom';
import type { AnalysisSettings } from '../types';

export function renderSettingsPage(): HTMLElement {
  const p = app.getState().project!;

  function edit(fn: (s: AnalysisSettings) => void): void {
    app.updateProject((q) => { fn(q.settings); return q; });
  }

  const s = p.settings;
  return h('div', { style: 'max-width:720px' }, [
    h('div', { class: 'card' }, [
      h('h2', {}, ['分析参数']),
      field('眩光判定半角 (°,反射方向与视线夹角阈值)',
        numInput(s.glareThresholdDeg, 1, (v) => edit((x) => { x.glareThresholdDeg = v; }))),
      h('p', { class: 'muted' }, ['阈值越大,判定为眩光的锥角范围越宽。道路眩光工程评估常用 30–60°。']),
      field('多阴影重叠求并集栅格分辨率(单边格数)',
        numInput(s.shadowGridSize, 8, (v) => edit((x) => { x.shadowGridSize = Math.max(8, Math.round(v)); }))),
      field('全年分析时间步长 (分钟)', (() => {
        const sel = h('select', {}, [
          h('option', { value: '60' }, ['60 分钟(较快)']),
          h('option', { value: '30' }, ['30 分钟(精细,约 2 倍耗时)']),
        ]) as HTMLSelectElement;
        sel.value = String(s.timeStepMinutes);
        sel.addEventListener('change', () => edit((x) => { x.timeStepMinutes = parseInt(sel.value, 10) as 30 | 60; }));
        return sel;
      })()),
      field('启用大气折射修正(近地平线太阳高度)', (() => {
        const chk = h('input', { type: 'checkbox' }) as HTMLInputElement;
        chk.checked = s.useRefraction;
        chk.addEventListener('change', () => edit((x) => { x.useRefraction = chk.checked; }));
        return chk;
      })()),
      field('眩光视线遮挡检测(厂房/树木挡住视线则标记)', (() => {
        const chk = h('input', { type: 'checkbox' }) as HTMLInputElement;
        chk.checked = s.lineOfSightCheck;
        chk.addEventListener('change', () => edit((x) => { x.lineOfSightCheck = chk.checked; }));
        return chk;
      })()),
    ]),
    h('div', { class: 'card' }, [
      h('h2', {}, ['关于计算引擎']),
      h('ul', { class: 'muted' }, [
        h('li', {}, ['太阳位置:NOAA 太阳位置算法(赤经赤纬/时差/真太阳时),北 0 顺时针方位角。']),
        h('li', {}, ['阴影:平行光投影 + 凸多边形 Sutherland-Hodgman 裁剪,解析面积比,无像素近似。']),
        h('li', {}, ['单杆影长与三角公式同源,浮点级误差;电线杆用解析胶囊阴影。']),
        h('li', {}, ['眩光:镜面反射向量与观察视线夹角判定,支持视线遮挡分析。']),
        h('li', {}, ['全年分析在 Web Worker 中运行,不阻塞三维交互。']),
      ]),
      h('button', { class: 'btn secondary', onclick: () => toast('当前设置已自动保存') }, ['确认保存']),
    ]),
  ]);
}
