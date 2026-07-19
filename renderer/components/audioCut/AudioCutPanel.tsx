import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Scissors,
  Plus,
  Trash2,
  FolderOpen,
  FileVideo,
  X,
  Loader2,
  Upload,
  Wand2,
  Play,
  Pause,
} from 'lucide-react';
import { toast } from 'sonner';

interface AudioInfo {
  path: string;
  fileName: string;
  duration: number;
  format: string;
}

interface CutResult {
  index: number;
  outputPath: string;
  startTime: number;
  endTime: number;
}

interface SilenceData {
  audioStart: number;
  audioEnd: number;
  duration: number;
  silenceRanges: Array<{ start: number; end: number }>;
}

interface WaveformData {
  duration: number;
  samples: number[];
  sampleRate: number;
}

function formatSeconds(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.floor((s % 1) * 10);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${ms}`;
}

function formatTimeShort(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function parseTimeInput(str: string): number | null {
  const parts = str.trim().split(':').map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return null;
}

// 波形可视化组件 - 分屏显示前3分钟和后3分钟
function WaveformCanvas({
  startWaveform,
  endWaveform,
  silenceData,
  keyframes,
  duration,
  checkDuration,
  currentTime,
  onTimeClick,
}: {
  startWaveform: number[];
  endWaveform: number[];
  silenceData: SilenceData | null;
  keyframes: number[];
  duration: number;
  checkDuration: number;
  currentTime: number;
  onTimeClick?: (time: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const halfWidth = width / 2;
    const separatorWidth = 2;

    // 清空
    ctx.clearRect(0, 0, width, height);

    // 绘制背景（深色）
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, width, height);

    // 绘制分隔线
    ctx.fillStyle = '#333355';
    ctx.fillRect(halfWidth - separatorWidth / 2, 0, separatorWidth, height);

    // 绘制单侧波形的函数
    const drawWaveformSide = (
      samples: number[],
      offsetX: number,
      sideWidth: number,
      startTime: number,
      endTime: number,
      label: string,
    ) => {
      if (!samples || samples.length === 0) return;

      const barWidth = sideWidth / samples.length;
      const maxBarHeight = height * 0.75;
      const baselineY = height - 15;

      // 绘制基线
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(offsetX, baselineY);
      ctx.lineTo(offsetX + sideWidth, baselineY);
      ctx.stroke();

      // 先绘制静音区域背景（使用 FFmpeg 检测的数据）
      if (silenceData) {
        ctx.fillStyle = 'rgba(239, 68, 68, 0.25)';
        for (const range of silenceData.silenceRanges) {
          // 检查是否与当前显示范围有重叠
          if (range.end <= startTime || range.start >= endTime) continue;

          const clampedStart = Math.max(range.start, startTime);
          const clampedEnd = Math.min(range.end, endTime);

          const x1 =
            offsetX +
            ((clampedStart - startTime) / (endTime - startTime)) * sideWidth;
          const x2 =
            offsetX +
            ((clampedEnd - startTime) / (endTime - startTime)) * sideWidth;
          ctx.fillRect(x1, 0, x2 - x1, height);
        }
      }

      // 波形颜色渐变
      const gradient = ctx.createLinearGradient(0, baselineY, 0, 0);
      gradient.addColorStop(0, '#22c55e');
      gradient.addColorStop(0.5, '#4ade80');
      gradient.addColorStop(1, '#86efac');

      ctx.fillStyle = gradient;
      for (let i = 0; i < samples.length; i++) {
        const x = offsetX + i * barWidth;
        const barHeight = samples[i] * maxBarHeight;
        ctx.fillRect(
          x,
          baselineY - barHeight,
          Math.max(barWidth - 1, 1),
          barHeight,
        );
      }

      // 绘制静音区域标记
      if (silenceData) {
        ctx.fillStyle = 'rgba(239, 68, 68, 0.2)';
        for (const range of silenceData.silenceRanges) {
          // 检查是否在当前显示范围内
          if (range.end < startTime || range.start > endTime) continue;

          const clampedStart = Math.max(range.start, startTime);
          const clampedEnd = Math.min(range.end, endTime);

          const x1 =
            offsetX +
            ((clampedStart - startTime) / (endTime - startTime)) * sideWidth;
          const x2 =
            offsetX +
            ((clampedEnd - startTime) / (endTime - startTime)) * sideWidth;
          ctx.fillRect(x1, 0, x2 - x1, height);
        }
      }

      // 绘制时间标签
      ctx.font = '10px sans-serif';
      ctx.fillStyle = '#8888aa';
      ctx.textAlign = 'center';
      ctx.fillText(label, offsetX + sideWidth / 2, height - 4);

      // 起止时间
      ctx.textAlign = 'left';
      ctx.fillText(formatTimeShort(startTime), offsetX + 4, 12);
      ctx.textAlign = 'right';
      ctx.fillText(formatTimeShort(endTime), offsetX + sideWidth - 4, 12);
    };

    // 计算实际的检测时长
    const actualCheckDuration = Math.min(checkDuration, duration / 2);

    // 绘制左半部分（前3分钟）
    drawWaveformSide(
      startWaveform,
      0,
      halfWidth - separatorWidth,
      0,
      actualCheckDuration,
      '开头',
    );

    // 绘制右半部分（后3分钟）
    drawWaveformSide(
      endWaveform,
      halfWidth + separatorWidth,
      halfWidth - separatorWidth,
      duration - actualCheckDuration,
      duration,
      '结尾',
    );

    // 绘制音频开始/结束标记
    if (silenceData) {
      // 开始标记（绿色）
      if (silenceData.audioStart <= actualCheckDuration) {
        const startX =
          (silenceData.audioStart / actualCheckDuration) *
          (halfWidth - separatorWidth);
        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(startX, 0);
        ctx.lineTo(startX, height);
        ctx.stroke();

        ctx.fillStyle = '#22c55e';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('开始', startX, height - 15);
      }

      // 结束标记（蓝色）
      if (silenceData.audioEnd >= duration - actualCheckDuration) {
        const endOffset =
          silenceData.audioEnd - (duration - actualCheckDuration);
        const endX =
          halfWidth +
          separatorWidth +
          (endOffset / actualCheckDuration) * (halfWidth - separatorWidth);
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(endX, 0);
        ctx.lineTo(endX, height);
        ctx.stroke();

        ctx.fillStyle = '#3b82f6';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('结束', endX, height - 15);
      }
    }

    // 绘制播放位置（白色竖线）
    if (currentTime >= 0) {
      let playX = -1;

      if (currentTime <= actualCheckDuration) {
        // 在前半部分
        playX =
          (currentTime / actualCheckDuration) * (halfWidth - separatorWidth);
      } else if (currentTime >= duration - actualCheckDuration) {
        // 在后半部分
        const endOffset = currentTime - (duration - actualCheckDuration);
        playX =
          halfWidth +
          separatorWidth +
          (endOffset / actualCheckDuration) * (halfWidth - separatorWidth);
      }

      if (playX >= 0) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(playX, 0);
        ctx.lineTo(playX, height);
        ctx.stroke();

        // 播放位置小三角
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(playX - 4, 0);
        ctx.lineTo(playX + 4, 0);
        ctx.lineTo(playX, 6);
        ctx.closePath();
        ctx.fill();
      }
    }
  }, [
    startWaveform,
    endWaveform,
    silenceData,
    duration,
    checkDuration,
    currentTime,
  ]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onTimeClick || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const width = rect.width;
    const halfWidth = width / 2;
    const separatorWidth = 2;

    const actualCheckDuration = Math.min(checkDuration, duration / 2);

    let time = -1;
    if (x < halfWidth - separatorWidth) {
      // 点击前半部分
      const ratio = x / (halfWidth - separatorWidth);
      time = ratio * actualCheckDuration;
    } else if (x > halfWidth + separatorWidth) {
      // 点击后半部分
      const ratio =
        (x - halfWidth - separatorWidth) / (halfWidth - separatorWidth);
      time = duration - actualCheckDuration + ratio * actualCheckDuration;
    }

    if (time >= 0) {
      onTimeClick(time);
    }
  };

  return (
    <canvas
      ref={canvasRef}
      width={800}
      height={120}
      className="w-full rounded-md cursor-pointer"
      onClick={handleClick}
    />
  );
}

export default function AudioCutPanel() {
  const [audioInfo, setAudioInfo] = useState<AudioInfo | null>(null);
  const [cutPoints, setCutPoints] = useState<string[]>(['']);
  const [cutting, setCutting] = useState(false);
  const [extractAudio, setExtractAudio] = useState(false);
  const [progress, setProgress] = useState<{
    current: number;
    total: number;
    percent: number;
  } | null>(null);
  const [results, setResults] = useState<CutResult[]>([]);
  const [dragging, setDragging] = useState(false);
  const [startWaveform, setStartWaveform] = useState<number[]>([]);
  const [endWaveform, setEndWaveform] = useState<number[]>([]);
  const [silenceData, setSilenceData] = useState<SilenceData | null>(null);
  const [keyframes, setKeyframes] = useState<number[]>([]);
  const [detecting, setDetecting] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(-1);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const animFrameRef = useRef<number>();
  const audioContextRef = useRef<AudioContext | null>(null);
  const checkDuration = 180; // 3分钟

  // 清理播放器
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
        audioRef.current = null;
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, []);

  const loadFile = useCallback(
    async (filePath: string) => {
      const infoRes = await window.ipc.invoke('audioCut:getInfo', {
        filePath,
      });
      if (infoRes.success) {
        setAudioInfo(infoRes.data);
        setCutPoints(['']);
        setResults([]);
        setStartWaveform([]);
        setEndWaveform([]);
        setSilenceData(null);
        setKeyframes([]);
        setCurrentTime(-1);
        setPlaying(false);

        // 停止之前的播放
        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current.src = '';
          audioRef.current = null;
        }

        // 自动检测静音并生成波形
        setDetecting(true);
        try {
          // 并行检测静音、波形和关键帧
          const [silenceRes, startWaveRes, endWaveRes, keyframeRes] =
            await Promise.all([
              window.ipc.invoke('audioCut:detectSilence', { filePath }),
              window.ipc.invoke('audioCut:getWaveform', {
                filePath,
                samples: 300,
                startTime: 0,
                endTime: Math.min(checkDuration, infoRes.data.duration / 2),
              }),
              window.ipc.invoke('audioCut:getWaveform', {
                filePath,
                samples: 300,
                startTime: Math.max(0, infoRes.data.duration - checkDuration),
                endTime: infoRes.data.duration,
              }),
              window.ipc.invoke('audioCut:detectKeyframes', { filePath }),
            ]);

          if (silenceRes.success) {
            setSilenceData(silenceRes.data);
            const { audioStart, audioEnd } = silenceRes.data;
            if (audioStart > 0.1 || audioEnd < infoRes.data.duration - 0.1) {
              const points: string[] = [];
              if (audioStart > 0.1) points.push(formatSeconds(audioStart));
              if (audioEnd < infoRes.data.duration - 0.1)
                points.push(formatSeconds(audioEnd));
              setCutPoints(points);
              toast.success(`已检测到静音区域，自动填入裁切点`);
            } else {
              toast.info('未检测到明显的首尾静音区域');
            }
          } else {
            toast.warning('静音检测失败，请手动设置裁切点');
          }

          if (startWaveRes.success) setStartWaveform(startWaveRes.data.samples);
          if (endWaveRes.success) setEndWaveform(endWaveRes.data.samples);

          if (keyframeRes.success && keyframeRes.data.keyframes.length > 0) {
            setKeyframes(keyframeRes.data.keyframes);
          }
        } catch (error) {
          console.error('Detection error:', error);
        } finally {
          setDetecting(false);
        }
      } else {
        toast.error(infoRes.error);
      }
    },
    [checkDuration],
  );

  const handleSelectFile = useCallback(async () => {
    const res = await window.ipc.invoke('audioCut:selectFile');
    if (!res.success) return;
    await loadFile(res.data);
  }, [loadFile]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) {
        const filePath = window.ipc.getPathForFile(file);
        loadFile(filePath);
      }
    },
    [loadFile],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
  }, []);

  const handleAddPoint = useCallback(() => {
    setCutPoints((prev) => [...prev, '']);
  }, []);

  const handleRemovePoint = useCallback((index: number) => {
    setCutPoints((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // 自动格式化时间输入：只输数字，自动插入冒号和点号
  const handlePointChange = useCallback((index: number, value: string) => {
    // 始终提取纯数字并重新格式化，确保冒号/点号自动插入
    const digits = value.replace(/[^0-9]/g, '');
    if (!digits) {
      setCutPoints((prev) => prev.map((v, i) => (i === index ? '' : v)));
      return;
    }
    let formatted = '';
    for (let d = 0; d < Math.min(digits.length, 7); d++) {
      if (d === 2 || d === 4) formatted += ':';
      if (d === 6) formatted += '.';
      formatted += digits[d];
    }
    setCutPoints((prev) => prev.map((v, i) => (i === index ? formatted : v)));
  }, []);

  // 播放/暂停
  const togglePlay = useCallback(async () => {
    if (!audioInfo) return;

    if (playing && audioRef.current) {
      audioRef.current.pause();
      setPlaying(false);
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    } else {
      try {
        // 如果还没有创建音频对象
        if (!audioRef.current) {
          // 使用 media:// 协议加载本地文件
          const audioSrc = `media://${audioInfo.path}`;

          audioRef.current = new Audio(audioSrc);

          // 设置事件监听
          audioRef.current.addEventListener('ended', () => {
            setPlaying(false);
            setCurrentTime(-1);
            if (animFrameRef.current) {
              cancelAnimationFrame(animFrameRef.current);
            }
          });

          audioRef.current.addEventListener('error', (e) => {
            console.error('Audio error:', e);
            toast.error('文件加载失败');
            setPlaying(false);
          });

          // 等待音频加载
          await new Promise((resolve, reject) => {
            audioRef.current!.addEventListener('canplay', resolve, {
              once: true,
            });
            audioRef.current!.addEventListener('error', reject, { once: true });
            audioRef.current!.load();
          });
        }

        await audioRef.current.play();
        setPlaying(true);

        // 更新播放位置
        const updateProgress = () => {
          if (audioRef.current && !audioRef.current.paused) {
            setCurrentTime(audioRef.current.currentTime);
            animFrameRef.current = requestAnimationFrame(updateProgress);
          }
        };
        updateProgress();
      } catch (error) {
        console.error('Play error:', error);
        toast.error('播放失败');
      }
    }
  }, [audioInfo, playing]);

  // 跳转到指定时间
  const seekTo = useCallback(
    (time: number) => {
      if (!audioRef.current) {
        // 如果还没有创建音频对象，先创建
        if (audioInfo) {
          const audioSrc = `media://${audioInfo.path}`;
          audioRef.current = new Audio(audioSrc);
          audioRef.current.addEventListener('ended', () => {
            setPlaying(false);
            setCurrentTime(-1);
          });
        } else {
          return;
        }
      }
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    },
    [audioInfo],
  );

  const handleTimeClick = useCallback(
    (time: number) => {
      seekTo(time);
      toast.info(`跳转到 ${formatSeconds(time)}`);
    },
    [seekTo],
  );

  const handleCut = useCallback(async () => {
    if (!audioInfo) return;

    const times: number[] = [];
    for (const cp of cutPoints) {
      if (!cp.trim()) continue;
      const t = parseTimeInput(cp);
      if (t === null) {
        toast.error(`无效时间格式: ${cp}`);
        return;
      }
      if (t <= 0 || t >= audioInfo.duration) {
        toast.error(`时间点超出范围: ${cp}`);
        return;
      }
      times.push(t);
    }

    if (times.length === 0) {
      toast.error('请至少输入一个切割点');
      return;
    }

    setCutting(true);
    setProgress(null);
    setResults([]);

    const unsub = window.ipc.on(
      'audioCut:progress',
      (data: { current: number; total: number; percent: number }) => {
        setProgress(data);
      },
    );

    const res = await window.ipc.invoke('audioCut:cut', {
      filePath: audioInfo.path,
      cutPoints: times,
    });

    unsub();
    setCutting(false);
    setProgress(null);

    if (res.success) {
      setResults(res.data);
      toast.success(`裁切完成，共 ${res.data.length} 个片段`);
    } else {
      toast.error(res.error);
    }
  }, [audioInfo, cutPoints]);

  const handleOpenFolder = useCallback((filePath: string) => {
    window.ipc.invoke('audioCut:openFolder', { filePath });
  }, []);

  return (
    <div className="flex flex-col gap-4 h-full overflow-auto p-4">
      {/* 文件选择 */}
      <div
        className={`flex items-center gap-3 p-4 border-2 rounded-lg cursor-pointer transition-colors ${
          dragging
            ? 'border-primary bg-primary/5'
            : 'border-dashed border-muted-foreground/25 hover:border-muted-foreground/50'
        }`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onClick={handleSelectFile}
      >
        <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
          {audioInfo ? (
            <FileVideo className="h-5 w-5 text-muted-foreground" />
          ) : (
            <Upload className="h-5 w-5 text-muted-foreground" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          {audioInfo ? (
            <div>
              <div className="font-medium truncate">{audioInfo.fileName}</div>
              <div className="text-sm text-muted-foreground">
                {audioInfo.format} · 时长 {formatSeconds(audioInfo.duration)}
              </div>
            </div>
          ) : (
            <div className="text-muted-foreground">
              拖放音频或视频文件到这里，或点击选择
            </div>
          )}
        </div>
        {audioInfo && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={(e) => {
              e.stopPropagation();
              setAudioInfo(null);
              setCutPoints(['']);
              setResults([]);
              setStartWaveform([]);
              setEndWaveform([]);
              setSilenceData(null);
              setKeyframes([]);
              setCurrentTime(-1);
              setPlaying(false);
              if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current.src = '';
                audioRef.current = null;
              }
            }}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* 检测中提示 */}
      {detecting && (
        <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">正在分析波形和静音区域...</span>
        </div>
      )}

      {/* 波形显示和播放控制 */}
      {(startWaveform.length > 0 || endWaveform.length > 0) && audioInfo && (
        <div className="border rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="font-medium text-sm">波形（开头/结尾各3分钟）</div>
            <div className="flex items-center gap-2">
              {/* 播放按钮 */}
              <Button
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={togglePlay}
              >
                {playing ? (
                  <Pause className="h-4 w-4" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
              </Button>
              {/* 当前播放时间 */}
              {currentTime >= 0 && (
                <span className="text-sm text-muted-foreground min-w-[80px]">
                  {formatSeconds(currentTime)}
                </span>
              )}
            </div>
          </div>

          <WaveformCanvas
            startWaveform={startWaveform}
            endWaveform={endWaveform}
            silenceData={silenceData}
            keyframes={keyframes}
            duration={audioInfo.duration}
            checkDuration={checkDuration}
            currentTime={currentTime}
            onTimeClick={handleTimeClick}
          />

          {/* 图例 */}
          {silenceData && (
            <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 bg-red-500/20 rounded"></span>
                静音区域
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-2 bg-green-500 rounded"></span>
                开始: {formatSeconds(silenceData.audioStart)}
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-2 bg-blue-500 rounded"></span>
                结束: {formatSeconds(silenceData.audioEnd)}
              </span>
            </div>
          )}
          {keyframes.length > 0 && (
            <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="text-yellow-500">▼</span>
                关键帧: 共 {keyframes.length} 个
              </span>
              <span className="text-yellow-500/70">
                开头: {keyframes.filter((kf) => kf < checkDuration).map((kf) => formatSeconds(Math.round(kf * 1000) / 1000)).slice(0, 5).join(', ')}
                {keyframes.filter((kf) => kf < checkDuration).length > 5 ? ' ...' : ''}
              </span>
              <span className="text-yellow-500/70">
                结尾: {keyframes.filter((kf) => kf > audioInfo.duration - checkDuration).map((kf) => formatSeconds(Math.round(kf * 1000) / 1000)).slice(-5).join(', ')}
              </span>
            </div>
          )}
        </div>
      )}

      {/* 切割点 */}
      {audioInfo && (
        <div className="border rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="font-medium flex items-center gap-2">
              <Scissors className="h-4 w-4" />
              切割点
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1"
                onClick={async () => {
                  setDetecting(true);
                  try {
                    const res = await window.ipc.invoke(
                      'audioCut:detectSilence',
                      {
                        filePath: audioInfo.path,
                      },
                    );
                    if (res.success) {
                      setSilenceData(res.data);
                      const { audioStart, audioEnd } = res.data;
                      const points: string[] = [];
                      if (audioStart > 0.1)
                        points.push(formatSeconds(audioStart));
                      if (audioEnd < audioInfo.duration - 0.1)
                        points.push(formatSeconds(audioEnd));
                      setCutPoints(points);
                      toast.success('已重新检测静音区域');
                    }
                  } finally {
                    setDetecting(false);
                  }
                }}
              >
                <Wand2 className="h-3.5 w-3.5" />
                自动检测
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1"
                onClick={handleAddPoint}
              >
                <Plus className="h-3.5 w-3.5" />
                手动添加
              </Button>
            </div>
          </div>

          <div className="text-sm text-muted-foreground mb-3">
            点击波形图可跳转播放位置，或手动输入时间点（格式：时:分:秒）
          </div>

          <div className="flex flex-col gap-2">
            {cutPoints.map((cp, i) => (
              <React.Fragment key={i}>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground w-16 flex-shrink-0">
                    切割点 {i + 1}
                  </span>
                  <input
                    type="text"
                    placeholder="00:00:00.0"
                    value={cp}
                    onChange={(e) => handlePointChange(i, e.target.value)}
                    className="flex-1 h-8 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => {
                      const t = parseTimeInput(cp);
                      if (t !== null) seekTo(t);
                    }}
                  >
                    跳转
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => handleRemovePoint(i)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {(() => {
                  const t = parseTimeInput(cp);
                  if (t === null || keyframes.length === 0) return null;
                  let prev: number | null = null;
                  let next: number | null = null;
                  for (const kf of keyframes) {
                    if (kf <= t) prev = kf;
                    if (kf > t && next === null) next = kf;
                  }
                  if (prev === null && next === null) return null;
                  return (
                    <div className="flex items-center gap-2 ml-16 mb-1 text-xs text-muted-foreground">
                      <span className="text-yellow-500">◆</span>
                      关键帧:
                      {prev !== null && (
                        <button
                          className="text-yellow-600 hover:underline cursor-pointer"
                          onClick={() =>
                            handlePointChange(
                              i,
                              formatSeconds(Math.round(prev! * 1000) / 1000),
                            )
                          }
                          title="跳到此关键帧（快速裁切）"
                        >
                          ← {formatSeconds(Math.round(prev * 1000) / 1000)}
                        </button>
                      )}
                      {prev !== null && next !== null && <span>|</span>}
                      {next !== null && (
                        <button
                          className="text-yellow-600 hover:underline cursor-pointer"
                          onClick={() =>
                            handlePointChange(
                              i,
                              formatSeconds(Math.round(next! * 1000) / 1000),
                            )
                          }
                          title="跳到此关键帧（快速裁切）"
                        >
                          {formatSeconds(Math.round(next * 1000) / 1000)} →
                        </button>
                      )}
                    </div>
                  );
                })()}
              </React.Fragment>
            ))}
          </div>

          {cutPoints.filter((c) => c.trim()).length > 0 && (
            <div className="mt-3 text-sm text-muted-foreground">
              将生成 {cutPoints.filter((c) => c.trim()).length + 1} 个片段
            </div>
          )}
        </div>
      )}

      {/* 同时分离音频 */}
      {audioInfo && audioInfo.format.match(/MP4|MKV|AVI|MOV|WEBM|TS/i) && (
        <div className="flex items-center gap-2 px-1">
          <input
            type="checkbox"
            id="extractAudio"
            checked={extractAudio}
            onChange={(e) => setExtractAudio(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300"
          />
          <label htmlFor="extractAudio" className="text-sm text-muted-foreground cursor-pointer">
            同时分离音频（从视频中提取 .m4a 音频文件）
          </label>
        </div>
      )}

      {/* 操作按钮 */}
      {audioInfo && (
        <Button
          onClick={handleCut}
          disabled={cutting || cutPoints.every((c) => !c.trim())}
          className="w-full gap-2"
        >
          {cutting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              裁切中...
              {progress && ` (${progress.current}/${progress.total})`}
            </>
          ) : (
            <>
              <Scissors className="h-4 w-4" />
              开始裁切
            </>
          )}
        </Button>
      )}

      {/* 进度条 */}
      {cutting && progress && (
        <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
          <div
            className="bg-primary h-full transition-all duration-300"
            style={{
              width: `${((progress.current - 1) / progress.total) * 100 + progress.percent / progress.total}%`,
            }}
          />
        </div>
      )}

      {/* 结果列表 */}
      {results.length > 0 && (
        <div className="border rounded-lg p-4">
          <div className="font-medium mb-3">裁切结果</div>
          <div className="flex flex-col gap-2">
            {results.map((r) => (
              <div
                key={r.index}
                className="flex items-center gap-2 text-sm p-2 rounded bg-muted/50"
              >
                <span className="font-medium w-8">#{r.index}</span>
                <span className="text-muted-foreground flex-1 truncate">
                  {formatSeconds(r.startTime)} → {formatSeconds(r.endTime)}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 text-xs"
                  onClick={() => handleOpenFolder(r.outputPath)}
                >
                  <FolderOpen className="h-3 w-3" />
                  打开目录
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
