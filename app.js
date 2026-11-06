import { applyHostThemeOnce, getWidgetBlockId, syncHostStyles } from './host.js';
import {
  createEmptyData,
  getAssetPathFromAttrs,
  getBlockAttrs,
  ensureMinBlockHeight,
  isManagedAssetPath,
  newItemId,
  normalizeData,
  readAsset,
  saveData,
} from './storage.js';
import { renderMarkdown } from './renderer.js';

const app = document.getElementById('app');
const state = {
  blockId: '',
  assetPath: '',
  data: null,
  activeId: '',
  editing: false,
  editMode: '',
  draftTitle: '',
  draftMarkdown: '',
  dirty: false,
  saving: false,
  toastTimer: 0,
  tabsScroll: 0,
  menuOpen: false,
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const ICONS = {
  add: '<path d="M12 5v14M5 12h14"/>',
  refresh: '<path d="M20 5v6h-6"/><path d="M20.5 11a8.5 8.5 0 1 0-1.2 5.4"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
  edit: '<path d="M4 20h4L20 8a2.83 2.83 0 0 0-4-4L4 16v4Z"/><path d="M13.5 5.5l5 5"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  trash: '<path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/>',
};

function icon(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
}

function iconButton(action, label) {
  return `<button class="icon-btn" data-action="${action}" title="${label}" aria-label="${label}">${icon(action)}</button>`;
}

function currentItem() {
  return state.data.items.find(item => item.id === state.activeId) || state.data.items[0] || null;
}

function toast(message, error = false) {
  clearTimeout(state.toastTimer);
  app.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = `toast${error ? ' error' : ''}`;
  el.textContent = message;
  app.appendChild(el);
  state.toastTimer = setTimeout(() => el.remove(), error ? 5000 : 1800);
}

async function load() {
  // 先注入宿主样式（含主题变量与编辑器字号规则），再走变量桥接兕底。
  syncHostStyles();
  applyHostThemeOnce();
  state.blockId = getWidgetBlockId();
  if (!state.blockId) throw new Error('无法获取当前挂件块 ID');

  const attrs = await getBlockAttrs(state.blockId);
  const assetPath = getAssetPathFromAttrs(attrs);
  state.assetPath = assetPath;
  // 抬高度失败不影响数据加载。
  await ensureMinBlockHeight(state.blockId, attrs).catch(() => {});

  if (!assetPath) {
    state.data = createEmptyData(state.blockId);
  } else {
    if (!isManagedAssetPath(assetPath)) {
      throw new Error('custom-data-assets 指向了非 Markdown Reference 资源');
    }
    const raw = await readAsset(assetPath);
    if (raw === null) throw new Error('挂件引用的数据文件不存在');
    state.data = normalizeData(JSON.parse(raw), state.blockId);
  }

  state.activeId = state.data.items[0]?.id || '';
  await render();
}

async function render() {
  const item = currentItem();
  if (item && !state.activeId) state.activeId = item.id;
  state.menuOpen = false;
  // 重建 DOM 会丢滚动位置；tab 多到溢出时切一下资料就会莫名跳回开头。
  const prevTabs = app.querySelector('.tabs');
  if (prevTabs) state.tabsScroll = prevTabs.scrollLeft;

  const tabs = state.data.items.map(entry => `
    <button class="tab${entry.id === state.activeId ? ' active' : ''}"
      draggable="true" data-action="select" data-id="${escapeHtml(entry.id)}"
      title="${escapeHtml(entry.title)}（拖动可调整顺序）">
      ${escapeHtml(entry.title)}
    </button>`).join('');

  let body;
  if (state.editing) {
    body = `
      <div class="editor">
        <input id="titleInput" class="title-input" value="${escapeHtml(state.draftTitle)}" placeholder="标题">
        <textarea id="markdownInput" class="markdown-input" spellcheck="false" placeholder="粘贴 Markdown…">${escapeHtml(state.draftMarkdown)}</textarea>
      </div>`;
  } else if (item) {
    let html;
    try {
      html = await renderMarkdown(item.markdown);
    } catch (error) {
      html = `<div class="render-error">${escapeHtml(error.message)}</div>`;
    }
    body = `<article id="preview" class="preview b3-typography">${html || '<p></p>'}</article>`;
  } else {
    body = `<div class="empty"><button class="btn primary" data-action="add">＋ 添加 Markdown 参考资料</button></div>`;
  }

  const actions = state.editing
    ? `<button class="btn" data-action="cancel">取消</button><button class="btn primary" data-action="save">保存</button>`
    : item
      ? `${iconButton('add', '新建')}<span class="sep"></span>${iconButton('copy', '复制 Markdown')}${iconButton('edit', '编辑')}${moreMenu()}`
      : iconButton('add', '新建');

  app.innerHTML = `
    <header class="topbar">
      <div class="tabs">${tabs}</div>
      ${actions}
    </header>
    <main class="content">${body}</main>`;
  app.setAttribute('aria-busy', 'false');
  const tabsEl = app.querySelector('.tabs');
  if (tabsEl) tabsEl.scrollLeft = state.tabsScroll;
  bindEvents();
}

function moreMenu() {
  return `
    <div class="menu-wrap">
      <button class="icon-btn more" data-action="menu" title="更多" aria-label="更多"
        aria-haspopup="menu" aria-expanded="${state.menuOpen}">${icon('more')}</button>
      <div class="menu${state.menuOpen ? ' open' : ''}" role="menu">
        <button role="menuitem" data-action="refresh" title="主题或字体设置变更后，重载挂件以应用新样式">${icon('refresh')}重载挂件</button>
        <button role="menuitem" class="danger" data-action="delete">${icon('trash')}删除当前资料</button>
      </div>
    </div>`;
}

function syncMenu() {
  app.querySelector('.menu')?.classList.toggle('open', state.menuOpen);
  app.querySelector('[data-action="menu"]')?.setAttribute('aria-expanded', String(state.menuOpen));
}

function closeMenu() {
  if (!state.menuOpen) return;
  state.menuOpen = false;
  syncMenu();
}

function bindEvents() {
  app.querySelectorAll('[data-action]').forEach(el => el.addEventListener('click', onAction));
  const tabsEl = app.querySelector('.tabs');
  tabsEl?.addEventListener('dragstart', onTabDragStart);
  tabsEl?.addEventListener('dragover', onTabDragOver);
  tabsEl?.addEventListener('dragend', onTabDragEnd);
  document.getElementById('titleInput')?.addEventListener('input', event => {
    state.draftTitle = event.target.value;
    state.dirty = true;
  });
  const textarea = document.getElementById('markdownInput');
  textarea?.addEventListener('input', event => {
    state.draftMarkdown = event.target.value;
    state.dirty = true;
  });
  textarea?.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void saveEdit();
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      textarea.setRangeText('  ', start, end, 'end');
      state.draftMarkdown = textarea.value;
      state.dirty = true;
    }
  });
}

