/**
 * IMA 知识库上传工具
 * 使用 IMA OpenAPI 上传文件到腾讯 IMA 知识库
 */

import { ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { logMessage } from './storeManager';

const IMA_API_BASE = 'https://ima.qq.com/openapi/wiki/v1';

function getCredentials() {
  return {
    clientId: process.env.IMA_OPENAPI_CLIENTID || '',
    apiKey: process.env.IMA_OPENAPI_APIKEY || '',
  };
}

async function imaApi(
  endpoint: string,
  data: Record<string, any>,
): Promise<any> {
  const { clientId, apiKey } = getCredentials();
  const url = `${IMA_API_BASE}/${endpoint}`;
  const body = JSON.stringify(data);

  logMessage(`[IMA] API request: ${endpoint} → ${url}`, 'info');

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'ima-openapi-clientid': clientId,
        'ima-openapi-apikey': apiKey,
      },
      body,
    });

    const text = await resp.text();
    logMessage(
      `[IMA] API response (${resp.status}): ${text.slice(0, 300)}`,
      'info',
    );

    if (!text || text.trim() === '') {
      return { code: -1, msg: `Empty response, HTTP ${resp.status}` };
    }
    return JSON.parse(text);
  } catch (e: any) {
    logMessage(`[IMA] API error: ${e.message}`, 'error');
    return { code: -1, msg: e.message };
  }
}

/** 知识库配置（本地 JSON 文件持久化） */
const IMA_CONFIG_FILE = path.join(
  process.env.HOME || process.env.USERPROFILE || '',
  '.smartsub_ima_config.json',
);

interface ProgramMapping {
  keyword: string; // 标题中包含的关键词
  knowledgeBase: string; // 知识库名称
  folderName: string; // 目标文件夹名称
}

interface IMAConfig {
  knowledgeBases: Record<string, string>; // name → id
  folderCache: Record<string, string>; // "kbName_folderName" → folder_id
  programMappings?: ProgramMapping[]; // 节目→知识库+文件夹映射
}

function loadIMAConfig(): IMAConfig {
  try {
    if (fs.existsSync(IMA_CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(IMA_CONFIG_FILE, 'utf-8'));
    }
  } catch {}
  return { knowledgeBases: {}, folderCache: {}, programMappings: [] };
}

