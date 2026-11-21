import { store } from '../store';
import { el, fmtNum, fmtPct } from '../ui';
import { Viewer } from '../three/viewer';
import { sunPosition, localToUtc, poleShadowLength } from '../solar/sun';
import { runAnnualShading, AnnualShadingResult } from '../solar/shading';
import { downloadCsv, shadingCsv } from '../csv';

export function renderShading(root: HTMLElement): () => void {
  const page = el('div', { className: 'page' });
  const viewWrap = el('div', { className: 'view3d' });
  page.append(viewWrap);
  root.append(page);

  const viewer = new Viewer(viewWrap);
  viewer.rebuild(store.current!);

  const now = new Date();
  let dateStr = `${store.settings.year}-12-21`;
  let minutes = 12 * 60;
  let playing = false;
  let result: AnnualShadingResult | null = null;

  function proj() { return store.current!; }

  // ---- 底部时间条 ----
  const dateInput = el('input', { type: 'date', value: dateStr });
  const slider = el('input', { type: 'range', min: '0', max: '1439', value: String(minutes), step: '1' });
  const readout = el('span', { className: 'sun-readout' });
  const playBtn = el('button', { onClick: () => { playing = !playing; playBtn.textContent = playing ? '⏸ 暂停' : '▶ 播放'; } }, ['▶ 播放']);
  dateInput.addEventListener('change', () => { dateStr = dateInput.value; updateSun(); });
  slider.addEventListener('input', () => { minutes = parseInt(slider.value, 10); updateSun(); });

  const timebar = el('div', { className: 'timebar' }, [
    el('span', { className: 'muted' }, ['日期']), dateInput,
    el('span', { className: 'muted' }, ['时刻']), slider, playBtn, readout,
  ]);
  viewWrap.append(timebar);

  function updateSun() {
    const [y, mo, d] = dateStr.split('-').map(Number);
    const { lat, lon, timezone } = proj().location;
    const t = localToUtc(y, mo, d, Math.floor(minutes / 60), minutes % 60, timezone);
    const sp = sunPosition(t, lat, lon);
    viewer.setSun(sp.elevation > 0 ? sp : null);
    const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
    const mm = String(minutes % 60).padStart(2, '0');
    const shadow10 = poleShadowLength(10, sp.elevation);
    readout.innerHTML = '';
    readout.append(
      `${hh}:${mm}  高度角 `,
      el('b', {}, [sp.elevation > 0 ? fmtNum(sp.elevation, 1) + '°' : '地平线以下']),
      '  方位角 ',
      el('b', {}, [sp.elevation > 0 ? fmtNum(sp.azimuth, 1) + '°' : '—']),
      sp.elevation > 0 ? `  10m 杆影长 ${fmtNum(shadow10, 2)}m` : '',
    );
  }
  updateSun();

  // 播放动画
  let lastTick = 0;
  function tick(ts: number) {
    if (playing && ts - lastTick > 50) {
      lastTick = ts;
      minutes = (minutes + 5) % 1440;
      slider.value = String(minutes);
      updateSun();
    }
    if (!disposed) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ---- 右侧分析面板 ----
  const panel = el('div', { className: 'overlay-panel' });
  viewWrap.append(panel);

  function renderPanel() {
    panel.innerHTML = '';
    panel.append(el('h2', {}, ['全年逐时遮挡分析']));
    panel.append(el('p', { className: 'muted' }, [
      `时间步长 ${store.settings.timeStepMin} 分钟 · 每组件 ${store.settings.sampleGrid}×${store.settings.sampleGrid} 采样点 · 可在设置页调整`,
    ]));
    const runBtn = el('button', { className: 'primary' }, ['运行全年分析']);
    const progress = el('div', { className: 'progress-wrap' }, [el('div', { className: 'progress-bar' })]);
    (progress.firstChild as HTMLElement).style.width = '0';
    runBtn.addEventListener('click', () => {
      runBtn.disabled = true;
      (progress.firstChild as HTMLElement).style.width = '30%';
      // 让 UI 先渲染, 再同步计算
      setTimeout(() => {
        result = runAnnualShading(proj(), store.settings);
        (progress.firstChild as HTMLElement).style.width = '100%';
        viewer.setModuleHeat(result.moduleIrrFrac);
        runBtn.disabled = false;
        renderPanel();
      }, 50);
    });
    panel.append(runBtn, progress);

    if (result) {
      const r = result;
      const n = r.rows * r.cols;
      let sum = 0, max = 0;
      for (let i = 0; i < n; i++) { sum += r.moduleIrrFrac[i]; if (r.moduleIrrFrac[i] > max) max = r.moduleIrrFrac[i]; }
      panel.append(
        el('div', { className: 'stat-grid' }, [
          el('div', { className: 'stat' }, [el('div', { className: 'v' }, [fmtPct(sum / n)]), el('div', { className: 'k' }, ['阵列平均遮挡损失'])]),
          el('div', { className: 'stat' }, [el('div', { className: 'v' }, [fmtPct(max)]), el('div', { className: 'k' }, ['单块最大损失'])]),
          el('div', { className: 'stat' }, [el('div', { className: 'v' }, [fmtNum(r.elapsedMs / 1000, 2) + ' s']), el('div', { className: 'k' }, [`计算耗时 (${fmtNum(r.sunSteps, 0)} 时步 × ${fmtNum(n, 0)} 块)`])]),
        ]),
        el('h3', {}, ['组件遮挡损失热力图(上北, 第 1 排在下)']),
      );
      // 热力图
      const hm = el('canvas', { className: 'heatmap' });
      hm.width = r.cols; hm.height = r.rows;
      const ctx = hm.getContext('2d')!;
      const img = ctx.createImageData(r.cols, r.rows);
      for (let row = 0; row < r.rows; row++) {
        for (let col = 0; col < r.cols; col++) {
          const f = Math.min(1, r.moduleIrrFrac[row * r.cols + col] * 8);
          const hue = (1 - f) * 119;
          const [rr, gg, bb] = hslToRgb(hue / 360, 0.9, 0.45);
          // canvas 第 0 行在上方 = 最后一排(北)
          const px = ((r.rows - 1 - row) * r.cols + col) * 4;
          img.data[px] = rr; img.data[px + 1] = gg; img.data[px + 2] = bb; img.data[px + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      const info = el('p', { className: 'muted' }, ['点击单元格查看单块数值']);
      hm.addEventListener('click', ev => {
        const rect = hm.getBoundingClientRect();
        const col = Math.floor(((ev.clientX - rect.left) / rect.width) * r.cols);
        const row = r.rows - 1 - Math.floor(((ev.clientY - rect.top) / rect.height) * r.rows);
        if (row < 0 || row >= r.rows || col < 0 || col >= r.cols) return;
        const i = row * r.cols + col;
        info.textContent = `第 ${row + 1} 排第 ${col + 1} 块: 辐照加权损失 ${fmtPct(r.moduleIrrFrac[i])}, 时间加权遮挡 ${fmtPct(r.moduleTimeFrac[i])}`;
      });
      panel.append(hm, el('div', { className: 'legend' }, [
        el('span', {}, ['0%']), el('div', { className: 'bar' }), el('span', {}, ['≥12.5%']),
      ]), info);

      panel.append(el('div', { className: 'btn-row' }, [
        el('button', {
          onClick: () => downloadCsv(`遮挡损失_${proj().name}.csv`,
            shadingCsv(r, proj().name, proj().location.timezone)),
        }, ['导出遮挡损失 CSV']),
        el('button', {
          onClick: () => { result = null; viewer.setModuleHeat(null); renderPanel(); },
        }, ['清除结果']),
      ]));
    }
  }

  renderPanel();

  let disposed = false;
  const onResize = () => viewer.resize();
  window.addEventListener('resize', onResize);
  return () => {
    disposed = true;
    window.removeEventListener('resize', onResize);
    viewer.dispose();
  };
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}
