/* 注入宿主样式标记，防止 refresh 时重复注入 */
const HOST_STYLE_MARK = 'data-mdr-host-style';

/* @font-face 等会用相对 url，若不绝对化会基于挂件自身 URL 错误解析 */
function absolutizeCssUrls(cssText, base) {
  if (!cssText.includes('url(')) return cssText;
  return cssText.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (match, quote, url) => {
    if (!url || /^(?:https?:|data:|blob:)/i.test(url)) return match;
    try {
      return `url(${quote}${new URL(url, base).href}${quote})`;
    } catch {
      return match;
    }
  });
}

export function getHostLuteConstructor() {
  try {
    return window.parent?.Lute || null;
  } catch {
    return null;
  }
}

/* 把宿主 head 里的所有样式克隆进本 iframe，并镜像 html 的 data-* 与内联变量。
   主题/设置变更不会实时同步：由顶栏 refresh 按钮重载挂件重新注入。 */
export function syncHostStyles() {
  try {
    if (window.parent === window) return 0;
    const parentDoc = window.parent.document;

    const hostRoot = parentDoc.documentElement;
    const guestRoot = document.documentElement;
    for (const attr of [...hostRoot.attributes]) {
      if (attr.name === 'style' || attr.name.startsWith('data-')) {
        guestRoot.setAttribute(attr.name, attr.value);
      }
    }

    document.head.querySelectorAll(`[${HOST_STYLE_MARK}]`).forEach(node => node.remove());

    /* 插到自身 styles.css 之前：平级规则我们后加载者胜出 */
    const anchor = document.querySelector('link[href="styles.css"]') || document.head.firstElementChild;
    const sources = parentDoc.head.querySelectorAll('style, link[rel~="stylesheet"]');
    let index = 0;
    for (const node of sources) {
      let clone;
      if (node.tagName === 'STYLE') {
        clone = document.createElement('style');
        clone.textContent = absolutizeCssUrls(node.textContent, parentDoc.baseURI);
      } else {
        clone = document.createElement('link');
        for (const attr of node.attributes) clone.setAttribute(attr.name, attr.value);
        clone.setAttribute('href', new URL(node.getAttribute('href'), parentDoc.baseURI).href);
      }
      clone.setAttribute(HOST_STYLE_MARK, String(index));
      document.head.insertBefore(clone, anchor);
      index += 1;
    }
    return index;
  } catch {
    return -1;
  }
}

export function getWidgetBlockId() {
  try {
    const frame = window.frameElement;
    const node = frame?.closest?.('[data-node-id][data-type="NodeWidget"]')
      || frame?.parentElement?.closest?.('[data-node-id]')
      || null;
    return node?.getAttribute('data-node-id') || '';
  } catch {
    return '';
  }
}

// 只读宿主。绝不修改 parent DOM / frameElement。
export function applyHostThemeOnce() {
  try {
    if (window.parent === window) return;
    const parentDocument = window.parent.document;
    const sourceRoot = parentDocument.documentElement;
    const sourceStyle = window.parent.getComputedStyle(sourceRoot);
    const target = document.documentElement.style;

    for (let i = 0; i < sourceStyle.length; i++) {
      const name = sourceStyle.item(i);
      if (!name?.startsWith('--b3-')) continue;
      const value = sourceStyle.getPropertyValue(name).trim();
      if (value) target.setProperty(name, value);
    }

    const editor = parentDocument.querySelector('.protyle-wysiwyg, .b3-typography');
    if (editor) {
      const cs = window.parent.getComputedStyle(editor);
      if (cs.fontFamily) target.setProperty('--mdr-font-family', cs.fontFamily);
      if (cs.fontSize) target.setProperty('--mdr-font-size', cs.fontSize);
      if (cs.lineHeight) target.setProperty('--mdr-line-height', cs.lineHeight);
    }
  } catch {
    // 主题桥接失败不影响功能。
  }
}
