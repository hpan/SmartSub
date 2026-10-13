/**
 * 音画 - 配置管理器
 * 三层级联：通用样式 → 视频分类 → 节目配置
 *
 * 通用样式：字体、字号、颜色、描边（纯视觉样式，不含位置）
 * 视频分类：showTitle、showOverlay、overlayOpacity、defaultSpectrumStyle、titleYRatio、subtitleBottomRatio
 * 节目配置：封面图、logo、分类归属，可逐项覆盖分类默认值
 */

import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { logMessage } from '../storeManager';

// ===== 通用样式（Layer 1）—— 只含字体 / 字号 / 颜色 / 描边 =====

export interface GlobalVisualConfig {
  titleFontPath: string;
  titleFontSize: number;
  titleColor: string;
  titleStrokeEnabled: boolean;
  titleStrokeWidth: number;
  titleShadowEnabled: boolean;
  titleShadowWidth: number;
  titleLetterSpacing: number;
  titleLineSpacing: number;
  subtitleFontPath: string;
  subtitleFontSize: number;
  subtitleColor: string;
  subtitleStrokeWidth: number;
  watermarkText?: string;
  watermarkEnabled?: boolean;
  watermarkDensity?: number; // spacing ratio 0.05~0.5, default 0.18
  watermarkAngle?: number; // degrees, default -45
  disclaimerText?: string;
  disclaimerPosition?: string; // 'top-left'|'top-center'|'top-right'|'bottom-left'|'bottom-center'|'bottom-right'
  watermarkOpacity?: number; // 0~255, default 25
  disclaimerOpacity?: number; // 0~255, default 153
}

// ===== 视频分类（Layer 2）—— 位置 / 显示开关 =====

export interface CategoryConfig {
  showTitle: boolean;
  showOverlay: boolean;
  overlayOpacity: number;
  overlayBlur: number;
  defaultSpectrumStyle:
    | 'none'
    | 'bars'
    | 'radial'
    | 'rings'
    | 'radar'
    | 'wave'
    | 'pulse';
  titleYRatio: number;
  subtitleBottomRatio: number;
}

export type CategoryConfigMap = Record<string, CategoryConfig>;

// ===== 节目配置（Layer 3）—— 最高优先级覆盖 =====

export type ProgramCategory = 'talent' | 'meeting';

export interface ProgramLogo {
  id: string;
  path: string;
  label?: string;
}

export interface ProgramConfig {
  id: string;
  name: string;
  category?: ProgramCategory;
  covers: CoverAsset[];
  logoPath?: string;
  logos?: ProgramLogo[];
  logoPosition:
    | 'bottom-left'
    | 'bottom-right'
    | 'top-left'
    | 'top-right'
    | 'center-top'
    | 'center'
    | 'center-bottom';
  logoXRatio?: number;
  logoYRatio?: number;
  logoSizeRatio?: number;
  logoRotate?: boolean;
  logoRotateSpeed?: number;
  overlayOpacity?: number;
  showTitle?: boolean;
  showOverlay?: boolean;
  defaultSpectrumStyle?:
    | 'none'
    | 'bars'
    | 'radial'
    | 'rings'
    | 'radar'
    | 'wave'
    | 'pulse';
  defaultRatio: '16:9' | '3:4' | '1:1';
  watermarkText?: string;
}

// ===== 合并结果 =====

export interface ResolvedVisualConfig {
  showTitle: boolean;
  showOverlay: boolean;
  overlayOpacity: number;
  overlayBlur: number;
  defaultSpectrumStyle:
    | 'none'
    | 'bars'
    | 'radial'
    | 'rings'
    | 'radar'
    | 'wave'
    | 'pulse';
  titleFontPath: string;
  titleFontSize: number;
  titleColor: string;
  titleStrokeEnabled: boolean;
  titleStrokeWidth: number;
  titleShadowEnabled: boolean;
  titleShadowWidth: number;
  titleLetterSpacing: number;
  titleLineSpacing: number;
  titleYRatio: number;
  subtitleFontPath: string;
  subtitleFontSize: number;
  subtitleColor: string;
  subtitleStrokeWidth: number;
  subtitleBottomRatio: number;
}

