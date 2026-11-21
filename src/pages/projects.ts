import { store } from '../store';
import { el, fmtNum } from '../ui';

function download(filename: string, text: string) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

export function renderProjects(root: HTMLElement): () => void {
  const page = el('div', { className: 'scroll-page' });
  root.append(page);

  function refresh() {
    page.innerHTML = '';
    const card = el('div', { className: 'card' });
    card.append(
      el('h2', {}, ['项目列表']),
      el('div', { className: 'btn-row' }, [
        el('button', {
          className: 'primary',
          onClick: () => {
            const name = prompt('项目名称', `项目 ${store.projects.length + 1}`);
            if (name) { store.createProject(name); location.hash = '#/site'; }
          },
        }, ['＋ 新建项目']),
        el('button', {
          onClick: () => {
            const input = el('input', { type: 'file', accept: '.json' });
            input.addEventListener('change', async () => {
              const f = input.files?.[0];
              if (!f) return;
              try {
                store.importProject(await f.text());
                refresh();
              } catch (e) {
                alert('导入失败:' + (e as Error).message);
              }
            });
            input.click();
          },
        }, ['导入项目 (JSON)']),
      ]),
    );

    const table = el('table', { className: 'data' });
    table.append(el('tr', {}, [
      el('th', {}, ['名称']), el('th', {}, ['位置']),
      el('th', {}, ['阵列规模']), el('th', {}, ['遮挡物']),
      el('th', {}, ['更新时间']), el('th', {}, ['操作']),
    ]));
    for (const p of store.projects) {
      const arr = p.array;
      const tr = el('tr', {}, [
        el('td', {}, [p.name + (p.id === store.currentId ? ' ●' : '')]),
        el('td', {}, [`${fmtNum(p.location.lat)}°N, ${fmtNum(p.location.lon)}°E`]),
        el('td', {}, [`${arr.rows} 排 × ${arr.modulesPerRow} 块 = ${fmtNum(arr.rows * arr.modulesPerRow, 0)} 块`]),
        el('td', {}, [String(p.obstructions.length)]),
        el('td', {}, [new Date(p.updatedAt).toLocaleString('zh-CN')]),
        el('td', {}, [
          el('button', { onClick: () => { store.setCurrent(p.id); location.hash = '#/site'; } }, ['打开']),
          ' ',
          el('button', {
            onClick: () => {
              const name = prompt('重命名', p.name);
              if (name) { store.renameProject(p.id, name); refresh(); }
            },
          }, ['重命名']),
          ' ',
          el('button', { onClick: () => { store.duplicateProject(p.id); refresh(); } }, ['复制']),
          ' ',
          el('button', { onClick: () => download(`${p.name}.json`, store.exportProject(p.id)) }, ['导出']),
          ' ',
          el('button', {
            className: 'danger',
            onClick: () => {
              if (confirm(`确定删除项目「${p.name}」?`)) { store.deleteProject(p.id); refresh(); }
            },
          }, ['删除']),
        ]),
      ]);
      table.append(tr);
    }
    card.append(table);
    card.append(el('p', { className: 'muted' }, [
      '项目数据保存在浏览器 localStorage 中, 清除浏览器数据前请先导出备份。',
    ]));
    page.append(card);
  }

  refresh();
  return () => {};
}
