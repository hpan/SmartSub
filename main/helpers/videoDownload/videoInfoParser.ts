/**
 * 视频信息解析器
 * 使用 yt-dlp 解析链接获取视频元信息和可用格式
 */

import * as path from 'path';
import { spawn } from 'child_process';
import { logMessage } from '../storeManager';
import {
  isDouyinUrl,
  extractDouyinId,
  downloadDouyinVideo,
} from './douyinDownloader';
import type {
  DownloadPlatform,
  DownloadVideoInfo,
  DownloadFormat,
  PlaylistEntry,
} from '../../../types/videoDownload';

/**
 * 从 URL 识别平台
 */
/**
 * 从抖音分享文本中提取短链接并解析为真实链接
 * 分享文本示例: "0.56 复制打开抖音，看看【xxx的作品】... https://v.douyin.com/_uM6E95MsT0/ ..."
 */
export async function resolveShareLink(input: string): Promise<string> {
  // Extract URL from share text
  const urlMatch = input.match(/https?:\/\/v\.douyin\.com\/[\w-]+\/?/i);
  if (!urlMatch) return input; // No short URL found, return as-is

  const shortUrl = urlMatch[0];
  logMessage(`[douyin] Resolving share link: ${shortUrl}`, 'info');

  return new Promise<string>((resolve) => {
    // Follow redirects manually
    const https = require('https');
    const http = require('http');

    const followRedirects = (url: string, maxRedirects = 5): void => {
      if (maxRedirects <= 0) {
        resolve(url);
        return;
      }

      const client = url.startsWith('https') ? https : http;
      client
        .get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res: any) => {
          if (
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            const nextUrl = res.headers.location.startsWith('http')
              ? res.headers.location
              : new URL(res.headers.location, url).href;
            logMessage(`[douyin] Redirect: ${nextUrl}`, 'info');
            followRedirects(nextUrl, maxRedirects - 1);
          } else {
            resolve(url);
          }
        })
        .on('error', () => resolve(input));
    };

    followRedirects(shortUrl);
  });
}

/**
 * 检查输入是否为抖音分享文本（包含短链接）
 */
export function isDouyinShareText(input: string): boolean {
  return /https?:\/\/v\.douyin\.com\/[\w-]+\/?/i.test(input);
}
export function isXhsShareLink(input: string): boolean {
  return /https?:\/\/xhslink\.(com|cn)\/[\w-]+\/?/i.test(input);
}

/**
 * 解析小红书短链接 (xhslink.cn / xhslink.com) 为真实 URL，
 * 避免 yt-dlp 直接请求短链接时出现 SSL 错误。
 */

export function detectPlatform(url: string): DownloadPlatform {
  const lower = url.toLowerCase();
  if (lower.includes('bilibili.com') || lower.includes('b23.tv'))
    return 'bilibili';
  if (lower.includes('youtube.com') || lower.includes('youtu.be'))
    return 'youtube';
  if (
    lower.includes('xiaohongshu.com') ||
    lower.includes('xhslink.com') ||
    lower.includes('xhslink.cn')
  )
    return 'xiaohongshu';
  if (
    lower.includes('weixin.qq.com') ||
    lower.includes('channels.weixin.qq.com')
  )
    return 'weixin_video';
  if (
    lower.includes('douyin.com') ||
    lower.includes('iesdouyin.com') ||
    lower.includes('v.douyin.com')
  )
    return 'douyin';
  return 'generic';
}

/** Cookie 传参 */
export interface CookieArgs {
  cookieFile?: string;
  cookiesFromBrowser?: string;
}

/**
 * 将 cookie 参数注入 yt-dlp args
 */
function applyCookieArgs(args: string[], cookieArgs?: CookieArgs): void {
  if (!cookieArgs) return;
  if (cookieArgs.cookiesFromBrowser) {
    args.push('--cookies-from-browser', cookieArgs.cookiesFromBrowser);
  }
  if (cookieArgs.cookieFile) {
    args.push('--cookies', cookieArgs.cookieFile);
  }
}

/**
 * 将 yt-dlp 的 JSON 数据对象转为 DownloadVideoInfo
 */
function parseVideoData(
  data: any,
  url: string,
  platform: DownloadPlatform,
): DownloadVideoInfo {
  const formats: DownloadFormat[] = (data.formats || [])
    .filter((f: any) => f.url && f.protocol !== 'storyboard')
    .map((f: any) => {
      const filesize = f.filesize || f.filesize_approx || null;
      const audioOnly = !f.vcodec || f.vcodec === 'none';
      const resolution =
        f.resolution ||
        (audioOnly ? 'audio only' : `${f.width || '?'}x${f.height || '?'}`);

      let label = '';
      if (audioOnly) {
        label = `音频 · ${f.ext || '?'} · ${f.acodec || '?'}`;
      } else {
        const height = f.height ? `${f.height}p` : '';
        label = [height, f.ext, f.vcodec?.split('.')[0]]
          .filter(Boolean)
          .join(' · ');
      }
      if (filesize) label += ` · ${formatBytes(filesize)}`;

      return {
        formatId: f.format_id,
        ext: f.ext,
        resolution,
        fps: f.fps || null,
        vcodec: f.vcodec || 'none',
        acodec: f.acodec || 'none',
        filesize,
        label,
        audioOnly,
      } as DownloadFormat;
    });

  return {
    id: data.id,
    title: data.title || data.fulltitle || '未知标题',
    thumbnail: data.thumbnail || null,
    duration: data.duration || null,
    uploader: data.uploader || data.channel || null,
    uploadDate: data.upload_date || null,
    originalUrl: url,
    platform,
    formats,
    hasSubtitles: Boolean(
      data.subtitles && Object.keys(data.subtitles).length > 0,
    ),
    subtitleLanguages: data.subtitles ? Object.keys(data.subtitles) : [],
    isPlaylist: false,
    playlistCount: null,
  };
}

