import { store } from '../store';
import { el, numField, fmtNum } from '../ui';
import { Viewer } from '../three/viewer';
import { minRowPitchForDate } from '../solar/geometry';
import { sunPosition, localToUtc } from '../solar/sun';
import { setDefaultSun } from './site';

export function renderArray(root: HTMLElement): () => void {
  const page = el('div', { className: 'page' });
  const sidebar = el('div', { className: 'sidebar' });
  const viewWrap = el('div', { className: 'view3d' });
  viewWrap.append(el('div', { className: 'view-hint' }, ['点击阵列拖动整体平移 · 左键旋转 · 右键平移']));
  page.append(sidebar, viewWrap);
  root.append(page);

  const viewer = new Viewer(viewWrap);
  viewer.enabledDrags = new Set(['array']);

  function proj() { return store.current!; }
  function cfg() { return proj().array; }

  viewer.rebuild(proj());
  setDefaultSun(viewer, proj().location.lat, proj().location.lon);

  let pitchInfo: HTMLElement;

  function renderSidebar() {
    sidebar.innerHTML = '';
    const c = cfg();
    sidebar.append(el('h2', {}, ['阵列布置']));

    const update = () => { store.touchCurrent(); viewer.rebuild(proj()); renderStats(); };

    sidebar.append(el('h3', {}, ['组件']));
    sidebar.append(numField('组件宽度', c.moduleWidth, 'm', v => { c.moduleWidth = v; update(); }));
    sidebar.append(numField('组件长度', c.moduleLength, 'm', v => { c.moduleLength = v; update(); }));
    sidebar.append(numField('下沿离地', c.clearance, 'm', v => { c.clearance = v; update(); }));
    sidebar.append(numField('排内间隙', c.moduleGap, 'm', v => { c.moduleGap = v; update(); }, { step: 0.01 }));

    sidebar.append(el('h3', {}, ['朝向']));
    sidebar.append(numField('倾角', c.tilt, '°', v => { c.tilt = Math.min(90, Math.max(0, v)); update(); }, { step: 1, min: 0, max: 90 }));
    sidebar.append(numField('方位角', c.azimuth, '°', v => { c.azimuth = v; update(); }, { step: 5 }));
    sidebar.append(el('p', { className: 'muted' }, ['方位角 0°=正南, 正值偏西, 负值偏东。']));

    sidebar.append(el('h3', {}, ['布置']));
    sidebar.append(numField('行距', c.rowPitch, 'm', v => { c.rowPitch = Math.max(0.5, v); update(); }, { min: 0.5 }));
    sidebar.append(numField('排数', c.rows, '', v => { c.rows = Math.max(1, Math.round(v)); update(); }, { step: 1, min: 1 }));
    sidebar.append(numField('每排组件数', c.modulesPerRow, '', v => { c.modulesPerRow = Math.max(1, Math.round(v)); update(); }, { step: 1, min: 1 }));
    sidebar.append(numField('区块中心 X', c.originX, 'm', v => { c.originX = v; update(); }));
    sidebar.append(numField('区块中心 Y', c.originY, 'm', v => { c.originY = v; update(); }));

    sidebar.append(el('h3', {}, ['最小行距(冬至 9:00–15:00 不遮挡)']));
    pitchInfo = el('div', {});
    sidebar.append(
      el('button', {
        className: 'warn',
        onClick: () => {
          const p = proj();
          const { lat, lon, timezone } = p.location;
          const year = store.settings.year;
          const res = minRowPitchForDate(c, (h, m) =>
            sunPosition(localToUtc(year, 12, 21, h, m, timezone), lat, lon));
          pitchInfo.innerHTML = '';
          pitchInfo.append(el('p', {}, [
            `最小行距 ≈ ${fmtNum(res.pitch)} m`,
            `(最不利时刻 ${res.worstTime}, 太阳高度角 ${fmtNum(res.worstElevation, 1)}°, 方位角 ${fmtNum(res.worstAzimuth, 1)}°)`,
          ]));
          const btn = el('button', {
            className: 'primary',
            onClick: () => {
              c.rowPitch = Math.ceil(res.pitch * 100) / 100;
              store.touchCurrent();
              renderSidebar();
              viewer.rebuild(proj());
            },
          }, [`采用 ${fmtNum(Math.ceil(res.pitch * 100) / 100)} m`]);
          pitchInfo.append(btn);
        },
      }, ['计算最小行距']),
      pitchInfo,
    );

    renderStats();
  }

  function renderStats() {
    const c = cfg();
    let stats = sidebar.querySelector('.stat-grid');
    if (!stats) {
      stats = el('div', { className: 'stat-grid' });
      sidebar.append(el('h3', {}, ['规模']), stats);
    }
    const total = c.rows * c.modulesPerRow;
    const width = c.modulesPerRow * (c.moduleWidth + c.moduleGap);
    const depth = (c.rows - 1) * c.rowPitch + c.moduleLength * Math.cos((c.tilt * Math.PI) / 180);
    stats.innerHTML = '';
    stats.append(
      el('div', { className: 'stat' }, [el('div', { className: 'v' }, [fmtNum(total, 0)]), el('div', { className: 'k' }, ['组件总数'])]),
      el('div', { className: 'stat' }, [el('div', { className: 'v' }, [fmtNum(width * depth, 0) + ' m²']), el('div', { className: 'k' }, ['占地面积'])]),
      el('div', { className: 'stat' }, [el('div', { className: 'v' }, [fmtNum(total * c.moduleWidth * c.moduleLength, 0) + ' m²']), el('div', { className: 'k' }, ['组件总面积'])]),
    );
  }

  viewer.setCallbacks({
    onMoveArray: (x, y) => {
      const c = cfg();
      c.originX = Math.round(x * 10) / 10;
      c.originY = Math.round(y * 10) / 10;
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
