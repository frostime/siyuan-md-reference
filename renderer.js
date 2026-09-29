import { getHostLuteConstructor } from './host.js';

const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;
// 挂件随包离线捆绑的 KaTeX（与思源内置版本一致：0.16.9）。
const KATEX_BASE = 'vendor/katex';
let lute = null;
let katexReady = null;

function loadStylesheet(url, id) {
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = url;
  document.head.appendChild(link);
}

function loadScript(url, id) {
  if (document.getElementById(id)) return;
  const script = document.createElement('script');
  script.id = id;
  script.src = url;
  document.head.appendChild(script);
}

function loadKatex() {
  katexReady ||= new Promise((resolve, reject) => {
    try {
      loadStylesheet(`${KATEX_BASE}/katex.min.css`, 'mdr-katex-style');
      loadScript(`${KATEX_BASE}/katex.min.js`, 'mdr-katex-script');
      loadScript(`${KATEX_BASE}/mhchem.min.js`, 'mdr-katex-mhchem');
      const started = Date.now();
      const check = () => {
        if (window.katex?.renderToString) return resolve();
        if (Date.now() - started > 10000) {
          return reject(new Error('KaTeX 资源加载失败，无法渲染公式'));
        }
        setTimeout(check, 100);
      };
      check();
    } catch (error) {
      reject(error);
    }
  });
  return katexReady;
}

function byteLength(text) {
  return new TextEncoder().encode(text).byteLength;
}

function getLute() {
  if (lute) return lute;
  const Lute = getHostLuteConstructor();
  if (!Lute?.New) {
    throw new Error('无法访问思源前端 Lute；当前版本不支持此挂件');
  }
  lute = Lute.New();
  lute.SetSanitize(true);
  lute.SetCodeSyntaxHighlight(false);
  lute.SetSoftBreak2HardBreak(false);
  lute.SetHeadingID(false);
  lute.SetYamlFrontMatter(false);
  lute.SetFootnotes(true);
  lute.SetGFMStrikethrough(true);
  lute.SetInlineMath(true);
  return lute;
}

function safeUrl(value, kind) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (raw.startsWith('#')) return raw;
  if (raw.startsWith('assets/')) return `/${raw}`;
  if (raw.startsWith('/assets/')) return raw;
  if (kind === 'src' && raw.startsWith('data:image/')) return raw;
  try {
    const url = new URL(raw, location.origin);
    const protocols = kind === 'href'
      ? new Set(['http:', 'https:', 'mailto:', 'siyuan:'])
      : new Set(['http:', 'https:']);
    return protocols.has(url.protocol) ? raw : null;
  } catch {
    return null;
  }
}

function sanitizeHtml(html) {
  const template = document.createElement('template');
  template.innerHTML = html;

  template.content.querySelectorAll(
    'script,iframe,object,embed,form,meta,base,link,style,svg,math,button,select,textarea',
  ).forEach(node => node.remove());

  for (const el of template.content.querySelectorAll('*')) {
    if (el.tagName === 'INPUT') {
      if ((el.getAttribute('type') || '').toLowerCase() !== 'checkbox') {
        el.remove();
        continue;
      }
      el.setAttribute('disabled', '');
    }

    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on') || name === 'srcdoc' || name === 'style' || name === 'contenteditable') {
        el.removeAttribute(attr.name);
        continue;
      }
      if (name === 'href' || name === 'xlink:href') {
        const safe = safeUrl(attr.value, 'href');
        if (safe === null) el.removeAttribute(attr.name);
        else el.setAttribute(attr.name, safe);
      }
      if (name === 'src' || name === 'poster') {
        const safe = safeUrl(attr.value, 'src');
        if (safe === null) el.removeAttribute(attr.name);
        else el.setAttribute(attr.name, safe);
      }
    }

    if (el.tagName === 'A' && el.hasAttribute('href')) {
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noopener noreferrer');
    }
    if (el.tagName === 'IMG') el.setAttribute('loading', 'lazy');
  }

  return template.innerHTML;
}

// Lute 输出的 <span|div class="language-math"> 只含公式原文（定界符已被消费）；
// 对每个元素直接调用 katex.renderToString，与思源主编辑器的 mathRender 同一思路。
async function renderMath(container) {
  const nodes = container.querySelectorAll('.language-math');
  if (!nodes.length) return;
  await loadKatex();
  for (const el of nodes) {
    const isBlock = el.tagName === 'DIV';
    try {
      el.innerHTML = window.katex.renderToString(el.textContent || '', {
        displayMode: isBlock,
        output: 'html',
        throwOnError: false,
        strict: (code) => (code === 'unicodeTextInMathMode' ? 'ignore' : 'warn'),
      });
    } catch (error) {
      el.classList.add('mdr-math-error');
      el.textContent = error?.message || String(error);
    }
  }
}

export async function renderMarkdown(markdown) {
  const source = String(markdown || '');
  if (byteLength(source) > MAX_MARKDOWN_BYTES) {
    throw new Error('单条 Markdown 超过 2 MiB，拒绝渲染');
  }
  const html = getLute().MarkdownStr('md-reference', source);
  const container = document.createElement('div');
  container.innerHTML = sanitizeHtml(String(html || ''));
  await renderMath(container);
  return container.innerHTML;
}