/* 拖动 tab 调整顺序：拖动过程中直接搬 DOM 节点（其他 tab 实时让位），
   松手时才把最终顺序写回数据并保存一次——每次保存都会上传一个新的 asset 文件。 */
let draggingTabId = '';

function tabElements() {
  return [...app.querySelectorAll('.tabs .tab')];
}

function onTabDragStart(event) {
  const tab = event.target.closest?.('.tab');
  if (!tab || state.saving) {
    event.preventDefault();
    return;
  }
  draggingTabId = tab.dataset.id;
  // Firefox 不 setData 就不启动拖拽；Chromium 无此行也照常，两行成本换跨浏览器一致。
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', draggingTabId);
  tab.classList.add('dragging');
}

function onTabDragOver(event) {
  if (!draggingTabId) return;
  // 不 preventDefault 则不允许 drop，光标会显示禁止图标。
  event.preventDefault();
  const dragged = tabElements().find(el => el.dataset.id === draggingTabId);
  const over = event.target.closest?.('.tab');
  if (!dragged || !over || over === dragged) return;
  const rect = over.getBoundingClientRect();
  // 越过中线才让位，避免指针停在缝隙处来回抖。
  if (event.clientX > rect.left + rect.width / 2) over.after(dragged);
  else over.before(dragged);
}

function onTabDragEnd() {
  tabElements().find(el => el.dataset.id === draggingTabId)?.classList.remove('dragging');
  const domIds = tabElements().map(el => el.dataset.id);
  draggingTabId = '';
  void applyTabOrder(domIds);
}

async function applyTabOrder(domIds) {
  const currentIds = state.data.items.map(item => item.id);
  if (domIds.length !== currentIds.length) return;
  if (domIds.every((id, index) => id === currentIds[index])) return;
  const byId = new Map(state.data.items.map(item => [item.id, item]));
  if (domIds.some(id => !byId.has(id))) return;

  const snapshot = structuredClone(state.data);
  state.data.items = domIds.map(id => byId.get(id));
  try {
    await persist();
  } catch (error) {
    state.data = snapshot;
    await render();
    toast(`排序失败：${error.message}`, true);
    return;
  }
  await render();
  toast('顺序已保存');
}

