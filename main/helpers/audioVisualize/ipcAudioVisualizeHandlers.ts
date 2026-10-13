/**
 * 音画 IPC 处理器 - 按 DESIGN_SPEC.md 规范生成视频
 */

import { ipcMain, BrowserWindow, app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawn, execFileSync, execFile } from 'child_process';
import ffprobeStatic from 'ffprobe-static';
import ffmpegStatic from 'ffmpeg-static';
import { logMessage, logDebug } from '../storeManager';
import {
  loadPrograms,
  savePrograms,
  saveAsset,
  deleteAsset,
  loadGlobalConfig,
  saveGlobalConfig,
  loadCategoryConfig,
  saveCategoryConfig,
  resolveVisualConfig,
  readImageSize,
  fitCoverSize,
  type ProgramConfig,
  type GlobalVisualConfig,
  type CategoryConfigMap,
} from './configManager';

interface TaskRecord {
  id: string;
  audioPath: string;
  outputPath: string;
  status: 'running' | 'done' | 'error' | 'stopped';
  progress: number;
  elapsed: number;
  startTime: number;
  endTime?: number;
  error?: string;
  params: string; // JSON summary
  videoDuration?: number; // seconds of generated video
}

const tasks: TaskRecord[] = [];
const TASKS_FILE = path.join(
  app.getPath('userData'),
  'audio-visualize',
  'tasks.json',
);

function loadTasks() {
  try {
    if (fs.existsSync(TASKS_FILE)) {
      const data = JSON.parse(fs.readFileSync(TASKS_FILE, 'utf-8'));
      tasks.length = 0;
      tasks.push(...data);
    }
  } catch {}
}

function saveTasks() {
  try {
    const dir = path.dirname(TASKS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2));
  } catch {}
}

function broadcastTask(task: TaskRecord) {
  BrowserWindow.getAllWindows().forEach((w) => {
    w.webContents.send('audioVisualize:taskUpdate', task);
  });
}

loadTasks();

interface GenerateParams {
  audioPath: string;
  coverPath: string;
  logoPath?: string;
  aspectRatio: string;
  width?: number;
  height?: number;
  logoPosition: string;
  tagText?: string;
  speed?: number;
  previewDuration?: number;
  spectrumStyle?: string;
  spectrumColor?: string;
  programId?: string;
  subtitlePath?: string;
  subtitleBottomRatio?: number;
  subtitleTopPx?: number;
  watermarkEnabled?: boolean;
}

function getResolution(ratio: string): { w: number; h: number } {
  switch (ratio) {
    case '16:9':
      return { w: 1920, h: 1080 };
    case '3:4':
      return { w: 1080, h: 1440 };
    case '1:1':
      return { w: 1080, h: 1080 };
    default:
      return { w: 1920, h: 1080 };
  }
}

// Logo 位置坐标（相对于画布比例）
function getLogoPosition(
  pos: string,
  w: number,
  h: number,
): { x: string; y: string } {
  switch (pos) {
    case 'bottom-left':
      return { x: `${Math.round(w * 0.09)}`, y: `${Math.round(h * 0.89)}` };
    case 'bottom-right':
      return { x: `${Math.round(w * 0.91)}`, y: `${Math.round(h * 0.89)}` };
    case 'top-left':
      return { x: `${Math.round(w * 0.09)}`, y: `${Math.round(h * 0.11)}` };
    case 'top-right':
      return { x: `${Math.round(w * 0.91)}`, y: `${Math.round(h * 0.11)}` };
    case 'center-top':
      return { x: `${Math.round(w * 0.5)}`, y: `${Math.round(h * 0.45)}` };
    case 'center':
      return { x: `${Math.round(w * 0.5)}`, y: `${Math.round(h * 0.5)}` };
    case 'center-bottom':
      return { x: `${Math.round(w * 0.5)}`, y: `${Math.round(h * 0.82)}` };
    default:
      return { x: `${Math.round(w * 0.09)}`, y: `${Math.round(h * 0.89)}` };
  }
}

function getPythonPath(): string {
  const candidates = [
    '/opt/homebrew/bin/python3.12',
    '/opt/homebrew/bin/python3.11',
    'python3',
  ];
  const fs = require('fs');
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return 'python3';
}

interface MediaInfo {
  duration: number; // seconds
  bitrate: number; // bps (audio stream, falls back to container)
  size: number; // bytes
  sampleRate: number;
  channels: number;
}

async function getMediaInfo(filePath: string): Promise<MediaInfo> {
  const info: MediaInfo = {
    duration: 0,
    bitrate: 0,
    size: 0,
    sampleRate: 0,
    channels: 0,
  };
  try {
    info.size = fs.statSync(filePath).size;
  } catch {}
  try {
    const fp = (ffprobeStatic as any).path || ffprobeStatic;
    const json: string = await new Promise((resolve, reject) => {
      execFile(
        fp,
        [
          '-v',
          'error',
          '-print_format',
          'json',
          '-show_format',
          '-show_streams',
          filePath,
        ],
        { timeout: 10000 },
        (err, stdout) => (err ? reject(err) : resolve(stdout)),
      );
    });
    const data = JSON.parse(json);
    const fmt = data.format || {};
    info.duration = parseFloat(fmt.duration) || 0;
    info.bitrate = parseInt(fmt.bit_rate, 10) || 0;
    const stream = (data.streams || []).find(
      (s: any) => s.codec_type === 'audio',
    );
    if (stream) {
      info.sampleRate = parseInt(stream.sample_rate, 10) || 0;
      info.channels = stream.channels || 0;
      info.bitrate = parseInt(stream.bit_rate, 10) || info.bitrate;
    }
  } catch {}
  return info;
}

let currentGenProcess: any = null;

