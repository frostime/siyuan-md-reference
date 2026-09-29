const ATTR_KEY = 'custom-data-assets';
const ASSET_DIR = '/assets/md-references/';
const ASSET_PREFIX = 'assets/md-references/';
const SCHEMA_VERSION = 1;

async function apiJson(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${path} 返回了非 JSON 响应`);
  }
  if (!response.ok || !json || json.code !== 0) {
    throw new Error(json?.msg || `${path} 失败 (${response.status})`);
  }
  return json.data;
}

export async function getBlockAttrs(blockId) {
  return apiJson('/api/attr/getBlockAttrs', { id: blockId });
}

export function getAssetPathFromAttrs(attrs) {
  return String(attrs?.[ATTR_KEY] || '').trim();
}

export function isManagedAssetPath(path) {
  return typeof path === 'string'
    && path.startsWith(ASSET_PREFIX)
    && path.endsWith('.json')
    && !path.includes('..');
}

export async function readAsset(assetPath) {
  if (!isManagedAssetPath(assetPath)) {
    throw new Error('custom-data-assets 不是当前挂件管理的 JSON 资源');
  }
  const response = await fetch('/api/file/getFile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: `/data/${assetPath}` }),
  });

  if (response.ok) return response.text();

  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  if (json?.code === 404) return null;
  throw new Error(json?.msg || `读取资源失败 (${response.status})`);
}

async function uploadDataAsset(blockId, data) {
  const filename = `${blockId}.json`;
  const form = new FormData();
  form.append('assetsDirPath', ASSET_DIR);
  form.append(
    'file[]',
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' }),
    filename,
  );

  const response = await fetch('/api/asset/upload', { method: 'POST', body: form });
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new Error('/api/asset/upload 返回了非 JSON 响应');
  }
  if (!response.ok || !json || json.code !== 0) {
    throw new Error(json?.msg || `资源上传失败 (${response.status})`);
  }

  const errFiles = json.data?.errFiles || [];
  if (errFiles.length) throw new Error(`资源上传失败：${errFiles.join(', ')}`);
  const succMap = json.data?.succMap || {};
  const assetPath = String(succMap[filename] || Object.values(succMap)[0] || '');
  if (!isManagedAssetPath(assetPath)) throw new Error('资源上传返回了异常路径');
  return assetPath;
}

async function bindAsset(blockId, assetPath) {
  await apiJson('/api/attr/setBlockAttrs', {
    id: blockId,
    attrs: { [ATTR_KEY]: assetPath },
  });
}

export async function saveData(blockId, data) {
  // 先确认块存在，再上传。避免刚插入的 Widget 尚未进入块树时产生孤儿写入。
  await getBlockAttrs(blockId);

  // 上传新版本；不覆盖、不主动删除旧 asset。
  const assetPath = await uploadDataAsset(blockId, data);

  // 自定义块属性必须使用 custom- 前缀。
  await bindAsset(blockId, assetPath);
  return assetPath;
}

export function createEmptyData(blockId) {
  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    ownerBlockId: blockId,
    createdAt: now,
    updatedAt: now,
    items: [],
  };
}

export function normalizeData(value, blockId) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.items)) {
    throw new Error('Markdown Reference 数据格式无效');
  }
  if (Number(value.schemaVersion) !== SCHEMA_VERSION) {
    throw new Error(`不支持的数据版本：${value.schemaVersion}`);
  }
  if (String(value.ownerBlockId || '') !== blockId) {
    throw new Error('资源 ownerBlockId 与当前挂件不一致');
  }

  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    ownerBlockId: blockId,
    createdAt: String(value.createdAt || now),
    updatedAt: String(value.updatedAt || value.createdAt || now),
    items: value.items.map(item => ({
      id: String(item?.id || newItemId()),
      title: String(item?.title || '未命名'),
      markdown: String(item?.markdown || ''),
      createdAt: String(item?.createdAt || now),
      updatedAt: String(item?.updatedAt || item?.createdAt || now),
    })),
  };
}

export function newItemId() {
  return crypto.randomUUID?.() || `item-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
