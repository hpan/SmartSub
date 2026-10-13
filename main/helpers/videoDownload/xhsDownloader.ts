/**
 * 小红书视频下载器
 * 调用 Python xhs_dl.py (curl_cffi + chrome146 TLS指纹)
 */

import * as https from 'https';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { app } from 'electron';
import { logMessage } from '../storeManager';
import type {
  DownloadVideoInfo,
  DownloadFormat,
} from '../../../types/videoDownload';

const MAX_REDIRECTS = 5;
const PYTHON_PATH = '/opt/homebrew/bin/python3';

function getScriptPath(): string {
  const isDev = !app.isPackaged;
  return isDev
    ? path.join(app.getAppPath(), 'tools', 'xhs-dl', 'xhs_dl.py')
    : path.join(process.resourcesPath, 'tools', 'xhs-dl', 'xhs_dl.py');
}

/** 解析 xhslink 短链接为真实 URL */
export async function resolveXhsLinkTracked(input: string): Promise<string> {
  const urlMatch = input.match(/https?:\/\/xhslink\.(com|cn)\/[\w\-\/]+/i);
  if (!urlMatch) return input;
  const shortUrl = urlMatch[0];
  logMessage(`[xhs] Resolving share link: ${shortUrl}`, 'info');

  return new Promise<string>((resolve) => {
    const followRedirects = (url: string, maxRedirects: number): void => {
      if (maxRedirects <= 0) {
        resolve(url);
        return;
      }
      const client = url.startsWith('https') ? https : http;
      client
        .get(
          url,
          {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            timeout: 10000,
          },
          (res: any) => {
            if (
              res.statusCode >= 300 &&
              res.statusCode < 400 &&
              res.headers.location
            ) {
              const nextUrl = res.headers.location.startsWith('http')
                ? res.headers.location
                : new URL(res.headers.location, url).href;
              logMessage(`[xhs] Redirect: ${nextUrl}`, 'info');
              res.resume();
              followRedirects(nextUrl, maxRedirects - 1);
            } else {
              res.resume();
              resolve(url);
            }
          },
        )
        .on('error', (err: any) => {
          logMessage(`[xhs] Redirect error: ${err.message}`, 'warning');
          resolve(input);
        });
    };
    followRedirects(shortUrl, MAX_REDIRECTS);
  });
}

function extractNoteId(url: string): string | null {
  const m = url.match(/(?:explore|discovery\/item)\/([a-f0-9]{24})/i);
  return m ? m[1] : null;
}

interface XhsParseResult {
  success: boolean;
  id?: string;
  title?: string;
  author?: string;
  thumbnail?: string;
  videoUrl?: string;
  resolvedUrl?: string;
  originalUrl?: string;
  error?: string;
}

/** 调用 Python 脚本解析小红书链接 */
function callXhsParser(url: string): Promise<XhsParseResult> {
  return new Promise((resolve) => {
    const scriptPath = getScriptPath();
    logMessage(`[xhs] Parsing via Python: ${url}`, 'info');

    const proc = spawn(PYTHON_PATH, [scriptPath, 'parse', url], {
      timeout: 30000,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });

    proc.on('close', (code: number) => {
      if (code !== 0) {
        logMessage(`[xhs] Python error (code ${code}): ${stderr}`, 'error');
        resolve({
          success: false,
          error: stderr || `Python exited with code ${code}`,
        });
        return;
      }
      try {
        const result = JSON.parse(stdout.trim());
        if (result.success) {
          logMessage(`[xhs] Parsed: ${result.title} (${result.id})`, 'info');
        } else {
          logMessage(`[xhs] Parse failed: ${result.error}`, 'warning');
        }
        resolve(result);
      } catch (e: any) {
        logMessage(`[xhs] Parse output error: ${e.message}`, 'error');
        resolve({ success: false, error: `Parse output error: ${e.message}` });
      }
    });

    proc.on('error', (err: Error) => {
      logMessage(`[xhs] Process error: ${err.message}`, 'error');
      resolve({ success: false, error: `Process error: ${err.message}` });
    });
  });
}