function parseSrt(srtContent: string) {
  const entries: {
    startSec: number;
    endSec: number;
    startH: number;
    startM: number;
    startS: number;
    startMs: number;
    endH: number;
    endM: number;
    endS: number;
    endMs: number;
    text: string;
  }[] = [];
  const blocks = srtContent.trim().split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 3) continue;
    const m = lines[1].match(
      /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/,
    );
    if (!m) continue;
    const startSec =
      parseInt(m[1]) * 3600 +
      parseInt(m[2]) * 60 +
      parseInt(m[3]) +
      parseInt(m[4]) / 1000;
    const endSec =
      parseInt(m[5]) * 3600 +
      parseInt(m[6]) * 60 +
      parseInt(m[7]) +
      parseInt(m[8]) / 1000;
    entries.push({
      startSec,
      endSec,
      startH: parseInt(m[1]),
      startM: parseInt(m[2]),
      startS: parseInt(m[3]),
      startMs: parseInt(m[4]),
      endH: parseInt(m[5]),
      endM: parseInt(m[6]),
      endS: parseInt(m[7]),
      endMs: parseInt(m[8]),
      text: lines
        .slice(2)
        .join(' ')
        .replace(/<[^>]+>/g, '')
        .trim(),
    });
  }
  return entries;
}

/**
 * 长标题自动换行：优先在冒号/——处断行，其次在逗号处断行。
 * 目标：2行显示，最多不超过4行。根据视频宽度和字号动态计算每行最大字数。
 * FFmpeg drawtext 用 \n 换行。
 */
/** 估算单个字符的像素宽度（中文≈fontSize，半宽≈fontSize*0.55） */
function charW(ch: string, fs: number): number {
  const code = ch.charCodeAt(0);
  if (code <= 0x7f) return fs * 0.55; // ASCII
  // 中文标点（全角）比汉字窄，约 0.6 倍
  if (code >= 0x3000 && code <= 0x303f) return fs * 0.6; // CJK标点
  if (code >= 0xff00 && code <= 0xffef) return fs * 0.6; // 全角标点
  if (code === 0x2014 || code === 0x2026 || code === 0x00b7) return fs * 0.6; // — … ·
  return fs * 1.05; // 汉字
}

/** 估算字符串的像素宽度 */
function textW(s: string, fs: number): number {
  let w = 0;
  for (const c of s) w += charW(c, fs);
  return w;
}

function wrapTitle(
  text: string,
  videoWidth: number,
  fontSize: number,
  videoHeight?: number,
): string {
  // 自适应标题宽度比例
  const ratio =
    videoHeight > videoWidth ? 0.92 : videoWidth > videoHeight ? 0.65 : 0.8;
  const maxW = videoWidth * ratio;
  if (textW(text, fontSize) <= maxW) return text;

  const strongBreaks = new Set(['：', '—', ':']);
  const mediumBreaks = new Set(['，', '；', '、']);
  const weakBreaks = new Set(['。', '！', '？', ',', '.', ' ']);

  // Find all possible break positions
  const candidates: Array<{ pos: number; priority: number }> = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (strongBreaks.has(ch)) candidates.push({ pos: i + 1, priority: 1 });
    else if (mediumBreaks.has(ch)) candidates.push({ pos: i + 1, priority: 2 });
    else if (weakBreaks.has(ch)) candidates.push({ pos: i + 1, priority: 3 });
  }

  const lines: string[] = [];
  let pos = 0;
  while (pos < text.length) {
    const remaining = text.slice(pos);
    if (textW(remaining, fontSize) <= maxW) {
      lines.push(remaining);
      break;
    }
    // Best break: rightmost within width, highest priority
    let bestBreak = -1;
    let bestPriority = 999;
    for (const c of candidates) {
      if (c.pos <= pos) continue;
      const seg = text.slice(pos, c.pos);
      if (textW(seg, fontSize) <= maxW) {
        if (
          c.priority < bestPriority ||
          (c.priority === bestPriority && c.pos > bestBreak)
        ) {
          bestBreak = c.pos;
          bestPriority = c.priority;
        }
      }
    }
    if (bestBreak > pos) {
      const line = text.slice(pos, bestBreak).trim();
      if (line) lines.push(line);
      pos = bestBreak;
      continue;
    }
    // Hard cut
    let cut = remaining.length;
    for (let i = 1; i <= remaining.length; i++) {
      if (textW(remaining.slice(0, i), fontSize) > maxW) {
        cut = Math.max(1, i - 1);
        break;
      }
    }
    lines.push(remaining.slice(0, cut).trim());
    pos += cut;
  }
  return lines.join('<BR>');
}

function extractTitleDate(text) {
  if (!text) return { text: '', date: null };
  let full;
  const dm = text.match(
    /^(20\d{2})\s*[-./年]\s*(\d{1,2})\s*[-./月]\s*(\d{1,2})\s*日?/,
  );
  if (dm) {
    full = dm[0];
  } else {
    const dm2 = text.match(/^(20\d{2})(\d{2})(\d{2})/);
    if (dm2) full = dm2[0];
  }
  if (!full) return { text, date: null };
  const rest = text
    .slice(full.length)
    .replace(/^[\s\-—：:；;，,、]+/, '')
    .trim();
  return { text: rest, date: full };
}
function buildTitle(text, w, fs, h) {
  const { text: main, date } = extractTitleDate(text);
  const title = main ? wrapTitle(main, w, fs, h).replace(/<BR>/g, '\n') : '';
  return { title, date: date ? '（' + date + '）' : null };
}

