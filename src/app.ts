/**
 * 轻量全局状态(发布订阅),管理当前项目与页面导航。
 */
import type { Project } from './types';
import { createProject } from './defaults';
import { projectStore } from './store';

export type PageId = 'projects' | 'site' | 'arrays' | 'shading' | 'glare' | 'settings';

interface AppState {
  page: PageId;
  project: Project | null;
}

type Listener = (state: AppState) => void;

function initialState(): AppState {
  const activeId = projectStore.getActiveId();
  const project = (activeId && projectStore.get(activeId)) || projectStore.list()[0] || null;
  return { page: 'projects', project };
}

let state: AppState = initialState();
const listeners = new Set<Listener>();

export const app = {
  /** 测试用:重置内存状态(不清理 localStorage) */
  __reset(): void {
    state = { page: 'projects', project: null };
    listeners.clear();
  },

  getState(): AppState {
    return state;
  },

  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  set(patch: Partial<AppState>): void {
    state = { ...state, ...patch };
    listeners.forEach((fn) => fn(state));
  },

  navigate(page: PageId): void {
    this.set({ page });
  },

  openProject(project: Project): void {
    projectStore.setActiveId(project.id);
    this.set({ project, page: 'site' });
  },

  /** 更新当前项目并持久化 */
  updateProject(mutator: (p: Project) => Project): void {
    if (!state.project) return;
    const next = mutator(structuredClone(state.project));
    const saved = projectStore.save(next);
    this.set({ project: saved });
  },

  createAndOpen(name: string): Project {
    const p = projectStore.save(createProject(name));
    this.openProject(p);
    return p;
  },
};