/** 解析小红书视频信息 */
export async function getXhsVideoInfo(url: string): Promise<DownloadVideoInfo> {
  const result = await callXhsParser(url);
  if (!result.success || !result.videoUrl) {
    throw new Error(result.error || '小红书解析失败');
  }

  const noteId = result.id || extractNoteId(url) || 'unknown';

  const format: DownloadFormat = {
    formatId: 'xhs-best',
    ext: 'mp4',
    resolution: 'video',
    fps: null,
    vcodec: 'h264',
    acodec: 'aac',
    filesize: null,
    label: '最佳画质 · mp4',
    audioOnly: false,
  };
  const audioFormat: DownloadFormat = {
    formatId: 'xhs-audio',
    ext: 'm4a',
    resolution: 'audio only',
    fps: null,
    vcodec: 'none',
    acodec: 'aac',
    filesize: null,
    label: '仅音频 · m4a',
    audioOnly: true,
  };

  return {
    id: noteId,
    title: result.title || '小红书视频',
    thumbnail: result.thumbnail || null,
    duration: null,
    uploader: result.author || null,
    uploadDate: null,
    originalUrl: url,
    platform: 'xiaohongshu',
    formats: [format, audioFormat],
    hasSubtitles: false,
    subtitleLanguages: [],
    isPlaylist: false,
    playlistCount: null,
  };
}

/** 下载小红书视频 */
export async function downloadXhsVideo(
  videoInfo: DownloadVideoInfo,
  outputDir: string,
  audioOnly: boolean,
  onProgress?: (percent: number, speed: string) => void,
  abortSignal?: { aborted: boolean },
): Promise<string> {
  // Re-parse to get fresh video URL
  const result = await callXhsParser(videoInfo.originalUrl);
  if (!result.success || !result.videoUrl) {
    throw new Error(result.error || '无法获取小红书视频下载地址');
  }

  const videoUrl = result.videoUrl;
  const safeTitle = videoInfo.title
    .replace(/[\/\\:*?"<>|]/g, '_')
    .substring(0, 150);
  const ext = audioOnly ? 'm4a' : 'mp4';
  const outputPath = path.join(outputDir, `${safeTitle}.${ext}`);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  logMessage(`[xhs] Downloading: ${videoUrl.substring(0, 80)}...`, 'info');

  return new Promise<string>((resolve, reject) => {
    const doDownload = (url: string, redirectsLeft: number): void => {
      if (redirectsLeft <= 0) {
        reject(new Error('下载重定向次数过多'));
        return;
      }
      const client = url.startsWith('https') ? https : http;
      client
        .get(
          url,
          { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 60000 },
          (res) => {
            if (
              res.statusCode &&
              res.statusCode >= 300 &&
              res.statusCode < 400 &&
              res.headers.location
            ) {
              const next = res.headers.location!.startsWith('http')
                ? res.headers.location!
                : new URL(res.headers.location!, url).href;
              res.resume();
              doDownload(next, redirectsLeft - 1);
              return;
            }
            if (res.statusCode !== 200) {
              reject(new Error(`下载失败: HTTP ${res.statusCode}`));
              return;
            }

            const totalSize = parseInt(
              res.headers['content-length'] || '0',
              10,
            );
            let downloaded = 0;
            const file = fs.createWriteStream(outputPath);

            res.on('data', (chunk: Buffer) => {
              if (abortSignal?.aborted) {
                res.destroy();
                file.close();
                try {
                  fs.unlinkSync(outputPath);
                } catch {}
                reject(new Error('下载已取消'));
                return;
              }
              downloaded += chunk.length;
              file.write(chunk);
              if (onProgress && totalSize > 0) {
                onProgress(Math.round((downloaded / totalSize) * 100), '');
              }
            });

            res.on('end', () => {
              file.end(() => {
                resolve(outputPath);
              });
            });
            res.on('error', (err) => {
              file.close();
              reject(err);
            });
          },
        )
        .on('error', reject);
    };
    doDownload(videoUrl, MAX_REDIRECTS);
  });
}
