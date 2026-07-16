/**
 * 下载后自动重命名模块
 * 移植自 SoundScrub 项目的 parse_bilibili_filename() + generate_filename() + classify_source()
 *
 * 规则: {日期}-{栏目名}：{标题}.{ext}
 * 例如: 20260614-华创宏观张瑜：让加息的子弹飞一会儿.mp3
 */

import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import { logMessage } from '../storeManager';

// ============ 节目配置类型 ============

export interface ProgramConfig {
  keywords: string[];
  /** 固定栏目名，如 "中金宏观策略周论" */
  nameFormat?: string;
  /** 星期几 → 栏目名（大摩用） */
  weekdayNames?: Record<number, string>;
}

export interface RenameConfig {
  enabled: boolean;
  programs: Record<string, ProgramConfig>;
}

// ============ 默认节目配置（与 SoundScrub settings.yaml 保持一致） ============

const DEFAULT_PROGRAMS: Record<string, ProgramConfig> = {
  大摩: {
    keywords: ['大摩', '摩根士丹利', 'Morgan Stanley', 'MS'],
    weekdayNames: {
      0: '大摩宏观策略谈', // 周一
      2: '大摩周期论剑', // 周三
      4: '大摩热点前瞻', // 周五
    },
  },
  中金: {
    keywords: ['中金', 'CICC', '中金公司'],
    nameFormat: '中金宏观策略周论',
  },
  华创: {
    keywords: ['华创', '华创证券', '张瑜'],
    nameFormat: '华创宏观{name}',
  },
  招商: {
    keywords: ['招商', '招商证券', '张静静'],
    nameFormat: '招商宏观{name}',
  },
  高盛: {
    keywords: ['高盛', 'Goldman Sachs'],
  },
  摩根大通: {
    keywords: ['摩根大通', 'JP Morgan', 'JPM'],
  },
  国海证券: {
    keywords: ['国海', '国海证券'],
  },
  中信证券: {
    keywords: ['中信', '中信证券'],
  },
  广发策略: {
    keywords: ['广发', '广发策略', '广发证券'],
  },
};

// ============ 配置管理 ============

function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'rename-rules.json');
}

export function readRenameConfig(): RenameConfig {
  try {
    const configPath = getConfigPath();
    if (fs.existsSync(configPath)) {
      const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return {
        enabled: saved.enabled ?? true,
        programs: { ...DEFAULT_PROGRAMS, ...saved.programs },
      };
    }
  } catch (error) {
    logMessage(`[rename] read config error: ${error}`, 'error');
  }
  return { enabled: true, programs: { ...DEFAULT_PROGRAMS } };
}

export function saveRenameConfig(config: RenameConfig): void {
  try {
    fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2));
  } catch (error) {
    logMessage(`[rename] save config error: ${error}`, 'error');
  }
}

// ============ 核心重命名逻辑 ============

/**
 * 解析文件名中的日期信息
 * 支持格式:
 *   5月4日 大摩宏观策略会：内卷与创新之辩          (X月Y日 开头)
 *   6.17完整版大摩闭门会 ｜标题 [BVxxx].mp3       (M.D 开头)
 *   【完整版】大摩闭门会：标题260622全网最快        (YYMMDD 结尾)
 */
