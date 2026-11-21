import { store } from '../store';
import { el, numField, fmtNum } from '../ui';
import { Viewer } from '../three/viewer';
import { runGlareAnalysis, GlareResult } from '../solar/glare';
import { sunPosition, localToUtc } from '../solar/sun';
import { downloadCsv, glareCsv } from '../csv';
import { setDefaultSun } from './site';

export function renderGlare(root: HTMLElement): () => void {
  const page = el('div', { className: 'page' });
  const sidebar = el('div', { className: 'sidebar' });
  const viewWrap = el('div', { className: 'view3d' });
  viewWrap.append(el('div', { className: 'view-hint' }, ['拖动黄色人形标记设置观察点 · 高度在左侧面板输入']));
  page.append(sidebar, viewWrap);
  root.append(page);

  const viewer = new Viewer(viewWrap);
  viewer.enabledDrags = new Set(['observer']);
  viewer.rebuild(store.current!);
  setDefaultSun(viewer, store.current!.location.lat, store.current!.location.lon);

  let result: GlareResult | null = null;

  function proj() { return store.current!; }

  function renderSidebar() {
    sidebar.innerHTML = '';
    const o = proj().observer;
    sidebar.append(el('h2', {}, ['眩光分析']));
    sidebar.append(el('h3', {}, ['观察点']));
    const update = () => { store.touchCurrent(); viewer.rebuild(proj()); };
    sidebar.append(numField('位置 X(东)', o.x, 'm', v => { o.x = v; update(); }));
    sidebar.append(numField('位置 Y(北)', o.y, 'm', v => { o.y = v; update(); }));
    sidebar.append(numField('高度', o.z, 'm', v => { o.z = Math.max(0.1, v); update(); }, { min: 0.1 }));
    sidebar.append(el('p', { className: 'muted' }, [
      `判定阈值:反射光与视线夹角 < ${store.settings.glareAngleDeg}°(设置页可调)。道路观察点建议高度 1.5–2m(驾驶员眼睛)。`,
    ]));

    const runBtn = el('button', { className: 'primary' }, ['运行全年眩光扫描']);
    runBtn.addEventListener('click', () => {
      runBtn.disabled = true;
      runBtn.textContent = '计算中…';
      setTimeout(() => {
        result = runGlareAnalysis(proj(), store.settings);
        runBtn.disabled = false;
        runBtn.textContent = '运行全年眩光扫描';
        renderSidebar();
      }, 50);
    });
    sidebar.append(el('div', { className: 'btn-row' }, [runBtn]));

    if (result) {
      const totalMin = result.windows.reduce((s, w) => s + w.minutes, 0);
      const days = new Set(result.windows.map(w => w.date)).size;
      sidebar.append(el('div', { className: 'stat-grid' }, [
        el('div', { className: 'stat' }, [el('div', { className: 'v' }, [String(result.windows.length)]), el('div', { className: 'k' }, ['眩光时间窗'])]),
        el('div', { className: 'stat' }, [el('div', { className: 'v' }, [fmtNum(totalMin, 0) + ' min']), el('div', { className: 'k' }, [`全年累计 · 涉及 ${days} 天`])]),
        el('div', { className: 'stat' }, [el('div', { className: 'v' }, [fmtNum(result.elapsedMs / 1000, 2) + ' s']), el('div', { className: 'k' }, ['计算耗时'])]),
      ]));
      sidebar.append(el('div', { className: 'btn-row' }, [
        el('button', {
          onClick: () => downloadCsv(`眩光时刻表_${proj().name}.csv`, glareCsv(result!, proj().name)),
        }, ['导出眩光时刻表 CSV']),
      ]));

      sidebar.append(el('h3', {}, ['时刻表(点击行查看该时刻太阳与阵列)']));
      const list = el('div', { style: 'max-height:300px;overflow-y:auto;' });
      const table = el('table', { className: 'data' });
      table.append(el('tr', {}, [
        el('th', {}, ['日期']), el('th', {}, ['起']), el('th', {}, ['止']),
        el('th', {}, ['分钟']), el('th', {}, ['峰值组件']),
      ]));
      for (const w of result.windows.slice(0, 500)) {
        const tr = el('tr', { style: 'cursor:pointer' }, [
          el('td', {}, [w.date]), el('td', {}, [w.start]), el('td', {}, [w.end]),
          el('td', {}, [String(w.minutes)]), el('td', {}, [String(w.peakModules)]),
        ]);
        tr.addEventListener('click', () => {
          const [y, mo, d] = w.date.split('-').map(Number);
          const [hh, mm] = w.start.split(':').map(Number);
          const { lat, lon, timezone } = proj().location;
          const sp = sunPosition(localToUtc(y, mo, d, hh, mm, timezone), lat, lon);
          viewer.setSun(sp.elevation > 0 ? sp : null);
        });
        table.append(tr);
      }
      list.append(table);
      if (result.windows.length > 500) {
        list.append(el('p', { className: 'muted' }, [`仅显示前 500 条, 完整数据请导出 CSV。`]));
      }
      sidebar.append(list);
    }
  }

  viewer.setCallbacks({
    onMoveObserver: (x, y) => {
      const o = proj().observer;
      o.x = Math.round(x * 10) / 10;
      o.y = Math.round(y * 10) / 10;
      viewer.rebuild(proj());
    },
    onDragEnd: () => { store.touchCurrent(); renderSidebar(); },
  });

  renderSidebar();

  const onResize = () => viewer.resize();
  window.addEventListener('resize', onResize);
  return () => {
    window.removeEventListener('resize', onResize);
    viewer.dispose();
  };
}
