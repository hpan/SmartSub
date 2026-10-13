/**
 * 视频画面裁切 IPC 处理函数
 * 支持按比例裁切视频画面（居中裁切）
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

export function setupVideoCropHandlers(mainWindow: BrowserWindow) {
  // 选择视频文件
  ipcMain.handle('videoCrop:selectFile', async () => {
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

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const filePath = result.filePaths[0];
    try {
      const info = await getVideoInfo(filePath);
      logMessage(
        `[videoCrop] selected file: ${filePath}, ${info.width}x${info.height}, ${info.duration}s`,
        'info',
      );
      return { success: true, data: info };
    } catch (error) {
      logMessage(`[videoCrop] probe error: ${error}`, 'error');
      return { success: false, error: `读取视频信息失败: ${error}` };
    }
  });

  // 获取视频信息
  ipcMain.handle(
    'videoCrop:getInfo',
    async (_event, { filePath }: { filePath: string }) => {
      try {
        if (!fs.existsSync(filePath)) {
          return { success: false, error: '文件不存在' };
        }
        const info = await getVideoInfo(filePath);
        return { success: true, data: info };
      } catch (error) {
        logMessage(`[videoCrop] getInfo error: ${error}`, 'error');
        return { success: false, error: `读取视频信息失败: ${error}` };
      }
    },
  );

  // 执行画面裁切
  ipcMain.handle(
    'videoCrop:crop',
    async (
      _event,
      {
        inputPath,
        outputPath,
        cropW,
        cropH,
        offsetX,
        offsetY,
        duration,
      }: {
        inputPath: string;
        outputPath: string;
        cropW: number;
        cropH: number;
        offsetX: number;
        offsetY: number;
        duration?: number;
      },
    ) => {
      try {
        if (!fs.existsSync(inputPath)) {
          return { success: false, error: '输入文件不存在' };
        }

        // 确保裁切尺寸为偶数（h264 要求）
        const w = cropW % 2 === 0 ? cropW : cropW - 1;
        const h = cropH % 2 === 0 ? cropH : cropH - 1;
        const x = Math.round(offsetX);
        const y = Math.round(offsetY);

        const cropFilter = `crop=${w}:${h}:${x}:${y}`;

        logMessage(
          `[videoCrop] cropping: ${inputPath} -> ${outputPath}, filter: ${cropFilter}`,
          'info',
        );

        return new Promise((resolve) => {
          let lastPercent = 0;

          ffmpeg(inputPath)
            .videoFilters(cropFilter)
            .outputOptions(
              '-c:v',
              'libx264',
              '-preset',
              'ultrafast',
              '-crf',
              '23',
              '-c:a',
              'copy',
              '-y',
            )
            .on('start', (cmd: string) => {
              logMessage(`[videoCrop] ffmpeg cmd: ${cmd}`, 'info');
            })
            .on(
              'progress',
              (progress: { percent?: number; timemark?: string }) => {
                // progress.percent 有时为 undefined，用 timemark 估算
                let p = Math.round(progress.percent || 0);
                if (p === 0 && progress.timemark && (duration || 0) > 0) {
                  const parts = progress.timemark.split(':').map(parseFloat);
                  const secs =
                    (parts[0] || 0) * 3600 +
                    (parts[1] || 0) * 60 +
                    (parts[2] || 0);
                  p = Math.min(99, Math.round((secs / (duration || 1)) * 100));
                }
                if (p !== lastPercent) {
                  lastPercent = p;
                  mainWindow.webContents.send('videoCrop:progress', {
                    percent: p,
                  });
                }
              },
            )
            .on('end', () => {
              logMessage(`[videoCrop] crop done: ${outputPath}`, 'info');
              mainWindow.webContents.send('videoCrop:progress', {
                percent: 100,
              });
              resolve({ success: true, outputPath });
            })
            .on('error', (err: Error) => {
              logMessage(`[videoCrop] crop error: ${err.message}`, 'error');
              resolve({
                success: false,
                error: `裁切失败: ${err.message}`,
              });
            })
            .save(outputPath);
        });
      } catch (error) {
        logMessage(`[videoCrop] crop error: ${error}`, 'error');
        return { success: false, error: `裁切失败: ${error}` };
      }
    },
  );

  // 选择输出目录
  ipcMain.handle('videoCrop:selectOutputDir', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择输出目录',
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });

  // 打开文件所在目录
  ipcMain.handle(
    'videoCrop:revealFile',
    async (_event, { filePath }: { filePath: string }) => {
      shell.showItemInFolder(filePath);
    },
  );

  logMessage('[videoCrop] handlers registered', 'info');
}