// ===== 文件路径常量 =====

const PROGRAMS_FILE = 'audio-visualize/programs.json';
const CATEGORY_FILE = 'audio-visualize/category-config.json';
const GLOBAL_FILE = 'audio-visualize/global-config.json';
const ASSETS_DIR = 'audio-visualize/assets';

function getUserDataPath(file: string): string {
  return path.join(app.getPath('userData'), file);
}
function getAssetsDir(): string {
  const dir = path.join(app.getPath('userData'), ASSETS_DIR);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ---- 封面图片工具：读取尺寸、计算比例 ----

export interface CoverAsset {
  id: string;
  path: string;
  width: number;
  height: number;
  ratio: string;
  subtitleTopPx?: number;
}

/** 从图片文件头读取宽高（支持 JPEG / PNG / WebP） */
export function readImageSize(
  filePath: string,
): { width: number; height: number } | null {
  try {
    const buf = fs.readFileSync(filePath);
    if (!buf || buf.length < 24) return null;
    // PNG
    if (
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47
    ) {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    // WebP (RIFF....WEBP)
    if (
      buf.toString('ascii', 0, 4) === 'RIFF' &&
      buf.toString('ascii', 8, 12) === 'WEBP'
    ) {
      const vp8 = buf.toString('ascii', 12, 16);
      if (vp8 === 'VP8 ') {
        return {
          width: buf.readUInt16LE(26) & 0x3fff,
          height: buf.readUInt16LE(28) & 0x3fff,
        };
      }
      if (vp8 === 'VP8L') {
        const bits = buf.readUInt32LE(21);
        return {
          width: (bits & 0x3fff) + 1,
          height: ((bits >> 14) & 0x3fff) + 1,
        };
      }
      return null;
    }
    // JPEG（文件名以 jpg/jpeg 结尾，或前两字节 FF D8）
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2;
      while (i < buf.length - 9) {
        if (buf[i] !== 0xff) {
          i += 1;
          continue;
        }
        const marker = buf[i + 1];
        if (
          marker === 0xd8 ||
          marker === 0x01 ||
          (marker >= 0xd0 && marker <= 0xd7)
        ) {
          i += 2;
          continue;
        }
        const segLen = buf.readUInt16BE(i + 2);
        if (
          (marker >= 0xc0 && marker <= 0xc3) ||
          (marker >= 0xc5 && marker <= 0xc7) ||
          (marker >= 0xc9 && marker <= 0xcb) ||
          (marker >= 0xcd && marker <= 0xcf)
        ) {
          return {
            height: buf.readUInt16BE(i + 5),
            width: buf.readUInt16BE(i + 7),
          };
        }
        i += 2 + segLen;
      }
      return null;
    }
    return null;
  } catch {
    return null;
  }
}

/** 把宽高归约成常见尺寸标签：16:9 / 4:3 / 1:1 / 3:4 / 9:16 / 竖屏 / 其余显示实际比例 */
function ratioLabel(w: number, h: number): string {
  if (!w || !h) return '';
  const g = gcd(w, h);
  const sw = w / g;
  const sh = h / g;
  const cand: [number, number, string][] = [
    [16, 9, '16:9'],
    [9, 16, '9:16'],
    [4, 3, '4:3'],
    [3, 4, '3:4'],
    [1, 1, '1:1'],
  ];
  if (sw <= 6 && sh <= 6) {
    for (const [cw, ch, label] of cand)
      if (sw === cw && sh === ch) return label;
  }
  const val = w / h;
  if (Math.abs(val - 16 / 9) < 0.02) return '16:9';
  if (Math.abs(val - 9 / 16) < 0.02) return '9:16';
  if (Math.abs(val - 4 / 3) < 0.02) return '4:3';
  if (Math.abs(val - 3 / 4) < 0.02) return '3:4';
  if (Math.abs(val - 1) < 0.02) return '1:1';
  return `${sw}:${sh}`;
}
function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}

