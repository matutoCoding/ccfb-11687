// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { projectStore } from '../src/store';
import { app } from '../src/app';
import { renderApp } from '../src/shell';
import { createProject } from '../src/defaults';

// jsdom 缺失的浏览器 API polyfill
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
if (!HTMLCanvasElement.prototype.getContext) {
  HTMLCanvasElement.prototype.getContext = () => null; // 强制 WebGL 降级路径
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div id="app"></div>';
  app.__reset();
});

describe('UI 冒烟测试(jsdom,WebGL 自动降级)', () => {
  it('应用可挂载并显示项目列表页', () => {
    document.querySelector('#app')!.append(renderApp());
    expect(document.body.textContent).toContain('项目列表');
    expect(document.body.textContent).toContain('新建项目');
  });

  it('项目创建后持久化并能在列表中看到', () => {
    const p = projectStore.save(createProject('测试电站 A'));
    expect(projectStore.list()).toHaveLength(1);
    document.querySelector('#app')!.append(renderApp());
    expect(document.body.textContent).toContain('测试电站 A');
    expect(p.id).toBeTruthy();
  });

  it('通过 app 创建项目后自动跳转到场地建模页', () => {
    document.querySelector('#app')!.append(renderApp());
    app.createAndOpen('电站 B');
    expect(app.getState().page).toBe('site');
    expect(app.getState().project?.name).toBe('电站 B');
    // 场地页应渲染遮挡物相关 UI
    expect(document.body.textContent).toContain('遮挡物');
  });

  it('导航在六个页面间切换且无项目时禁用业务页', () => {
    document.querySelector('#app')!.append(renderApp());
    const navButtons = () => Array.from(document.querySelectorAll('.nav button')) as HTMLButtonElement[];
    // 初始无项目,场地等按钮禁用
    expect(navButtons().find((b) => b.textContent === '场地建模')?.disabled).toBe(true);
    app.createAndOpen('电站 C');
    expect(navButtons().find((b) => b.textContent === '场地建模')?.disabled).toBe(false);
    app.navigate('arrays');
    expect(document.body.textContent).toContain('光伏阵列');
    app.navigate('settings');
    expect(document.body.textContent).toContain('分析参数');
  });

  it('场地页可添加厂房并更新存储', () => {
    app.createAndOpen('电站 D');
    document.querySelector('#app')!.append(renderApp());
    app.navigate('site');
    const before = app.getState().project!.obstacles.length;
    const addBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === '+ 厂房') as HTMLButtonElement;
    addBtn.click();
    const after = projectStore.get(app.getState().project!.id)!.obstacles;
    expect(after.length).toBe(before + 1);
    expect(after[after.length - 1].type).toBe('building');
  });

  it('阵列页可新建阵列并计算最小行距', () => {
    app.createAndOpen('电站 E');
    document.querySelector('#app')!.append(renderApp());
    app.navigate('arrays');
    const addBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === '+ 新建阵列') as HTMLButtonElement;
    addBtn.click();
    const proj = app.getState().project!;
    expect(proj.arrays.length).toBeGreaterThan(0);
    // 行距计算卡片应出现非空结果
    expect(document.body.textContent).toContain('最小行距');
  });

  it('项目复制与删除正确', () => {
    const p = projectStore.save(createProject('原件'));
    const copy = projectStore.duplicate(p.id);
    expect(projectStore.list()).toHaveLength(2);
    expect(copy.name).toContain('副本');
    projectStore.remove(p.id);
    expect(projectStore.list().map((x) => x.id)).not.toContain(p.id);
  });

  it('项目 JSON 导入导出往返一致', () => {
    const p = projectStore.save(createProject('导出测试'));
    const json = projectStore.exportJSON(p);
    const imported = projectStore.importJSON(json);
    const saved = projectStore.save(imported);
    expect(saved.site).toEqual(p.site);
    expect(saved.arrays.length).toBe(p.arrays.length);
    expect(saved.id).not.toBe(p.id); // 导入生成新 id
  });
});
