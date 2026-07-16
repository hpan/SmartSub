/**
 * 视频下载 IPC 处理器
 * 注册所有下载相关的 IPC 通道
 */

import { ipcMain, BrowserWindow, dialog, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import { logMessage } from '../storeManager';
import {
  DOWNLOAD_IPC_CHANNELS,
  type DownloadTask,
  type DownloadConfig,
  type CookieMode,
  type DownloadTaskStatus,
  type DownloadVideoInfo,
} from '../../../types/videoDownload';
import {
  getYtdlpStatus,
  ensureYtdlp,
  downloadYtdlp,
  checkForUpdate,
  updateYtdlp,
  getYtdlpBinaryPath,
  isYtdlpInstalled,
} from './ytdlpManager';
import { getVideoInfo, detectPlatform } from './videoInfoParser';
import { startDownload, cancelDownload } from './downloadExecutor';
import {
  isXiaoyuzhouUrl,
  parseXyzEpisode,
  downloadXyzAudio,
  type XyzEpisode,
} from './xyzdlDownloader';
import {
  renameAfterDownload,
  readRenameConfig,
  saveRenameConfig,
} from './renameAfterDownload';

/** 下载配置默认值 */
const DEFAULT_CONFIG: DownloadConfig = {
  defaultOutputDir: app.getPath('downloads'),
  downloadSubtitles: false,
  subtitleLanguages: ['zh', 'en'],
  extraArgs: '',
  proxy: '',
  autoImportToTranscribe: false,
  cookieMode: 'none',
  cookieFile: '',
};

/** 下载配置文件路径 */
function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'download-config.json');
}

/** 读取下载配置 */
function readConfig(): DownloadConfig {
  try {
    const configPath = getConfigPath();
    if (fs.existsSync(configPath)) {
      const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return { ...DEFAULT_CONFIG, ...saved };
    }
  } catch (error) {
    logMessage(`[download] read config error: ${error}`, 'error');
  }
  return { ...DEFAULT_CONFIG };
}

/** 保存下载配置 */
function saveConfig(config: DownloadConfig): void {
  try {
    fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2));
  } catch (error) {
    logMessage(`[download] save config error: ${error}`, 'error');
  }
}

/**
 * 根据 cookieMode 构建传给 getVideoInfo / startDownload 的 cookie 参数
 */
function resolveCookieArgs(config: DownloadConfig): {
  cookieFile?: string;
  cookiesFromBrowser?: string;
} {
  switch (config.cookieMode) {
    case 'from-file':
      return { cookieFile: config.cookieFile || undefined };
    case 'from-browser-firefox':
      return { cookiesFromBrowser: 'firefox' };
    case 'from-browser-edge':
      return { cookiesFromBrowser: 'edge' };
    case 'from-browser-chrome':
      return { cookiesFromBrowser: 'chrome' };
    case 'none':
    default:
      return {};
  }
}

/** 活跃的下载任务 Map */
const downloadTasks = new Map<string, DownloadTask>();

/** 主窗口引用 */
let mainWindowRef: BrowserWindow | null = null;

/**
 * 发送事件到渲染进程
 */
function sendToRenderer(channel: string, ...args: any[]): void {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send(channel, ...args);
  }
}

/**
 * 更新任务状态
 */
function updateTaskStatus(
  taskId: string,
  status: DownloadTaskStatus,
  extra?: Partial<DownloadTask>,
): void {
  const task = downloadTasks.get(taskId);
  if (task) {
    task.status = status;
    task.updatedAt = Date.now();
    Object.assign(task, extra);
    sendToRenderer(DOWNLOAD_IPC_CHANNELS.TASK_STATUS_CHANGE, {
      taskId,
      status,
      ...extra,
    });
  }
}

/**
 * 设置视频下载 IPC 处理器
 */