function buildTitleFilter(
  titlePath,
  dateStr,
  fontPath,
  titleSize,
  dateSize,
  colorHex,
  strokeWidth,
  shadowWidth,
  lineSpacing,
  titleTopY,
  w,
  h,
) {
  const content = fs.readFileSync(titlePath, 'utf-8');
  const titleLines = content.trim()
    ? content.split('\n').filter(Boolean).length
    : 0;
  const hasTitle = titleLines > 0;
  const hasDate = !!dateStr;
  if (!hasTitle && !hasDate) return '';
  const titleLh = hasTitle ? Math.round(titleSize * 1.4) : 0;
  const dateLh = hasDate ? Math.round(dateSize * 1.4) : 0;
  const gap = hasTitle && hasDate ? lineSpacing : 0;
  const y0 = Math.max(0, titleTopY);
  const common = `:fontfile='${fontPath}':fontcolor=0x${colorHex}:bordercolor=black`;
  let f = '';
  if (hasTitle) {
    f += `drawtext=textfile='${titlePath}':fontsize=${titleSize}:borderw=${strokeWidth}:shadowx=${shadowWidth}:shadowy=${shadowWidth}:line_spacing=${lineSpacing}:x=(w-text_w)/2:y=${y0}${common}`;
  }
  if (hasDate) {
    const esc = dateStr
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/:/g, '\\:')
      .replace(/,/g, '\\,');
    const dateY = y0 + titleLh * titleLines + gap;
    if (f) f += ',';
    f += `drawtext=text='${esc}':fontsize=${dateSize}:borderw=${strokeWidth}:shadowx=${shadowWidth}:shadowy=${shadowWidth}:x=(w-text_w)/2:y=${dateY}${common}`;
  }
  return f;
}

