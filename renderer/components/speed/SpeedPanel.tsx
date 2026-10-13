/**
 * 变速面板
 * 支持音频/视频变速，预设倍速和自定义倍速
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  Gauge,
  FolderOpen,
  Play,
  Pause,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { cn } from 'lib/utils';

interface MediaInfo {
  path: string;
  fileName: string;
  duration: number;
  type: 'audio' | 'video';
}

const PRESET_SPEEDS = [
  { label: '1.1x', value: 1.1 },
  { label: '1.25x', value: 1.25 },
  { label: '1.35x', value: 1.35 },
  { label: '1.5x', value: 1.5 },
  { label: '2x', value: 2 },
];

export default function SpeedPanel() {
  const [file, setFile] = useState<MediaInfo | null>(null);
  const [speed, setSpeed] = useState(1.25);
  const [customSpeed, setCustomSpeed] = useState('1.25');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [outputPath, setOutputPath] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 格式化时间
  const formatTime = (seconds: number) => {
    if (!isFinite(seconds) || seconds < 0) return '0:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${m}:${String(s).padStart(2, '0')}`;
  };

  // 计算变速后的时长
  const getNewDuration = () => {
    if (!file || speed <= 0) return null;
    return file.duration / speed;
  };

  const loadFileInfo = useCallback(async (filePath: string) => {
    try {
      const result = await window.ipc.invoke('speed:getInfo', { filePath });
      if (!result || !result.success) {
        setError(result?.error || '无法读取文件信息');
        return;
      }
      const info = result.data as MediaInfo;
      setFile(info);
      setDuration(info.duration);
      setError(null);
      setOutputPath(null);
      setSpeed(1.25);
      setCustomSpeed('1.25');
      setCurrentTime(0);
      setIsPlaying(false);
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
        audioRef.current = null;
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    } catch (err) {
      setError('无法读取文件信息');
    }
  }, []);

  const handleSelectFile = useCallback(async () => {
    try {
      const result = await window.ipc.invoke('speed:selectFile');
      if (!result || !result.success) {
        if (result?.error) setError(result.error);
        return;
      }
      const info = result.data as MediaInfo;
      setFile(info);
      setDuration(info.duration);
      setError(null);
      setOutputPath(null);
      setSpeed(1.25);
      setCustomSpeed('1.25');
      setCurrentTime(0);
      setIsPlaying(false);
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
        audioRef.current = null;
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    } catch (err) {
      setError('无法读取文件信息');
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragging(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;
      const filePath = window.ipc.getPathForFile(files[0]);
      const ext = filePath.split('.').pop()?.toLowerCase() || '';
      const supportedExts = [
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
      ];
      if (!supportedExts.includes(ext)) {
        setError('不支持的文件格式');
        return;
      }
      await loadFileInfo(filePath);
    },
    [loadFileInfo],
  );

  // 播放/暂停
  const togglePlay = useCallback(async () => {
    if (!file) return;
    if (isPlaying) {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setIsPlaying(false);
    } else {
      try {
        if (!audioRef.current) {
          const audioSrc = `media://${file.path}`;
          const audio = new Audio(audioSrc);
          audioRef.current = audio;
        }
        audioRef.current.playbackRate = speed;
        await audioRef.current.play();
        setIsPlaying(true);
        timerRef.current = setInterval(() => {
          if (audioRef.current) {
            setCurrentTime(audioRef.current.currentTime);
            if (audioRef.current.ended) {
              setIsPlaying(false);
              setCurrentTime(0);
              if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
              }
            }
          }
        }, 100);
      } catch (err) {
        console.error('播放失败:', err);
        setError('播放失败');
      }
    }
  }, [file, isPlaying, speed]);

  // 空格键控制播放/暂停
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && file && !processing) {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [file, processing, togglePlay]);

  const handleSpeedChange = useCallback((value: number) => {
    setSpeed(value);
    setCustomSpeed(value.toString());
    if (audioRef.current) {
      audioRef.current.playbackRate = value;
    }
  }, []);

  const handleCustomSpeedChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setCustomSpeed(value);
      const numValue = parseFloat(value);
      if (!isNaN(numValue) && numValue > 0 && numValue <= 3) {
        setSpeed(numValue);
        if (audioRef.current) {
          audioRef.current.playbackRate = numValue;
        }
      }
    },
    [],
  );

  const handleGenerate = useCallback(async () => {
    if (!file) return;
    setProcessing(true);
    setProgress(0);
    setError(null);
    setOutputPath(null);
    const unsub = window.ipc.on(
      'speed:progress',
      (_event, data: { percent: number }) => {
        setProgress(data.percent);
      },
    );
    try {
      const result = await window.ipc.invoke('speed:change', {
        inputPath: file.path,
        speed,
      });
      if (result.success) {
        setOutputPath(result.outputPath);
      } else {
        setError(result.error || '变速失败');
      }
    } catch (err) {
      setError('变速处理失败');
    } finally {
      setProcessing(false);
      unsub();
    }
  }, [file, speed]);

  const newDuration = getNewDuration();

  return (
    <div ref={containerRef} className="space-y-4" tabIndex={0}>
      <div className="space-y-2">
        <Label>选择音频/视频文件</Label>
        <div
          className={cn(
            'border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors',
            'hover:border-primary/50 hover:bg-primary/5',
            dragging
              ? 'border-primary bg-primary/10'
              : file
                ? 'border-green-500/50 bg-green-500/5'
                : 'border-muted-foreground/25',
          )}
          onClick={handleSelectFile}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {file ? (
            <div className="space-y-1">
              <Gauge className="h-8 w-8 mx-auto text-green-500" />
              <p className="text-sm font-medium">{file.fileName}</p>
              <p className="text-xs text-muted-foreground">
                {file.type === 'video' ? '视频' : '音频'} · 原时长{' '}
                {formatTime(file.duration)}
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              <FolderOpen className="h-8 w-8 mx-auto text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {dragging ? '释放文件到这里' : '点击或拖拽文件到这里'}
              </p>
              <p className="text-xs text-muted-foreground">
                支持 MP3, WAV, M4A, AAC, MP4, MKV, AVI, MOV 等
              </p>
            </div>
          )}
        </div>
      </div>

      {file && (
        <div className="space-y-3">
          <Label>倍速</Label>
          <div className="flex flex-wrap items-center gap-2">
            {PRESET_SPEEDS.map((preset) => (
              <Button
                key={preset.value}
                variant={speed === preset.value ? 'default' : 'outline'}
                size="sm"
                onClick={() => handleSpeedChange(preset.value)}
              >
                {preset.label}
              </Button>
            ))}
            <div className="flex items-center gap-1 ml-2">
              <Input
                type="number"
                min="0.5"
                max="3"
                step="0.05"
                value={customSpeed}
                onChange={handleCustomSpeedChange}
                placeholder="自定义"
                className="w-20 h-8 text-sm"
              />
              <span className="text-xs text-muted-foreground">x</span>
            </div>
            {newDuration && (
              <span className="text-xs text-muted-foreground ml-2">
                变速后: {formatTime(newDuration)}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 bg-muted rounded-lg p-2">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={togglePlay}
            >
              {isPlaying ? (
                <Pause className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )}
            </Button>
            <div className="flex-1 text-xs text-muted-foreground">
              {formatTime(currentTime)} / {formatTime(duration)}
            </div>
            <div className="text-xs font-medium px-2">{speed}x</div>
            <span className="text-[10px] text-muted-foreground">
              空格播放/暂停
            </span>
          </div>

          <Button
            onClick={handleGenerate}
            disabled={processing}
            className="w-full"
          >
            {processing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                处理中 {progress > 0 && `${progress}%`}
              </>
            ) : (
              <>
                <Gauge className="h-4 w-4 mr-2" />
                生成变速文件
              </>
            )}
          </Button>

          {error && (
            <div className="flex items-center gap-2 text-red-500 text-sm">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}

          {outputPath && (
            <div className="flex items-center gap-2 text-green-500 text-sm">
              <CheckCircle2 className="h-4 w-4" />
              <span className="flex-1 truncate">
                {outputPath.split('/').pop()}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  window.ipc.invoke('speed:revealFile', {
                    filePath: outputPath,
                  })
                }
              >
                打开
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
