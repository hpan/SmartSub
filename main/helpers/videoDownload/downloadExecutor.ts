/**
 * 下载执行器
 * 使用 yt-dlp 执行实际下载，支持进度回调和取消
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import ffmpegStatic from '@ffmpeg-installer/ffmpeg';
import { logMessage } from '../storeManager';
import type { DownloadTask } from '../../../types/videoDownload';
import type { CookieArgs } from './videoInfoParser';

/** 活跃的下载进程 Map<taskId, ChildProcess> */
const activeDownloads = new Map<string, ChildProcess>();

/** 取消标志 Map<taskId, boolean> */
const cancelFlags = new Map<string, boolean>();

/**
 * 获取 ffmpeg 路径（用于 yt-dlp 合并音视频流）
 */
function getFfmpegPath(): string {
  const raw = ffmpegStatic.path || ffmpegStatic;
  return String(raw).replace('app.asar', 'app.asar.unpacked');
}

export interface DownloadProgressInfo {
  taskId: string;
  percent: number;
  speed: number;
  downloaded: number;
  totalSize: number;
  eta: number;
  status: string;
  /** 给渲染层的状态文字，如 "下载视频流..." "合并音视频中..." */
  statusText: string;
}

/**
 * 构建格式选择字符串
 * 选择特定视频流时必须同时指定音频流，否则下载的文件没有声音
 */
function buildFormatArg(
  selectedFormatId: string | null,
  allFormats?: { formatId: string; audioOnly: boolean }[],
): string {
  if (!selectedFormatId || selectedFormatId === 'best') {
    return 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best';
  }

  const isAudioOnly = allFormats?.find(
    (f) => f.formatId === selectedFormatId,
  )?.audioOnly;
  if (isAudioOnly || selectedFormatId === 'bestaudio') {
    return 'bestaudio/best';
  }

  return `${selectedFormatId}+bestaudio/best`;
}

/**
 * 下载阶段追踪（用于双流下载时的进度映射）
 *
 * 双流下载时 yt-dlp 的原始进度：
 *   视频流: 0% → 100%  (约总耗时 45%)
 *   音频流: 0% → 100%  (约总耗时 45%)
 *   合并:   瞬间         (约总耗时 10%)
 *
 * 映射为统一进度：
 *   视频流: 0% → 45%
 *   音频流: 45% → 90%
 *   合并:   90% → 100%
 */
type DownloadPhase = 'video' | 'audio' | 'merge' | 'single';

interface PhaseState {
  phase: DownloadPhase;
}

/**
 * 从 yt-dlp 输出行检测当前阶段
 */
function detectPhase(line: string, currentPhase: DownloadPhase): DownloadPhase {
  // [download] Destination: xxx.f137.mp4 → 正在下载视频流
  if (line.match(/\[download\]\s+Destination:.*\.f\d+\.(mp4|webm|mkv)/)) {
    return 'video';
  }
  // [download] Destination: xxx.f140.m4a → 正在下载音频流
  if (
    line.match(/\[download\]\s+Destination:.*\.f\d+\.(m4a|aac|opus|ogg|mp3)/)
  ) {
    return 'audio';
  }
  // [Merger] Merging formats → 合并阶段
  if (line.includes('[Merger]')) {
    return 'merge';
  }
  return currentPhase;
}

/**
 * 将原始进度映射为统一进度百分比
 */
function mapProgress(
  rawPercent: number,
  phase: DownloadPhase,
): { percent: number; statusText: string } {
  switch (phase) {
    case 'video':
      return { percent: rawPercent * 0.45, statusText: '下载视频流...' };
    case 'audio':
      return { percent: 45 + rawPercent * 0.45, statusText: '下载音频流...' };
    case 'merge':
      return { percent: 90 + rawPercent * 0.1, statusText: '合并音视频中...' };
    case 'single':
    default:
      return { percent: rawPercent, statusText: '' };
  }
}

/**
 * 开始下载
 */
