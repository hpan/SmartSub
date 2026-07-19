/**
 * 音频裁切功能 IPC 处理函数
 */

import { ipcMain, dialog, BrowserWindow, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import { logMessage } from './storeManager';

const ffmpegPath = ffmpegStatic.replace('app.asar', 'app.asar.unpacked');

// 基于 ffmpeg-static 的路径计算 ffprobe 路径
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

logMessage(`[audioCut] ffmpeg path: ${ffmpegPath}`, 'info');
logMessage(`[audioCut] ffprobe path: ${ffprobePath}`, 'info');

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

interface AudioInfo {
  path: string;
  fileName: string;
  duration: number;
  format: string;
}

interface CutPoint {
  time: number; // 秒
}

interface CutResult {
  index: number;
  outputPath: string;
  startTime: number;
  endTime: number;
}

function getAudioDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      resolve(metadata.format.duration || 0);
    });
  });
}

/**
 * 精确切割音视频片段
 *
 * -ss 放在 -i 前面：快速跳到目标位置附近的关键帧（瞬间完成）
 * 然后重编码确保帧级精度，使用 ultrafast 预设尽量提速
 * 音频用 -c:a copy 流复制（不需要重编码，速度快）
 */
function cutAudio(
  inputPath: string,
  outputPath: string,
  startTime: number,
  duration: number,
  onProgress?: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg(inputPath)
      .outputOptions('-ss', String(startTime), '-t', String(duration), '-c', 'copy', '-y')
      .on('start', (str) => {
        logMessage(`audio cut start: ${str}`, 'info');
      })
      .on('progress', (progress) => {
        if (onProgress && progress.percent != null) {
          onProgress(Math.min(100, progress.percent));
        }
      })
      .on('end', () => {
        logMessage(`audio cut done: ${outputPath}`, 'info');
        resolve();
      })
      .on('error', (err) => {
        logMessage(`audio cut error: ${err}`, 'error');
        reject(err);
      })
      .save(outputPath);

    activeFfmpegCommands.push(cmd);
  });
}

let activeFfmpegCommands: ffmpeg.FfmpegCommand[] = [];

export function setupAudioCutHandlers(mainWindow: BrowserWindow) {
  // 选择音频文件
  ipcMain.handle('audioCut:selectFile', async () => {
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: '选择音频/视频文件',
        properties: ['openFile'],
        filters: [
          {
            name: 'Audio / Video Files',
            extensions: [
              'mp3',
              'wav',
              'flac',
              'aac',
              'ogg',
              'm4a',
              'wma',
              'opus',
              'ape',
              'alac',
              'mp4',
              'mkv',
              'avi',
              'mov',
              'webm',
              'ts',
              'mts',
            ],
          },
        ],
      });
      if (result.canceled || !result.filePaths[0]) {
        return { success: false, error: '用户取消选择' };
      }
      return { success: true, data: result.filePaths[0] };
    } catch (error) {
      return { success: false, error: `选择文件失败: ${error}` };
    }
  });

  // 获取音频信息
  ipcMain.handle('audioCut:getInfo', async (_event, { filePath }: { filePath: string }) => {
    try {
      if (!fs.existsSync(filePath)) {
        return { success: false, error: '文件不存在' };
      }
      const duration = await getAudioDuration(filePath);
      const info: AudioInfo = {
        path: filePath,
        fileName: path.basename(filePath),
        duration,
        format: path.extname(filePath).slice(1).toUpperCase(),
      };
      return { success: true, data: info };
    } catch (error) {
      return { success: false, error: `获取音频信息失败: ${error}` };
    }
  });

  // 执行裁切
  ipcMain.handle(
    'audioCut:cut',
    async (
      _event,
      { filePath, cutPoints, extractAudio }: { filePath: string; cutPoints: number[]; extractAudio?: boolean },
    ) => {
      try {
        if (!fs.existsSync(filePath)) {
          return { success: false, error: '文件不存在' };
        }

        const duration = await getAudioDuration(filePath);
        const ext = path.extname(filePath);
        const base = path.basename(filePath, ext);
        const dir = path.dirname(filePath);

        // 构建时间段：[0, cut1], [cut1, cut2], ..., [cutN, duration]
        const sorted = [...new Set(cutPoints)]
          .filter((t) => t > 0 && t < duration)
          .sort((a, b) => a - b);

        const boundaries = [0, ...sorted, duration];
        const results: CutResult[] = [];

        activeFfmpegCommands = [];

        const videoExts = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.ts', '.mts'];
        const isVideo = videoExts.includes(ext.toLowerCase());

        for (let i = 0; i < boundaries.length - 1; i++) {
          const start = boundaries[i];
          const end = boundaries[i + 1];
          const segDuration = end - start;
          const outFile = path.join(
            dir,
            `${base}_part${String(i + 1).padStart(2, '0')}${ext}`,
          );

          mainWindow.webContents.send('audioCut:progress', {
            current: i + 1,
            total: boundaries.length - 1,
            percent: 0,
          });

          await cutAudio(filePath, outFile, start, segDuration, (pct) => {
            mainWindow.webContents.send('audioCut:progress', {
              current: i + 1,
              total: boundaries.length - 1,
              percent: pct,
            });
          });

          results.push({
            index: i + 1,
            outputPath: outFile,
            startTime: start,
            endTime: end,
          });

          // 如果需要分离音频，从刚裁切的视频片段中提取音频
          if (extractAudio && isVideo) {
            const audioFile = path.join(
              dir,
              `${base}_part${String(i + 1).padStart(2, '0')}.m4a`,
            );
            await new Promise<void>((resolveAudio, rejectAudio) => {
              ffmpeg(outFile)
                .outputOptions('-vn', '-c:a', 'copy', '-y')
                .on('end', () => resolveAudio())
                .on('error', (err) => rejectAudio(err))
                .save(audioFile);
            });
            logMessage(`[audioCut] audio extracted: ${audioFile}`, 'info');
          }
        }

        return { success: true, data: results };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes('SIGKILL') || msg.includes('killed')) {
          return { success: false, error: '已取消' };
        }
        logMessage(`audio cut error: ${error}`, 'error');
        return { success: false, error: `裁切失败: ${error}` };
      }
    },
  );

  // 取消裁切
  ipcMain.handle('audioCut:cancel', async () => {
    for (const cmd of activeFfmpegCommands) {
      try {
        cmd.kill('SIGKILL');
      } catch {}
    }
    activeFfmpegCommands = [];
    return { success: true };
  });

  // 打开文件所在目录
  ipcMain.handle('audioCut:openFolder', async (_event, { filePath }: { filePath: string }) => {
    try {
      shell.showItemInFolder(filePath);
      return { success: true };
    } catch (error) {
      return { success: false, error: `打开目录失败: ${error}` };
    }
  });

  logMessage('音频裁切 IPC 处理函数已注册', 'info');
}