function parseDateFromFilename(filename: string): {
  date: string;
  weekday: number;
} | null {
  const clean = filename.replace(/\s*\[BV[a-zA-Z0-9]+\]\s*/g, '').trim();

  let dt: Date | null = null;

  // 格式1: 开头 X月Y日（中文日期）
  const mZh = clean.match(/^(\d{1,2})月(\d{1,2})日/);
  if (mZh) {
    const month = parseInt(mZh[1], 10);
    const day = parseInt(mZh[2], 10);
    const year = new Date().getFullYear();
    const candidate = new Date(year, month - 1, day);
    if (candidate.getMonth() === month - 1 && candidate.getDate() === day) {
      dt = candidate;
    }
  }

  // 格式2: 开头 M.D 或 MM.DD
  if (!dt) {
    const m1 = clean.match(/^(\d{1,2})[.．](\d{1,2})/);
    if (m1) {
      const month = parseInt(m1[1], 10);
      const day = parseInt(m1[2], 10);
      const year = new Date().getFullYear();
      const candidate = new Date(year, month - 1, day);
      if (candidate.getMonth() === month - 1 && candidate.getDate() === day) {
        dt = candidate;
      }
    }
  }

  // 格式3: 结尾 YYMMDD（如 260622）
  if (!dt) {
    const m2 = clean.match(
      /(\d{2})(\d{2})(\d{2})(?:全网|推荐|独家|搬运|B站|$)/,
    );
    if (m2) {
      const yy = parseInt(m2[1], 10);
      const mm = parseInt(m2[2], 10);
      const dd = parseInt(m2[3], 10);
      const year = 2000 + yy;
      const candidate = new Date(year, mm - 1, dd);
      if (candidate.getMonth() === mm - 1 && candidate.getDate() === dd) {
        dt = candidate;
      }
    }
  }

  if (!dt) return null;

  const dateStr =
    dt.getFullYear().toString() +
    (dt.getMonth() + 1).toString().padStart(2, '0') +
    dt.getDate().toString().padStart(2, '0');

  return { date: dateStr, weekday: dt.getDay() };
}

/**
 * 从标题中提取人名（开头的 2-3 个中文字符）
 */
function extractPersonName(title: string): string {
  const m = title.match(
    /^([\u4e00-\u9fff]{2,3})(?:最新|独家|深度|重磅|解读|分享|闭门|旬度|宏观|策略|研究|[与和：:，。\s0-9])/,
  );
  return m ? m[1] : '';
}

/**
 * 清理标题中的推广文字、来源关键词等
 */
function cleanTitle(
  topic: string,
  sourceName: string,
  programs: Record<string, ProgramConfig>,
): string {
  // 去掉来源关键词
  for (const [, prog] of Object.entries(programs)) {
    for (const kw of prog.keywords) {
      topic = topic.replace(new RegExp(kw, 'g'), '');
    }
  }

  // 去掉栏目名（从 nameFormat 中提取核心词）
  const prog = programs[sourceName];
  if (prog?.nameFormat) {
    const core = prog.nameFormat.replace('{name}', '').replace(sourceName, '');
    if (core) topic = topic.replace(new RegExp(core, 'g'), '');
  }

  // 去掉特殊字符
  topic = topic.replace(/[\\/:*?"<>|｜]/g, '').trim();

  // 去掉英文人名（如 "Laura Wang："、"David Li："）
  topic = topic.replace(/^[A-Z][a-z]+(?:\s[A-Z][a-z]+)+[：:]?\s*/, '');

  // 去掉标题开头的人名+动词（如 "张瑜最新："）
  topic = topic.replace(
    /^[\u4e00-\u9fff]{2,4}(最新|独家|深度|重磅|解读|分享)[：:]?\s*/,
    '',
  );
  topic = topic.replace(/^(最新|独家|深度|重磅|解读|分享)[：:]?\s*/, '');

  // 去掉开头的栏目相关词
  topic = topic.replace(/^(闭门会?|旬度|宏观|策略|研究)[：:]?\s*/, '');

  // 去掉残留的机构后缀词
  topic = topic.replace(/^(研究|证券|公司)\s*/, '');

  // 清理多余的冒号和空格
  topic = topic.replace(/^[：:]+\s*/, '');

  // 去掉推广性文字
  topic = topic.replace(
    /\s*[（(【[][^）)\]】]*(?:B站|首发|推荐|独家|转载|搬运|全网|星推荐)[^）)\]】]*[）)】\]]/g,
    '',
  );
  topic = topic.replace(/(?:B站|全网)首发/g, '');
  topic = topic.replace(/(?:推荐程度|[0-9]+星推荐)/g, '');

  // 去掉开头或结尾的 6 位日期数字
  topic = topic.replace(/^\d{6}\s*/, '');
  topic = topic.replace(/\s*\d{6}$/, '');

  // 清理多余空格
  topic = topic.replace(/\s+/g, ' ').trim();

  return topic;
}

