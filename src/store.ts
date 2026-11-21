import { AppSettings, DEFAULT_SETTINGS, Project, defaultProject, genId } from './types';

const LS_PROJECTS = 'pvsa.projects.v1';
const LS_SETTINGS = 'pvsa.settings.v1';
const LS_CURRENT = 'pvsa.current.v1';

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn('localStorage 写入失败', e);
  }
}

class Store {
  projects: Project[] = [];
  settings: AppSettings = { ...DEFAULT_SETTINGS };
  currentId: string | null = null;
  private listeners = new Set<() => void>();

  init() {
    this.projects = load<Project[]>(LS_PROJECTS, []);
    this.settings = { ...DEFAULT_SETTINGS, ...load<Partial<AppSettings>>(LS_SETTINGS, {}) };
    this.currentId = load<string | null>(LS_CURRENT, null);
    if (this.projects.length === 0) {
      this.projects.push(defaultProject('示例项目'));
      this.currentId = this.projects[0].id;
      this.persist();
    }
    if (this.currentId && !this.projects.find(p => p.id === this.currentId)) {
      this.currentId = this.projects[0]?.id ?? null;
    }
  }

  onChange(fn: () => void) {
    this.listeners.add(fn);
  }

  private emit() {
    this.listeners.forEach(f => f());
  }

  persist() {
    save(LS_PROJECTS, this.projects);
    save(LS_SETTINGS, this.settings);
    save(LS_CURRENT, this.currentId);
    this.emit();
  }

  get current(): Project | null {
    return this.projects.find(p => p.id === this.currentId) ?? null;
  }

  setCurrent(id: string) {
    this.currentId = id;
    this.persist();
  }

  createProject(name: string): Project {
    const p = defaultProject(name);
    this.projects.push(p);
    this.currentId = p.id;
    this.persist();
    return p;
  }

  duplicateProject(id: string) {
    const src = this.projects.find(p => p.id === id);
    if (!src) return;
    const copy: Project = JSON.parse(JSON.stringify(src));
    copy.id = genId();
    copy.name = src.name + ' (副本)';
    copy.createdAt = Date.now();
    copy.updatedAt = Date.now();
    this.projects.push(copy);
    this.persist();
  }

  renameProject(id: string, name: string) {
    const p = this.projects.find(p => p.id === id);
    if (!p) return;
    p.name = name;
    p.updatedAt = Date.now();
    this.persist();
  }

  deleteProject(id: string) {
    this.projects = this.projects.filter(p => p.id !== id);
    if (this.currentId === id) this.currentId = this.projects[0]?.id ?? null;
    this.persist();
  }

  touchCurrent() {
    const p = this.current;
    if (p) p.updatedAt = Date.now();
    this.persist();
  }

  exportProject(id: string): string {
    const p = this.projects.find(p => p.id === id);
    return JSON.stringify({ app: 'pv-shading-glare', version: 1, project: p }, null, 2);
  }

  importProject(json: string): Project {
    const data = JSON.parse(json);
    const p: Project = data.project ?? data;
    if (!p || !p.array || !p.location) throw new Error('文件格式不正确');
    p.id = genId();
    p.name = (p.name || '导入项目') + ' (导入)';
    p.updatedAt = Date.now();
    this.projects.push(p);
    this.currentId = p.id;
    this.persist();
    return p;
  }
}

export const store = new Store();
