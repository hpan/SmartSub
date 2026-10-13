/**
 * 视频裁片 IPC 处理函数
 * 支持截取视频片段（去掉头尾广告等）
 */

import { ipcMain, dialog, BrowserWindow, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import { logMessage } from './storeManager';

const ffmpegPath = ffmpegStatic.replace('app.asar', 'app.asar.unpacked');
const ffprobePath = path.join(
  path.dirname(ffmpegPath),
  '..',
  'ffprobe-static',
  'bin',
  process.platform === 'win32'
    ? 'win32'
    : process.platform === 'darwin'
      ? 'darwin'
      : 'linux',
  process.arch === 'arm64' ? 'arm64' : 'x64',
  process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe',
);

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

interface VideoInfo {
  path: string;
  fileName: string;
  width: number;
  height: number;
  duration: number;
  format: string;
}

function getVideoInfo(filePath: string): Promise<VideoInfo> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      const videoStream = metadata.streams.find(
        (s) => s.codec_type === 'video',
      );
      if (!videoStream) return reject(new Error('未找到视频流'));
      resolve({
        path: filePath,
        fileName: path.basename(filePath),
        width: videoStream.width || 0,
        height: videoStream.height || 0,
        duration: metadata.format.duration || 0,
        format: metadata.format.format_name || '',
      });
    });
  });
}

export function setupVideoTrimHandlers(mainWindow: BrowserWindow) {
  // 选择视频文件
  ipcMain.handle('videoTrim:selectFile', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择视频文件',
      filters: [
        {
          name: '视频文件',
          extensions: ['mp4', 'mkv', 'avi', 'mov', 'webm', 'ts', 'mts', 'flv'],
        },
      ],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    try {
      const info = await getVideoInfo(filePath);
      logMessage(
        `[videoTrim] selected: ${filePath}, ${info.width}x${info.height}, ${info.duration}s`,
        'info',
      );
      return { success: true, data: info };
    } catch (error) {
      logMessage(`[videoTrim] probe error: ${error}`, 'error');
      return { success: false, error: `读取视频信息失败: ${error}` };
    }
  });

  // 获取视频信息
  ipcMain.handle(
    'videoTrim:getInfo',
    async (_event, { filePath }: { filePath: string }) => {
      try {
        if (!fs.existsSync(filePath))
          return { success: false, error: '文件不存在' };
        const info = await getVideoInfo(filePath);
        return { success: true, data: info };
      } catch (error) {
        logMessage(`[videoTrim] getInfo error: ${error}`, 'error');
        return { success: false, error: `读取视频信息失败: ${error}` };
      }
    },
  );

  // 执行裁片
  ipcMain.handle(
    'videoTrim:trim',
    async (
      _event,
      {
        inputPath,
        outputPath,
        startTime,
        endTime,
        duration,
      }: {
        inputPath: string;
        outputPath: string;
        startTime: number;
        endTime: number;
        duration: number;
      },
    ) => {
      try {
        if (!fs.existsSync(inputPath))
          return { success: false, error: '输入文件不存在' };

        logMessage(
          `[videoTrim] trimming: ${inputPath} [${startTime}s - ${endTime}s] -> ${outputPath}`,
          'info',
        );

        return new Promise((resolve) => {
          let lastPercent = 0;
          const trimDuration = endTime - startTime;

          ffmpeg(inputPath)
            .setStartTime(startTime)
            .duration(trimDuration)
            .outputOptions(
              '-c:v',
              'libx264',
              '-preset',
              'medium',
              '-crf',
              '23',
              '-c:a',
              'aac',
              '-b:a',
              '128k',
              '-y',
            )
            .on('start', (cmd: string) => {
              logMessage(`[videoTrim] ffmpeg cmd: ${cmd}`, 'info');
            })
            .on(
              'progress',
              (progress: { percent?: number; timemark?: string }) => {
                let p = Math.round(progress.percent || 0);
                if (p === 0 && progress.timemark && trimDuration > 0) {
                  const parts = progress.timemark.split(':').map(parseFloat);
                  const secs =
                    (parts[0] || 0) * 3600 +
                    (parts[1] || 0) * 60 +
                    (parts[2] || 0);
                  p = Math.min(99, Math.round((secs / trimDuration) * 100));
                }
                if (p !== lastPercent) {
                  lastPercent = p;
                  mainWindow.webContents.send('videoTrim:progress', {
                    percent: p,
                  });
                }
              },
            )
            .on('end', () => {
              logMessage(`[videoTrim] trim done: ${outputPath}`, 'info');
              mainWindow.webContents.send('videoTrim:progress', {
                percent: 100,
              });
              resolve({ success: true, outputPath });
            })
            .on('error', (err: Error) => {
              logMessage(`[videoTrim] trim error: ${err.message}`, 'error');
              resolve({ success: false, error: `裁片失败: ${err.message}` });
            })
            .save(outputPath);
        });
      } catch (error) {
        logMessage(`[videoTrim] trim error: ${error}`, 'error');
        return { success: false, error: `裁片失败: ${error}` };
      }
    },
  );

  // 选择输出目录
  ipcMain.handle('videoTrim:selectOutputDir', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择输出目录',
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // 打开文件所在目录
  ipcMain.handle(
    'videoTrim:revealFile',
    async (_event, { filePath }: { filePath: string }) => {
      shell.showItemInFolder(filePath);
    },
  );

  logMessage('[videoTrim] handlers registered', 'info');
}
