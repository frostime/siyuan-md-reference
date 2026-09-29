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

export function getHostLuteConstructor() {
  try {
    return window.parent?.Lute || null;
  } catch {
    return null;
  }
}