/** 把封面尺寸缩到目标最大边，保持原比例（避免黑边） */
export function fitCoverSize(
  width: number,
  height: number,
  max: number,
): { w: number; h: number } {
  if (!width || !height) return { w: max, h: max };
  const scale = Math.min(max / width, max / height, 1);
  return { w: Math.round(width * scale), h: Math.round(height * scale) };
}

/** 把单个条目规范成 CoverAsset（读真实尺寸算比例） */
function makeCover(pathStr: string, id: string): CoverAsset {
  const size = readImageSize(pathStr);
  const w = size ? size.width : 0;
  const h = size ? size.height : 0;
  return {
    id,
    path: pathStr,
    width: w,
    height: h,
    ratio: w && h ? ratioLabel(w, h) : '1:1',
  };
}

/** 兼容旧数据结构：Record<ratio, path> → CoverAsset[] */
function normalizeCovers(raw: unknown): CoverAsset[] {
  if (Array.isArray(raw)) {
    return raw
      .filter((c: any) => c && c.path)
      .map((c: any, i: number) =>
        c.width && c.height
          ? {
              ...c,
              id: c.id || 'cover-' + i,
              path: c.path,
              width: c.width,
              height: c.height,
              ratio: c.ratio,
            }
          : makeCover(c.path, c.id || 'cover-' + i),
      );
  }
  const map = (raw || {}) as Record<string, string>;
  return Object.keys(map)
    .filter((k) => map[k])
    .map((k, i) => makeCover(map[k], 'cover-' + i));
}

// ===== Global Config =====

const DEFAULT_GLOBAL: GlobalVisualConfig = {
  titleFontPath: '/Users/vangogh/Library/Fonts/SmileySans-Oblique.ttf',
  titleFontSize: 0,
  titleColor: '#F5DE65',
  titleStrokeEnabled: true,
  titleStrokeWidth: 4,
  titleShadowEnabled: false,
  titleShadowWidth: 3,
  titleLetterSpacing: 0,
  titleLineSpacing: 12,
  subtitleFontPath: '/Users/vangogh/Library/Fonts/SmileySans-Oblique.ttf',
  subtitleFontSize: 0,
  subtitleColor: '#FFF79B',
  subtitleStrokeWidth: 3,
};

export function loadGlobalConfig(): GlobalVisualConfig {
  const p = getUserDataPath(GLOBAL_FILE);
  if (!fs.existsSync(p)) return { ...DEFAULT_GLOBAL };
  try {
    const saved = JSON.parse(fs.readFileSync(p, 'utf-8'));
    // Strip legacy position-ratio keys so they don't pollute the pure style config
    const { titleYRatio, subtitleBottomRatio, ...clean } = saved;
    return { ...DEFAULT_GLOBAL, ...clean };
  } catch {
    return { ...DEFAULT_GLOBAL };
  }
}

export function saveGlobalConfig(config: GlobalVisualConfig): void {
  const p = getUserDataPath(GLOBAL_FILE);
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(config, null, 2), 'utf-8');
  logMessage('[音画] Saved global config', 'info');
}

// ===== Category Config =====

const DEFAULT_CATEGORIES: CategoryConfigMap = {
  talent: {
    showTitle: true,
    showOverlay: true,
    overlayOpacity: 0.6,
    overlayBlur: 0,
    defaultSpectrumStyle: 'bars',
    titleYRatio: 0.15,
    subtitleBottomRatio: 0.146,
  },
  meeting: {
    showTitle: false,
    showOverlay: false,
    overlayOpacity: 0,
    overlayBlur: 0,
    defaultSpectrumStyle: 'none',
    titleYRatio: 0.1,
    subtitleBottomRatio: 0.08,
  },
};

