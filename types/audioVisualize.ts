/**
 * 音画 - 配置类型定义
 */

/** 全局样式配置（标题 + 字幕），所有节目共用 */
export interface GlobalVisualConfig {
  /** 标题字体路径 */
  titleFontPath: string;
  /** 标题字号 (px)，0=自动 */
  titleFontSize: number;
  /** 标题颜色 hex */
  titleColor: string;
  /** 标题描边宽度 */
  titleStrokeWidth: number;
  /** 标题Y位置比例 (0-1) */
  titleYRatio: number;
  /** 字幕字体路径 */
  subtitleFontPath: string;
  /** 字幕字号 (px) */
  subtitleFontSize: number;
  /** 字幕颜色 hex */
  subtitleColor: string;
  /** 字幕描边宽度 */
  subtitleStrokeWidth: number;
  /** 字幕Y位置比例 (0-1)，距底部 */
  subtitleBottomRatio: number;
}

export const DEFAULT_GLOBAL_CONFIG: GlobalVisualConfig = {
  titleFontPath: '/Users/vangogh/Library/Fonts/SmileySans-Oblique.ttf',
  titleFontSize: 0, // 0=自动
  titleColor: '#F5DE65',
  titleStrokeWidth: 4,
  titleYRatio: 0.15,
  subtitleFontPath: '/Users/vangogh/Library/Fonts/SmileySans-Oblique.ttf',
  subtitleFontSize: 0, // 0=自动
  subtitleColor: '#FFF79B',
  subtitleStrokeWidth: 3,
  subtitleBottomRatio: 0.08,
};

/** 单个 Logo 资产 */
export interface ProgramLogo {
  id: string;
  path: string;
  label?: string;
}

/** 单个节目配置（封面 + Logo + 蒙版） */
export interface ProgramConfig {
  id: string;
  name: string;
  covers: {
    '16:9'?: string;
    '3:4'?: string;
    '1:1'?: string;
  };
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
  overlayOpacity?: number;
  defaultRatio: '16:9' | '3:4' | '1:1';
}

export const DEFAULT_PROGRAMS: ProgramConfig[] = [
  {
    id: 'mystical-boss',
    name: '神秘大佬',
    covers: {},
    logoPosition: 'center-top',
    defaultRatio: '16:9',
  },
  {
    id: 'morgan',
    name: '大摩闭门会',
    covers: {},
    logoPosition: 'bottom-right',
    defaultRatio: '16:9',
  },
  {
    id: 'huachuang',
    name: '华创宏观张瑜旬度',
    covers: {},
    logoPosition: 'bottom-right',
    defaultRatio: '16:9',
  },
  {
    id: 'cicc',
    name: '中金宏观策略',
    covers: {},
    logoPosition: 'bottom-right',
    defaultRatio: '16:9',
  },
  {
    id: 'zhaoshang',
    name: '招商宏观周周谈',
    covers: {},
    logoPosition: 'bottom-right',
    defaultRatio: '16:9',
  },
];
