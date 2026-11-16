/** 项目列表页:增删改查、复制、导入导出 */
import { app } from '../app';
import { projectStore } from '../store';
import { h, toast, download } from '../dom';
import type { Project } from '../types';

export function renderProjectsPage(): HTMLElement {
  const projects = projectStore.list();

  const create = () => {
    const name = `光伏项目 ${projects.length + 1}`;
    const p = app.createAndOpen(name);
    toast(`已创建「${p.name}」`);
  };

  const importFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const p = projectStore.save(projectStore.importJSON(String(reader.result)));
        app.openProject(p);
        toast('导入成功');
      } catch (err) {
        toast(`导入失败:${(err as Error).message}`);
      }
    };
    reader.readAsText(file);
  };

  const fileInput = h('input', {
    type: 'file',
    accept: 'application/json',
    style: 'display:none',
  }) as HTMLInputElement;
  fileInput.addEventListener('change', () => {
    if (fileInput.files?.[0]) importFile(fileInput.files[0]);
    fileInput.value = '';
  });

  const rows = projects.map((p: Project) =>
    h('tr', {}, [
      h('td', {}, [p.name]),
      h('td', { class: 'mono' }, [
        `${p.arrays.reduce((n, a) => n + a.rows * a.cols, 0)} 块 / ${p.obstacles.length} 遮挡物`,
      ]),
      h('td', {}, [new Date(p.updatedAt).toLocaleString('zh-CN')]),
      h('td', {}, [
        h('div', { class: 'row' }, [
          h('button', {
            class: 'btn',
            onclick: () => app.openProject(p),
          }, ['打开']),
          h('button', {
            class: 'btn secondary',
            onclick: () => {
              const c = projectStore.duplicate(p.id);
              app.navigate('projects');
              rerender();
              toast(`已复制为「${c.name}」`);
            },
          }, ['复制']),
          h('button', {
            class: 'btn ghost',
            onclick: () => download(`${p.name}.json`, projectStore.exportJSON(p)),
          }, ['导出']),
          h('button', {
            class: 'btn danger',
            onclick: () => {
              if (confirm(`确认删除「${p.name}」?此操作不可恢复。`)) {
                projectStore.remove(p.id);
                rerender();
                toast('已删除');
              }
            },
          }, ['删除']),
        ]),
      ]),
    ]),
  );

  const table = projects.length
    ? h('table', {}, [
        h('thead', {}, [h('tr', {}, [h('th', {}, ['项目名称']), h('th', {}, ['规模']), h('th', {}, ['更新时间']), h('th', {}, ['操作'])])]),
        h('tbody', {}, rows),
      ])
    : h('div', { class: 'empty' }, [
        h('div', { class: 'big' }, ['☀']),
        h('p', {}, ['还没有项目,点击右上角"新建项目"开始。']),
      ]);

  const wrapper = h('div', {}, [
    h('div', { class: 'card' }, [
      h('div', { class: 'row' }, [
        h('h2', { style: 'margin:0' }, ['项目列表']),
        h('div', { class: 'spacer' }),
        h('button', { class: 'btn', onclick: create }, ['+ 新建项目']),
        h('button', { class: 'btn secondary', onclick: () => fileInput.click() }, ['导入 JSON']),
        fileInput,
      ]),
    ]),
    h('div', { class: 'card' }, [table]),
  ]);

  function rerender(): void {
    const mount = document.getElementById('page-mount');
    if (mount) {
      mount.innerHTML = '';
      mount.append(renderProjectsPage());
    }
  }

  return wrapper;
}