export function registerAudioVisualizeHandlers(mainWindow: BrowserWindow) {
  // ===== 配置管理 =====
  ipcMain.handle('audioVisualize:getPrograms', async () => loadPrograms());
  ipcMain.handle(
    'audioVisualize:savePrograms',
    async (_event, programs: ProgramConfig[]) => {
      savePrograms(programs);
      return { success: true };
    },
  );
  ipcMain.handle(
    'audioVisualize:updateCoverField',
    async (
      _event,
      params: { programId: string; coverId: string; field: string; value: any },
    ) => {
      const programs = loadPrograms();
      const prog = programs.find((p) => p.id === params.programId);
      if (!prog) return { success: false, error: '节目不存在' };
      const cover = prog.covers.find((c) => c.id === params.coverId);
      if (!cover) return { success: false, error: '封面不存在' };
      (cover as any)[params.field] = params.value;
      savePrograms(programs);
      return { success: true };
    },
  );
  ipcMain.handle('audioVisualize:getGlobalConfig', async () =>
    loadGlobalConfig(),
  );
  ipcMain.handle(
    'audioVisualize:saveGlobalConfig',
    async (_event, config: GlobalVisualConfig) => {
      saveGlobalConfig(config);
      return { success: true };
    },
  );
  ipcMain.handle(
    'audioVisualize:getResolvedConfig',
    async (_event, programId: string) => {
      const programs = loadPrograms();
      const program = programs.find((p) => p.id === programId);
      return resolveVisualConfig(program);
    },
  );
  ipcMain.handle('audioVisualize:getCategoryConfig', async () =>
    loadCategoryConfig(),
  );
  ipcMain.handle(
    'audioVisualize:saveCategoryConfig',
    async (_event, config: CategoryConfigMap) => {
      saveCategoryConfig(config);
      return { success: true };
    },
  );
  ipcMain.handle('audioVisualize:selectImage', async () => {
    const { dialog, BrowserWindow } = require('electron');
    const focusedWin = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(focusedWin || mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: '图片文件', extensions: ['jpg', 'jpeg', 'png', 'webp'] },
      ],
    });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle(
    'audioVisualize:saveAsset',
    async (
      _event,
      {
        sourcePath,
        programId,
        assetType,
      }: { sourcePath: string; programId: string; assetType: string },
    ) => {
      try {
        const savedPath = saveAsset(sourcePath, programId, assetType);
        const size = readImageSize(savedPath);
        return {
          success: true,
          path: savedPath,
          width: size ? size.width : 0,
          height: size ? size.height : 0,
        };
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    },
  );
  ipcMain.handle('audioVisualize:stopGenerate', async () => {
    if (currentGenProcess) {
      try {
        currentGenProcess.kill('SIGTERM');
      } catch {}
      currentGenProcess = null;
      const running = tasks.find((t) => t.status === 'running');
      if (running) {
        running.status = 'stopped';
        running.endTime = Date.now();
        running.elapsed = Math.floor(
          (running.endTime - running.startTime) / 1000,
        );
        broadcastTask(running);
        saveTasks();
      }
      return { success: true };
    }
    return { success: false };
  });
  ipcMain.handle(
    'audioVisualize:fileExists',
    async (_event, filePath: string) => fs.existsSync(filePath),
  );
  ipcMain.handle(
    'audioVisualize:getMediaInfo',
    async (_event, filePath: string) => {
      if (!filePath || !fs.existsSync(filePath)) return null;
      return getMediaInfo(filePath);
    },
  );
  ipcMain.handle(
    'audioVisualize:deleteAsset',
    async (_event, assetPath: string) => {
      deleteAsset(assetPath);
      return { success: true };
    },
  );
  ipcMain.handle(
    'audioVisualize:loadFont',
    async (_event, fontPath: string) => {
      try {
        if (!fs.existsSync(fontPath)) return null;
        const buf = fs.readFileSync(fontPath);
        // Return as base64 so it can traverse IPC
        return buf.toString('base64');
      } catch {
        return null;
      }
    },
  );

  // ===== 任务查询 =====
  ipcMain.handle('audioVisualize:getTasks', async () =>
    tasks.slice().reverse(),
  );
  ipcMain.handle('audioVisualize:clearTasks', async () => {
    tasks.length = 0;
    saveTasks();
    return { success: true };
  });

  // ===== 视频生成（按 DESIGN_SPEC.md 规范） =====
  ipcMain.handle(
    'audioVisualize:generate',
    async (_event, params: GenerateParams) => {
      const {
        audioPath,
        coverPath,
        logoPath,
        aspectRatio,
        logoPosition,
        tagText,
        speed,
        width,
        height,
      } = params;
      const playbackSpeed = speed && speed > 0 ? speed : 1.0;
      const durationLimit = params.previewDuration;
      const audioDuration = (await getMediaInfo(audioPath)).duration || 0;
      const videoDuration = durationLimit || audioDuration;

      if (!fs.existsSync(audioPath))
        return { success: false, error: '音频文件不存在' };
      if (!fs.existsSync(coverPath))
        return { success: false, error: '封面图片不存在' };
      if (logoPath && !fs.existsSync(logoPath))
        return { success: false, error: 'Logo文件不存在' };

      const coverSize = readImageSize(coverPath);
      const outSize =
        width && height
          ? fitCoverSize(width, height, 1920)
          : coverSize
            ? fitCoverSize(coverSize.width, coverSize.height, 1920)
            : getResolution(aspectRatio);
      const w = outSize.w;
      const h = outSize.h;
      // Convert subtitleTopPx to subtitleBottomRatio
      const effectiveSubtitleBottomRatio =
        params.subtitleTopPx !== undefined
          ? 1 - params.subtitleTopPx / h
          : undefined;
      const ffmpegPath = (ffmpegStatic as any).path || ffmpegStatic;

      const audioDir = path.dirname(audioPath);
      const audioName = path.basename(audioPath, path.extname(audioPath));
      const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
      const suffix = durationLimit ? `_preview_${ts}` : `_visualize_${ts}`;
      const outputPath = path.join(audioDir, `${audioName}${suffix}.mp4`);

      const programs = loadPrograms();
      const program =
        programs.find((p) => p.id === params.programId) || programs[0];
      const resolvedCfg = resolveVisualConfig(program);
      const spectrumStyle =
        params.spectrumStyle || resolvedCfg.defaultSpectrumStyle || 'none';
      const globalCfg = loadGlobalConfig();
      // Resolve watermark: program overrides global, respects watermarkEnabled toggle
      const watermarkEnabled = params.watermarkEnabled !== false; // default true
      const watermarkText = watermarkEnabled
        ? (program?.watermarkText ?? '').trim() ||
          (globalCfg.watermarkText ?? '').trim() ||
          ''
        : '';
      const watermarkDensity = globalCfg.watermarkDensity ?? 0.18;
      const watermarkAngle = globalCfg.watermarkAngle ?? -45;
      const disclaimerText = watermarkEnabled
        ? (globalCfg.disclaimerText ?? '').trim()
        : '';
      const disclaimerPosition =
        globalCfg.disclaimerPosition || 'bottom-center';
      const watermarkOpacity = globalCfg.watermarkOpacity ?? 25;
      const disclaimerOpacity = globalCfg.disclaimerOpacity ?? 153;
      const titleText = path.basename(audioPath, path.extname(audioPath));
      const titleFontPath =
        globalCfg.titleFontPath ||
        '/Users/vangogh/Library/Fonts/SmileySans-Oblique.ttf';
      const titleFontSize = globalCfg.titleFontSize || Math.round(h * 0.045);
      const titleColorHex = (globalCfg.titleColor || '#F5DE65').replace(
        '#',
        '',
      );
      const titleYRatio = resolvedCfg.titleYRatio;
      logMessage(
        `[音画] Generating: ${outputPath} (${w}x${h}) spectrumStyle=${spectrumStyle}`,
        'info',
      );
      logDebug(
        `[音画] Params: audioPath=${audioPath}, coverPath=${coverPath}, logoPath=${logoPath ?? 'none'}, ratio=${aspectRatio}, speed=${playbackSpeed}, preview=${durationLimit ?? 'full'}, subtitlePath=${params.subtitlePath ?? 'none'}, programId=${params.programId ?? 'none'}`,
      );
      logDebug(
        `[音画] Title: text="${titleText}", fontPath="${titleFontPath}", fontSize=${titleFontSize}, color=${titleColorHex}, yRatio=${titleYRatio}`,
      );
      logDebug(
        `[音画] Config: overlayOpacity=${program?.overlayOpacity ?? 0.6}, logoSizeRatio=${program?.logoSizeRatio ?? 0.15}, logoXRatio=${program?.logoXRatio ?? 'auto'}, logoYRatio=${program?.logoYRatio ?? 'auto'}`,
      );

      // Spectrum mode: use Python PIL renderer
      if (spectrumStyle !== 'none') {
        return new Promise((resolve) => {
          const scriptPath = path.join(
            app.getAppPath(),
            'tools',
            'audio-visualize',
            'spectrum_renderer.py',
          );
          const pythonPath = getPythonPath();
          const args = [
            scriptPath,
            '--audio',
            audioPath,
            '--cover',
            coverPath,
            '--output',
            outputPath,
            '--width',
            String(w),
            '--height',
            String(h),
            '--fps',
            '24',
            '--speed',
            String(playbackSpeed),
            '--logo-position',
            logoPosition || 'bottom-left',
            '--spectrum-style',
            spectrumStyle,
            '--spectrum-color',
            params.spectrumColor || '#FFF79B',
          ];
          if (logoPath) args.push('--logo', logoPath);
          if (tagText) args.push('--tag-text', tagText);
          if (watermarkText) args.push('--watermark-text', watermarkText);
          if (watermarkText) {
            args.push('--watermark-density', String(watermarkDensity));
            args.push('--watermark-angle', String(watermarkAngle));
            args.push('--watermark-opacity', String(watermarkOpacity));
          }
          if (disclaimerText) {
            args.push('--disclaimer-text', disclaimerText);
            args.push('--disclaimer-position', disclaimerPosition);
            args.push('--disclaimer-opacity', String(disclaimerOpacity));
          }
          if (durationLimit)
            args.push('--preview-seconds', String(durationLimit));
          // Title from audio filename
          const titleText = path.basename(audioPath, path.extname(audioPath));
          if (resolvedCfg.showTitle) {
            const tb = buildTitle(titleText, w, titleFontSize, h);
            args.push('--title', tb.title);
            if (tb.date) {
              args.push('--title-date', tb.date);
              args.push(
                '--title-date-font-size',
                String(Math.max(10, titleFontSize - 8)),
              );
            }
          }
          const logoSizeRatio = program?.logoSizeRatio ?? 0.15;
          const logoXRatio = program?.logoXRatio;
          const logoYRatio = program?.logoYRatio;
          args.push('--overlay-opacity', String(resolvedCfg.overlayOpacity));
          args.push('--overlay-blur', String(resolvedCfg.overlayBlur || 0));
          args.push('--logo-size-ratio', String(logoSizeRatio));
          if (program?.logoRotate) args.push('--logo-rotate', '1');
          if (program?.logoRotateSpeed)
            args.push('--logo-rotate-speed', String(program.logoRotateSpeed));
          if (logoXRatio !== undefined)
            args.push('--logo-x-ratio', String(logoXRatio));
          if (logoYRatio !== undefined)
            args.push('--logo-y-ratio', String(logoYRatio));
          if (globalCfg.titleFontPath)
            args.push('--title-font', globalCfg.titleFontPath);
          if (globalCfg.titleFontSize)
            args.push('--title-font-size', String(globalCfg.titleFontSize));
          args.push('--title-color', globalCfg.titleColor);
          args.push(
            '--title-stroke-enabled',
            globalCfg.titleStrokeEnabled !== false ? '1' : '0',
          );
          if (globalCfg.titleStrokeWidth !== undefined)
            args.push(
              '--title-stroke-width',
              String(globalCfg.titleStrokeWidth),
            );
          args.push(
            '--title-shadow-enabled',
            globalCfg.titleShadowEnabled === true ? '1' : '0',
          );
          args.push(
            '--title-shadow-width',
            String(globalCfg.titleShadowWidth || 3),
          );
          args.push(
            '--title-letter-spacing',
            String(globalCfg.titleLetterSpacing || 0),
          );
          args.push(
            '--title-line-spacing',
            String(globalCfg.titleLineSpacing || 12),
          );
          if (resolvedCfg.titleYRatio !== undefined)
            args.push('--title-y-ratio', String(resolvedCfg.titleYRatio));
          if (globalCfg.subtitleFontPath)
            args.push('--subtitle-font', globalCfg.subtitleFontPath);
          if (globalCfg.subtitleFontSize)
            args.push(
              '--subtitle-font-size',
              String(globalCfg.subtitleFontSize),
            );
          args.push('--subtitle-color', globalCfg.subtitleColor);
          if (globalCfg.subtitleStrokeWidth !== undefined)
            args.push(
              '--subtitle-stroke-width',
              String(globalCfg.subtitleStrokeWidth),
            );
          if (
            (effectiveSubtitleBottomRatio ??
              params.subtitleBottomRatio ??
              resolvedCfg.subtitleBottomRatio) !== undefined
          )
            args.push(
              '--subtitle-bottom-ratio',
              String(
                effectiveSubtitleBottomRatio ??
                  params.subtitleBottomRatio ??
                  resolvedCfg.subtitleBottomRatio,
              ),
            );
          if (params.subtitlePath) args.push('--subtitle', params.subtitlePath);

          logDebug(`[音画] Python cmd: ${pythonPath} ${args.join(' ')}`);

          const pTaskId =
            Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
          const pTask: TaskRecord = {
            id: pTaskId,
            audioPath,
            outputPath,
            status: 'running',
            progress: 0,
            elapsed: 0,
            videoDuration,
            startTime: Date.now(),
            params: JSON.stringify({
              spectrumStyle,
              speed,
              preview: !!durationLimit,
            }),
          };
          tasks.push(pTask);
          broadcastTask(pTask);
          saveTasks();

          const proc = spawn(pythonPath, args);
          currentGenProcess = proc;
          let stderr = '';
          proc.stdout.on('data', (d: Buffer) => {
            const line = d.toString().trim();
            logMessage(`[音画] ${line}`, 'info');
            // Parse progress from Python renderer
            const progMatch = line.match(/\[PROGRESS\]\s*(\d+\.?\d*)/);
            if (progMatch) {
              const pct = parseFloat(progMatch[1]);
              mainWindow.webContents.send('audioVisualize:progress', {
                percent: pct,
              });
              pTask.progress = pct;
              pTask.elapsed = Math.floor((Date.now() - pTask.startTime) / 1000);
              broadcastTask(pTask);
            }
          });
          proc.stderr.on('data', (d: Buffer) => {
            stderr += d.toString();
          });
          proc.on('close', (code: number) => {
            currentGenProcess = null;
            pTask.endTime = Date.now();
            pTask.elapsed = Math.floor(
              (pTask.endTime - pTask.startTime) / 1000,
            );
            if (code === 0) {
              logMessage(`[音画] Success: ${outputPath}`, 'info');
              pTask.status = 'done';
              pTask.progress = 100;
              broadcastTask(pTask);
              saveTasks();
              resolve({ success: true, outputPath });
            } else {
              logMessage(`[音画] Failed: ${stderr.slice(-500)}`, 'error');
              pTask.status = 'error';
              pTask.error = `Python 退出码 ${code}`;
              broadcastTask(pTask);
              saveTasks();
              resolve({
                success: false,
                error: `Python 退出码 ${code}\n${stderr.slice(-500)}`,
              });
            }
          });
          proc.on('error', (err: Error) =>
            resolve({ success: false, error: err.message }),
          );
        });
      }

      // Non-spectrum mode: use FFmpeg directly
      return new Promise((resolve) => {
        const inputs = ['-y', '-i', audioPath, '-loop', '1', '-i', coverPath];
        let filterComplex: string;
        let videoLabel = 'out';
        let titleTextPath = '';

        // Logo 尺寸：从配置读取
        const logoSizeRatio = program?.logoSizeRatio ?? 0.15;
        const logoSize = Math.round(h * logoSizeRatio);

        // Logo 位置：优先使用配置的精确比例
        const cfgLogoX = program?.logoXRatio;
        const cfgLogoY = program?.logoYRatio;
        const posDefaults: Record<string, { x: number; y: number }> = {
          'bottom-left': { x: 0.09, y: 0.89 },
          'bottom-right': { x: 0.91, y: 0.89 },
          'top-left': { x: 0.09, y: 0.11 },
          'top-right': { x: 0.91, y: 0.11 },
          'center-top': { x: 0.5, y: 0.38 },
          center: { x: 0.5, y: 0.5 },
          'center-bottom': { x: 0.5, y: 0.82 },
        };
        const posDef =
          posDefaults[logoPosition || 'bottom-right'] ||
          posDefaults['bottom-right'];
        const logoXPx = Math.round(w * (cfgLogoX ?? posDef.x));
        const logoYPx = Math.round(h * (cfgLogoY ?? posDef.y));

        // 标题 Y 坐标
        const titleY = Math.round(h * titleYRatio);

        // 字幕：解析 SRT 并生成 drawtext 链
        let subtitleDrawText = '';
        if (params.subtitlePath && fs.existsSync(params.subtitlePath)) {
          const srtContent = fs.readFileSync(params.subtitlePath, 'utf-8');
          const srtEntries = parseSrt(srtContent);
          const subFontPath =
            globalCfg.subtitleFontPath ||
            '/Users/vangogh/Library/Fonts/SmileySans-Oblique.ttf';
          const subFontSize =
            globalCfg.subtitleFontSize || Math.round(h * 0.035);
          const subColorHex = (globalCfg.subtitleColor || '#FFF79B').replace(
            '#',
            '',
          );
          const subBottomRatio =
            effectiveSubtitleBottomRatio ??
            params.subtitleBottomRatio ??
            resolvedCfg.subtitleBottomRatio;
          const subY = Math.round(h * (1 - subBottomRatio));
          const subStroke = globalCfg.subtitleStrokeWidth || 3;
          for (const entry of srtEntries) {
            const escaped = entry.text
              .replace(/\\/g, '\\\\')
              .replace(/'/g, "\\'")
              .replace(/:/g, '\\:')
              .replace(/,/g, '\\,')
              .replace(/\n/g, ' ');
            const startH = String(entry.startH).padStart(2, '0');
            const startM = String(entry.startM).padStart(2, '0');
            const startS = String(entry.startS).padStart(2, '0');
            const startMs = String(entry.startMs).padStart(3, '0');
            const endH = String(entry.endH).padStart(2, '0');
            const endM = String(entry.endM).padStart(2, '0');
            const endS = String(entry.endS).padStart(2, '0');
            const endMs = String(entry.endMs).padStart(3, '0');
            subtitleDrawText += `,drawtext=text='${escaped}':fontfile='${subFontPath}':fontsize=${subFontSize}:fontcolor=0x${subColorHex}:borderw=${subStroke}:bordercolor=black:shadowx=2:shadowy=2:x=(w-text_w)/2:y=${subY}:enable='between(t\\,${entry.startSec}\\,${entry.endSec})'`;
          }
        }

        if (logoPath) {
          inputs.push('-loop', '1', '-i', logoPath);

          // Logo 加白色圆角边框
          const borderW = Math.max(3, Math.round(logoSize * 0.04));
          const paddedSize = logoSize + borderW * 2;
          const logoFilter =
            `[2:v]scale=${logoSize}:${logoSize}:force_original_aspect_ratio=decrease,format=rgba[logoRaw];` +
            `color=c=black:s=${logoSize}x${logoSize}:d=1:r=1,` +
            `geq=lum=if(lte(sqrt((X-${logoSize}/2)*(X-${logoSize}/2)+(Y-${logoSize}/2)*(Y-${logoSize}/2))\\,${logoSize}/2)\\,255\\,0)[innerMask];` +
            `[logoRaw][innerMask]alphamerge[logoCircle];` +
            `color=c=white:s=${paddedSize}x${paddedSize}:d=1:r=1,format=rgba[borderBg];` +
            `color=c=black:s=${paddedSize}x${paddedSize}:d=1:r=1,` +
            `geq=lum=if(lte(sqrt((X-${paddedSize}/2)*(X-${paddedSize}/2)+(Y-${paddedSize}/2)*(Y-${paddedSize}/2))\\,${paddedSize}/2)\\,255\\,0)[outerMask];` +
            `[borderBg][outerMask]alphamerge[borderCircle];` +
            `[borderCircle][logoCircle]overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2:format=auto[logoWithBorder];` +
            `[logoWithBorder]fps=24,rotate=t*${program?.logoRotateSpeed || 90}/${playbackSpeed}*PI/180:fillcolor=0x00000000:ow=${paddedSize}:oh=${paddedSize}[logo]`;

          let bgFilter = `[1:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black`;

          // 暗色蒙版
          if (resolvedCfg.showOverlay) {
            if (resolvedCfg.overlayBlur > 0)
              bgFilter += `,gblur=sigma=${resolvedCfg.overlayBlur}`;
            bgFilter += `,drawbox=x=0:y=0:w=${w}:h=${h}:color=black@${resolvedCfg.overlayOpacity}:t=fill`;
          }

          // 标题文字
          if (resolvedCfg.showTitle) {
            const tb = buildTitle(titleText, w, titleFontSize, h);
            titleTextPath = path.join(
              os.tmpdir(),
              `smartsub_title_${Date.now()}.txt`,
            );
            fs.writeFileSync(titleTextPath, tb.title, 'utf-8');
            bgFilter +=
              ',' +
              buildTitleFilter(
                titleTextPath,
                tb.date,
                titleFontPath,
                titleFontSize,
                Math.max(10, titleFontSize - 8),
                titleColorHex,
                globalCfg.titleStrokeEnabled !== false
                  ? globalCfg.titleStrokeWidth || 4
                  : 0,
                globalCfg.titleShadowEnabled === true
                  ? globalCfg.titleShadowWidth || 3
                  : 0,
                globalCfg.titleLineSpacing || 12,
                titleY,
                w,
                h,
              );
          }

          // 字幕
          if (subtitleDrawText) bgFilter += subtitleDrawText;

          // 水印（斜向平铺）
          if (watermarkText) {
            const wmFontSize = Math.round(w * 0.035);
            const wmSpacing = Math.round(w * watermarkDensity);
            const wmAngleRad = (watermarkAngle * Math.PI) / 180;
            const wmEscaped = watermarkText
              .replace(/:/g, '\\:')
              .replace(/'/g, "\\'");
            for (let row = -1; row <= Math.ceil(h / wmSpacing) + 1; row++) {
              for (let col = -1; col <= Math.ceil(w / wmSpacing) + 1; col++) {
                bgFilter += `,drawtext=text='${wmEscaped}':fontsize=${wmFontSize}:fontcolor=white@${(watermarkOpacity / 255).toFixed(2)}:x=${col * wmSpacing}:y=${row * wmSpacing}:angle=${wmAngleRad.toFixed(4)}`;
              }
            }
          }

          // 免责声明
          if (disclaimerText) {
            const dmEscaped = disclaimerText
              .replace(/:/g, '\\:')
              .replace(/'/g, "\\'");
            const dmFontSize = Math.round(w * 0.022);
            let dmX = '(w-tw)/2',
              dmY = 'h-th-20';
            if (disclaimerPosition === 'top-left') {
              dmX = '20';
              dmY = '20';
            } else if (disclaimerPosition === 'top-center') {
              dmX = '(w-tw)/2';
              dmY = '20';
            } else if (disclaimerPosition === 'top-right') {
              dmX = 'w-tw-20';
              dmY = '20';
            } else if (disclaimerPosition === 'bottom-left') {
              dmX = '20';
              dmY = 'h-th-20';
            } else if (disclaimerPosition === 'bottom-center') {
              dmX = '(w-tw)/2';
              dmY = 'h-th-20';
            } else if (disclaimerPosition === 'bottom-right') {
              dmX = 'w-tw-20';
              dmY = 'h-th-20';
            }
            bgFilter += `,drawtext=text='${dmEscaped}':fontsize=${dmFontSize}:fontcolor=white@${(disclaimerOpacity / 255).toFixed(2)}:x=${dmX}:y=${dmY}`;
          }

          filterComplex =
            bgFilter +
            '[bg];' +
            logoFilter +
            `;[bg][logo]overlay=${logoXPx}-overlay_w/2:${logoYPx}-overlay_h/2:format=auto[out]`;
          videoLabel = 'out';
        } else {
          let bgFilter = `[1:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black`;
          if (resolvedCfg.showOverlay) {
            if (resolvedCfg.overlayBlur > 0)
              bgFilter += `,gblur=sigma=${resolvedCfg.overlayBlur}`;
            bgFilter += `,drawbox=x=0:y=0:w=${w}:h=${h}:color=black@${resolvedCfg.overlayOpacity}:t=fill`;
          }
          if (resolvedCfg.showTitle) {
            const tb = buildTitle(titleText, w, titleFontSize, h);
            titleTextPath = path.join(
              os.tmpdir(),
              `smartsub_title_${Date.now()}.txt`,
            );
            fs.writeFileSync(titleTextPath, tb.title, 'utf-8');
            bgFilter +=
              ',' +
              buildTitleFilter(
                titleTextPath,
                tb.date,
                titleFontPath,
                titleFontSize,
                Math.max(10, titleFontSize - 8),
                titleColorHex,
                globalCfg.titleStrokeEnabled !== false
                  ? globalCfg.titleStrokeWidth || 4
                  : 0,
                globalCfg.titleShadowEnabled === true
                  ? globalCfg.titleShadowWidth || 3
                  : 0,
                globalCfg.titleLineSpacing || 12,
                titleY,
                w,
                h,
              );
          }
          if (subtitleDrawText) bgFilter += subtitleDrawText;

          // 水印（斜向平铺）
          if (watermarkText) {
            const wmFontSize = Math.round(w * 0.035);
            const wmSpacing = Math.round(w * watermarkDensity);
            const wmAngleRad = (watermarkAngle * Math.PI) / 180;
            const wmEscaped = watermarkText
              .replace(/:/g, '\\:')
              .replace(/'/g, "\\'");
            for (let row = -1; row <= Math.ceil(h / wmSpacing) + 1; row++) {
              for (let col = -1; col <= Math.ceil(w / wmSpacing) + 1; col++) {
                bgFilter += `,drawtext=text='${wmEscaped}':fontsize=${wmFontSize}:fontcolor=white@${(watermarkOpacity / 255).toFixed(2)}:x=${col * wmSpacing}:y=${row * wmSpacing}:angle=${wmAngleRad.toFixed(4)}`;
              }
            }
          }

          // 免责声明
          if (disclaimerText) {
            const dmEscaped = disclaimerText
              .replace(/:/g, '\\:')
              .replace(/'/g, "\\'");
            const dmFontSize = Math.round(w * 0.022);
            let dmX = '(w-tw)/2',
              dmY = 'h-th-20';
            if (disclaimerPosition === 'top-left') {
              dmX = '20';
              dmY = '20';
            } else if (disclaimerPosition === 'top-center') {
              dmX = '(w-tw)/2';
              dmY = '20';
            } else if (disclaimerPosition === 'top-right') {
              dmX = 'w-tw-20';
              dmY = '20';
            } else if (disclaimerPosition === 'bottom-left') {
              dmX = '20';
              dmY = 'h-th-20';
            } else if (disclaimerPosition === 'bottom-center') {
              dmX = '(w-tw)/2';
              dmY = 'h-th-20';
            } else if (disclaimerPosition === 'bottom-right') {
              dmX = 'w-tw-20';
              dmY = 'h-th-20';
            }
            bgFilter += `,drawtext=text='${dmEscaped}':fontsize=${dmFontSize}:fontcolor=white@${(disclaimerOpacity / 255).toFixed(2)}:x=${dmX}:y=${dmY}`;
          }

          filterComplex = bgFilter + '[out]';
          videoLabel = 'out';
        }

        const filterScriptPath = path.join(
          os.tmpdir(),
          `smartsub_filter_${Date.now()}.txt`,
        );
        fs.writeFileSync(filterScriptPath, filterComplex, 'utf-8');
        logDebug(`[音画] filter script: ${filterScriptPath}`);

        inputs.push(
          ...(durationLimit ? ['-t', String(durationLimit)] : []),
          '-filter_complex_script',
          filterScriptPath,
          '-map',
          `[${videoLabel}]`,
          '-map',
          '0:a',
          '-c:v',
          'libx264',
          '-preset',
          'medium',
          '-crf',
          '28',
          '-pix_fmt',
          'yuv420p',
          '-r',
          '24',
          '-threads',
          '0',
          '-c:a',
          'aac',
          '-b:a',
          '160k',
          '-ac',
          '2',
          '-filter:a',
          `atempo=${playbackSpeed}`,
          '-shortest',
          '-movflags',
          '+faststart',
          outputPath,
        );

        logMessage(`[音画] FILTER_SCRIPT_CONTENT:\n${filterComplex}`, 'info');
        logDebug(
          `[音画] filterComplex (len=${filterComplex.length}): ${filterComplex}`,
        );
        logDebug(`[音画] ffmpeg full args: ${JSON.stringify(inputs)}`);
        logMessage(`[音画] ffmpeg command built, starting...`, 'info');

        const taskId =
          Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const task: TaskRecord = {
          id: taskId,
          audioPath,
          outputPath,
          status: 'running',
          progress: 0,
          elapsed: 0,
          startTime: Date.now(),
          videoDuration,
          params: JSON.stringify({
            spectrumStyle,
            speed,
            preview: !!durationLimit,
          }),
        };
        tasks.push(task);
        broadcastTask(task);
        saveTasks();

        const proc = spawn(ffmpegPath, inputs);
        currentGenProcess = proc;
        let stderr = '';
        let totalDuration = durationLimit || 0;

        proc.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
          // Parse total duration on first occurrence
          if (!totalDuration) {
            const durMatch = data
              .toString()
              .match(/Duration:\s*(\d+):(\d+):(\d+)\.\d+/);
            if (durMatch)
              totalDuration =
                parseInt(durMatch[1]) * 3600 +
                parseInt(durMatch[2]) * 60 +
                parseInt(durMatch[3]);
          }
          const match = data.toString().match(/time=(\d+):(\d+):(\d+)\.(\d+)/);
          if (match && totalDuration > 0) {
            const cur =
              parseInt(match[1]) * 3600 +
              parseInt(match[2]) * 60 +
              parseInt(match[3]) +
              parseInt(match[4]) / 100;
            const pct = Math.min((cur / totalDuration) * 100, 99.9);
            mainWindow.webContents.send('audioVisualize:progress', {
              percent: pct,
            });
            task.progress = pct;
            task.elapsed = Math.floor((Date.now() - task.startTime) / 1000);
            broadcastTask(task);
          }
        });
        proc.on('close', (code: number | null, signal: string | null) => {
          try {
            fs.unlinkSync(filterScriptPath);
          } catch {}
          try {
            fs.unlinkSync(titleTextPath);
          } catch {}
          currentGenProcess = null;
          if (code === 0) {
            logMessage(`[音画] Success: ${outputPath}`, 'info');
            logDebug(
              `[音画] Output: ${outputPath}, stderr tail: ${stderr.slice(-300)}`,
            );
            task.status = 'done';
            task.progress = 100;
            task.endTime = Date.now();
            task.elapsed = Math.floor((task.endTime - task.startTime) / 1000);
            broadcastTask(task);
            saveTasks();
            resolve({ success: true, outputPath });
          } else {
            const reason =
              code === null ? `killed by signal ${signal}` : `退出码 ${code}`;
            logMessage(
              `[音画] Failed (${reason}): ${stderr.slice(-1000)}`,
              'error',
            );
            task.status = 'error';
            task.error = `ffmpeg ${reason}`;
            task.endTime = Date.now();
            task.elapsed = Math.floor((task.endTime - task.startTime) / 1000);
            broadcastTask(task);
            saveTasks();
            resolve({ success: false, error: `ffmpeg ${reason}` });
          }
        });
        proc.on('error', (err: Error) =>
          resolve({ success: false, error: err.message }),
        );
      });
    },
  );
}
