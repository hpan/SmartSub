/**
 * 视频裁片面板
 * 支持播放预览、设定起止时间、截取片段、拖拽上传
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Scissors,
  FolderOpen,
  Play,
  Pause,
  Loader2,
  CheckCircle2,
  AlertCircle,
  SkipBack,
  SkipForward,
  RotateCcw,
  Film,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { cn } from 'lib/utils';

interface VideoInfo {
  path: string;
  fileName: string;
  width: number;
  height: number;
  duration: number;
  format: string;
}

function fmtTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '00:00.000';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0
    ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`
    : `${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
}

function parseTime(str: string): number | null {
  const parts = str.split(':').map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return null;
}

export default function VideoTrimPanel() {
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const [startInput, setStartInput] = useState('00:00.000');
  const [endInput, setEndInput] = useState('00:00.000');
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [trimming, setTrimming] = useState(false);
  const [progress, setProgress] = useState(0);
  const [outputPath, setOutputPath] = useState('');
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [dragStart, setDragStart] = useState<number | null>(null);
  const [dragEnd, setDragEnd] = useState<number | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const playMode = useRef<'idle' | 'full' | 'range'>('idle');

  // 监听进度
  useEffect(() => {
    const unsub = window.ipc.on(
      'videoTrim:progress',
      (data: { percent: number }) => {
        setProgress(data.percent);
      },
    );
    return unsub;
  }, []);

  // 全局键盘快捷键（仅在视频已加载且焦点不在输入框时生效）
  useEffect(() => {
    if (!videoInfo) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (e.code === 'Space') {
        e.preventDefault();
        if (playMode.current === 'range') {
          handlePreview();
        } else {
          togglePlay();
        }
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        if (videoRef.current) {
          const t = Math.max(0, videoRef.current.currentTime - 1);
          videoRef.current.currentTime = t;
          setCurrentTime(t);
        }
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        if (videoRef.current) {
          const t = Math.min(
            videoInfo.duration,
            videoRef.current.currentTime + 1,
          );
          videoRef.current.currentTime = t;
          setCurrentTime(t);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [videoInfo, playing]);

  useEffect(() => {
    if (videoInfo) {
      setStartInput(fmtTime(startTime));
      setEndInput(fmtTime(endTime));
    }
  }, [startTime, endTime, videoInfo]);

  const handleTimeUpdate = useCallback(() => {
    if (!videoRef.current) return;
    const t = videoRef.current.currentTime;
    setCurrentTime(t);
    if (playMode.current === 'range' && t >= endTime) {
      playMode.current = 'idle';
      videoRef.current.pause();
      setPreviewPlaying(false);
    }
  }, [endTime]);

  // 加载视频文件（供拖拽和选择共用）
  const loadVideoFile = async (filePath: string) => {
    setError('');
    setOutputPath('');
    const result = await window.ipc.invoke('videoTrim:getInfo', { filePath });
    if (result?.success && result.data) {
      const info = result.data as VideoInfo;
      setVideoInfo(info);
      setStartTime(0);
      setEndTime(info.duration);
      setCurrentTime(0);
      setDragStart(null);
      setDragEnd(null);
    } else {
      setError(result?.error || '读取视频信息失败');
    }
  };

  // 选择文件
  const handleSelectFile = async () => {
    setError('');
    setOutputPath('');
    const result = await window.ipc.invoke('videoTrim:selectFile');
    if (result?.success && result.data) {
      const info = result.data as VideoInfo;
      setVideoInfo(info);
      setStartTime(0);
      setEndTime(info.duration);
      setCurrentTime(0);
      setDragStart(null);
      setDragEnd(null);
    }
  };

  // 拖拽相关
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    const videoFile = files.find((f) =>
      /\.(mp4|mkv|avi|mov|webm|ts|mts|flv)$/i.test(f.name),
    );
    if (videoFile) {
      const filePath = window.ipc.getPathForFile(videoFile);
      await loadVideoFile(filePath);
    } else {
      setError('请拖入视频文件（mp4/mkv/avi/mov/webm/ts/flv）');
    }
  };

  // 全片播放/暂停
  const togglePlay = () => {
    if (!videoRef.current) return;
    if (playMode.current === 'full') {
      playMode.current = 'idle';
      videoRef.current.pause();
      setPlaying(false);
    } else {
      if (playMode.current === 'range') {
        setPreviewPlaying(false);
      }
      playMode.current = 'full';
      videoRef.current.currentTime = 0;
      videoRef.current.play();
      setPlaying(true);
    }
  };

  // 区间预览/停止
  const handlePreview = () => {
    if (!videoRef.current) return;
    if (playMode.current === 'range') {
      playMode.current = 'idle';
      videoRef.current.pause();
      setPreviewPlaying(false);
    } else {
      if (playMode.current === 'full') {
        setPlaying(false);
      }
      playMode.current = 'range';
      videoRef.current.currentTime = startTime;
      setPreviewPlaying(true);
      videoRef.current.play();
    }
  };

  const seekToStart = () => {
    if (videoRef.current) {
      videoRef.current.currentTime = startTime;
      setCurrentTime(startTime);
    }
  };
  const seekToEnd = () => {
    if (videoRef.current) {
      videoRef.current.currentTime = endTime;
      setCurrentTime(endTime);
    }
  };
  const markStart = () => {
    setStartTime(Math.min(Math.max(0, currentTime), endTime - 0.1));
  };
  const markEnd = () => {
    setEndTime(
      Math.max(
        Math.min(videoInfo?.duration || 0, currentTime),
        startTime + 0.1,
      ),
    );
  };

  const handleStartInputChange = (v: string) => {
    setStartInput(v);
    const t = parseTime(v);
    if (t !== null && t >= 0 && t < endTime) setStartTime(t);
  };

  const handleEndInputChange = (v: string) => {
    setEndInput(v);
    const t = parseTime(v);
    if (t !== null && t > startTime && t <= (videoInfo?.duration || 0))
      setEndTime(t);
  };

  // 起始时间输入框键盘微调（上/下 = ±100ms）
  const handleStartInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const next = Math.min(
        startTime + 0.1,
        endTime - 0.1,
        videoInfo?.duration || 0,
      );
      const val = Math.round(next * 1000) / 1000;
      setStartTime(val);
      if (videoRef.current) {
        videoRef.current.currentTime = val;
        setCurrentTime(val);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = Math.max(0, startTime - 0.1);
      const val = Math.round(next * 1000) / 1000;
      setStartTime(val);
      if (videoRef.current) {
        videoRef.current.currentTime = val;
        setCurrentTime(val);
      }
    }
  };

  // 结束时间输入框键盘微调（上/下 = ±100ms）
  const handleEndInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const next = Math.min(endTime + 0.1, videoInfo?.duration || 0);
      const val = Math.round(next * 1000) / 1000;
      setEndTime(val);
      if (videoRef.current) {
        videoRef.current.currentTime = val;
        setCurrentTime(val);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = Math.max(startTime + 0.1, endTime - 0.1);
      const val = Math.round(next * 1000) / 1000;
      setEndTime(val);
      if (videoRef.current) {
        videoRef.current.currentTime = val;
        setCurrentTime(val);
      }
    }
  };

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!videoRef.current || !timelineRef.current || !videoInfo) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const t = ((e.clientX - rect.left) / rect.width) * videoInfo.duration;
    const ct = Math.max(0, Math.min(videoInfo.duration, t));
    videoRef.current.currentTime = ct;
    setCurrentTime(ct);
  };

  const handleTimelineMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!timelineRef.current || !videoInfo) return;
    const rect = timelineRef.current.getBoundingClientRect();
    setDragStart(((e.clientX - rect.left) / rect.width) * videoInfo.duration);
    setDragEnd(((e.clientX - rect.left) / rect.width) * videoInfo.duration);
  };

  const handleTimelineMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (dragStart === null || !timelineRef.current || !videoInfo) return;
    const rect = timelineRef.current.getBoundingClientRect();
    setDragEnd(
      Math.max(
        0,
        Math.min(
          videoInfo.duration,
          ((e.clientX - rect.left) / rect.width) * videoInfo.duration,
        ),
      ),
    );
  };

  const handleTimelineMouseUp = () => {
    if (dragStart !== null && dragEnd !== null && videoInfo) {
      const s = Math.min(dragStart, dragEnd);
      const e = Math.max(dragStart, dragEnd);
      if (e - s > 0.5) {
        setStartTime(Math.max(0, s));
        setEndTime(Math.min(videoInfo.duration, e));
      }
    }
    setDragStart(null);
    setDragEnd(null);
  };

  const handleReset = () => {
    if (videoInfo) {
      setStartTime(0);
      setEndTime(videoInfo.duration);
    }
  };

  // 执行裁片
  const handleTrim = async () => {
    if (!videoInfo) return;
    setTrimming(true);
    setProgress(0);
    setError('');
    setOutputPath('');

    const ext = videoInfo.fileName.includes('.')
      ? videoInfo.fileName.substring(videoInfo.fileName.lastIndexOf('.'))
      : '.mp4';
    const baseName = videoInfo.fileName.replace(ext, '');
    const outName = `${baseName}_trimmed${ext}`;

    const outDir = await window.ipc.invoke('videoTrim:selectOutputDir');
    if (!outDir) {
      setTrimming(false);
      return;
    }

    const out = `${outDir}/${outName}`;
    const result = await window.ipc.invoke('videoTrim:trim', {
      inputPath: videoInfo.path,
      outputPath: out,
      startTime,
      endTime,
      duration: videoInfo.duration,
    });

    setTrimming(false);
    if (result?.success) setOutputPath(result.outputPath);
    else setError(result?.error || '裁片失败');
  };

  const handleReveal = async () => {
    if (outputPath)
      await window.ipc.invoke('videoTrim:revealFile', { filePath: outputPath });
  };

  const trimDuration = endTime - startTime;
  const progressPct = videoInfo ? (currentTime / videoInfo.duration) * 100 : 0;
  const startPct = videoInfo ? (startTime / videoInfo.duration) * 100 : 0;
  const endPct = videoInfo ? (endTime / videoInfo.duration) * 100 : 0;

  return (
    <div
      className="flex flex-col gap-4 h-full"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* 顶部：文件选择 + 信息 */}
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={handleSelectFile}>
          <FolderOpen className="h-4 w-4 mr-1" /> 选择视频
        </Button>
        {videoInfo && (
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="text-foreground font-medium truncate max-w-[300px]">
              {videoInfo.fileName}
            </span>
            <span>
              {videoInfo.width}×{videoInfo.height}
            </span>
            <span>总时长 {fmtTime(videoInfo.duration)}</span>
          </div>
        )}
      </div>

      {!videoInfo ? (
        <div
          className={cn(
            'flex-1 flex flex-col items-center justify-center border-2 border-dashed rounded-lg transition-colors cursor-pointer',
            dragOver
              ? 'border-primary bg-primary/5'
              : 'border-muted-foreground/25 text-muted-foreground',
          )}
          onClick={handleSelectFile}
        >
          <Film className="h-12 w-12 mb-3 opacity-40" />
          <p className="text-sm">
            {dragOver ? '松开以加载视频' : '拖拽视频文件到此处，或点击选择'}
          </p>
          <p className="text-xs mt-1 opacity-60">
            支持 mp4 / mkv / avi / mov / webm / ts / flv
          </p>
        </div>
      ) : (
        <>
          {/* 视频播放器 */}
          <div
            className="relative bg-black rounded-lg overflow-hidden flex items-center justify-center"
            style={{ minHeight: 320 }}
          >
            <video
              ref={videoRef}
              src={`media://${videoInfo.path}`}
              className="max-w-full max-h-[450px] object-contain"
              onTimeUpdate={handleTimeUpdate}
              onPlay={() => {
                if (playMode.current === 'full') setPlaying(true);
              }}
              onPause={() => {
                if (playMode.current === 'full') setPlaying(false);
              }}
              onEnded={() => {
                if (playMode.current === 'full') {
                  setPlaying(false);
                  playMode.current = 'idle';
                }
                if (playMode.current === 'range') {
                  setPreviewPlaying(false);
                  playMode.current = 'idle';
                }
              }}
            />
          </div>

          {/* 时间轴 */}
          <div className="flex flex-col gap-1">
            <div
              ref={timelineRef}
              className="relative h-8 bg-muted rounded cursor-pointer select-none"
              onClick={handleTimelineClick}
              onMouseDown={handleTimelineMouseDown}
              onMouseMove={handleTimelineMouseMove}
              onMouseUp={handleTimelineMouseUp}
              onMouseLeave={handleTimelineMouseUp}
            >
              <div
                className="absolute top-0 bottom-0 bg-primary/20 border-y-2 border-primary/60"
                style={{ left: `${startPct}%`, width: `${endPct - startPct}%` }}
              />
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-yellow-400 z-10"
                style={{ left: `${progressPct}%` }}
              />
              <div
                className="absolute top-0 bottom-0 w-1 bg-green-500 z-10"
                style={{ left: `${startPct}%` }}
                title="起始点"
              />
              <div
                className="absolute top-0 bottom-0 w-1 bg-red-500 z-10"
                style={{ left: `${endPct}%` }}
                title="结束点"
              />
              {dragStart !== null && dragEnd !== null && (
                <div
                  className="absolute top-0 bottom-0 bg-blue-400/30"
                  style={{
                    left: `${(Math.min(dragStart, dragEnd) / videoInfo.duration) * 100}%`,
                    width: `${(Math.abs(dragEnd - dragStart) / videoInfo.duration) * 100}%`,
                  }}
                />
              )}
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>{fmtTime(0)}</span>
              <span className="text-foreground font-medium">
                {fmtTime(currentTime)}
              </span>
              <span>{fmtTime(videoInfo.duration)}</span>
            </div>
          </div>

          {/* 播放控制 */}
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={togglePlay}
              className="w-20"
            >
              {playing ? (
                <>
                  <Pause className="h-4 w-4 mr-1" /> 暂停
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-1" /> 播放
                </>
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={seekToStart}
              title="跳转到起始点"
            >
              <SkipBack className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={seekToEnd}
              title="跳转到结束点"
            >
              <SkipForward className="h-4 w-4" />
            </Button>
            <div className="h-5 w-px bg-border mx-1" />
            <Button
              variant="secondary"
              size="sm"
              onClick={markStart}
              title="将当前时间设为起始点"
            >
              <Scissors className="h-4 w-4 mr-1" /> 设为起点
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={markEnd}
              title="将当前时间设为结束点"
            >
              <Scissors className="h-4 w-4 mr-1" /> 设为终点
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReset}
              title="重置为完整视频"
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
          </div>

          {/* 起止时间输入 */}
          <div className="flex items-end gap-6 flex-wrap">
            <div className="flex flex-col gap-1">
              <Label className="text-xs">起始时间</Label>
              <Input
                value={startInput}
                onChange={(e) => handleStartInputChange(e.target.value)}
                onKeyDown={handleStartInputKeyDown}
                className="h-8 text-xs font-mono w-32"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">结束时间</Label>
              <Input
                value={endInput}
                onChange={(e) => handleEndInputChange(e.target.value)}
                onKeyDown={handleEndInputKeyDown}
                className="h-8 text-xs font-mono w-32"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">截取时长</Label>
              <div className="h-8 flex items-center text-sm font-mono text-foreground">
                {fmtTime(trimDuration)}
              </div>
            </div>
            <Button
              variant={previewPlaying ? 'default' : 'outline'}
              size="sm"
              onClick={handlePreview}
              disabled={trimDuration <= 0}
              title="预览选取的区间"
            >
              {previewPlaying ? (
                <>
                  <Pause className="h-4 w-4 mr-1" /> 停止
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-1" /> 预览
                </>
              )}
            </Button>
            <div className="flex-1" />
            <Button
              onClick={handleTrim}
              disabled={trimming || trimDuration <= 0}
              className="min-w-28"
            >
              {trimming ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" /> {progress}%
                </>
              ) : (
                <>
                  <Scissors className="h-4 w-4 mr-1" /> 执行裁片
                </>
              )}
            </Button>
          </div>

          {/* 结果/错误 */}
          {error && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" /> {error}
            </div>
          )}
          {outputPath && (
            <div className="flex items-center gap-2 text-sm text-green-600">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span className="truncate flex-1">{outputPath}</span>
              <Button variant="ghost" size="sm" onClick={handleReveal}>
                打开文件
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
