/**
 * 项目持久化(localStorage)与导入导出。
 * 全部数据结构化克隆,不持有运行时引用。
 */
import type { Project } from './types';
import { createProject, deepClone, uid } from './defaults';

const STORAGE_KEY = 'pv-shading-projects-v1';
const ACTIVE_KEY = 'pv-shading-active-v1';

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export const projectStore = {
  list(): Project[] {
    return safeParse<Project[]>(localStorage.getItem(STORAGE_KEY), []);
  },

  save(project: Project): Project {
    const projects = this.list();
    const idx = projects.findIndex((p) => p.id === project.id);
    const stamped: Project = { ...deepClone(project), updatedAt: Date.now() };
    if (idx >= 0) projects[idx] = stamped;
    else projects.push(stamped);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
    return stamped;
  },

  remove(id: string): void {
    const projects = this.list().filter((p) => p.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
    if (this.getActiveId() === id) this.setActiveId(projects[0]?.id ?? null);
  },

  duplicate(id: string): Project {
    const src = this.list().find((p) => p.id === id);
    if (!src) throw new Error('项目不存在');
    const copy = deepClone(src);
    copy.id = uid('proj');
    copy.name = `${src.name} - 副本`;
    copy.createdAt = Date.now();
    copy.updatedAt = Date.now();
    return this.save(copy);
  },

  get(id: string): Project | undefined {
    return this.list().find((p) => p.id === id);
  },

  getActiveId(): string | null {
    return localStorage.getItem(ACTIVE_KEY);
  },

  setActiveId(id: string | null): void {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  },

  /** 导出为 JSON 文件内容字符串 */
  exportJSON(project: Project): string {
    return JSON.stringify(deepClone(project), null, 2);
  },

  /** 从 JSON 字符串导入,重新生成 id 避免冲突 */
  importJSON(json: string): Project {
    const data = JSON.parse(json) as Project;
    if (!data.site || !Array.isArray(data.arrays)) {
      throw new Error('文件格式不正确:缺少场地或阵列数据');
    }
    const project = createProject(data.name || '导入项目', data.site.year);
    return {
      ...project,
      ...deepClone(data),
      id: uid('proj'),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  },
};
