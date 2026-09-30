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
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
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
  render();
}

async function render() {
  const item = currentItem();
  if (item && !state.activeId) state.activeId = item.id;

  const tabs = state.data.items.map(entry => `
    <button class="tab${entry.id === state.activeId ? ' active' : ''}"
      data-action="select" data-id="${escapeHtml(entry.id)}" title="${escapeHtml(entry.title)}">
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
      ? `<button class="btn" data-action="copy-md">复制 Markdown</button><button class="btn" data-action="copy-text">复制纯文本</button><button class="btn" data-action="edit">编辑</button><button class="btn danger" data-action="delete">删除</button>`
      : '';

  app.innerHTML = `
    <header class="topbar">
      <div class="tabs">${tabs}</div>
      <button class="icon-btn" data-action="refresh" title="重载挂件（主题/字体设置变更后点这里）">↻</button>
      <button class="icon-btn" data-action="add" title="新建">＋</button>
    </header>
    <main class="content">${body}</main>
    <footer class="actions">${actions}</footer>`;
  app.setAttribute('aria-busy', 'false');
  bindEvents();
}

function bindEvents() {
  app.querySelectorAll('[data-action]').forEach(el => el.addEventListener('click', onAction));
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

async function onAction(event) {
  const { action, id } = event.currentTarget.dataset;
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
  if (action === 'copy-md') return copyMarkdown();
  if (action === 'copy-text') return copyText();
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
    render();
    toast('已保存');
  } catch (error) {
    state.data = snapshot;
    state.activeId = oldActive;
    state.dirty = true;
    render();
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
    render();
    toast('已删除');
  } catch (error) {
    state.data = snapshot;
    state.activeId = oldActive;
    render();
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

async function copyText() {
  const item = currentItem();
  if (!item) return;
  try {
    const preview = document.getElementById('preview');
    const text = preview?.innerText ?? '';
    await navigator.clipboard.writeText(text);
    toast('纯文本已复制');
  } catch (error) {
    toast(`复制失败：${error.message}`, true);
  }
}

load().catch(error => {
  app.setAttribute('aria-busy', 'false');
  app.innerHTML = `<div class="fatal"><strong>Markdown Reference 加载失败</strong><div>${escapeHtml(error.message)}</div></div>`;
});