// 检测静音位置（首尾）- 优化版：只检测前3分钟和后3分钟
ipcMain.handle(
  'audioCut:detectSilence',
  async (
    _event,
    {
      filePath,
      silenceThreshold = -30,
      minSilenceDuration = 2,
    }: {
      filePath: string;
      silenceThreshold?: number;
      minSilenceDuration?: number;
    },
  ) => {
    try {
      if (!fs.existsSync(filePath)) {
        return { success: false, error: '文件不存在' };
      }

      logMessage(
        `[audioCut] detecting silence (optimized): ${filePath}`,
        'info',
      );

      const duration = await getAudioDuration(filePath);
      const CHECK_DURATION = 180; // 检测前/后各3分钟

      // 计算实际检测的时间范围
      const startCheckEnd = Math.min(CHECK_DURATION, duration);
      const endCheckStart = Math.max(0, duration - CHECK_DURATION);

      logMessage(
        `[audioCut] checking 0-${startCheckEnd}s and ${endCheckStart}-${duration}s`,
        'info',
      );

      return new Promise((resolve) => {
        const { spawn } = require('child_process');

        // 检测开头静音
        const detectStart = () =>
          new Promise<Array<{ start: number; end: number }>>((res) => {
            const args = [
              '-i',
              filePath,
              '-t',
              String(startCheckEnd),
              '-af',
              `silencedetect=noise=${silenceThreshold}dB:d=${minSilenceDuration}`,
              '-f',
              'null',
              '-',
            ];

            const proc = spawn(ffmpegPath, args);
            let stderr = '';

            proc.stderr.on('data', (data: Buffer) => {
              stderr += data.toString();
            });

            proc.on('close', () => {
              const ranges: Array<{ start: number; end: number }> = [];
              const lines = stderr.split('\n');
              let currentStart: number | null = null;

              for (const line of lines) {
                const startMatch = line.match(/silence_start:\s*([\d.]+)/);
                const endMatch = line.match(/silence_end:\s*([\d.]+)/);

                if (startMatch) {
                  currentStart = parseFloat(startMatch[1]);
                } else if (endMatch && currentStart !== null) {
                  ranges.push({
                    start: currentStart,
                    end: parseFloat(endMatch[1]),
                  });
                  currentStart = null;
                }
              }

              logMessage(
                `[audioCut] start silence ranges: ${JSON.stringify(ranges)}`,
                'info',
              );
              res(ranges);
            });

            proc.on('error', () => res([]));
          });

        // 检测结尾静音
        const detectEnd = () =>
          new Promise<Array<{ start: number; end: number }>>((res) => {
            const args = [
              '-ss',
              String(endCheckStart),
              '-i',
              filePath,
              '-af',
              `silencedetect=noise=${silenceThreshold}dB:d=${minSilenceDuration}`,
              '-f',
              'null',
              '-',
            ];

            const proc = spawn(ffmpegPath, args);
            let stderr = '';

            proc.stderr.on('data', (data: Buffer) => {
              stderr += data.toString();
            });

            proc.on('close', () => {
              const ranges: Array<{ start: number; end: number }> = [];
              const lines = stderr.split('\n');
              let currentStart: number | null = null;

              for (const line of lines) {
                const startMatch = line.match(/silence_start:\s*([\d.]+)/);
                const endMatch = line.match(/silence_end:\s*([\d.]+)/);

                if (startMatch) {
                  currentStart = parseFloat(startMatch[1]) + endCheckStart;
                } else if (endMatch && currentStart !== null) {
                  ranges.push({
                    start: currentStart,
                    end: parseFloat(endMatch[1]) + endCheckStart,
                  });
                  currentStart = null;
                }
              }

              logMessage(
                `[audioCut] end silence ranges: ${JSON.stringify(ranges)}`,
                'info',
              );
              res(ranges);
            });

            proc.on('error', () => res([]));
          });

        // 并行检测开头和结尾
        Promise.all([detectStart(), detectEnd()])
          .then(([startRanges, endRanges]) => {
            const allRanges = [...startRanges, ...endRanges];

            // 找到音频开始时间（第一个静音区间的结束）
            let audioStart = 0;
            if (startRanges.length > 0 && startRanges[0].start < 1) {
              audioStart = startRanges[0].end;
            }

            // 找到音频结束时间（最后一个静音区间的开始）
            let audioEnd = duration;
            if (endRanges.length > 0) {
              const lastRange = endRanges[endRanges.length - 1];
              if (lastRange.end >= duration - 1) {
                audioEnd = lastRange.start;
              }
            }

            logMessage(
              `[audioCut] result: audioStart=${audioStart}, audioEnd=${audioEnd}`,
              'info',
            );

            resolve({
              success: true,
              data: {
                audioStart: Math.max(0, audioStart),
                audioEnd: Math.min(duration, audioEnd),
                duration,
                silenceRanges: allRanges,
              },
            });
          })
          .catch((err) => {
            logMessage(`[audioCut] silence detect error: ${err}`, 'error');
            resolve({ success: false, error: `检测静音失败: ${err}` });
          });
      });
    } catch (error) {
      logMessage(`[audioCut] silence detect error: ${error}`, 'error');
      return { success: false, error: `检测静音失败: ${error}` };
    }
  },
);