function saveIMAConfig(config: IMAConfig): void {
  fs.writeFileSync(IMA_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

/** 根据名称获取知识库 ID（从本地配置读取） */
function getKnowledgeBaseId(name: string): string | null {
  const config = loadIMAConfig();
  return config.knowledgeBases[name] || null;
}

/** 从本地缓存读取文件夹 ID */
function getCachedFolderId(kbName: string, yyyymm: string): string | null {
  const config = loadIMAConfig();
  const key = `${kbName}_${yyyymm}`;
  return config.folderCache[key] || null;
}

function setCachedFolderId(
  kbName: string,
  folderName: string,
  folderId: string,
): void {
  const config = loadIMAConfig();
  const key = `${kbName}_${folderName}`;
  config.folderCache[key] = folderId;
  saveIMAConfig(config);
}

/** 根据标题/文件路径匹配节目映射，返回目标知识库名和文件夹名 */
function resolveTarget(
  title: string,
  filePath?: string,
): {
  knowledgeBase: string;
  folderName: string;
} {
  const config = loadIMAConfig();
  const mappings = config.programMappings || [];

  // 标题为空时用文件名兜底，确保仍有可匹配的文本
  const effectiveTitle =
    (title || '').trim() || (filePath ? path.basename(filePath) : '');

  // 1) 优先按标题匹配
  for (const m of mappings) {
    if (effectiveTitle.includes(m.keyword)) {
      logMessage(
        `[IMA] 标题匹配: "${m.keyword}" → 知识库 "${m.knowledgeBase}" / 文件夹 "${m.folderName}"`,
        'info',
      );
      return { knowledgeBase: m.knowledgeBase, folderName: m.folderName };
    }
  }

  // 2) 标题未命中时，用文件所在目录名兜底。
  //    下载时已按节目正确归档到各自目录（如 华创张瑜旬度时间2026），
  //    目录名自带节目关键词，比标题更可靠，可避免「标题漏带关键词→误进默认大摩」的问题。
  if (filePath) {
    const dirName = path.basename(path.dirname(filePath));
    for (const m of mappings) {
      if (dirName.includes(m.keyword) || filePath.includes(m.keyword)) {
        logMessage(
          `[IMA] 标题未命中，目录兜底匹配: "${m.keyword}" (目录="${dirName}") → 知识库 "${m.knowledgeBase}" / 文件夹 "${m.folderName}"`,
          'info',
        );
        return { knowledgeBase: m.knowledgeBase, folderName: m.folderName };
      }
    }
  }

  // 默认: 大摩闭门会 + YYYYMM_updating
  const now = new Date();
  const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  logMessage(
    `[IMA] 标题/目录均未命中映射 (title="${effectiveTitle.slice(0, 50)}")，使用默认: 大摩闭门会 / ${yyyymm}_updating`,
    'info',
  );
  return { knowledgeBase: '大摩闭门会', folderName: `${yyyymm}_updating` };
}

/** 搜索知识库内容（用于查找已有文件夹） */
async function searchKnowledge(
  kbId: string,
  query: string,
): Promise<string | null> {
  const result = await imaApi('search_knowledge', {
    query,
    knowledge_base_id: kbId,
    cursor: '',
  });
  if (result.code !== 0) {
    logMessage(
      `[IMA] search_knowledge failed: ${JSON.stringify(result)}`,
      'warn',
    );
    return null;
  }
  const list = result.data?.info_list || [];
  const found = list.find(
    (item: any) => item.title === query || item.name === query,
  );
  return found?.media_id || found?.id || null;
}

/** 创建文件夹（如已存在则搜索获取 ID） */
async function createFolder(
  kbId: string,
  folderName: string,
): Promise<string | null> {
  const result = await imaApi('create_folder', {
    knowledge_base_id: kbId,
    name: folderName,
  });
  if (result.code === 0) {
    return result.data?.folder_id || result.data?.media_id || null;
  }
  // 220001 = 已存在同名，尝试搜索获取 ID
  if (result.code === 220001) {
    logMessage(`[IMA] 文件夹 "${folderName}" 已存在，搜索获取 ID...`, 'info');
    const found = await searchKnowledge(kbId, folderName);
    if (found) return found;
  }
  logMessage(`[IMA] create_folder failed: ${JSON.stringify(result)}`, 'warn');
  return null;
}

/** 上传文件到 IMA 知识库 */
async function imaUploadFile(
  filePath: string,
  kbId: string,
  folderId?: string,
): Promise<{ success: boolean; error?: string }> {
  const filename = path.basename(filePath);
  const fileSize = fs.statSync(filePath).size;
  const ext = path.extname(filePath).toLowerCase().replace('.', '');

  const mimeMap: Record<string, string> = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    csv: 'text/csv',
    txt: 'text/plain',
    md: 'text/markdown',
    m4a: 'audio/x-m4a',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    aac: 'audio/aac',
  };
  const contentType = mimeMap[ext] || 'application/octet-stream';

  const mediaTypeMap: Record<string, number> = {
    pdf: 1,
    doc: 3,
    docx: 3,
    ppt: 4,
    pptx: 4,
    xls: 5,
    xlsx: 5,
    csv: 5,
    txt: 13,
    md: 7,
    m4a: 15,
    mp3: 15,
    wav: 15,
    aac: 15,
  };
  const mediaType = mediaTypeMap[ext] || 1;

  // 1. 创建上传凭证
  const createData: Record<string, any> = {
    file_name: filename,
    file_size: fileSize,
    content_type: contentType,
    file_ext: ext,
    knowledge_base_id: kbId,
  };
  if (folderId) createData.folder_id = folderId;

  const createResult = await imaApi('create_media', createData);
  if (createResult.code !== 0) {
    return {
      success: false,
      error: `create_media failed: ${createResult.msg || JSON.stringify(createResult)}`,
    };
  }

  const cosInfo = createResult.data || {};
  const mediaId = cosInfo.media_id || '';
  const cred = cosInfo.cos_credential || {};

  const {
    secret_id,
    secret_key,
    token,
    bucket_name,
    region,
    cos_key,
    start_time,
    expired_time,
  } = cred;
  if (!secret_id || !secret_key || !bucket_name || !region || !cos_key) {
    return { success: false, error: 'Incomplete COS credential' };
  }

  // 2. 上传到 COS
  const cosUrl = `https://${bucket_name}.cos.${region}.myqcloud.com/${cos_key}`;
  const fileData = fs.readFileSync(filePath);
  const host = `${bucket_name}.cos.${region}.myqcloud.com`;
  const pathname = `/${cos_key}`;
  const keyTime = `${start_time};${expired_time}`;

  const signKey = crypto
    .createHmac('sha1', secret_key)
    .update(keyTime)
    .digest('hex');
  const headerDict: Record<string, string> = {
    host,
    'content-length': String(fileData.length),
  };
  const headerKeys = Object.keys(headerDict).sort();
  const httpHeaders = headerKeys
    .map((k) => `${k}=${encodeURIComponent(headerDict[k])}`)
    .join('&');
  const httpString = `put\n${pathname}\n\n${httpHeaders}\n`;
  const httpStringSha1 = crypto
    .createHash('sha1')
    .update(httpString)
    .digest('hex');
  const stringToSign = `sha1\n${keyTime}\n${httpStringSha1}\n`;
  const signature = crypto
    .createHmac('sha1', signKey)
    .update(stringToSign)
    .digest('hex');
  const headerList = headerKeys.join(';');
  const authorization = `q-sign-algorithm=sha1&q-ak=${secret_id}&q-sign-time=${keyTime}&q-key-time=${keyTime}&q-header-list=${headerList}&q-url-param-list=&q-signature=${signature}`;

  try {
    const cosResp = await fetch(cosUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(fileData.length),
        Host: host,
        'x-cos-security-token': token,
        Authorization: authorization,
      },
      body: fileData,
    });
    if (!cosResp.ok) {
      const errText = await cosResp.text().catch(() => '');
      return {
        success: false,
        error: `COS upload failed: ${cosResp.status} ${errText.slice(0, 200)}`,
      };
    }
  } catch (e: any) {
    return { success: false, error: `COS upload error: ${e.message}` };
  }

  // 3. 添加到知识库
  const addData: Record<string, any> = {
    media_type: mediaType,
    media_id: mediaId,
    title: filename,
    knowledge_base_id: kbId,
  };
  if (folderId) addData.folder_id = folderId;

  const addResult = await imaApi('add_knowledge', addData);
  if (addResult.code === 0) {
    return { success: true };
  }
  return {
    success: false,
    error: `add_knowledge failed: ${addResult.msg || JSON.stringify(addResult)}`,
  };
}