/**
 * 使用 yt-dlp 获取视频信息（JSON 格式）
 *
 * 关键：分P视频 / 播放列表时 yt-dlp 会输出多行 JSON（每行一个条目），
 * 需要逐行解析。对于播放列表，取第一条的格式信息，并把所有条目记录为
 * playlistEntries。
 */
/**
 * 获取抖音视频信息（使用 Python 脚本）
 */
async function getDouyinVideoInfo(
  url: string,
  cookieArgs?: CookieArgs,
): Promise<DownloadVideoInfo> {
  const { getDouyinVideoInfo: getDouyinInfo } = require('./douyinDownloader');

  logMessage(`[douyin] Parsing via BrowserWindow: ${url}`, 'info');

  const result = await getDouyinInfo(url);

  return {
    id: result.id,
    title: result.title || '未知标题',
    thumbnail: result.thumbnail || null,
    duration: result.duration || null,
    uploader: result.uploader || null,
    uploadDate: null,
    originalUrl: url,
    platform: 'douyin',
    formats: [
      ...(result.hasVideo
        ? [
            {
              formatId: 'douyin-best',
              ext: 'mp4',
              resolution: `${result.width || 0}x${result.height || 0}`,
              fps: null,
              vcodec: 'h264',
              acodec: 'aac',
              filesize: null,
              label: '最佳画质',
              audioOnly: false,
            },
          ]
        : []),
      {
        formatId: 'douyin-audio',
        ext: 'm4a',
        resolution: 'audio only',
        fps: null,
        vcodec: null,
        acodec: 'aac',
        filesize: null,
        label: '仅音频 (M4A)',
        audioOnly: true,
      },
    ],
    hasSubtitles: false,
    subtitleLanguages: [],
    isPlaylist: false,
    playlistCount: null,
  };
}

export async function getVideoInfo(
  url: string,
  ytdlpPath: string,
  cookieArgs?: CookieArgs,
  proxy?: string,
): Promise<DownloadVideoInfo> {
  // Handle Douyin URLs with Python parser
  if (isDouyinUrl(url)) {
    logMessage(`[douyin] Using Python parser for: ${url}`, 'info');
    return getDouyinVideoInfo(url, cookieArgs);
  }

  return new Promise((resolve, reject) => {
    const args = [
      '--dump-json',
      '--no-download',
      '--no-warnings',
      '--no-check-certificates',
      url,
    ];

    applyCookieArgs(args, cookieArgs);
    if (proxy) args.push('--proxy', proxy);

    logMessage(`[ytdlp] getVideoInfo args: ${args.join(' ')}`, 'info');

    let stdout = '';
    let stderr = '';

    const proc = spawn(ytdlpPath, args, {
      timeout: 60000,
      windowsHide: true,
    });

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });
    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        logMessage(`[ytdlp] parse error (code ${code}): ${stderr}`, 'error');
        let userMessage = stderr || `yt-dlp 退出码 ${code}`;
        if (stderr.includes('412') || stderr.includes('Precondition Failed')) {
          userMessage =
            'B站返回 412 错误：请在设置中配置 Cookie（推荐使用 Firefox 自动读取）';
        } else if (stderr.includes('Sign in to confirm')) {
          userMessage = 'YouTube 需要登录验证：请在设置中配置 Cookie';
        } else if (stderr.includes('cookies') || stderr.includes('cookie')) {
          userMessage = 'Cookie 相关错误：请在设置中重新配置 Cookie';
        }
        reject(new Error(userMessage));
        return;
      }

      try {
        const platform = detectPlatform(url);
        const lines = stdout.trim().split('\n').filter(Boolean);

        if (lines.length === 0) {
          reject(new Error('yt-dlp 返回了空结果'));
          return;
        }

        // 单个视频（最常见情况）
        if (lines.length === 1) {
          const data = JSON.parse(lines[0]);
          resolve(parseVideoData(data, url, platform));
          return;
        }

        // 多行 JSON = 分P视频 或 播放列表
        logMessage(
          `[ytdlp] playlist detected: ${lines.length} entries`,
          'info',
        );
        const entries: any[] = [];
        for (const line of lines) {
          try {
            entries.push(JSON.parse(line));
          } catch {
            // 跳过无法解析的行
          }
        }

        if (entries.length === 0) {
          reject(new Error('解析播放列表失败'));
          return;
        }

        // 用第一个条目的格式信息作为整体格式
        const first = entries[0];
        const info = parseVideoData(first, url, platform);

        // 标记为播放列表
        info.isPlaylist = true;
        info.playlistCount = entries.length;
        info.playlistEntries = entries.map((e: any, idx: number) => ({
          id: e.id || `p${idx + 1}`,
          title: e.title || e.fulltitle || `第${idx + 1}P`,
          url: e.webpage_url || url,
          duration: e.duration || null,
          thumbnail: e.thumbnail || null,
        }));

        // 总时长 = 各分P时长之和
        const totalDuration = entries.reduce(
          (sum, e) => sum + (e.duration || 0),
          0,
        );
        if (totalDuration > 0) info.duration = totalDuration;

        resolve(info);
      } catch (parseError) {
        logMessage(`[ytdlp] JSON parse error: ${parseError}`, 'error');
        reject(new Error('解析视频信息失败'));
      }
    });

    proc.on('error', (err) => {
      logMessage(`[ytdlp] spawn error: ${err}`, 'error');
      reject(new Error(`启动 yt-dlp 失败: ${err.message}`));
    });
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
