# Markdown Reference v0.5.0

这是一次与 v0.x 旧测试数据完全割裂的重写版本。

## 数据模型

- 只读取/写入块属性 `custom-data-assets`。
- Markdown 集合保存为 `data/assets/md-references/` 下的 JSON asset。
- 保存使用 `/api/asset/upload`；不使用 `putFile`、`removeFile`。
- 新版本 asset 绑定成功后，旧版本自然成为未引用资源，由思源自身机制清理。
- 不读取旧版 `data-assets`，不探测旧目录，不做迁移。

## 宿主边界

- `window.frameElement` 只读取块 ID，绝不修改。
- 不修改任何父 Protyle DOM。
- 不设置 iframe 尺寸。
- 不使用 MutationObserver、自动保存或轮询。

## Markdown 渲染

使用思源前端已经加载的 `Lute` 构造器在 iframe 侧渲染，不调用 `/api/lute/md2html`。Lute 输出还会再经过一层 DOM 过滤。

## 主题

启动时只读复制父页面的 `--b3-*` CSS variables 和编辑器字体指标。不注入完整第三方 `theme.css`，避免在当前稳定性验证阶段增加额外变量。

## 安装/测试

1. 删除旧 `data/widgets/md-reference/`。
2. 测试数据阶段建议同时删除旧 `data/assets/md-references/`。
3. 将本包中的 `md-reference/` 放入 `<workspace>/data/widgets/`。
4. 重启思源后重新插入一个全新挂件。

本版不兼容任何旧测试数据。
