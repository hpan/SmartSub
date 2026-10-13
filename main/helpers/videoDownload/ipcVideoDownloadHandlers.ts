/**
 * 视频下载 IPC 处理器
 * 注册所有下载相关的 IPC 通道
 */

import { ipcMain, BrowserWindow, dialog, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import { logMessage } from '../storeManager';
import ffmpegStatic from 'ffmpeg-static';
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
import {
  getVideoInfo,
  detectPlatform,
  resolveShareLink,
  isDouyinShareText,
  isXhsShareLink,
} from './videoInfoParser';
import { startDownload, cancelDownload } from './downloadExecutor';
import { isDouyinUrl, downloadDouyinVideo } from './douyinDownloader';
import {
  getXhsVideoInfo,
  downloadXhsVideo,
  resolveXhsLinkTracked,
} from './xhsDownloader';
import {
  isXiaoyuzhouUrl,
  parseXyzEpisode,
  downloadXyzAudio,
  type XyzEpisode,
} from './xyzdlDownloader';
import {
  renameAfterDownload,
  previewRename,
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

        // Auto-resolve Douyin share text to real URL
        if (isDouyinShareText(url)) {
          logMessage(
            `[download] Detected Douyin share text, resolving...`,
            'info',
          );
          url = await resolveShareLink(url);
          logMessage(`[download] Resolved to: ${url}`, 'info');
        }

        // Xiaohongshu: use custom downloader (yt-dlp XHS extractor is broken)
        if (isXhsShareLink(url) || url.includes('xiaohongshu.com')) {
          logMessage(
            `[download] Using custom XHS downloader for: ${url}`,
            'info',
          );
          const xhsInfo = await getXhsVideoInfo(url);
          return { success: true, data: xhsInfo, isXiaoyuzhou: false };
        }

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
        logMessage(
          `[download:main] PARSE_URL platform=${info.platform} title=${info.title?.substring(0, 40)}`,
          'info',
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
      for (let url of urls) {
        try {
          const ytdlpPath = await ensureYtdlp(mainWindow);
          const config = readConfig();
          const cookieArgs = resolveCookieArgs(config);

          // Auto-resolve Douyin share text
          if (isDouyinShareText(url)) {
            url = await resolveShareLink(url);
          }

          // Xiaohongshu: use custom downloader
          if (isXhsShareLink(url) || url.includes('xiaohongshu.com')) {
            const xhsInfo = await getXhsVideoInfo(url);
            results.push({
              url,
              success: true,
              data: xhsInfo,
              isXiaoyuzhou: false,
            });
            continue;
          }

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

  // ==================== 文件名预览 ====================
  ipcMain.handle(
    'download:previewRename',
    async (
      _event,
      params: {
        title: string;
        uploadDate: string | null;
        originalUrl: string;
        originalFilename: string;
        ext: string;
      },
    ) => {
      try {
        return previewRename(
          params.title,
          params.uploadDate,
          params.originalUrl,
          params.originalFilename,
          params.ext,
        );
      } catch {
        return params.originalFilename + '.' + params.ext;
      }
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
        selectedVideoFormatId: taskData.selectedVideoFormatId ?? null,
        selectedAudioFormatId: taskData.selectedAudioFormatId ?? null,
        downloadCover: taskData.downloadCover ?? false,
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
        customFilename: taskData.customFilename,
      };

      logMessage(
        `[download:main] START_DOWNLOAD outputDir=${task.outputDir} platform=${task.videoInfo?.platform} title=${task.videoInfo?.title?.substring(0, 30)}`,
        'info',
      );
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
          let finalPath: string;
          if (task.customFilename) {
            const dir = path.dirname(outputPath);
            const ext = path.extname(outputPath);
            finalPath = path.join(dir, task.customFilename + ext);
            if (finalPath !== outputPath) {
              try {
                fs.renameSync(outputPath, finalPath);
              } catch {}
            }
          } else {
            const renameResult = renameAfterDownload(
              outputPath,
              episode.title,
              null,
              task.videoInfo.originalUrl,
            );
            finalPath = renameResult.newPath;
          }

          task.outputPath = finalPath;
          task.progress = 100;
          updateTaskStatus(taskId, 'completed', { outputPath: finalPath });
          sendToRenderer(DOWNLOAD_IPC_CHANNELS.TASK_COMPLETE, {
            taskId,
            outputPath: finalPath,
          });
          return { success: true, outputPath: finalPath };
        }

        // Handle Douyin downloads with native downloader
        if (isDouyinUrl(task.videoInfo.originalUrl)) {
          logMessage(`[download] Using Douyin native downloader`, 'info');
          const outputDir = task.outputDir || config.defaultOutputDir;
          const cookieArgs = resolveCookieArgs(config);
          // 抖音需要认证 Cookie，未配置时自动使用 Firefox 作为回退
          const cookieString =
            cookieArgs?.cookiesFromBrowser ||
            cookieArgs?.cookieFile ||
            'firefox';

          // Check if audio-only download (douyin-audio format or video=none)
          const isAudioOnly =
            task.selectedAudioFormatId === 'douyin-audio' ||
            (task.selectedVideoFormatId === 'none' &&
              task.selectedAudioFormatId !== 'none');

          const result = await downloadDouyinVideo(
            task.videoInfo.originalUrl,
            outputDir,
            cookieString,
            (progress) => {
              task.progress = progress.percent;
              task.speed = progress.speed;
              task.downloaded = progress.downloaded;
              sendToRenderer(DOWNLOAD_IPC_CHANNELS.TASK_PROGRESS, {
                taskId,
                percent: progress.percent,
                speed: progress.speed,
                downloaded: progress.downloaded,
                totalSize: 0,
                eta: 0,
              });
            },
          );

          if (result.success && result.outputPath) {
            let finalPath = result.outputPath;

            // If audio-only, detect format and keep as-is if already audio
            if (isAudioOnly) {
              const ffmpegPath = ffmpegStatic.path || ffmpegStatic;
              const { spawn } = require('child_process');

              // Detect actual audio codec of the downloaded file
              const detectCodec = (): Promise<string> =>
                new Promise((resolve) => {
                  const probe = spawn(ffmpegPath, ['-i', result.outputPath]);
                  let output = '';
                  probe.stderr.on('data', (d: Buffer) => {
                    output += d.toString();
                  });
                  probe.on('close', () => {
                    if (output.includes('Audio: mp3')) resolve('mp3');
                    else if (output.includes('Audio: aac')) resolve('aac');
                    else if (output.includes('Audio: opus')) resolve('opus');
                    else resolve('unknown');
                  });
                  probe.on('error', () => resolve('unknown'));
                });

              const codec = await detectCodec();
              logMessage(`[download] Detected audio codec: ${codec}`, 'info');

              // If already a pure audio file (mp3/opus), just rename the extension
              if (codec === 'mp3' || codec === 'opus') {
                const ext = codec === 'mp3' ? '.mp3' : '.opus';
                const audioPath = result.outputPath.replace(/\.mp4?$/, ext);
                require('fs').renameSync(result.outputPath, audioPath);
                finalPath = audioPath;
                logMessage(
                  `[download] Audio is already ${codec}, renamed to ${audioPath}`,
                  'info',
                );
              } else {
                // Video file with audio track — extract to m4a
                logMessage(`[download] Extracting audio to M4A`, 'info');
                const audioPath = result.outputPath.replace(/\.mp4?$/, '.m4a');

                await new Promise<void>((resolveAudio, rejectAudio) => {
                  const ffmpeg = spawn(ffmpegPath, [
                    '-i',
                    result.outputPath,
                    '-vn',
                    '-acodec',
                    'aac',
                    '-b:a',
                    '192k',
                    '-y',
                    audioPath,
                  ]);

                  let stderr = '';
                  ffmpeg.stderr.on('data', (data: Buffer) => {
                    stderr += data.toString();
                  });
                  ffmpeg.on('close', (code: number) => {
                    if (code === 0) {
                      try {
                        require('fs').unlinkSync(result.outputPath);
                      } catch {}
                      resolveAudio();
                    } else {
                      rejectAudio(
                        new Error(`ffmpeg exited with code ${code}: ${stderr}`),
                      );
                    }
                  });
                  ffmpeg.on('error', (err: Error) => rejectAudio(err));
                });

                finalPath = audioPath;
              }
            }

            // Apply customFilename if set
            if (task.customFilename && finalPath) {
              const dir = path.dirname(finalPath);
              const ext = path.extname(finalPath);
              const renamed = path.join(dir, task.customFilename + ext);
              if (renamed !== finalPath) {
                try {
                  fs.renameSync(finalPath, renamed);
                  finalPath = renamed;
                } catch {}
              }
            }

            task.outputPath = finalPath;
            task.progress = 100;
            updateTaskStatus(taskId, 'completed', { outputPath: finalPath });
            sendToRenderer(DOWNLOAD_IPC_CHANNELS.TASK_COMPLETE, {
              taskId,
              outputPath: finalPath,
            });
            return { success: true, outputPath: finalPath };
          } else {
            throw new Error(result.error || '抖音下载失败');
          }
        }

        // Handle Xiaohongshu downloads with custom downloader
        if (task.videoInfo.platform === 'xiaohongshu') {
          logMessage(`[download] Using custom XHS downloader`, 'info');
          const outputDir = task.outputDir || config.defaultOutputDir;
          const isAudioOnly =
            task.selectedVideoFormatId === 'none' &&
            task.selectedAudioFormatId !== 'none';

          const outputPath = await downloadXhsVideo(
            task.videoInfo,
            outputDir,
            false, // always download video first, extract audio after if needed
            (percent, speed) => {
              task.progress = percent;
              task.speed = speed;
              sendToRenderer(DOWNLOAD_IPC_CHANNELS.TASK_PROGRESS, {
                taskId,
                percent,
                speed,
                downloaded: 0,
                totalSize: 0,
                eta: 0,
              });
            },
          );

          // If audio-only, extract audio with ffmpeg
          const { spawn } = require('child_process');
          let finalPath = outputPath;
          if (isAudioOnly) {
            const ffmpegPath = ffmpegStatic;
            const audioPath = outputPath.replace(/\.mp4$/, '.m4a');
            await new Promise<void>((resolve, reject) => {
              const proc = spawn(
                ffmpegPath,
                ['-i', outputPath, '-vn', '-acodec', 'copy', '-y', audioPath],
                { windowsHide: true },
              );
              proc.on('close', (code: number) => {
                if (code === 0) {
                  try {
                    fs.unlinkSync(outputPath);
                  } catch {}
                  finalPath = audioPath;
                  resolve();
                } else {
                  reject(new Error('ffmpeg audio extraction failed'));
                }
              });
              proc.on('error', reject);
            });
          }

          // Rename if needed
          if (task.customFilename) {
            const ext = isAudioOnly ? 'm4a' : 'mp4';
            const customPath = path.join(
              path.dirname(finalPath),
              `${task.customFilename}.${ext}`,
            );
            if (customPath !== finalPath) {
              try {
                fs.renameSync(finalPath, customPath);
                finalPath = customPath;
              } catch {}
            }
          } else {
            const renameResult = renameAfterDownload(
              finalPath,
              task.videoInfo.title,
              null,
              task.videoInfo.originalUrl,
            );
            finalPath = renameResult.newPath;
          }

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
            let finalPath: string;
            if (task.customFilename) {
              const dir = path.dirname(outputPath);
              const ext = path.extname(outputPath);
              finalPath = path.join(dir, task.customFilename + ext);
              if (finalPath !== outputPath) {
                try {
                  fs.renameSync(outputPath, finalPath);
                } catch {}
              }
            } else {
              const renameResult = renameAfterDownload(
                outputPath,
                task.videoInfo.title,
                task.videoInfo.uploadDate,
                task.videoInfo.originalUrl,
              );
              finalPath = renameResult.newPath;
            }

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

  /** 在音频文件所在目录执行 generate_audio_covers.py 生成封面 */
  ipcMain.handle(
    'download:generateCovers',
    async (_event, filePath: string) => {
      const dir = path.dirname(filePath);
      const scriptPath = path.join(dir, 'generate_audio_covers.py');
      if (!fs.existsSync(scriptPath)) {
        return {
          success: false,
          error: '当前目录下未找到 generate_audio_covers.py',
        };
      }
      const { spawn } = require('child_process');
      return new Promise((resolve) => {
        const child = spawn('python3', [scriptPath], {
          cwd: dir,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d: Buffer) => {
          stdout += d.toString();
        });
        child.stderr.on('data', (d: Buffer) => {
          stderr += d.toString();
        });
        child.on('close', (code: number) => {
          logMessage('[generateCovers] stdout: ' + stdout, 'info');
          if (code !== 0) {
            logMessage('[generateCovers] stderr: ' + stderr, 'error');
            resolve({ success: false, error: stderr || '脚本执行失败' });
          } else {
            resolve({ success: true, data: stdout });
          }
        });
        child.on('error', (err: Error) => {
          logMessage('[generateCovers] spawn error: ' + err.message, 'error');
          resolve({ success: false, error: '无法启动 Python: ' + err.message });
        });
      });
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
      customFilename,
    }: {
      thumbnailUrl: string;
      outputDir: string;
      title: string;
      customFilename?: string;
    },
  ) => {
    try {
      if (!thumbnailUrl) {
        return { success: false, error: '没有封面图URL' };
      }

      // 确保输出目录存在
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // 获取文件扩展名
      const urlPath = new URL(thumbnailUrl).pathname;
      const ext = path.extname(urlPath) || '.jpg';

      // 使用自定义文件名或原标题
      const baseName = customFilename
        ? customFilename
        : title.replace(/[\/\\:*?"<>|]/g, '_').substring(0, 150);
      const outputPath = path.join(outputDir, `${baseName}_cover${ext}`);

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
