/** 可复用三维视口:封装 three-scene + 日期/时间滑块 + 太阳信息徽章 */
import { h } from '../dom';
import { createScene, type SceneHandle } from '../three-scene';
import type { Project } from '../types';
import { solarPosition } from '../engine/solar';

export interface ViewportOptions {
  showTimeControl?: boolean;
  onPick?: (id: string | null) => void;
  selectedId?: string | null;
}

export interface ViewportHandle {
  el: HTMLElement;
  scene: SceneHandle;
  getTime(): { year: number; month: number; day: number; hour: number };
  setTime(t: { year: number; month: number; day: number; hour: number }): void;
}

export function createViewport(project: Project, opts: ViewportOptions = {}): ViewportHandle {
  const mount = h('div', { class: 'viewport' });
  const scene = createScene(mount);
  scene.setProject(project);
  if (opts.onPick) scene.onPick(opts.onPick);
  if (opts.selectedId) scene.setSelected(opts.selectedId);

  const time = { year: project.site.year, month: 6, day: 21, hour: 12 };

  const badge = h('div', { class: 'sun-badge' });
  const hourSlider = h('input', { type: 'range', min: '5', max: '19', step: '0.25', value: '12' }) as HTMLInputElement;
  const monthSlider = h('input', { type: 'range', min: '1', max: '12', step: '1', value: '6' }) as HTMLInputElement;
  const daySlider = h('input', { type: 'range', min: '1', max: '28', step: '1', value: '21' }) as HTMLInputElement;

  function refresh(): void {
    scene.setSunTime(time);
    const sp = solarPosition({
      year: time.year, month: time.month, day: time.day, localHour: time.hour,
      latitude: project.site.latitude,
      longitude: project.site.longitude,
      utcOffset: project.site.utcOffset,
    });
    const hh = Math.floor(time.hour);
    const mm = Math.round((time.hour - hh) * 60);
    badge.innerHTML =
      `日期 ${time.year}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')} ` +
      `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}<br>` +
      `太阳高度 ${sp.elevation.toFixed(1)}°　方位 ${sp.azimuth.toFixed(1)}°<br>` +
      (sp.isDaytime ? '☀ 白昼' : '🌙 夜间(无日照)');
  }

  hourSlider.addEventListener('input', () => { time.hour = parseFloat(hourSlider.value); refresh(); });
  monthSlider.addEventListener('input', () => { time.month = parseInt(monthSlider.value, 10); refresh(); });
  daySlider.addEventListener('input', () => { time.day = parseInt(daySlider.value, 10); refresh(); });

  if (opts.showTimeControl !== false) {
    const panel = h('div', { class: 'time-control' }, [
      h('label', { class: 'field' }, [h('span', {}, ['月份']), monthSlider]),
      h('label', { class: 'field' }, [h('span', {}, ['日期']), daySlider]),
      h('label', { class: 'field' }, [h('span', {}, ['时刻(小时)']), hourSlider]),
    ]);
    mount.append(panel);
  }
  mount.append(badge);
  refresh();

  const resizeObserver = new ResizeObserver(() => scene.resize());
  resizeObserver.observe(mount);

  return {
    el: mount,
    scene,
    getTime: () => ({ ...time }),
    setTime(t: typeof time): void {
      Object.assign(time, t);
      hourSlider.value = String(t.hour);
      monthSlider.value = String(t.month);
      daySlider.value = String(t.day);
      refresh();
    },
  };
}