/**
 * 根据标题识别来源机构
 */
function classifySource(
  title: string,
  programs: Record<string, ProgramConfig>,
): string {
  const titleLower = title.toLowerCase();

  for (const [progName, progCfg] of Object.entries(programs)) {
    if (progName === '其他') continue;
    for (const kw of progCfg.keywords) {
      if (
        kw.toLowerCase().includes(titleLower) ||
        titleLower.includes(kw.toLowerCase())
      ) {
        return progName;
      }
    }
  }

  return '其他';
}

/**
 * 从原始文件名中提取标题（去掉日期、来源名、节目名等前缀）
 *
 * 例: "5月4日 大摩宏观策略会：内卷与创新之辩" → "内卷与创新之辩"
 *     "6.17完整版大摩闭门会 ｜药明康德260622" → "药明康德"
 */
function extractTopicFromFilename(
  filename: string,
  sourceName: string,
  programs: Record<string, ProgramConfig>,
): string {
  let text = filename.replace(/\s*\[BV[a-zA-Z0-9]+\]\s*/g, '').trim();

  // 去掉 【xxx】 标记
  text = text.replace(/【[^】]*】\s*/g, '').trim();

  // 去掉中文日期前缀: "5月4日 "、"12月3日"
  text = text.replace(/^\d{1,2}月\d{1,2}日\s*/, '');
  // 去掉点号日期前缀: "6.17"、"12.3"
  text = text.replace(/^\d{1,2}[.．]\d{1,2}/, '');

  // 按 ｜ 或 | 分割，取最后一段（标题在分隔符后面）
  const parts = text.split(/[｜|]/);
  if (parts.length > 1) {
    text = parts[parts.length - 1].trim();
  }

  // 去掉结尾的 YYMMDD + 推广文字
  text = text.replace(/\d{6}.*$/, '').trim();

  // 核心：去掉 "来源名+节目名：" 前缀
  // 匹配模式：（来源关键词）（节目名）：（标题）
  // 例: "大摩宏观策略会：内卷与创新之辩" → "内卷与创新之辩"
  // 例: "华创宏观张瑜：让加息的子弹飞一会儿" → "让加息的子弹飞一会儿"
  if (sourceName !== '其他' && programs[sourceName]) {
    const kwPattern = programs[sourceName].keywords
      .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|');
    // 去掉 "来源名 + 任意文字 + ：" 的前缀
    text = text.replace(
      new RegExp('^(?:' + kwPattern + ')[^：:]*[：:]\s*', ''),
      '',
    );
    // 也去掉纯来源名前缀（如果没有冒号分隔）
    text = text.replace(new RegExp('^(?:' + kwPattern + ')\s*', ''), '');
  }

  // 清理推广文字
  text = text.replace(
    /\s*[（(【[][^）)\]】]*(?:B站|首发|推荐|独家|转载|搬运|全网|星推荐)[^）)\]】]*[）)】\]]/g,
    '',
  );
  text = text.replace(/(?:B站|全网)首发/g, '');
  text = text.replace(/(?:推荐程度|[0-9]+星推荐)/g, '');

  // 去掉开头或结尾的 6 位日期数字
  text = text.replace(/^\d{6}\s*/, '');
  text = text.replace(/\s*\d{6}$/, '');

  // 清理多余空格
  text = text.replace(/\s+/g, ' ').trim();

  return text;
}

/**
 * 生成规范的文件名
 * 规则: {日期}-{栏目名}：{标题}.{ext}
 */
