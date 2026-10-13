import { ipcMain, BrowserWindow, dialog } from 'electron';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { logMessage } from '../storeManager';

export interface WatermarkSegment {
  start: number;
  end: number;
  duration: number;
  energyRatio: number;
  centroidRatio?: number;
}

export interface FileAnalysis {
  filePath: string;
  fileName: string;
  duration: number;
  sampleRate: number;
  watermarks: WatermarkSegment[];
}

function getAudioInfo(
  filePath: string,
): Promise<{ duration: number; sampleRate: number }> {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_streams',
      filePath,
    ]);
    let stdout = '';
    proc.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    proc.on('close', () => {
      try {
        const streams = JSON.parse(stdout).streams || [];
        for (const s of streams) {
          if (s.codec_type === 'audio') {
            resolve({
              duration: parseFloat(s.duration || '0'),
              sampleRate: parseInt(s.sample_rate || '44100'),
            });
            return;
          }
        }
      } catch {}
      resolve({ duration: 0, sampleRate: 44100 });
    });
  });
}

/**
 * Goertzel 算法：高效计算单个频率 bin 的能量。
 * 比完整 FFT 快得多，只计算我们需要的几个关键频率。
 */
function goertzelMagnitude(
  samples: Float32Array,
  N: number,
  k: number,
): number {
  const w = (2 * Math.PI * k) / N;
  const coeff = 2 * Math.cos(w);
  let s0 = 0,
    s1 = 0,
    s2 = 0;
  for (let i = 0; i < N; i++) {
    s0 = samples[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
  return Math.sqrt(Math.abs(power));
}

/**
 * 计算窗口内的频谱质心（用 Goertzel 算法）。
 * 只计算关键频率 bin (200-8000Hz)，比完整 FFT 快10x+。
 * 频谱质心高 = 高频成分多 = 可能是不同音色（如女声水印）。
 */
function spectralCentroid(
  samples: Float32Array,
  sr: number,
  N: number,
): number {
  // 每 200Hz 一个 bin，覆盖 200-8000Hz
  const step = 200;
  const maxFreq = 8000;
  const binResolution = sr / N;
  let weightedSum = 0;
  let totalMag = 0;
  for (let freq = step; freq <= maxFreq; freq += step) {
    const k = Math.round(freq / binResolution);
    if (k <= 0 || k > N / 2) continue;
    const mag = goertzelMagnitude(samples, N, k);
    weightedSum += freq * mag;
    totalMag += mag;
  }
  return totalMag > 0 ? weightedSum / totalMag : 0;
}

function detectWatermarks(
  filePath: string,
  threshold: number = 3.0,
  windowMs: number = 100,
  minDuration: number = 0.3,
  maxDuration: number = 15.0,
  minGap: number = 8.0,
  extend: number = 1.0,
): Promise<WatermarkSegment[]> {
  return new Promise((resolve) => {
    const sr = 16000;
    const proc = spawn('ffmpeg', [
      '-i',
      filePath,
      '-f',
      'f32le',
      '-acodec',
      'pcm_f32le',
      '-ar',
      String(sr),
      '-ac',
      '1',
      '-',
    ]);
    const chunks: Buffer[] = [];
    proc.stdout.on('data', (d: Buffer) => chunks.push(d));
    proc.on('close', () => {
      const buf = Buffer.concat(chunks);
      const samples = new Float32Array(
        buf.buffer,
        buf.byteOffset,
        buf.byteLength / 4,
      );
      const winSamples = Math.floor((windowMs / 1000) * sr);
      const n = Math.floor(samples.length / winSamples);
      const energy = new Float32Array(n);
      const centroidArr = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const offset = i * winSamples;
        let sum = 0;
        for (let j = 0; j < winSamples; j++) {
          sum += samples[offset + j] * samples[offset + j];
        }
        energy[i] = Math.sqrt(sum / winSamples);
        // 频谱质心：用 Goertzel 算法计算关键频率的能量分布
        centroidArr[i] = spectralCentroid(
          samples.subarray(offset, offset + winSamples),
          sr,
          winSamples,
        );
      }
      const sorted = Array.from(energy).sort((a, b) => a - b);
      const medianE = sorted[Math.floor(sorted.length / 2)] || 1e-10;
      // 频谱质心中位数
      const sortedCentroid = Array.from(centroidArr).sort((a, b) => a - b);
      const medianCentroid =
        sortedCentroid[Math.floor(sortedCentroid.length / 2)] || 1;
      const thresholdVal = medianE * threshold;
      // 频谱质心阈值：高于中位数 * 1.8 视为频谱异常（高频成分多 = 不同音色）
      const centroidThreshold = medianCentroid * 1.8;
      const maxGapSec = 0.5;
      // 双重检测：能量突变 OR 频谱质心突变
      const rawRegions: Array<{ start: number; end: number; source: string }> =
        [];
      let inRegion = false;
      let regionStart = 0;
      let lastAbove = 0;
      for (let i = 0; i < n; i++) {
        const t = (i * windowMs) / 1000;
        const energyHit = energy[i] > thresholdVal;
        const centroidHit = centroidArr[i] > centroidThreshold;
        if (energyHit || centroidHit) {
          if (!inRegion) {
            inRegion = true;
            regionStart = t;
          }
          lastAbove = t;
        } else if (inRegion) {
          if (t - lastAbove > maxGapSec) {
            inRegion = false;
            const dur = lastAbove - regionStart;
            if (dur >= minDuration && dur <= maxDuration) {
              rawRegions.push({
                start: regionStart,
                end: lastAbove,
                source: 'hybrid',
              });
            }
          }
        }
      }
      if (inRegion) {
        const dur = lastAbove - regionStart;
        if (dur >= minDuration && dur <= maxDuration) {
          rawRegions.push({
            start: regionStart,
            end: lastAbove,
            source: 'hybrid',
          });
        }
      }
      // 合并相邻区域
      const merged: Array<{ start: number; end: number }> = [];
      for (const r of rawRegions) {
        if (
          merged.length > 0 &&
          r.start - merged[merged.length - 1].end < minGap
        ) {
          merged[merged.length - 1].end = Math.max(
            merged[merged.length - 1].end,
            r.end,
          );
        } else {
          merged.push({ ...r });
        }
      }
      const results: WatermarkSegment[] = merged.map((r) => {
        const startSample = Math.floor(r.start / (windowMs / 1000));
        const endSample = Math.floor(r.end / (windowMs / 1000));
        let peakE = 0;
        let peakCentroid = 0;
        for (let i = startSample; i <= Math.min(endSample, n - 1); i++) {
          if (energy[i] > peakE) peakE = energy[i];
          if (centroidArr[i] > peakCentroid) peakCentroid = centroidArr[i];
        }
        const energyRatio = Math.round((peakE / medianE) * 100) / 100;
        const centroidRatio =
          Math.round((peakCentroid / medianCentroid) * 100) / 100;
        return {
          start: Math.max(0, r.start - extend),
          end: r.end + extend,
          duration: r.end - r.start,
          energyRatio,
          centroidRatio,
        } as WatermarkSegment;
      });
      resolve(results);
    });
  });
}

export function setupScrubHandlers(mainWindow: BrowserWindow) {
  ipcMain.handle(
    'scrub:analyze',
    async (
      _event,
      filePath: string,
      options?: {
        threshold?: number;
        maxDuration?: number;
        minGap?: number;
      },
    ) => {
      try {
        if (!fs.existsSync(filePath))
          return { success: false, error: '\u6587\u4ef6\u4e0d\u5b58\u5728' };
        const info = await getAudioInfo(filePath);
        const watermarks = await detectWatermarks(
          filePath,
          options?.threshold ?? 3.0,
          100,
          0.3,
          options?.maxDuration ?? 10.0,
          options?.minGap ?? 15.0,
          1.0,
        );
        const result: FileAnalysis = {
          filePath,
          fileName: path.basename(filePath),
          duration: info.duration,
          sampleRate: info.sampleRate,
          watermarks,
        };
        logMessage(
          `[scrub] \u5206\u6790\u5b8c\u6210: ${result.fileName}, ${watermarks.length} \u5904\u6c34\u5370`,
          'info',
        );
        return { success: true, data: result };
      } catch (err: any) {
        logMessage(`[scrub] \u5206\u6790\u5931\u8d25: ${err.message}`, 'error');
        return { success: false, error: err.message };
      }
    },
  );

  ipcMain.handle('scrub:selectFiles', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '\u9009\u62e9\u97f3\u9891\u6587\u4ef6',
      filters: [
        {
          name: '\u97f3\u9891\u6587\u4ef6',
          extensions: ['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'opus'],
        },
        { name: '\u6240\u6709\u6587\u4ef6', extensions: ['*'] },
      ],
      properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled) return { canceled: true, files: [] };
    return { canceled: false, files: result.filePaths };
  });
}