/** 兼容旧布尔字段 defaultSpectrum → defaultSpectrumStyle */
function migrateSpectrumStyle(
  v: unknown,
): 'none' | 'bars' | 'radial' | 'rings' | 'radar' | 'wave' | 'pulse' {
  if (
    v === 'none' ||
    v === 'bars' ||
    v === 'radial' ||
    v === 'rings' ||
    v === 'radar' ||
    v === 'wave' ||
    v === 'pulse'
  )
    return v;
  if (v === true) return 'bars';
  return 'none';
}

export function loadCategoryConfig(): CategoryConfigMap {
  const p = getUserDataPath(CATEGORY_FILE);
  if (!fs.existsSync(p)) return { ...DEFAULT_CATEGORIES };
  try {
    const saved: Record<string, any> = JSON.parse(fs.readFileSync(p, 'utf-8'));
    const mapped: CategoryConfigMap = { ...DEFAULT_CATEGORIES };
    for (const [key, cfg] of Object.entries(saved)) {
      mapped[key] = {
        ...(mapped[key] || DEFAULT_CATEGORIES.talent),
        ...cfg,
        defaultSpectrumStyle:
          cfg.defaultSpectrumStyle !== undefined
            ? migrateSpectrumStyle(cfg.defaultSpectrumStyle)
            : migrateSpectrumStyle(cfg.defaultSpectrum),
      };
    }
    return mapped;
  } catch {
    return { ...DEFAULT_CATEGORIES };
  }
}

export function saveCategoryConfig(config: CategoryConfigMap): void {
  const p = getUserDataPath(CATEGORY_FILE);
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(config, null, 2), 'utf-8');
  logMessage('[音画] Saved category config', 'info');
}

// ===== Program Config =====

/**
 * 扫描素材目录，把已存在于磁盘但漏写进配置的多封面 / 多 Logo 补回配置。
 */
function backfillProgramAssets(programs) {
  const assetsDir = getAssetsDir();
  if (!fs.existsSync(assetsDir)) return programs;
  const files = fs.readdirSync(assetsDir);
  return programs.map((p) => {
    const covers = (p.covers || []).map((c) => ({ ...c }));
    const knownCovers = new Set(covers.map((c) => c.path));
    for (const f of files) {
      if (!f.startsWith(p.id + '_cover')) continue;
      const full = path.join(assetsDir, f);
      if (knownCovers.has(full)) continue;
      covers.push(makeCover(full, 'backfill-cover-' + covers.length));
    }
    const logos = p.logos
      ? [...p.logos]
      : p.logoPath
        ? [{ id: 'legacy', path: p.logoPath }]
        : [];
    const known = new Set(logos.map((l) => l.path));
    let n = logos.length;
    for (const f of files) {
      if (!f.startsWith(p.id + '_logo')) continue;
      const full = path.join(assetsDir, f);
      if (known.has(full)) continue;
      logos.push({ id: 'logo-backfill-' + n, path: full });
      n += 1;
    }
    return { ...p, covers, logos };
  });
}

export function loadPrograms(): ProgramConfig[] {
  const p = getUserDataPath(PROGRAMS_FILE);
  if (!fs.existsSync(p)) return getDefaultPrograms();
  try {
    const programs: ProgramConfig[] = JSON.parse(fs.readFileSync(p, 'utf-8'));
    // 兼容旧配置：将单 logo 迁移到 logos 数组
    programs.forEach((prog: any) => {
      if (prog.logoPath && (!prog.logos || prog.logos.length === 0)) {
        prog.logos = [{ id: 'legacy', path: prog.logoPath }];
      }
      prog.covers = normalizeCovers(prog.covers);
      if (
        prog.defaultSpectrumStyle === undefined &&
        prog.defaultSpectrum !== undefined
      ) {
        prog.defaultSpectrumStyle = prog.defaultSpectrum ? 'bars' : 'none';
        delete prog.defaultSpectrum;
      }
    });
    return backfillProgramAssets(programs);
  } catch {
    return getDefaultPrograms();
  }
}