function generateFilename(
  title: string,
  uploadDate: string | null,
  sourceName: string,
  ext: string,
  originalFilename: string,
  programs: Record<string, ProgramConfig>,
): string {
  const parsed = parseDateFromFilename(originalFilename);

  let dateStr: string;
  let topic: string;
  let weekday: number | null = null;

  if (parsed) {
    dateStr = parsed.date;
    weekday = parsed.weekday;
    topic = extractTopicFromFilename(originalFilename, sourceName, programs);
  } else if (uploadDate && uploadDate.length >= 8) {
    dateStr = uploadDate.substring(0, 8);
    topic = title;
  } else {
    dateStr = new Date().toISOString().replace(/-/g, '').substring(0, 8);
    topic = title;
  }

  // 确定栏目名
  let program = sourceName;
  const progCfg = programs[sourceName];

  if (sourceName === '大摩' && weekday !== null && progCfg?.weekdayNames) {
    program = progCfg.weekdayNames[weekday] || '大摩闭门会';
  } else if (progCfg?.nameFormat) {
    const fmt = progCfg.nameFormat;
    if (fmt.includes('{name}')) {
      const name = extractPersonName(title);
      if (name) {
        program = fmt.replace('{name}', name);
      } else {
        program = fmt.replace('{name}', '');
      }
    } else {
      program = fmt;
    }
  }

  // 清理标题
  topic = cleanTitle(topic, sourceName, programs);

  // 如果标题为空，使用原标题
  if (!topic) {
    topic = title.replace(/[\/\\:*?"<>|]/g, '_').substring(0, 100);
  }

  return `${dateStr}-${program}：${topic}.${ext}`;
}

// ============ 公开接口 ============

export interface RenameResult {
  renamed: boolean;
  originalPath: string;
  newPath: string;
  newName: string;
}

/**
 * 下载完成后自动重命名文件
 *
 * @param outputPath - yt-dlp 下载完成后的文件路径
 * @param title - 视频标题（来自 yt-dlp）
 * @param uploadDate - 上传日期 YYYYMMDD（来自 yt-dlp，可选）
 * @param originalUrl - 原始 URL（用于判断平台）
 * @returns 重命名结果
 */
export function renameAfterDownload(
  outputPath: string,
  title: string,
  uploadDate: string | null,
  originalUrl: string,
): RenameResult {
  const config = readRenameConfig();

  if (!config.enabled) {
    logMessage('[rename] 重命名功能已禁用', 'info');
    return {
      renamed: false,
      originalPath: outputPath,
      newPath: outputPath,
      newName: path.basename(outputPath),
    };
  }

  const dir = path.dirname(outputPath);
  const ext = path.extname(outputPath).substring(1); // 去掉点号
  const originalFilename = path.basename(outputPath, path.extname(outputPath));

  // 识别来源
  const sourceName = classifySource(title, config.programs);
  logMessage(`[rename] 识别来源: ${sourceName}`, 'info');

  // 生成新文件名
  const newName = generateFilename(
    title,
    uploadDate,
    sourceName,
    ext,
    originalFilename,
    config.programs,
  );

  const newPath = path.join(dir, newName);

  // 如果新旧文件名相同，跳过
  if (newPath === outputPath) {
    logMessage('[rename] 文件名无需变更', 'info');
    return {
      renamed: false,
      originalPath: outputPath,
      newPath: outputPath,
      newName: path.basename(outputPath),
    };
  }

  // 处理文件名冲突
  let finalPath = newPath;
  let counter = 1;
  while (fs.existsSync(finalPath)) {
    const parsed = path.parse(newPath);
    finalPath = path.join(dir, `${parsed.name}_${counter}${parsed.ext}`);
    counter++;
  }

  try {
    fs.renameSync(outputPath, finalPath);
    logMessage(`[rename] 重命名成功: ${path.basename(finalPath)}`, 'info');
    return {
      renamed: true,
      originalPath: outputPath,
      newPath: finalPath,
      newName: path.basename(finalPath),
    };
  } catch (error: any) {
    logMessage(`[rename] 重命名失败: ${error.message}`, 'error');
    return {
      renamed: false,
      originalPath: outputPath,
      newPath: outputPath,
      newName: path.basename(outputPath),
    };
  }
}
