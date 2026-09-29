import { getHostLuteConstructor } from './host.js';

const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;
let lute = null;

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

export function renderMarkdown(markdown) {
  const source = String(markdown || '');
  if (byteLength(source) > MAX_MARKDOWN_BYTES) {
    throw new Error('单条 Markdown 超过 2 MiB，拒绝渲染');
  }
  const html = getLute().MarkdownStr('md-reference', source);
  return sanitizeHtml(String(html || ''));
}