/** 上传文件到 IMA 知识库（根据标题自动路由到对应知识库和文件夹） */
export async function uploadToIMA(
  filePath: string,
  title?: string,
): Promise<{ success: boolean; error?: string }> {
  const { clientId, apiKey } = getCredentials();
  if (!clientId || !apiKey) {
    return {
      success: false,
      error:
        'IMA 凭证未配置，请在 ~/.zshrc 中设置 IMA_OPENAPI_CLIENTID 和 IMA_OPENAPI_APIKEY',
    };
  }

  if (!fs.existsSync(filePath)) {
    return { success: false, error: '文件不存在' };
  }

  const target = resolveTarget(title, filePath);
  const kbId = getKnowledgeBaseId(target.knowledgeBase);
  if (!kbId) {
    return {
      success: false,
      error: `未配置知识库 "${target.knowledgeBase}" 的 ID，请在 ~/.smartsub_ima_config.json 中设置`,
    };
  }
  logMessage(`[IMA] 知识库 "${target.knowledgeBase}" ID: ${kbId}`, 'info');

  const folderName = target.folderName;

  // 查找缓存的文件夹 ID
  let folderId = getCachedFolderId(target.knowledgeBase, folderName);
  if (folderId) {
    logMessage(`[IMA] 使用缓存文件夹: ${folderName} → ${folderId}`, 'info');
  } else {
    // 创建文件夹
    logMessage(`[IMA] 创建文件夹 "${folderName}"...`, 'info');
    folderId = await createFolder(kbId, folderName);
    if (folderId) {
      setCachedFolderId(target.knowledgeBase, folderName, folderId);
      logMessage(`[IMA] 文件夹创建成功: ${folderName} → ${folderId}`, 'info');
    }
  }
  if (!folderId) {
    return { success: false, error: `无法获取或创建文件夹 "${folderName}"` };
  }

  logMessage(
    `[IMA] 上传文件: ${path.basename(filePath)} → ${target.knowledgeBase}/${folderName}`,
    'info',
  );
  const result = await imaUploadFile(filePath, kbId, folderId);
  if (result.success) {
    logMessage(`[IMA] 上传成功: ${path.basename(filePath)}`, 'info');
  } else {
    logMessage(`[IMA] 上传失败: ${result.error}`, 'error');
  }
  return result;
}

/** 注册 IMA 上传 IPC handler */
export function registerIMAHandlers(): void {
  ipcMain.handle(
    'ima:upload',
    async (_event, filePath: string, title?: string) => {
      return uploadToIMA(filePath, title);
    },
  );
}
