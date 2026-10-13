import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Upload,
  Play,
  Pause,
  SkipForward,
  SkipBack,
  Star,
  HelpCircle,
  Trash2,
  Loader2,
  Volume2,
  ChevronRight,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';

interface WatermarkSegment {
  start: number;
  end: number;
  duration: number;
  energyRatio: number;
  centroidRatio?: number;
}

interface FileEntry {
  filePath: string;
  fileName: string;
  duration: number;
  watermarks: WatermarkSegment[];
  role: 'primary' | 'reference' | 'unassigned';
  analyzing: boolean;
}

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

/** 单个文件卡片 */
function FileCard({
  entry,
  isActive,
  playingWmIdx,
  onSelectRole,
  onRemove,
  onSetActive,
  onPlayWm,
  onStop,
}: {
  entry: FileEntry;
  isActive: boolean;
  playingWmIdx: number | null;
  onSelectRole: (role: 'primary' | 'reference' | 'unassigned') => void;
  onRemove: () => void;
  onSetActive: () => void;
  onPlayWm: (idx: number) => void;
  onStop: () => void;
}) {
  const roleLabel =
    entry.role === 'primary'
      ? '主文件'
      : entry.role === 'reference'
        ? '参考'
        : '';
  const roleColor =
    entry.role === 'primary'
      ? 'bg-blue-600 text-white'
      : entry.role === 'reference'
        ? 'bg-emerald-600 text-white'
        : '';

  return (
    <div
      className={`rounded-lg border p-3 transition-all cursor-pointer ${
        isActive
          ? 'border-primary bg-primary/5 shadow-sm'
          : 'border-border hover:border-muted-foreground/30'
      }`}
      onClick={onSetActive}
    >
      {/* 头部：文件名 + 角色标签 + 删除 */}
      <div className="flex items-center gap-2 mb-2">
        {roleLabel && (
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${roleColor}`}
          >
            {roleLabel}
          </span>
        )}
        <span
          className="text-sm font-medium truncate flex-1"
          title={entry.filePath}
        >
          {entry.fileName}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </div>

      {/* 时长 + 水印数量 */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground mb-2">
        <span>时长 {fmtTime(entry.duration)}</span>
        {entry.analyzing ? (
          <span className="flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" /> 检测中...
          </span>
        ) : (
          <span
            className={
              entry.watermarks.length > 0
                ? 'text-orange-500 font-medium'
                : 'text-green-600'
            }
          >
            {entry.watermarks.length > 0
              ? `发现 ${entry.watermarks.length} 处水印`
              : '未检测到水印'}
          </span>
        )}
      </div>

      {/* 角色选择 */}
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-xs text-muted-foreground">设为:</span>
        <Button
          variant={entry.role === 'primary' ? 'default' : 'outline'}
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={(e) => {
            e.stopPropagation();
            onSelectRole('primary');
          }}
        >
          <Star className="h-3 w-3 mr-0.5" /> 主文件
        </Button>
        <Button
          variant={entry.role === 'reference' ? 'default' : 'outline'}
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={(e) => {
            e.stopPropagation();
            onSelectRole(
              entry.role === 'reference' ? 'unassigned' : 'reference',
            );
          }}
        >
          <HelpCircle className="h-3 w-3 mr-0.5" /> 参考
        </Button>
      </div>

      {/* 水印列表 */}
      {entry.watermarks.length > 0 && (
        <div className="flex flex-col gap-1 mt-1">
          {entry.watermarks.map((wm, idx) => (
            <div
              key={idx}
              className={`flex items-center gap-2 text-xs px-2 py-1 rounded ${
                playingWmIdx === idx
                  ? 'bg-orange-100 dark:bg-orange-900/30'
                  : 'bg-muted/50'
              }`}
            >
              <span className="text-muted-foreground w-5 text-right">
                #{idx + 1}
              </span>
              <span className="font-mono">
                {fmtTime(wm.start)} - {fmtTime(wm.end)}
              </span>
              <span className="text-muted-foreground">
                ({wm.duration.toFixed(1)}s)
              </span>
              <span className="text-orange-500">{wm.energyRatio}x</span>
              {wm.centroidRatio && wm.centroidRatio > 1.5 && (
                <span className="text-purple-500" title="频谱质心比">
                  🎵{wm.centroidRatio}x
                </span>
              )}
              <div className="flex-1" />
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                onClick={(e) => {
                  e.stopPropagation();
                  if (playingWmIdx === idx) {
                    onStop();
                  } else {
                    onPlayWm(idx);
                  }
                }}
                title={playingWmIdx === idx ? '停止' : '播放此段'}
              >
                {playingWmIdx === idx ? (
                  <Pause className="h-3 w-3" />
                ) : (
                  <Play className="h-3 w-3" />
                )}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 主面板 */
export default function ScrubPanel() {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playingWmIdx, setPlayingWmIdx] = useState<number | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [threshold, setThreshold] = useState('3.0');

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<number | null>(null);

  // 创建/获取 audio 元素
  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.addEventListener('ended', () => {
        setPlaying(false);
        setPlayingWmIdx(null);
      });
      audioRef.current.addEventListener('error', (e) => {
        console.error('[ScrubPanel] audio error:', e);
        setPlaying(false);
        setPlayingWmIdx(null);
      });
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // 更新播放时间
  useEffect(() => {
    if (playing) {
      timerRef.current = window.setInterval(() => {
        if (audioRef.current) {
          setCurrentTime(audioRef.current.currentTime);
        }
      }, 100);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [playing]);

  // 通用：加载音频并播放
  const loadAndPlay = useCallback(
    (filePath: string, seekTime: number, onReady?: () => void) => {
      if (!audioRef.current) return;
      const audio = audioRef.current;
      audio.pause();
      audio.src = `media://${filePath}`;
      audio.currentTime = seekTime;
      const onCanPlay = () => {
        audio.removeEventListener('canplay', onCanPlay);
        audio.removeEventListener('error', onErr);
        audio
          .play()
          .catch((err) => console.error('[ScrubPanel] play failed:', err));
        onReady?.();
      };
      const onErr = () => {
        audio.removeEventListener('canplay', onCanPlay);
        audio.removeEventListener('error', onErr);
        console.error('[ScrubPanel] load failed for:', filePath);
      };
      audio.addEventListener('canplay', onCanPlay, { once: true });
      audio.addEventListener('error', onErr, { once: true });
      audio.load();
    },
    [],
  );

  // 添加文件
  const handleAddFiles = useCallback(async () => {
    const result = await window.ipc.invoke('scrub:selectFiles');
    if (result.canceled || !result.files?.length) return;

    const newEntries: FileEntry[] = result.files.map((f: string) => ({
      filePath: f,
      fileName: f.split('/').pop() || f,
      duration: 0,
      watermarks: [],
      role: 'unassigned' as const,
      analyzing: true,
    }));

    setFiles((prev) => {
      const updated = [...prev, ...newEntries];
      if (activeIdx === null && updated.length > 0) setActiveIdx(0);
      return updated;
    });

    // 逐个分析
    for (const entry of newEntries) {
      const res = await window.ipc.invoke('scrub:analyze', entry.filePath, {
        threshold: parseFloat(threshold) || 3.0,
        maxDuration: 10,
        minGap: 15,
      });
      setFiles((prev) =>
        prev.map((f) =>
          f.filePath === entry.filePath
            ? {
                ...f,
                analyzing: false,
                duration: res.success ? res.data.duration : 0,
                watermarks: res.success ? res.data.watermarks : [],
              }
            : f,
        ),
      );
    }
  }, [threshold, activeIdx]);

  // 拖拽上传
  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      const paths: string[] = [];
      for (const file of Array.from(e.dataTransfer.files)) {
        // Electron 拖拽有 path 属性
        const p = (file as any).path;
        if (p) paths.push(p);
      }
      if (paths.length === 0) return;

      const newEntries: FileEntry[] = paths.map((f) => ({
        filePath: f,
        fileName: f.split('/').pop() || f,
        duration: 0,
        watermarks: [],
        role: 'unassigned' as const,
        analyzing: true,
      }));

      setFiles((prev) => {
        const updated = [...prev, ...newEntries];
        if (activeIdx === null && updated.length > 0) setActiveIdx(0);
        return updated;
      });

      for (const entry of newEntries) {
        const res = await window.ipc.invoke('scrub:analyze', entry.filePath, {
          threshold: parseFloat(threshold) || 3.0,
          maxDuration: 10,
          minGap: 15,
        });
        setFiles((prev) =>
          prev.map((f) =>
            f.filePath === entry.filePath
              ? {
                  ...f,
                  analyzing: false,
                  duration: res.success ? res.data.duration : 0,
                  watermarks: res.success ? res.data.watermarks : [],
                }
              : f,
          ),
        );
      }
    },
    [threshold, activeIdx],
  );

  // 播放全文件
  const handlePlayPause = useCallback(() => {
    if (!audioRef.current || activeIdx === null) return;
    const entry = files[activeIdx];
    if (!entry) return;

    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
    } else {
      setPlaying(true);
      setPlayingWmIdx(null);
      loadAndPlay(entry.filePath, currentTime);
    }
  }, [files, activeIdx, playing, currentTime, loadAndPlay]);

  // 播放某段水印
  const handlePlayWm = useCallback(
    (idx: number) => {
      if (!audioRef.current || activeIdx === null) return;
      const entry = files[activeIdx];
      if (!entry || !entry.watermarks[idx]) return;

      const wm = entry.watermarks[idx];
      loadAndPlay(entry.filePath, wm.start);
      setPlaying(true);
      setPlayingWmIdx(idx);
      setCurrentTime(wm.start);

      // 到水印结束位置自动暂停（多留1秒供判断）
      const stopAt = wm.end + 1;
      const checkEnd = () => {
        if (audioRef.current && audioRef.current.currentTime >= stopAt) {
          audioRef.current.pause();
          setPlaying(false);
          setPlayingWmIdx(null);
          audioRef.current.removeEventListener('timeupdate', checkEnd);
        }
      };
      audioRef.current.addEventListener('timeupdate', checkEnd);
    },
    [files, activeIdx, loadAndPlay],
  );

  // 停止播放
  const handleStop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setPlaying(false);
    setPlayingWmIdx(null);
    setCurrentTime(0);
  }, []);

  // 设置角色
  const handleSetRole = useCallback(
    (idx: number, role: 'primary' | 'reference' | 'unassigned') => {
      setFiles((prev) =>
        prev.map((f, i) => {
          if (role === 'primary' && f.role === 'primary')
            return { ...f, role: 'unassigned' };
          if (i === idx) return { ...f, role };
          return f;
        }),
      );
    },
    [],
  );

  // 移除文件
  const handleRemove = useCallback(
    (idx: number) => {
      setFiles((prev) => prev.filter((_, i) => i !== idx));
      if (activeIdx === idx) {
        setActiveIdx(null);
        handleStop();
      } else if (activeIdx !== null && activeIdx > idx)
        setActiveIdx(activeIdx - 1);
    },
    [activeIdx, handleStop],
  );

  const activeEntry = activeIdx !== null ? files[activeIdx] : null;
  const primaryFile = files.find((f) => f.role === 'primary');
  const refFile = files.find((f) => f.role === 'reference');

  return (
    <div className="flex h-full gap-4 overflow-hidden">
      {/* 左侧：文件列表 */}
      <div className="flex flex-col gap-3 w-[380px] shrink-0 overflow-auto">
        {/* 添加文件按钮 */}
        <div
          className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/20 p-6 hover:border-primary/40 transition-colors cursor-pointer"
          onClick={handleAddFiles}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
        >
          <Upload className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            点击或拖拽音频文件到这里
          </p>
          <p className="text-xs text-muted-foreground/60">
            支持 mp3, m4a, wav, flac 等格式
          </p>
        </div>

        {/* 检测参数 */}
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">灵敏度:</span>
          <Input
            type="text"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            className="w-16 h-7 text-xs text-center"
          />
          <span className="text-muted-foreground">倍（越低越灵敏）</span>
        </div>

        {/* 文件列表 */}
        <div className="flex flex-col gap-2">
          {files.map((entry, idx) => (
            <FileCard
              key={entry.filePath}
              entry={entry}
              isActive={idx === activeIdx}
              playingWmIdx={idx === activeIdx ? playingWmIdx : null}
              onSelectRole={(role) => handleSetRole(idx, role)}
              onRemove={() => handleRemove(idx)}
              onSetActive={() => setActiveIdx(idx)}
              onPlayWm={handlePlayWm}
              onStop={handleStop}
            />
          ))}
        </div>
      </div>

      {/* 右侧：播放器 + 波形 + 操作 */}
      <div className="flex-1 flex flex-col gap-4 min-w-0 overflow-auto">
        {activeEntry ? (
          <>
            {/* 当前文件信息 */}
            <div className="flex items-center gap-3">
              <Volume2 className="h-5 w-5 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {activeEntry.fileName}
                </p>
                <p className="text-xs text-muted-foreground">
                  {fmtTime(currentTime)} / {fmtTime(activeEntry.duration)}
                  {playingWmIdx !== null &&
                    activeEntry.watermarks[playingWmIdx] && (
                      <span className="ml-2 text-orange-500">
                        ▶ 水印 #{playingWmIdx + 1}
                      </span>
                    )}
                </p>
              </div>
            </div>

            {/* 时间轴 + 水印标记 */}
            <div className="relative h-12 bg-muted rounded-lg overflow-hidden">
              {/* 进度条 */}
              <div
                className="absolute inset-y-0 left-0 bg-primary/10 transition-all"
                style={{
                  width:
                    activeEntry.duration > 0
                      ? `${(currentTime / activeEntry.duration) * 100}%`
                      : '0%',
                }}
              />
              {/* 水印标记 */}
              {activeEntry.watermarks.map((wm, idx) => (
                <div
                  key={idx}
                  className="absolute inset-y-0 bg-orange-400/30 border-x border-orange-500/50 cursor-pointer hover:bg-orange-400/50 transition-colors"
                  style={{
                    left: `${(wm.start / activeEntry.duration) * 100}%`,
                    width: `${(wm.duration / activeEntry.duration) * 100}%`,
                    minWidth: '2px',
                  }}
                  onClick={() => handlePlayWm(idx)}
                  title={`水印 #${idx + 1}: ${fmtTime(wm.start)} - ${fmtTime(wm.end)}`}
                >
                  <span className="absolute top-0.5 left-0.5 text-[9px] text-orange-600 font-medium">
                    #{idx + 1}
                  </span>
                </div>
              ))}
              {/* 播放头 */}
              <div
                className="absolute inset-y-0 w-0.5 bg-primary"
                style={{
                  left:
                    activeEntry.duration > 0
                      ? `${(currentTime / activeEntry.duration) * 100}%`
                      : '0%',
                }}
              />
              {/* 点击跳转 */}
              <div
                className="absolute inset-0 cursor-pointer"
                onClick={(e) => {
                  if (!audioRef.current || !activeEntry.duration) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const ratio = (e.clientX - rect.left) / rect.width;
                  const seekTime = ratio * activeEntry.duration;
                  audioRef.current.currentTime = seekTime;
                  setCurrentTime(seekTime);
                  if (!playing) {
                    loadAndPlay(activeEntry.filePath, seekTime);
                    setPlaying(true);
                    setPlayingWmIdx(null);
                  }
                }}
              />
            </div>

            {/* 播放控制 */}
            <div className="flex items-center justify-center gap-3">
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9"
                onClick={() => {
                  if (!audioRef.current) return;
                  audioRef.current.currentTime = Math.max(
                    0,
                    audioRef.current.currentTime - 10,
                  );
                }}
                title="后退10秒"
              >
                <SkipBack className="h-4 w-4" />
              </Button>
              <Button
                variant="default"
                size="icon"
                className="h-10 w-10 rounded-full"
                onClick={handlePlayPause}
              >
                {playing ? (
                  <Pause className="h-5 w-5" />
                ) : (
                  <Play className="h-5 w-5 ml-0.5" />
                )}
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9"
                onClick={() => {
                  if (!audioRef.current) return;
                  audioRef.current.currentTime = Math.min(
                    activeEntry.duration,
                    audioRef.current.currentTime + 10,
                  );
                }}
                title="前进10秒"
              >
                <SkipForward className="h-4 w-4" />
              </Button>
            </div>

            {/* 水印列表（大卡片） */}
            {activeEntry.watermarks.length > 0 && (
              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-medium text-muted-foreground">
                  检测到的水印（点击播放判断）
                </h3>
                {activeEntry.watermarks.map((wm, idx) => (
                  <div
                    key={idx}
                    className={`flex items-center gap-3 rounded-lg border px-3 py-2 transition-all ${
                      playingWmIdx === idx
                        ? 'border-orange-400 bg-orange-50 dark:bg-orange-900/20'
                        : 'border-border hover:border-orange-300'
                    }`}
                  >
                    <span className="text-sm font-medium text-muted-foreground w-6 text-right">
                      #{idx + 1}
                    </span>
                    <div className="flex-1">
                      <span className="font-mono text-sm">
                        {fmtTime(wm.start)} - {fmtTime(wm.end)}
                      </span>
                      <span className="text-xs text-muted-foreground ml-2">
                        ({wm.duration.toFixed(1)}秒)
                      </span>
                      <span className="text-xs text-orange-500 ml-2">
                        能量 {wm.energyRatio}x
                      </span>
                      {wm.centroidRatio && wm.centroidRatio > 1.5 && (
                        <span className="text-xs text-purple-500 ml-2">
                          质心 {wm.centroidRatio}x
                        </span>
                      )}
                    </div>
                    <Button
                      variant={playingWmIdx === idx ? 'default' : 'outline'}
                      size="sm"
                      className="h-7 px-3"
                      onClick={() => {
                        if (playingWmIdx === idx) handleStop();
                        else handlePlayWm(idx);
                      }}
                    >
                      {playingWmIdx === idx ? (
                        <>
                          <Pause className="h-3 w-3 mr-1" /> 停止
                        </>
                      ) : (
                        <>
                          <Play className="h-3 w-3 mr-1" /> 播放
                        </>
                      )}
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {/* 主/辅文件状态 */}
            <div className="mt-auto pt-4 border-t">
              <div className="flex items-center gap-4 text-sm">
                <div className="flex items-center gap-1.5">
                  <Star className="h-4 w-4 text-blue-500" />
                  <span className="text-muted-foreground">主文件:</span>
                  <span
                    className={primaryFile ? '' : 'text-muted-foreground/50'}
                  >
                    {primaryFile?.fileName || '未选择'}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <HelpCircle className="h-4 w-4 text-emerald-500" />
                  <span className="text-muted-foreground">参考:</span>
                  <span className={refFile ? '' : 'text-muted-foreground/50'}>
                    {refFile?.fileName || '未选择'}
                  </span>
                </div>
                {primaryFile && refFile && (
                  <Button
                    variant="default"
                    size="sm"
                    className="ml-auto"
                    disabled
                  >
                    <ShieldCheck className="h-3.5 w-3.5 mr-1" />
                    开始清洗（即将推出）
                  </Button>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-2">
            <Volume2 className="h-12 w-12 opacity-20" />
            <p className="text-sm">请添加音频文件开始检测</p>
          </div>
        )}
      </div>
    </div>
  );
}