export function setupVideoDownloadHandlers(mainWindow: BrowserWindow): void {
  mainWindowRef = mainWindow;

  // ==================== 文件系统操作 ====================

  /** 打开文件所在目录并选中该文件 */
  ipcMain.handle('download:showItemInFolder', (_event, filePath: string) => {
    try {
      if (fs.existsSync(filePath)) {
        shell.showItemInFolder(filePath);
      } else {
        // 文件不存在时尝试打开所在目录
        const dir = path.dirname(filePath);
        if (fs.existsSync(dir)) {
          shell.openPath(dir);
        }
      }
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  /** 用系统默认程序打开文件 */
  ipcMain.handle('download:openPath', (_event, targetPath: string) => {
    try {
      if (fs.existsSync(targetPath)) {
        shell.openPath(targetPath);
      }
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // ==================== yt-dlp 管理 ====================

  ipcMain.handle(DOWNLOAD_IPC_CHANNELS.GET_YTDLP_STATUS, async () => {
    return getYtdlpStatus();
  });

  ipcMain.handle(DOWNLOAD_IPC_CHANNELS.INSTALL_YTDLP, async () => {
    try {
      const success = await downloadYtdlp(undefined, mainWindow);
      return { success };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(DOWNLOAD_IPC_CHANNELS.UPDATE_YTDLP, async () => {
    try {
      const success = await updateYtdlp(mainWindow);
      return { success };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // ==================== URL 解析 ====================

  ipcMain.handle(
    DOWNLOAD_IPC_CHANNELS.PARSE_URL,
    async (_event, url: string) => {
      try {
        const ytdlpPath = await ensureYtdlp(mainWindow);
        const config = readConfig();

        if (isXiaoyuzhouUrl(url)) {
          const episode = await parseXyzEpisode(url);
          const info: DownloadVideoInfo = {
            id: episode.id,
            title: episode.title,
            thumbnail: episode.coverUrl,
            duration: episode.duration,
            uploader: episode.podcastAuthor,
            uploadDate: null,
            originalUrl: url,
            platform: 'xiaoyuzhou',
            formats: [
              {
                formatId: 'default',
                ext: 'mp3',
                resolution: 'audio only',
                fps: null,
                vcodec: 'none',
                acodec: 'mp3',
                filesize: null,
                label: '音频 · mp3',
                audioOnly: true,
              },
            ],
            hasSubtitles: false,
            subtitleLanguages: [],
            isPlaylist: false,
            playlistCount: null,
          };
          return {
            success: true,
            data: info,
            isXiaoyuzhou: true,
            xyzEpisode: episode,
          };
        }

        const cookieArgs = resolveCookieArgs(config);
        const info = await getVideoInfo(
          url,
          ytdlpPath,
          cookieArgs,
          config.proxy,
        );
        return { success: true, data: info, isXiaoyuzhou: false };
      } catch (error: any) {
        logMessage(`[download] parse URL error: ${error}`, 'error');
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle(
    DOWNLOAD_IPC_CHANNELS.PARSE_BATCH,
    async (_event, urls: string[]) => {
      const results = [];
      for (const url of urls) {
        try {
          const ytdlpPath = await ensureYtdlp(mainWindow);
          const config = readConfig();
          const cookieArgs = resolveCookieArgs(config);

          if (isXiaoyuzhouUrl(url)) {
            const episode = await parseXyzEpisode(url);
            const info: DownloadVideoInfo = {
              id: episode.id,
              title: episode.title,
              thumbnail: episode.coverUrl,
              duration: episode.duration,
              uploader: episode.podcastAuthor,
              uploadDate: null,
              originalUrl: url,
              platform: 'xiaoyuzhou',
              formats: [
                {
                  formatId: 'default',
                  ext: 'mp3',
                  resolution: 'audio only',
                  fps: null,
                  vcodec: 'none',
                  acodec: 'mp3',
                  filesize: null,
                  label: '音频 · mp3',
                  audioOnly: true,
                },
              ],
              hasSubtitles: false,
              subtitleLanguages: [],
              isPlaylist: false,
              playlistCount: null,
            };
            results.push({
              url,
              success: true,
              data: info,
              isXiaoyuzhou: true,
              xyzEpisode: episode,
            });
          } else {
            const info = await getVideoInfo(
              url,
              ytdlpPath,
              cookieArgs,
              config.proxy,
            );
            results.push({
              url,
              success: true,
              data: info,
              isXiaoyuzhou: false,
            });
          }
        } catch (error: any) {
          results.push({ url, success: false, error: error.message });
        }
      }
      return results;
    },
  );

  // ==================== 下载任务 ====================

  ipcMain.handle(
    DOWNLOAD_IPC_CHANNELS.START_DOWNLOAD,
    async (_event, taskData: Partial<DownloadTask>) => {
      const taskId = taskData.id || `dl-${Date.now()}`;
      const config = readConfig();

      const task: DownloadTask = {
        id: taskId,
        videoInfo: taskData.videoInfo!,
        selectedFormatId: taskData.selectedFormatId || null,
        downloadSubtitles:
          taskData.downloadSubtitles ?? config.downloadSubtitles,
        subtitleLanguages:
          taskData.subtitleLanguages || config.subtitleLanguages,
        outputDir: taskData.outputDir || config.defaultOutputDir,
        status: 'downloading',
        progress: 0,
        speed: 0,
        downloaded: 0,
        totalSize: 0,
        outputPath: null,
        error: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isXiaoyuzhou: taskData.isXiaoyuzhou || false,
        xyzEpisodeUrl: taskData.xyzEpisodeUrl,
      };

      downloadTasks.set(taskId, task);

      try {
        if (task.isXiaoyuzhou) {
          updateTaskStatus(taskId, 'downloading');

          let episode: XyzEpisode;
          if (taskData.xyzEpisodeUrl) {
            episode = await parseXyzEpisode(taskData.xyzEpisodeUrl);
          } else {
            throw new Error('小宇宙 Episode URL 缺失');
          }

          const outputPath = await downloadXyzAudio(
            episode,
            task.outputDir,
            (progress) => {
              task.progress = progress.percent;
              task.downloaded = progress.downloaded;
              task.totalSize = progress.total;
              sendToRenderer(DOWNLOAD_IPC_CHANNELS.TASK_PROGRESS, {
                taskId,
                percent: progress.percent,
                downloaded: progress.downloaded,
                totalSize: progress.total,
              });
            },
          );

          // 重命名
          const renameResult = renameAfterDownload(
            outputPath,
            episode.title,
            null,
            task.videoInfo.originalUrl,
          );
          const finalPath = renameResult.newPath;

          task.outputPath = finalPath;
          task.progress = 100;
          updateTaskStatus(taskId, 'completed', { outputPath: finalPath });
          sendToRenderer(DOWNLOAD_IPC_CHANNELS.TASK_COMPLETE, {
            taskId,
            outputPath: finalPath,
          });
          return { success: true, outputPath: finalPath };
        }

        const ytdlpPath = await ensureYtdlp(mainWindow);
        const cookieArgs = resolveCookieArgs(config);
        updateTaskStatus(taskId, 'downloading');

        await startDownload(
          task,
          ytdlpPath,
          (progress) => {
            task.progress = progress.percent;
            task.speed = progress.speed;
            task.downloaded = progress.downloaded;
            task.totalSize = progress.totalSize;
            sendToRenderer(DOWNLOAD_IPC_CHANNELS.TASK_PROGRESS, {
              taskId,
              percent: progress.percent,
              speed: progress.speed,
              downloaded: progress.downloaded,
              totalSize: progress.totalSize,
              eta: progress.eta,
              status: progress.status,
            });
          },
          (outputPath) => {
            // 重命名
            const renameResult = renameAfterDownload(
              outputPath,
              task.videoInfo.title,
              task.videoInfo.uploadDate,
              task.videoInfo.originalUrl,
            );
            const finalPath = renameResult.newPath;

            task.outputPath = finalPath;
            task.progress = 100;
            updateTaskStatus(taskId, 'completed', { outputPath: finalPath });
            sendToRenderer(DOWNLOAD_IPC_CHANNELS.TASK_COMPLETE, {
              taskId,
              outputPath: finalPath,
            });
          },
          (error) => {
            task.error = error;
            updateTaskStatus(taskId, 'failed', { error });
            sendToRenderer(DOWNLOAD_IPC_CHANNELS.TASK_ERROR, { taskId, error });
          },
          cookieArgs,
          config.proxy,
          config.extraArgs,
        );

        return { success: true, outputPath: task.outputPath };
      } catch (error: any) {
        task.error = error.message;
        updateTaskStatus(taskId, 'failed', { error: error.message });
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle(
    DOWNLOAD_IPC_CHANNELS.CANCEL_DOWNLOAD,
    async (_event, taskId: string) => {
      cancelDownload(taskId);
      updateTaskStatus(taskId, 'cancelled');
      return { success: true };
    },
  );

  ipcMain.handle(DOWNLOAD_IPC_CHANNELS.GET_TASKS, async () => {
    return Array.from(downloadTasks.values());
  });

  ipcMain.handle(
    DOWNLOAD_IPC_CHANNELS.CLEAR_TASK,
    async (_event, taskId: string) => {
      downloadTasks.delete(taskId);
      return { success: true };
    },
  );

  ipcMain.handle(DOWNLOAD_IPC_CHANNELS.CLEAR_ALL_TASKS, async () => {
    downloadTasks.clear();
    return { success: true };
  });

  // ==================== 配置 ====================

  ipcMain.handle(DOWNLOAD_IPC_CHANNELS.GET_CONFIG, async () => {
    return readConfig();
  });

  ipcMain.handle(
    DOWNLOAD_IPC_CHANNELS.SAVE_CONFIG,
    async (_event, config: Partial<DownloadConfig>) => {
      const current = readConfig();
      const updated = { ...current, ...config };
      saveConfig(updated);
      return updated;
    },
  );

  ipcMain.handle(DOWNLOAD_IPC_CHANNELS.SELECT_OUTPUT_DIR, async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      defaultPath: readConfig().defaultOutputDir,
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return result.filePaths[0];
  });

  ipcMain.handle(DOWNLOAD_IPC_CHANNELS.SELECT_COOKIE_FILE, async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择 Cookie 文件',
      filters: [
        { name: 'Cookie 文件', extensions: ['txt'] },
        { name: '所有文件', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return result.filePaths[0];
  });

  // ==================== 重命名规则 ====================

  ipcMain.handle(DOWNLOAD_IPC_CHANNELS.GET_RENAME_CONFIG, async () => {
    return readRenameConfig();
  });

  ipcMain.handle(
    DOWNLOAD_IPC_CHANNELS.SAVE_RENAME_CONFIG,
    async (_event, config) => {
      saveRenameConfig(config);
      return readRenameConfig();
    },
  );
}

// 下载封面图
ipcMain.handle(
  DOWNLOAD_IPC_CHANNELS.DOWNLOAD_THUMBNAIL,
  async (
    _event,
    {
      thumbnailUrl,
      outputDir,
      title,
    }: { thumbnailUrl: string; outputDir: string; title: string },
  ) => {
    try {
      if (!thumbnailUrl) {
        return { success: false, error: '没有封面图URL' };
      }

      // 确保输出目录存在
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // 清理文件名
      const safeTitle = title.replace(/[\/\\:*?"<>|]/g, '_').substring(0, 150);

      // 获取文件扩展名
      const urlPath = new URL(thumbnailUrl).pathname;
      const ext = path.extname(urlPath) || '.jpg';
      const outputPath = path.join(outputDir, `${safeTitle}_cover${ext}`);

      logMessage(`[download] downloading thumbnail: ${thumbnailUrl}`, 'info');
      logMessage(`[download] output path: ${outputPath}`, 'info');

      // 使用 https 模块下载
      const https = require('https');
      const http = require('http');

      return new Promise((resolve) => {
        const protocol = thumbnailUrl.startsWith('https') ? https : http;

        protocol
          .get(
            thumbnailUrl,
            {
              headers: {
                'User-Agent':
                  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                Referer: thumbnailUrl,
              },
            },
            (response: any) => {
              // 处理重定向
              if (response.statusCode === 301 || response.statusCode === 302) {
                const redirectUrl = response.headers.location;
                logMessage(
                  `[download] thumbnail redirect to: ${redirectUrl}`,
                  'info',
                );
                // 递归调用处理重定向
                protocol
                  .get(redirectUrl, (redirectResponse: any) => {
                    const fileStream = fs.createWriteStream(outputPath);
                    redirectResponse.pipe(fileStream);
                    fileStream.on('finish', () => {
                      fileStream.close();
                      logMessage(
                        `[download] thumbnail saved: ${outputPath}`,
                        'info',
                      );
                      resolve({ success: true, data: outputPath });
                    });
                  })
                  .on('error', (err: any) => {
                    logMessage(
                      `[download] thumbnail download error: ${err}`,
                      'error',
                    );
                    resolve({
                      success: false,
                      error: `下载封面图失败: ${err.message}`,
                    });
                  });
                return;
              }

              const fileStream = fs.createWriteStream(outputPath);
              response.pipe(fileStream);

              fileStream.on('finish', () => {
                fileStream.close();
                logMessage(`[download] thumbnail saved: ${outputPath}`, 'info');
                resolve({ success: true, data: outputPath });
              });
            },
          )
          .on('error', (err: any) => {
            logMessage(`[download] thumbnail download error: ${err}`, 'error');
            resolve({
              success: false,
              error: `下载封面图失败: ${err.message}`,
            });
          });
      });
    } catch (error) {
      logMessage(`[download] thumbnail download error: ${error}`, 'error');
      return { success: false, error: `下载封面图失败: ${error}` };
    }
  },
);
