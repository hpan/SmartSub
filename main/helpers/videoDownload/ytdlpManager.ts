/**
 * yt-dlp 二进制管理器
 * 负责查找、下载、更新 yt-dlp 二进制文件
 */

import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { execFile, spawn } from 'child_process';
import { logMessage } from '../storeManager';
import type { YtdlpStatus } from '../../../types/videoDownload';
import { DOWNLOAD_IPC_CHANNELS } from '../../../types/videoDownload';
import { BrowserWindow } from 'electron';

/** yt-dlp GitHub releases 配置 */
const YTDLP_GITHUB_API =
  'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest';
const YTDLP_GITHUB_DOWNLOAD_BASE =
  'https://github.com/yt-dlp/yt-dlp/releases/download';

/** 获取 yt-dlp 存储目录 */
function getYtdlpDir(): string {
  return path.join(app.getPath('userData'), 'ytdlp');
}

/** 获取 yt-dlp 二进制路径 */
export function getYtdlpBinaryPath(): string {
  const dir = getYtdlpDir();
  const platform = process.platform;
  const binaryName = platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  return path.join(dir, binaryName);
}

/** 检查 yt-dlp 是否已安装 */
export function isYtdlpInstalled(): boolean {
  return fs.existsSync(getYtdlpBinaryPath());
}

/** 获取已安装的 yt-dlp 版本 */
export async function getYtdlpVersion(): Promise<string | null> {
  const binaryPath = getYtdlpBinaryPath();
  if (!fs.existsSync(binaryPath)) return null;

  return new Promise((resolve) => {
    execFile(binaryPath, ['--version'], { timeout: 10000 }, (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      resolve(stdout.toString().trim());
    });
  });
}

/** 获取 yt-dlp 状态 */
export async function getYtdlpStatus(): Promise<YtdlpStatus> {
  const binaryPath = getYtdlpBinaryPath();
  const installed = fs.existsSync(binaryPath);
  const version = installed ? await getYtdlpVersion() : null;

  return {
    installed,
    version,
    binaryPath: installed ? binaryPath : null,
    checking: false,
    downloading: false,
    downloadProgress: 0,
  };
}

/** 获取当前平台对应的 yt-dlp 二进制文件名 */
function getPlatformBinaryName(): string {
  const platform = process.platform;
  if (platform === 'win32') return 'yt-dlp.exe';
  return 'yt-dlp';
}

/** 检查 GitHub releases 获取最新版本 */
export async function checkLatestVersion(): Promise<string | null> {
  try {
    const response = await fetch(YTDLP_GITHUB_API, {
      headers: { 'User-Agent': 'SmartSub/3.0' },
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.tag_name || null;
  } catch (error) {
    logMessage(`[ytdlp] check latest version error: ${error}`, 'error');
    return null;
  }
}

/**
 * 下载 yt-dlp 二进制
 * @param onProgress 进度回调
 * @param mainWindow 主窗口（用于发送进度到渲染进程）
 */
export async function downloadYtdlp(
  onProgress?: (progress: number) => void,
  mainWindow?: BrowserWindow | null,
): Promise<boolean> {
  const binaryName = getPlatformBinaryName();
  const ytdlpDir = getYtdlpDir();
  const binaryPath = path.join(ytdlpDir, binaryName);
  const tempPath = binaryPath + '.tmp';

  try {
    // 确保目录存在
    if (!fs.existsSync(ytdlpDir)) {
      fs.mkdirSync(ytdlpDir, { recursive: true });
    }

    // 获取最新版本号
    const latestVersion = await checkLatestVersion();
    if (!latestVersion) {
      throw new Error('无法获取 yt-dlp 最新版本信息');
    }

    // 构建下载 URL
    const platform = process.platform;
    let downloadFileName: string;
    if (platform === 'win32') {
      downloadFileName = 'yt-dlp.exe';
    } else if (platform === 'darwin') {
      downloadFileName = 'yt-dlp_macos';
    } else {
      downloadFileName = 'yt-dlp';
    }
    const downloadUrl = `${YTDLP_GITHUB_DOWNLOAD_BASE}/${latestVersion}/${downloadFileName}`;

    logMessage(`[ytdlp] downloading from: ${downloadUrl}`, 'info');

    // 使用 Node.js 原生 HTTP 下载
    const fileStream = fs.createWriteStream(tempPath);

    return new Promise<boolean>((resolve, reject) => {
      const doDownload = (url: string) => {
        const protocol = url.startsWith('https')
          ? require('https')
          : require('http');
        protocol
          .get(
            url,
            {
              headers: { 'User-Agent': 'SmartSub/3.0' },
            },
            (response: any) => {
              // 处理重定向
              if (
                response.statusCode >= 300 &&
                response.statusCode < 400 &&
                response.headers.location
              ) {
                doDownload(response.headers.location);
                return;
              }

              if (response.statusCode !== 200) {
                reject(new Error(`下载失败: HTTP ${response.statusCode}`));
                return;
              }

              const totalSize = parseInt(
                response.headers['content-length'] || '0',
                10,
              );
              let downloadedSize = 0;

              response.on('data', (chunk: Buffer) => {
                downloadedSize += chunk.length;
                if (totalSize > 0) {
                  const progress = Math.round(
                    (downloadedSize / totalSize) * 100,
                  );
                  onProgress?.(progress);
                  if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send(
                      DOWNLOAD_IPC_CHANNELS.TASK_PROGRESS,
                      {
                        type: 'ytdlp-download',
                        progress,
                      },
                    );
                  }
                }
              });

              response.pipe(fileStream);

              fileStream.on('finish', () => {
                fileStream.close();
                // 设置可执行权限
                if (platform !== 'win32') {
                  fs.chmodSync(tempPath, 0o755);
                }
                // 移动到最终位置
                fs.renameSync(tempPath, binaryPath);
                logMessage(`[ytdlp] downloaded successfully`, 'info');
                resolve(true);
              });

              fileStream.on('error', (err) => {
                fs.unlinkSync(tempPath);
                reject(err);
              });
            },
          )
          .on('error', reject);
      };

      doDownload(downloadUrl);
    });
  } catch (error) {
    logMessage(`[ytdlp] download error: ${error}`, 'error');
    // 清理临时文件
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {}
    return false;
  }
}

/**
 * 确保 yt-dlp 可用，不存在则自动下载
 */
export async function ensureYtdlp(
  mainWindow?: BrowserWindow | null,
): Promise<string> {
  if (isYtdlpInstalled()) {
    return getYtdlpBinaryPath();
  }

  logMessage('[ytdlp] not found, downloading...', 'info');
  const success = await downloadYtdlp(undefined, mainWindow);
  if (!success) {
    throw new Error('yt-dlp 下载失败');
  }
  return getYtdlpBinaryPath();
}

/**
 * 检查是否需要更新
 */
export async function checkForUpdate(): Promise<{
  needsUpdate: boolean;
  currentVersion: string | null;
  latestVersion: string | null;
}> {
  const currentVersion = await getYtdlpVersion();
  const latestVersion = await checkLatestVersion();

  return {
    needsUpdate: currentVersion !== latestVersion,
    currentVersion,
    latestVersion,
  };
}

/**
 * 更新 yt-dlp
 */
export async function updateYtdlp(
  mainWindow?: BrowserWindow | null,
): Promise<boolean> {
  // 删除旧版本
  const binaryPath = getYtdlpBinaryPath();
  if (fs.existsSync(binaryPath)) {
    fs.unlinkSync(binaryPath);
  }
  return downloadYtdlp(undefined, mainWindow);
}