export function savePrograms(programs: ProgramConfig[]): void {
  // 存储统一走 logos；保留 logoPath 作为向后兼容的默认引用
  const normalized = programs.map((p) => ({
    ...p,
    logos: p.logos || (p.logoPath ? [{ id: 'legacy', path: p.logoPath }] : []),
  }));
  const p = getUserDataPath(PROGRAMS_FILE);
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(normalized, null, 2), 'utf-8');
  logMessage(`[音画] Saved ${normalized.length} program configs`, 'info');
}

export function saveAsset(
  sourcePath: string,
  programId: string,
  assetType: string,
): string {
  const assetsDir = getAssetsDir();
  const ext = path.extname(sourcePath);
  const safeAssetType = assetType.replace(/:/g, 'x');
  // 冗余后缀避免同类型资产（如多个 Logo）互相覆盖
  const stamp = Date.now().toString(36);
  const fileName = `${programId}_${safeAssetType}_${stamp}${ext}`;
  const destPath = path.join(assetsDir, fileName);
  if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
  fs.copyFileSync(sourcePath, destPath);
  return destPath;
}

export function deleteAsset(assetPath: string): void {
  if (fs.existsSync(assetPath)) fs.unlinkSync(assetPath);
}

// ===== Resolve: program → category → global =====

export function resolveVisualConfig(
  program?: ProgramConfig,
): ResolvedVisualConfig {
  const global = loadGlobalConfig();
  const categories = loadCategoryConfig();
  const cat = program?.category || 'talent';
  const catCfg = categories[cat] || DEFAULT_CATEGORIES.talent;
  return {
    showTitle: program?.showTitle ?? catCfg.showTitle,
    showOverlay: program?.showOverlay ?? catCfg.showOverlay,
    overlayOpacity: program?.overlayOpacity ?? catCfg.overlayOpacity,
    overlayBlur: catCfg.overlayBlur,
    defaultSpectrumStyle:
      program?.defaultSpectrumStyle ?? catCfg.defaultSpectrumStyle,
    titleFontPath: global.titleFontPath,
    titleFontSize: global.titleFontSize,
    titleColor: global.titleColor,
    titleStrokeEnabled: global.titleStrokeEnabled,
    titleStrokeWidth: global.titleStrokeWidth,
    titleShadowEnabled: global.titleShadowEnabled,
    titleShadowWidth: global.titleShadowWidth,
    titleLetterSpacing: global.titleLetterSpacing,
    titleLineSpacing: global.titleLineSpacing,
    titleYRatio: catCfg.titleYRatio,
    subtitleFontPath: global.subtitleFontPath,
    subtitleFontSize: global.subtitleFontSize,
    subtitleColor: global.subtitleColor,
    subtitleStrokeWidth: global.subtitleStrokeWidth,
    subtitleBottomRatio: catCfg.subtitleBottomRatio,
  };
}

function getDefaultPrograms(): ProgramConfig[] {
  return [
    {
      id: 'mystical-boss',
      name: '神秘大佬',
      category: 'talent',
      covers: [],
      logoPosition: 'center-top',
      defaultRatio: '16:9',
    },
    {
      id: 'morgan',
      name: '大摩闭门会',
      category: 'meeting',
      covers: [],
      logoPosition: 'bottom-right',
      defaultRatio: '16:9',
    },
    {
      id: 'huachuang',
      name: '华创宏观张瑜旬度',
      category: 'meeting',
      covers: [],
      logoPosition: 'bottom-right',
      defaultRatio: '16:9',
    },
    {
      id: 'cicc',
      name: '中金宏观策略',
      category: 'meeting',
      covers: [],
      logoPosition: 'bottom-right',
      defaultRatio: '16:9',
    },
    {
      id: 'zhaoshang',
      name: '招商宏观周周谈',
      category: 'meeting',
      covers: [],
      logoPosition: 'bottom-right',
      defaultRatio: '16:9',
    },
  ];
}
