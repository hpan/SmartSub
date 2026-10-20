/**
 * 变速 IPC 处理函数
 * 支持音频/视频变速
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

interface MediaInfo {
  path: string;
  fileName: string;
  duration: number;
  type: 'audio' | 'video';
}

function getMediaInfo(filePath: string): Promise<MediaInfo> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      const videoStream = metadata.streams.find(
        (s) => s.codec_type === 'video',
      );
      const audioStream = metadata.streams.find(
        (s) => s.codec_type === 'audio',
      );
      if (!audioStream && !videoStream)
        return reject(new Error('未找到音频或视频流'));
      resolve({
        path: filePath,
        fileName: path.basename(filePath),
        duration: metadata.format.duration || 0,
        type: videoStream ? 'video' : 'audio',
      });
    });
  });
}

/**
 * 根据输出容器的扩展名返回兼容的音频编码器。
 * 变速必须重新编码，而各容器对编码有硬性要求：
 * 之前对所有音频强制 -c:a aac，在 wav/flac/mp3/ogg 等容器下会触发
 * "Conversion failed!"，因此按容器选择编码器。
 */
function audioCodecForExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.mp3':
      return 'libmp3lame';
    case '.wav':
      return 'pcm_s16le';
    case '.flac':
      return 'flac';
    case '.ogg':
      return 'libvorbis';
    case '.webm':
      return 'libopus';
    case '.m4a':
    case '.aac':
    default:
      return 'aac';
  }
}

export function setupSpeedHandlers(mainWindow: BrowserWindow) {
  // 选择文件
  ipcMain.handle('speed:selectFile', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择音频/视频文件',
      filters: [
        {
          name: '音频/视频文件',
          extensions: [
            'mp3',
            'wav',
            'm4a',
            'aac',
            'ogg',
            'flac',
            'mp4',
            'mkv',
            'avi',
            'mov',
            'webm',
          ],
        },
      ],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    try {
      const info = await getMediaInfo(filePath);
      logMessage(
        `[speed] selected: ${filePath}, type=${info.type}, duration=${info.duration}s`,
        'info',
      );
      return { success: true, data: info };
    } catch (error) {
      logMessage(`[speed] probe error: ${error}`, 'error');
      return { success: false, error: `读取文件信息失败: ${error}` };
    }
  });

  // 获取媒体信息
  ipcMain.handle(
    'speed:getInfo',
    async (_event, { filePath }: { filePath: string }) => {
      try {
        if (!fs.existsSync(filePath))
          return { success: false, error: '文件不存在' };
        const info = await getMediaInfo(filePath);
        return { success: true, data: info };
      } catch (error) {
        logMessage(`[speed] getInfo error: ${error}`, 'error');
        return { success: false, error: `读取文件信息失败: ${error}` };
      }
    },
  );

  // 执行变速
  ipcMain.handle(
    'speed:change',
    async (
      _event,
      { inputPath, speed }: { inputPath: string; speed: number },
    ) => {
      try {
        if (!fs.existsSync(inputPath))
          return { success: false, error: '输入文件不存在' };
        if (speed <= 0 || speed > 3)
          return { success: false, error: '倍速范围: 0.5 - 3.0' };

        const ext = path.extname(inputPath);
        const baseName = path.basename(inputPath, ext);
        const dir = path.dirname(inputPath);
        const outputPath = path.join(dir, `${baseName}_${speed}x${ext}`);

        logMessage(
          `[speed] changing: ${inputPath} -> ${speed}x -> ${outputPath}`,
          'info',
        );

        // atempo 过滤器只支持 0.5-2.0，超出范围需要链式
        function buildAtempoFilters(s: number): string[] {
          const filters: string[] = [];
          let remaining = s;
          while (remaining > 2.0) {
            filters.push('atempo=2.0');
            remaining /= 2.0;
          }
          while (remaining < 0.5) {
            filters.push('atempo=0.5');
            remaining /= 0.5;
          }
          filters.push(`atempo=${remaining.toFixed(4)}`);
          return filters;
        }

        const atempoFilters = buildAtempoFilters(speed);
        const isVideo = ['.mp4', '.mkv', '.avi', '.mov', '.webm'].includes(
          ext.toLowerCase(),
        );

        return new Promise((resolve) => {
          let lastPercent = 0;
          let stderrLog = '';
          let cmd = ffmpeg(inputPath);

          if (isVideo) {
            // 视频：加速音频 + 加速视频
            // webm 容器不支持 aac，单独处理音频编码
            const videoAudioCodec =
              ext.toLowerCase() === '.webm' ? 'libopus' : 'aac';
            cmd = cmd
              .audioFilters(atempoFilters)
              .videoFilters(`setpts=${(1 / speed).toFixed(4)}*PTS`)
              .outputOptions(
                '-c:v',
                'libx264',
                '-preset',
                'medium',
                '-crf',
                '23',
                '-c:a',
                videoAudioCodec,
                '-b:a',
                '128k',
                '-y',
              );
          } else {
            // 音频：只加速音频，按容器选择兼容的编码
            const audioCodec = audioCodecForExt(ext);
            const lossyCodecs = new Set([
              'aac',
              'libmp3lame',
              'libvorbis',
              'libopus',
            ]);
            const audioOpts: string[] = ['-c:a', audioCodec, '-y'];
            if (lossyCodecs.has(audioCodec)) audioOpts.push('-b:a', '128k');
            cmd = cmd.audioFilters(atempoFilters).outputOptions(audioOpts);
          }

          cmd
            .on('start', (cmdStr: string) => {
              logMessage(`[speed] ffmpeg cmd: ${cmdStr}`, 'info');
            })
            .on('stderr', (line: string) => {
              stderrLog += line + '\n';
            })
            .on(
              'progress',
              (progress: { percent?: number; timemark?: string }) => {
                let p = Math.round(progress.percent || 0);
                if (p !== lastPercent) {
                  lastPercent = p;
                  mainWindow.webContents.send('speed:progress', { percent: p });
                }
              },
            )
            .on('end', () => {
              logMessage(`[speed] done: ${outputPath}`, 'info');
              mainWindow.webContents.send('speed:progress', { percent: 100 });
              resolve({ success: true, outputPath });
            })
            .on('error', (err: Error) => {
              // 透出 ffmpeg 真实报错，方便定位（默认只给外壳信息）
              const detail = stderrLog
                .split('\n')
                .map((l) => l.trim())
                .filter(Boolean)
                .slice(-3)
                .join(' | ');
              const msg = detail ? `${err.message} (${detail})` : err.message;
              logMessage(`[speed] error: ${msg}`, 'error');
              resolve({ success: false, error: `变速失败: ${msg}` });
            })
            .save(outputPath);
        });
      } catch (error) {
        logMessage(`[speed] error: ${error}`, 'error');
        return { success: false, error: `变速失败: ${error}` };
      }
    },
  );

  // 打开文件所在目录
  ipcMain.handle(
    'speed:revealFile',
    async (_event, { filePath }: { filePath: string }) => {
      shell.showItemInFolder(filePath);
    },
  );

  logMessage('[speed] handlers registered', 'info');
}