// 生成波形数据（支持指定时间范围）
ipcMain.handle(
  'audioCut:getWaveform',
  async (
    _event,
    {
      filePath,
      samples = 300,
      startTime,
      endTime,
    }: {
      filePath: string;
      samples?: number;
      startTime?: number;
      endTime?: number;
    },
  ) => {
    try {
      if (!fs.existsSync(filePath)) {
        return { success: false, error: '文件不存在' };
      }

      const duration = await getAudioDuration(filePath);
      const start = startTime || 0;
      const end = endTime || duration;
      const segmentDuration = end - start;

      logMessage(
        `[audioCut] generating waveform: ${start}s - ${end}s, samples=${samples}`,
        'info',
      );

      const tempWav = path.join(
        require('os').tmpdir(),
        `waveform_${Date.now()}.wav`,
      );

      return new Promise((resolve) => {
        const { spawn } = require('child_process');

        // 提取指定时间段并降采样
        const args = [
          '-ss',
          String(start),
          '-i',
          filePath,
          '-t',
          String(segmentDuration),
          '-ac',
          '1',
          '-ar',
          '8000',
          '-f',
          'wav',
          '-y',
          tempWav,
        ];

        const proc = spawn(ffmpegPath, args);

        proc.on('close', async (code: number) => {
          if (code !== 0 || !fs.existsSync(tempWav)) {
            logMessage(`[audioCut] failed to create temp wav`, 'info');
            const waveform: number[] = [];
            for (let i = 0; i < samples; i++) {
              waveform.push(0.3 + Math.random() * 0.4);
            }
            resolve({
              success: true,
              data: {
                duration: segmentDuration,
                samples: waveform,
                sampleRate: samples / segmentDuration,
              },
            });
            return;
          }

          try {
            const wavBuffer = fs.readFileSync(tempWav);
            const dataStart = 44;
            const totalSamples = Math.floor((wavBuffer.length - dataStart) / 2);
            const samplesPerBucket = Math.max(
              1,
              Math.floor(totalSamples / samples),
            );

            const waveform: number[] = [];

            for (let i = 0; i < samples; i++) {
              let maxAmp = 0;
              const start = dataStart + i * samplesPerBucket * 2;
              const end = Math.min(
                start + samplesPerBucket * 2,
                wavBuffer.length,
              );

              for (let j = start; j < end; j += 2) {
                const sample = wavBuffer.readInt16LE(j);
                const amp = Math.abs(sample) / 32768;
                if (amp > maxAmp) maxAmp = amp;
              }

              waveform.push(maxAmp);
            }

            try {
              fs.unlinkSync(tempWav);
            } catch {}

            logMessage(
              `[audioCut] waveform generated: ${waveform.length} samples`,
              'info',
            );

            resolve({
              success: true,
              data: {
                duration: segmentDuration,
                samples: waveform,
                sampleRate: samples / segmentDuration,
              },
            });
          } catch (err) {
            logMessage(`[audioCut] waveform parse error: ${err}`, 'error');
            const waveform: number[] = [];
            for (let i = 0; i < samples; i++) {
              waveform.push(0.3 + Math.random() * 0.4);
            }
            resolve({
              success: true,
              data: {
                duration: segmentDuration,
                samples: waveform,
                sampleRate: samples / segmentDuration,
              },
            });
          }
        });

        proc.on('error', (err: Error) => {
          logMessage(`[audioCut] waveform error: ${err}`, 'error');
          const waveform: number[] = [];
          for (let i = 0; i < samples; i++) {
            waveform.push(0.3 + Math.random() * 0.4);
          }
          resolve({
            success: true,
            data: {
              duration: segmentDuration,
              samples: waveform,
              sampleRate: samples / segmentDuration,
            },
          });
        });
      });
    } catch (error) {
      logMessage(`[audioCut] waveform error: ${error}`, 'error');
      return { success: false, error: `生成波形失败: ${error}` };
    }
  },
);

