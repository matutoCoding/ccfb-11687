/** 应用外壳:顶部导航 + 页面挂载点,响应状态切换 */
import { app, type PageId } from './app';
import { h } from './dom';
import { renderProjectsPage } from './pages/projects-page';
import { renderSitePage } from './pages/site-page';
import { renderArraysPage } from './pages/arrays-page';
import { renderShadingPage } from './pages/shading-page';
import { renderGlarePage } from './pages/glare-page';
import { renderSettingsPage } from './pages/settings-page';

const NAV: { id: PageId; label: string; needsProject: boolean }[] = [
  { id: 'projects', label: '项目列表', needsProject: false },
  { id: 'site', label: '场地建模', needsProject: true },
  { id: 'arrays', label: '阵列布置', needsProject: true },
  { id: 'shading', label: '阴影分析', needsProject: true },
  { id: 'glare', label: '眩光分析', needsProject: true },
  { id: 'settings', label: '设置', needsProject: true },
];

const renderers: Record<PageId, () => HTMLElement> = {
  projects: renderProjectsPage,
  site: renderSitePage,
  arrays: renderArraysPage,
  shading: renderShadingPage,
  glare: renderGlarePage,
  settings: renderSettingsPage,
};

export function renderApp(): HTMLElement {
  const mount = h('div', { id: 'page-mount', class: 'main' });

  function renderPage(): void {
    const { page, project } = app.getState();
    // 无项目时强制回到列表页
    const target: PageId = !project && page !== 'projects' ? 'projects' : page;
    mount.innerHTML = '';
    mount.append(renderers[target]());
  }

  const nav = h('nav', { class: 'nav' });
  function renderNav(): void {
    const { page, project } = app.getState();
    nav.innerHTML = '';
    for (const item of NAV) {
      const disabled = item.needsProject && !project;
      const btn = h('button', {
        class: item.id === page ? 'active' : '',
        disabled,
        onclick: () => app.navigate(item.id),
      }, [item.label]);
      nav.append(btn);
    }
  }

  const header = h('header', { class: 'app-header' }, [
    h('div', { class: 'brand' }, ['☀ 光伏阵列阴影与眩光分析系统']),
    h('div', { class: 'project-name' }, [app.getState().project?.name ?? '未选择项目']),
    nav,
  ]);

  app.subscribe((state) => {
    (header.querySelector('.project-name') as HTMLElement).textContent = state.project?.name ?? '未选择项目';
    renderNav();
    renderPage();
  });

  renderNav();
  renderPage();
  return h('div', { id: 'app' }, [header, mount]);
}
