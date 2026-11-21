import { store } from '../store';
import { el, numField } from '../ui';

export function renderSettings(root: HTMLElement): () => void {
  const page = el('div', { className: 'scroll-page' });
  root.append(page);

  function proj() { return store.current!; }

  function refresh() {
    page.innerHTML = '';
    const p = proj();
    const s = store.settings;

    // 项目位置
    const locCard = el('div', { className: 'card' }, [
      el('h2', {}, ['项目位置(当前项目)']),
      numField('纬度', p.location.lat, '°N', v => { p.location.lat = v; store.touchCurrent(); }, { step: 0.01 }),
      numField('经度', p.location.lon, '°E', v => { p.location.lon = v; store.touchCurrent(); }, { step: 0.01 }),
      numField('时区', p.location.timezone, 'UTC+', v => { p.location.timezone = v; store.touchCurrent(); }, { step: 1 }),
      el('p', { className: 'muted' }, ['太阳位置按 NOAA 公式计算, 精度约 0.01°。']),
    ]);

    // 分析参数
    const anaCard = el('div', { className: 'card' }, [
      el('h2', {}, ['分析参数(全局)']),
      numField('分析年份', s.year, '', v => { s.year = Math.round(v); store.persist(); }, { step: 1, min: 2000, max: 2100 }),
      numField('时间步长', s.timeStepMin, 'min', v => { s.timeStepMin = Math.min(60, Math.max(5, Math.round(v))); store.persist(); }, { step: 5, min: 5, max: 60 }),
      numField('组件采样网格', s.sampleGrid, '×N', v => { s.sampleGrid = Math.min(8, Math.max(2, Math.round(v))); store.persist(); }, { step: 1, min: 2, max: 8 }),
      numField('眩光判定角', s.glareAngleDeg, '°', v => { s.glareAngleDeg = Math.min(5, Math.max(0.1, v)); store.persist(); }, { step: 0.1, min: 0.1, max: 5 }),
      el('p', { className: 'muted' }, [
        '采样网格越大, 障碍物遮挡的局部细节越准, 计算时间近似线性增加。',
        '1000 块组件 × 4×4 采样 × 全年逐时约需数秒。',
      ]),
    ]);

    // 数据管理
    const dataCard = el('div', { className: 'card' }, [
      el('h2', {}, ['数据管理']),
      el('div', { className: 'btn-row' }, [
        el('button', {
          onClick: () => {
            const blob = new Blob([store.exportProject(p.id)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = el('a', { href: url, download: `${p.name}.json` });
            a.click();
            URL.revokeObjectURL(url);
          },
        }, ['导出当前项目']),
        el('button', {
          className: 'danger',
          onClick: () => {
            if (confirm('确定清空全部项目和设置? 此操作不可恢复!')) {
              localStorage.clear();
              location.reload();
            }
          },
        }, ['清空全部数据']),
      ]),
      el('p', { className: 'muted' }, ['所有数据仅保存在本浏览器 localStorage, 不会上传。']),
    ]);

    page.append(locCard, anaCard, dataCard);
  }

  refresh();
  return () => {};
}