async function onAction(event) {
  const { action, id } = event.currentTarget.dataset;
  if (action === 'menu') {
    state.menuOpen = !state.menuOpen;
    syncMenu();
    return;
  }
  closeMenu();
  if (action === 'select') {
    if (state.editing && state.dirty && !confirm('当前编辑尚未保存，确定切换吗？')) return;
    state.editing = false;
    state.editMode = '';
    state.dirty = false;
    state.activeId = id;
    render();
    return;
  }
  if (action === 'refresh') {
    window.location.reload();
    return;
  }
  if (action === 'add') return add();
  if (action === 'edit') return edit();
  if (action === 'cancel') {
    state.editing = false;
    state.editMode = '';
    state.dirty = false;
    render();
    return;
  }
  if (action === 'save') return saveEdit();
  if (action === 'delete') return deleteItem();
  if (action === 'copy') return copyMarkdown();
}

function add() {
  if (state.editing && state.dirty && !confirm('当前编辑尚未保存，确定放弃吗？')) return;
  state.draftTitle = `参考资料 ${state.data.items.length + 1}`;
  state.draftMarkdown = '';
  state.editMode = 'new';
  state.editing = true;
  state.dirty = true;
  render();
  queueMicrotask(() => document.getElementById('markdownInput')?.focus());
}

function edit() {
  const item = currentItem();
  if (!item) return;
  state.draftTitle = item.title;
  state.draftMarkdown = item.markdown;
  state.editMode = 'existing';
  state.editing = true;
  state.dirty = false;
  render();
}

async function persist() {
  if (state.saving) throw new Error('正在保存');
  state.saving = true;
  try {
    state.data.updatedAt = new Date().toISOString();
    state.assetPath = await saveData(state.blockId, state.data);
  } finally {
    state.saving = false;
  }
}

async function saveEdit() {
  if (state.saving) return;
  const snapshot = structuredClone(state.data);
  const oldActive = state.activeId;
  const now = new Date().toISOString();
  try {
    if (state.editMode === 'new') {
      const id = newItemId();
      state.data.items.push({
        id,
        title: state.draftTitle.trim() || '未命名',
        markdown: state.draftMarkdown,
        createdAt: now,
        updatedAt: now,
      });
      state.activeId = id;
    } else {
      const item = currentItem();
      if (!item) throw new Error('当前资料不存在');
      item.title = state.draftTitle.trim() || '未命名';
      item.markdown = state.draftMarkdown;
      item.updatedAt = now;
    }

    await persist();
    state.editing = false;
    state.editMode = '';
    state.dirty = false;
    await render();
    toast('已保存');
  } catch (error) {
    state.data = snapshot;
    state.activeId = oldActive;
    state.dirty = true;
    await render();
    toast(`保存失败：${error.message}`, true);
  }
}

async function deleteItem() {
  const item = currentItem();
  if (!item || state.saving || !confirm(`删除“${item.title}”？`)) return;
  const snapshot = structuredClone(state.data);
  const oldActive = state.activeId;
  const index = state.data.items.findIndex(entry => entry.id === item.id);
  state.data.items.splice(index, 1);
  state.activeId = state.data.items[Math.min(index, state.data.items.length - 1)]?.id || '';
  try {
    await persist();
    await render();
    toast('已删除');
  } catch (error) {
    state.data = snapshot;
    state.activeId = oldActive;
    await render();
    toast(`删除失败：${error.message}`, true);
  }
}

async function copyMarkdown() {
  const item = currentItem();
  if (!item) return;
  try {
    await navigator.clipboard.writeText(item.markdown);
    toast('Markdown 已复制');
  } catch (error) {
    toast(`复制失败：${error.message}`, true);
  }
}

document.addEventListener('click', event => {
  if (!state.menuOpen) return;
  if (event.target.closest?.('.menu-wrap')) return;
  closeMenu();
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeMenu();
});

// 点击挂件外部时 iframe 内的 document 收不到 click，只能靠失焦收起菜单。
window.addEventListener('blur', closeMenu);

load().catch(error => {
  app.setAttribute('aria-busy', 'false');
  app.innerHTML = `<div class="fatal"><strong>Markdown Reference 加载失败</strong><div>${escapeHtml(error.message)}</div></div>`;
});
