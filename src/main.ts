import './style.css';
import { store } from './store';
import { el } from './ui';
import { renderProjects } from './pages/projects';
import { renderSite } from './pages/site';
import { renderArray } from './pages/array';
import { renderShading } from './pages/shading';
import { renderGlare } from './pages/glare';
import { renderSettings } from './pages/settings';

type PageFn = (root: HTMLElement) => (() => void) | void;

const ROUTES: { path: string; label: string; render: PageFn }[] = [
  { path: 'projects', label: '项目列表', render: renderProjects },
  { path: 'site', label: '场地建模', render: renderSite },
  { path: 'array', label: '阵列布置', render: renderArray },
  { path: 'shading', label: '阴影分析', render: renderShading },
  { path: 'glare', label: '眩光分析', render: renderGlare },
  { path: 'settings', label: '设置', render: renderSettings },
];

let cleanup: (() => void) | undefined;

function currentRoute(): string {
  const h = location.hash.replace(/^#\/?/, '');
  return ROUTES.some(r => r.path === h) ? h : 'projects';
}

function render() {
  if (cleanup) cleanup();
  const app = document.getElementById('app')!;
  app.innerHTML = '';
  const route = currentRoute();
  const proj = store.current;

  const nav = el('nav', { className: 'tabs' },
    ROUTES.map(r => el('a', {
      href: `#/${r.path}`,
      className: r.path === route ? 'active' : '',
    }, [r.label])),
  );

  app.append(
    el('header', { className: 'topbar' }, [
      el('span', { className: 'logo' }, ['☀ 光伏阴影与眩光分析']),
      nav,
      el('span', { className: 'proj-name' }, [proj ? `当前项目:${proj.name}` : '未选择项目']),
    ]),
  );

  const main = el('main', {});
  app.append(main);

  const def = ROUTES.find(r => r.path === route)!;
  if (!proj && route !== 'projects') {
    main.append(el('div', { className: 'scroll-page' }, [
      el('div', { className: 'card' }, ['请先在项目列表中创建或打开一个项目。']),
    ]));
    return;
  }
  cleanup = def.render(main) ?? undefined;
}

window.addEventListener('hashchange', render);
store.init();
store.onChange(() => {
  // 项目名等变化时刷新顶栏
  const nameEl = document.querySelector('.proj-name');
  if (nameEl) nameEl.textContent = store.current ? `当前项目:${store.current.name}` : '未选择项目';
});
render();