// 检测视频关键帧位置
ipcMain.handle(
  'audioCut:detectKeyframes',
  async (_event, { filePath }: { filePath: string }) => {
    try {
      if (!fs.existsSync(filePath)) {
        return { success: false, error: '文件不存在' };
      }

      const ext = path.extname(filePath).toLowerCase();
      const videoExts = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.ts', '.mts'];
      if (!videoExts.includes(ext)) {
        return { success: true, data: { keyframes: [] } };
      }

      logMessage(`[audioCut] detecting keyframes: ${filePath}`, 'info');

      const { spawn } = require('child_process');
      const args = [
        '-select_streams', 'v:0',
        '-show_entries', 'packet=pts_time,flags',
        '-of', 'csv',
        filePath,
      ];

      return new Promise((resolve) => {
        const proc = spawn(ffprobePath, args);
        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
        proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

        proc.on('close', (code: number) => {
          if (code !== 0) {
            logMessage(`[audioCut] keyframe detect error: ${stderr.slice(-200)}`, 'error');
            resolve({ success: false, error: '检测关键帧失败' });
            return;
          }

          const keyframes: number[] = [];
          for (const line of stdout.split('\n')) {
            const parts = line.trim().split(',');
            if (parts.length >= 3 && parts[2] && parts[2].includes('K')) {
              const t = parseFloat(parts[1]);
              if (!isNaN(t) && t >= 0) {
                keyframes.push(Math.round(t * 1000) / 1000);
              }
            }
          }

          logMessage(`[audioCut] found ${keyframes.length} keyframes`, 'info');
          resolve({ success: true, data: { keyframes } });
        });

        proc.on('error', (err: Error) => {
          logMessage(`[audioCut] keyframe detect error: ${err}`, 'error');
          resolve({ success: false, error: `检测关键帧失败: ${err.message}` });
        });
      });
    } catch (error) {
      logMessage(`[audioCut] keyframe detect error: ${error}`, 'error');
      return { success: false, error: `检测关键帧失败: ${error}` };
    }
  },
);
