import { store } from '../store';
import { el, numField, textField } from '../ui';
import { Viewer } from '../three/viewer';
import { OBSTRUCTION_DEFAULTS, OBSTRUCTION_LABEL, Obstruction, ObstructionType, genId } from '../types';
import { sunPosition } from '../solar/sun';

/** 用当前真实时间设置默认光照 */
export function setDefaultSun(viewer: Viewer, lat: number, lon: number) {
  const sp = sunPosition(Date.now(), lat, lon);
  viewer.setSun(sp.elevation > 0 ? sp : { elevation: 30, azimuth: 0 });
}

export function renderSite(root: HTMLElement): () => void {
  const project = store.current!;
  const page = el('div', { className: 'page' });
  const sidebar = el('div', { className: 'sidebar' });
  const viewWrap = el('div', { className: 'view3d' });
  viewWrap.append(el('div', { className: 'view-hint' }, [
    '左键旋转 · 右键平移 · 滚轮缩放 · 点击遮挡物选中并拖动 | 红=东 绿=北 蓝=天',
  ]));
  page.append(sidebar, viewWrap);
  root.append(page);

  const viewer = new Viewer(viewWrap);
  viewer.enabledDrags = new Set(['obstruction']);
  viewer.rebuild(project);
  setDefaultSun(viewer, project.location.lat, project.location.lon);

  let selectedId: string | null = null;

  function proj() { return store.current!; }

  function renderSidebar() {
    sidebar.innerHTML = '';
    sidebar.append(el('h2', {}, ['场地建模']));
    sidebar.append(el('div', { className: 'btn-row' },
      (Object.keys(OBSTRUCTION_LABEL) as ObstructionType[]).map(t =>
        el('button', {
          onClick: () => {
            const d = OBSTRUCTION_DEFAULTS[t];
            const obs: Obstruction = {
              id: genId(), type: t, name: OBSTRUCTION_LABEL[t] + (proj().obstructions.length + 1),
              x: 0, y: -30 - proj().obstructions.length * 10, ...d,
            };
            proj().obstructions.push(obs);
            store.touchCurrent();
            selectedId = obs.id;
            sync();
          },
        }, ['＋ ' + OBSTRUCTION_LABEL[t]]),
      ),
    ));

    // 遮挡物列表
    sidebar.append(el('h3', {}, [`遮挡物 (${proj().obstructions.length})`]));
    for (const obs of proj().obstructions) {
      const row = el('div', {
        className: 'field',
        style: 'cursor:pointer;' + (obs.id === selectedId ? 'outline:1px solid var(--accent2);border-radius:5px;' : ''),
      }, [
        el('label', { style: 'width:auto;flex:1;color:var(--fg)' }, [`${OBSTRUCTION_LABEL[obs.type]} · ${obs.name}`]),
        el('button', {
          className: 'danger',
          onClick: (ev: Event) => {
            ev.stopPropagation();
            proj().obstructions = proj().obstructions.filter(o => o.id !== obs.id);
            if (selectedId === obs.id) selectedId = null;
            store.touchCurrent();
            sync();
          },
        }, ['删']),
      ]);
      row.addEventListener('click', () => { selectedId = obs.id; sync(); });
      sidebar.append(row);
    }

    // 属性编辑
    const sel = proj().obstructions.find(o => o.id === selectedId);
    if (sel) {
      sidebar.append(el('h3', {}, ['属性']));
      const update = () => { store.touchCurrent(); viewer.rebuild(proj()); };
      sidebar.append(textField('名称', sel.name, v => { sel.name = v; update(); renderSidebar(); }));
      sidebar.append(numField('位置 X(东)', sel.x, 'm', v => { sel.x = v; update(); }));
      sidebar.append(numField('位置 Y(北)', sel.y, 'm', v => { sel.y = v; update(); }));
      sidebar.append(numField('高度', sel.height, 'm', v => { sel.height = Math.max(0.1, v); update(); }, { min: 0.1 }));
      if (sel.type === 'building') {
        sidebar.append(numField('长度(东西)', sel.length, 'm', v => { sel.length = Math.max(0.5, v); update(); }, { min: 0.5 }));
        sidebar.append(numField('宽度(南北)', sel.width, 'm', v => { sel.width = Math.max(0.5, v); update(); }, { min: 0.5 }));
        sidebar.append(numField('旋转', sel.rotation, '°', v => { sel.rotation = v; update(); }, { step: 5 }));
      } else {
        sidebar.append(numField(sel.type === 'tree' ? '树冠半径' : '杆体半径', sel.radius, 'm',
          v => { sel.radius = Math.max(0.05, v); update(); }, { min: 0.05 }));
      }
      if (sel.type === 'tree') {
        sidebar.append(el('p', { className: 'muted' }, ['树木按球状树冠近似, 高度为球心离地高度。']));
      }
    } else {
      sidebar.append(el('p', { className: 'muted' }, ['点击列表或 3D 场景中的遮挡物进行编辑。']));
    }
  }

  function sync() {
    viewer.rebuild(proj());
    viewer.setSelected(selectedId);
    renderSidebar();
  }

  viewer.setCallbacks({
    onSelect: id => { selectedId = id; viewer.setSelected(id); renderSidebar(); },
    onMoveObstruction: (id, x, y) => {
      const obs = proj().obstructions.find(o => o.id === id);
      if (!obs) return;
      obs.x = Math.round(x * 10) / 10;
      obs.y = Math.round(y * 10) / 10;
      viewer.rebuild(proj());
      viewer.setSelected(selectedId);
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