export async function startDownload(
  task: DownloadTask,
  ytdlpPath: string,
  onProgress: (progress: DownloadProgressInfo) => void,
  onComplete: (outputPath: string) => void,
  onError: (error: string) => void,
  cookieArgs?: CookieArgs,
  proxy?: string,
  extraArgs?: string,
): Promise<void> {
  const {
    videoInfo,
    selectedFormatId,
    downloadSubtitles,
    subtitleLanguages,
    outputDir,
  } = task;

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const safeTitle = videoInfo.title
    .replace(/[\/\\:*?"<>|]/g, '_')
    .substring(0, 150);
  const outputTemplate = path.join(outputDir, `${safeTitle}.%(ext)s`);

  const args: string[] = [
    '--no-warnings',
    '--no-check-certificates',
    '--newline',
    '--progress',
    '--merge-output-format',
    'mp4',
    '-o',
    outputTemplate,
  ];

  // ffmpeg 路径
  const ffmpegPath = getFfmpegPath();
  if (fs.existsSync(ffmpegPath)) {
    const ffmpegDir = path.dirname(ffmpegPath);
    args.push('--ffmpeg-location', ffmpegDir);
    logMessage(`[download] ffmpeg location: ${ffmpegDir}`, 'info');
  } else {
    logMessage(
      '[download] WARNING: ffmpeg not found, merging may fail',
      'error',
    );
  }

  // 格式选择
  const formatArg = buildFormatArg(selectedFormatId, videoInfo.formats);
  args.push('-f', formatArg);
  logMessage(`[download] format arg: ${formatArg}`, 'info');

  // 是否为双流下载（需要合并）
  const isDualStream = formatArg.includes('+bestaudio');

  // 字幕
  if (downloadSubtitles) {
    args.push('--write-sub', '--write-auto-sub');
    if (subtitleLanguages.length > 0) {
      args.push('--sub-langs', subtitleLanguages.join(','));
    }
    args.push('--sub-format', 'srt');
    args.push('--embed-subs');
  }

  // Cookie
  if (cookieArgs) {
    if (cookieArgs.cookiesFromBrowser) {
      args.push('--cookies-from-browser', cookieArgs.cookiesFromBrowser);
    }
    if (cookieArgs.cookieFile && fs.existsSync(cookieArgs.cookieFile)) {
      args.push('--cookies', cookieArgs.cookieFile);
    }
  }

  if (proxy) args.push('--proxy', proxy);

  if (extraArgs) {
    args.push(...extraArgs.split(/\s+/).filter(Boolean));
  }

  args.push(videoInfo.originalUrl);

  logMessage(`[download] starting: ${videoInfo.title}`, 'info');
  logMessage(`[download] dual stream: ${isDualStream}`, 'info');

  cancelFlags.delete(task.id);

  return new Promise<void>((resolve, reject) => {
    const proc = spawn(ytdlpPath, args, { windowsHide: true });
    activeDownloads.set(task.id, proc);

    let lastProgressTime = 0;
    const phaseState: PhaseState = { phase: isDualStream ? 'video' : 'single' };

    const emitProgress = (
      rawPercent: number,
      rawSpeed: number,
      rawTotal: number,
      rawEta: number,
    ) => {
      const now = Date.now();
      if (now - lastProgressTime < 300) return; // 限频 300ms
      lastProgressTime = now;

      const mapped = mapProgress(rawPercent, phaseState.phase);
      onProgress({
        taskId: task.id,
        percent: mapped.percent,
        speed: rawSpeed,
        downloaded: (rawPercent / 100) * rawTotal,
        totalSize: rawTotal,
        eta: rawEta,
        status: mapped.statusText || `下载中 ${mapped.percent.toFixed(1)}%`,
        statusText: mapped.statusText,
      });
    };

    proc.stdout.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        // 检测阶段切换
        const newPhase = detectPhase(line, phaseState.phase);
        if (newPhase !== phaseState.phase) {
          phaseState.phase = newPhase;
          logMessage(`[download] phase → ${newPhase}`, 'info');
          if (newPhase === 'merge') {
            onProgress({
              taskId: task.id,
              percent: 90,
              speed: 0,
              downloaded: 0,
              totalSize: 0,
              eta: 0,
              status: '合并音视频中...',
              statusText: '合并音视频中...',
            });
          }
        }

        // 解析进度行
        const progressMatch = line.match(
          /\[download\]\s+([\d.]+)%\s+of\s+~?([\d.]+\w+)\s+at\s+([\d.]+\w+\/s)\s+ETA\s+(\S+)/,
        );
        if (progressMatch) {
          const percent = parseFloat(progressMatch[1]);
          const totalSize = parseSize(progressMatch[2]);
          const speed = parseSize(progressMatch[3]);
          const eta = parseEta(progressMatch[4]);
          emitProgress(percent, speed, totalSize, eta);
          return;
        }

        // 100% 行
        if (line.includes('[download] 100%')) {
          emitProgress(100, 0, 0, 0);
        }
      }
    });

    proc.stderr.on('data', (data: Buffer) => {
      logMessage(`[download] stderr: ${data.toString()}`, 'info');
    });

    proc.on('close', (code) => {
      activeDownloads.delete(task.id);

      if (cancelFlags.has(task.id)) {
        cancelFlags.delete(task.id);
        onError('已取消');
        resolve();
        return;
      }

      if (code !== 0) {
        onError(`下载失败，退出码 ${code}`);
        reject(new Error(`yt-dlp exited with code ${code}`));
        return;
      }

      // 查找合并后的最终文件
      try {
        const files = fs.readdirSync(outputDir);
        const prefix = safeTitle.substring(0, 50);
        const matchedFile = files.find(
          (f) =>
            f.startsWith(prefix) &&
            /\.(mp4|mkv|webm|mp3|m4a|aac|opus|flac|ogg)$/.test(f) &&
            !f.includes('.f'), // 排除未合并的临时流文件
        );
        const outputPath = matchedFile
          ? path.join(outputDir, matchedFile)
          : outputDir;
        logMessage(`[download] complete: ${outputPath}`, 'info');
        onComplete(outputPath);
        resolve();
      } catch {
        onComplete(outputDir);
        resolve();
      }
    });

    proc.on('error', (err) => {
      activeDownloads.delete(task.id);
      onError(`启动 yt-dlp 失败: ${err.message}`);
      reject(err);
    });
  });
}

export function cancelDownload(taskId: string): void {
  cancelFlags.set(taskId, true);
  const proc = activeDownloads.get(taskId);
  if (proc) {
    proc.kill('SIGTERM');
    setTimeout(() => {
      if (!proc.killed) proc.kill('SIGKILL');
    }, 5000);
  }
}

export function hasActiveDownload(taskId: string): boolean {
  return activeDownloads.has(taskId);
}

function parseSize(sizeStr: string): number {
  const match = sizeStr.match(/([\d.]+)\s*(B|KB|KiB|MB|MiB|GB|GiB|TB|TiB|\/s)/);
  if (!match) return 0;
  const value = parseFloat(match[1]);
  const unit = match[2];
  const m: Record<string, number> = {
    B: 1,
    KB: 1000,
    KiB: 1024,
    MB: 1000000,
    MiB: 1024 * 1024,
    GB: 1000000000,
    GiB: 1024 * 1024 * 1024,
    TB: 1e12,
    TiB: 1024 ** 4,
    '/s': 1,
  };
  return value * (m[unit] || 1);
}

function parseEta(etaStr: string): number {
  const parts = etaStr.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}
