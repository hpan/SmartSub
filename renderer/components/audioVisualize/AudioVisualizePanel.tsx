/**
 * 音画面板 - 主页面：选节目 → 选封面 → 选音频 → 生成
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import {
  Music,
  Upload,
  Play,
  Pause,
  Loader2,
  CheckCircle2,
  FolderOpen,
  Settings,
  Palette,
  Image as ImageIcon,
  Check,
  Volume2,
  X,
  Plus,
  Info,
  Subtitles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from 'lib/utils';
import { Panel, PanelHeader } from '@/components/ui/panel';

// Font cache: path → familyName (already loaded)

/** 与 Python wrap_text 同逻辑的 JS 版标题换行 */
function wrapTitleJS(
  text: string,
  containerWidth: number,
  fontSize: number,
  videoInfo?: { vw: number; vh: number; vFontSize: number },
): { lines: string[]; debug: string } {
  const strongBreaks = new Set(['：', '—', ':']);
  const mediumBreaks = new Set(['，', '；', '、']);
  const weakBreaks = new Set(['。', '！', '？', ',', '.', ' ']);

  // 估算字符宽度（与 Python PIL 对齐）
  const charW = (ch: string): number => {
    const code = ch.charCodeAt(0);
    if (code <= 0x7f) return fontSize * 0.55;
    if (code >= 0x3000 && code <= 0x303f) return fontSize * 0.6;
    if (code >= 0xff00 && code <= 0xffef) return fontSize * 0.6;
    if (code === 0x2014 || code === 0x2026 || code === 0x00b7)
      return fontSize * 0.6;
    return fontSize * 1.05;
  };
  const textW = (s: string): number => {
    let w = 0;
    for (const c of s) w += charW(c);
    return w;
  };

  // 收集所有可断行位置
  const breaks: Array<{ pos: number; pri: number; ch: string }> = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (strongBreaks.has(ch)) breaks.push({ pos: i + 1, pri: 1, ch });
    else if (mediumBreaks.has(ch)) breaks.push({ pos: i + 1, pri: 2, ch });
    else if (weakBreaks.has(ch)) breaks.push({ pos: i + 1, pri: 3, ch });
  }

  let debug = '';
  if (videoInfo) {
    const vw = videoInfo.vw,
      vh = videoInfo.vh;
    const r = vh > vw ? 0.92 : vw > vh ? 0.65 : 0.8;
    debug += `视频: ${vw}×${vh}px  标题字号: ${videoInfo.vFontSize}px\n`;
    debug += `宽度比例: ${r}（${vh > vw ? '竖屏' : vw > vh ? '横屏' : '方形'}）\n`;
    debug += `标题最大宽度: ${Math.round(vw * r)}px\n`;
    debug += `预览缩放: maxW=${Math.round(containerWidth)}px fontSize=${fontSize}px\n`;
  } else {
    debug += `maxW=${Math.round(containerWidth)}px fontSize=${fontSize}px\n`;
  }
  debug += `全宽=${Math.round(textW(text))}px\n`;
  for (const b of breaks) {
    const segW = Math.round(textW(text.slice(0, b.pos)));
    debug += `  break@${b.pos} pri=${b.pri} '${b.ch}' segW=${segW}px ${segW <= containerWidth ? '✓' : '✗'}\n`;
  }

  const lines: string[] = [];
  let pos = 0;
  while (pos < text.length) {
    const remaining = text.slice(pos);
    if (textW(remaining) <= containerWidth) {
      lines.push(remaining);
      break;
    }
    let best = -1,
      bestPri = 999;
    for (const b of breaks) {
      if (b.pos <= pos) continue;
      if (textW(text.slice(pos, b.pos)) <= containerWidth) {
        if (b.pri < bestPri || (b.pri === bestPri && b.pos > best)) {
          best = b.pos;
          bestPri = b.pri;
        }
      }
    }
    if (best > pos) {
      const line = text.slice(pos, best).trim();
      if (line) lines.push(line);
      pos = best;
      continue;
    }
    let cut = remaining.length;
    for (let i = 1; i <= remaining.length; i++) {
      if (textW(remaining.slice(0, i)) > containerWidth) {
        cut = Math.max(1, i - 1);
        break;
      }
    }
    lines.push(remaining.slice(0, cut).trim());
    pos += cut;
  }
  debug += `结果: ${lines.length} 行`;
  return { lines, debug };
}

const loadedFonts = new Map<string, string>();

function getFontFamily(fontPath?: string): string {
  if (!fontPath) return 'sans-serif';
  return loadedFonts.get(fontPath) || 'sans-serif';
}

/** Load a local font file via IPC and register with FontFace API */
async function ensureFontLoaded(fontPath: string): Promise<string> {
  if (loadedFonts.has(fontPath)) return loadedFonts.get(fontPath)!;
  const base = fontPath.split('/').pop() || '';
  const familyName = base
    .replace(/\.(ttf|otf|woff2?|ttc)$/i, '')
    .replace(/[-_]/g, ' ');
  try {
    const b64 = await window.ipc.invoke('audioVisualize:loadFont', fontPath);
    if (!b64) {
      loadedFonts.set(fontPath, 'sans-serif');
      return 'sans-serif';
    }
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const fontFace = new FontFace(familyName, bytes.buffer);
    await fontFace.load();
    document.fonts.add(fontFace);
    loadedFonts.set(fontPath, `"${familyName}", sans-serif`);
    return `"${familyName}", sans-serif`;
  } catch {
    loadedFonts.set(fontPath, 'sans-serif');
    return 'sans-serif';
  }
}
import { toast } from 'sonner';

type LogoPosition =
  | 'bottom-left'
  | 'bottom-right'
  | 'top-left'
  | 'top-right'
  | 'center-top'
  | 'center'
  | 'center-bottom';

interface CoverAsset {
  id: string;
  path: string;
  width: number;
  height: number;
  ratio: string;
  subtitleTopPx?: number;
}

interface ProgramConfig {
  id: string;
  name: string;
  category?: string;
  covers: CoverAsset[];
  titleFontPath?: string;
  defaultSpectrumStyle?: string;
  showTitle?: boolean;
  logoPath?: string;
  logos?: { id: string; path: string; label?: string }[];
  defaultLogoId?: string;
  logoPosition: LogoPosition;
  logoXRatio?: number;
  logoYRatio?: number;
  logoSizeRatio?: number;
  overlayOpacity?: number;
  titleColor?: string;
  defaultRatio: '16:9' | '3:4' | '1:1';
  watermarkText?: string;
  watermarkEnabled?: boolean;
}

interface GlobalVisualConfig {
  titleFontPath: string;
  titleFontSize: number;
  titleColor: string;
  titleStrokeWidth: number;
  titleYRatio: number;
  subtitleFontPath: string;
  subtitleFontSize: number;
  subtitleColor: string;
  subtitleStrokeWidth: number;
  subtitleBottomRatio: number;
}

const RATIO_LABELS: Record<string, { label: string; desc: string }> = {
  '16:9': { label: '横屏', desc: '1920×1080' },
  '3:4': { label: '竖屏', desc: '1080×1440' },
  '1:1': { label: '方形', desc: '1080×1080' },
};

const SPEED_PRESETS = [1.0, 1.1, 1.25, 1.5, 2.0];

function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export default function AudioVisualizePanel() {
  const router = useRouter();
  const { locale, file } = router.query;

  const [programs, setPrograms] = useState<ProgramConfig[]>([]);
  const [selectedProgramId, setSelectedProgramId] = useState('');
  const [selectedCoverId, setSelectedCoverId] = useState('');
  const [selectedLogoId, setSelectedLogoId] = useState('');
  const [audioPath, setAudioPath] = useState('');
  const [audioInfo, setAudioInfo] = useState<{
    duration: number;
    bitrate: number;
    size: number;
    sampleRate: number;
    channels: number;
  } | null>(null);

  const [speed, setSpeed] = useState(1.0);
  const [spectrumStyle, setSpectrumStyle] = useState('bars');
  const [watermarkEnabled, setWatermarkEnabled] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [genQueue, setGenQueue] = useState<
    Array<{ label: string; params: any }>
  >([]);
  const [genProgress, setGenProgress] = useState(0);
  const [genElapsed, setGenElapsed] = useState(0);
  const [previewSecs, setPreviewSecs] = useState(15);
  const [tasks, setTasks] = useState<any[]>([]);
  const [outputPath, setOutputPath] = useState('');
  const [subtitlePath, setSubtitlePath] = useState('');
  const [subtitleTopPx, setSubtitleTopPx] = useState<string>('158');
  const subtitleUserEditedRef = useRef(false);
  const [globalConfig, setGlobalConfig] = useState<GlobalVisualConfig | null>(
    null,
  );
  const [resolvedConfig, setResolvedConfig] = useState<any>(null);

  // Audio preview
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [titleFontFamily, setTitleFontFamily] = useState('sans-serif');
  const [audioDragOver, setAudioDragOver] = useState(false);
  const [subtitleDragOver, setSubtitleDragOver] = useState(false);
  const [logosExpanded, setLogosExpanded] = useState(false);

  // Load tasks on mount and listen for updates
  useEffect(() => {
    window.ipc.invoke('audioVisualize:getTasks').then((t: any) => {
      if (Array.isArray(t)) setTasks(t);
    });
    const unsubTask = window.ipc.on(
      'audioVisualize:taskUpdate',
      (task: any) => {
        if (!task || !task.id) return;
        setTasks((prev) => {
          // 替换已有记录（按 ID 或 pending 标记）
          let idx = prev.findIndex((t) => t.id === task.id);
          if (idx < 0) {
            // 后端任务到达时，替换第一条 pending 记录
            idx = prev.findIndex((t) => t.id.startsWith('pending-'));
          }
          if (idx >= 0) {
            const merged = { ...prev[idx], ...task };
            // Keep frontend startTime if backend doesn't have it
            if (!task.startTime && prev[idx].startTime)
              merged.startTime = prev[idx].startTime;
            // Ensure done tasks show 100%
            if (task.status === 'done') merged.progress = 100;
            const next = [...prev];
            next[idx] = merged;
            return next;
          }
          return [task, ...prev];
        });
        // Sync progress to top-level state
        if (task.progress !== undefined) setGenProgress(task.progress);
      },
    );
    return () => {
      if (unsubTask) unsubTask();
    };
  }, []);

  useEffect(() => {
    window.ipc
      .invoke('audioVisualize:getPrograms')
      .then((data: ProgramConfig[]) => {
        setPrograms(data || []);
        if (data?.length > 0) {
          const saved = localStorage.getItem('audioVis_selectedProgramId');
          if (saved && data.find((p) => p.id === saved)) {
            setSelectedProgramId(saved);
          } else {
            setSelectedProgramId(data[0].id);
          }
        }
      });
  }, []);

  useEffect(() => {
    if (file && typeof file === 'string') {
      setAudioPath(file);
      autoDetectSubtitle(file);
    } else {
      // Restore from localStorage when navigating back from config pages
      const savedAudio = localStorage.getItem('audioVis_audioPath');
      if (savedAudio) setAudioPath(savedAudio);
      const savedSub = localStorage.getItem('audioVis_subtitlePath');
      if (savedSub) setSubtitlePath(savedSub);
    }
  }, [file]);

  // Fetch audio metadata
  useEffect(() => {
    if (!audioPath) {
      setAudioInfo(null);
      return;
    }
    window.ipc
      .invoke('audioVisualize:getMediaInfo', audioPath)
      .then((info: any) => {
        if (info) setAudioInfo(info);
      });
  }, [audioPath]);

  // Persist selections so returning from config pages restores them
  useEffect(() => {
    if (selectedProgramId)
      localStorage.setItem('audioVis_selectedProgramId', selectedProgramId);
  }, [selectedProgramId]);
  useEffect(() => {
    if (selectedCoverId)
      localStorage.setItem('audioVis_selectedCoverId', selectedCoverId);
  }, [selectedCoverId]);
  useEffect(() => {
    if (selectedLogoId)
      localStorage.setItem('audioVis_selectedLogoId', selectedLogoId);
  }, [selectedLogoId]);
  useEffect(() => {
    if (audioPath) localStorage.setItem('audioVis_audioPath', audioPath);
  }, [audioPath]);
  useEffect(() => {
    if (subtitlePath)
      localStorage.setItem('audioVis_subtitlePath', subtitlePath);
  }, [subtitlePath]);

  // Load global config
  useEffect(() => {
    window.ipc
      .invoke('audioVisualize:getGlobalConfig')
      .then((cfg: GlobalVisualConfig) => setGlobalConfig(cfg));
  }, []);

  // Fetch resolved config for preview
  const fetchResolvedConfig = useCallback(async (pid: string) => {
    if (!pid) {
      setResolvedConfig(null);
      return;
    }
    const cfg = await window.ipc.invoke(
      'audioVisualize:getResolvedConfig',
      pid,
    );
    setResolvedConfig(cfg);
  }, []);

  useEffect(() => {
    fetchResolvedConfig(selectedProgramId);
  }, [selectedProgramId, fetchResolvedConfig]);

  // 从配置页面返回时刷新预览
  useEffect(() => {
    const onReveal = () => {
      if (document.visibilityState === 'visible' && selectedProgramId) {
        fetchResolvedConfig(selectedProgramId);
      }
    };
    document.addEventListener('visibilitychange', onReveal);
    return () => document.removeEventListener('visibilitychange', onReveal);
  }, [selectedProgramId, fetchResolvedConfig]);

  // Listen for generation progress
  useEffect(() => {
    const unsub = window.ipc.on(
      'audioVisualize:progress',
      (data: { percent: number }) => {
        setGenProgress(data.percent);
      },
    );
    return () => {
      if (unsub) unsub();
    };
  }, []);

  const selectedProgram = programs.find((p) => p.id === selectedProgramId);

  // Sync subtitleTopPx from cover asset or resolved config
  useEffect(() => {
    if (subtitleUserEditedRef.current) return;
    const cover = selectedProgram?.covers?.find(
      (c) => c.id === selectedCoverId,
    );
    if (cover?.subtitleTopPx !== undefined) {
      setSubtitleTopPx(String(cover.subtitleTopPx));
    } else if (resolvedConfig?.subtitleBottomRatio !== undefined) {
      setSubtitleTopPx(
        String(Math.round(1080 * resolvedConfig.subtitleBottomRatio)),
      );
    }
  }, [selectedCoverId, selectedProgramId, selectedProgram]);

  // 切换封面/节目时重置编辑标记
  useEffect(() => {
    subtitleUserEditedRef.current = false;
  }, [selectedCoverId, selectedProgramId]);

  const programLogos = selectedProgram?.logos?.length
    ? selectedProgram.logos
    : selectedProgram?.logoPath
      ? [{ id: 'legacy', path: selectedProgram.logoPath }]
      : [];
  const defaultLogoId = selectedProgram?.defaultLogoId;
  const selectedLogo =
    programLogos.find((l) => l.id === selectedLogoId) ||
    programLogos.find((l) => l.id === defaultLogoId) ||
    programLogos[0];

  useEffect(() => {
    const saved = localStorage.getItem('audioVis_selectedLogoId');
    if (saved && programLogos.find((l) => l.id === saved)) {
      setSelectedLogoId(saved);
    } else if (
      defaultLogoId &&
      programLogos.find((l) => l.id === defaultLogoId)
    ) {
      setSelectedLogoId(defaultLogoId);
    } else {
      setSelectedLogoId('');
    }
  }, [selectedProgramId]);

  // Sync spectrum style with category default when program changes
  useEffect(() => {
    if (selectedProgram) {
      const defaultStyle =
        selectedProgram.defaultSpectrumStyle ||
        resolvedConfig?.defaultSpectrumStyle ||
        'none';
      setSpectrumStyle(defaultStyle);
    }
  }, [selectedProgramId, resolvedConfig]);

  // Sync watermarkEnabled from program config
  useEffect(() => {
    if (selectedProgram?.watermarkEnabled !== undefined) {
      setWatermarkEnabled(selectedProgram.watermarkEnabled);
    } else {
      setWatermarkEnabled(true); // default on
    }
  }, [selectedProgramId]);

  const availableCovers = selectedProgram
    ? (selectedProgram.covers || []).map((c) => ({
        id: c.id,
        ratio: c.ratio || '',
        path: c.path,
        width: c.width || 0,
        height: c.height || 0,
      }))
    : [];

  useEffect(() => {
    if (availableCovers.length > 0) {
      const saved = localStorage.getItem('audioVis_selectedCoverId');
      const found = saved && availableCovers.find((c) => c.id === saved);
      if (found) {
        setSelectedCoverId(found.id);
      } else {
        const preferred = availableCovers.find(
          (c) => c.ratio === selectedProgram?.defaultRatio,
        );
        setSelectedCoverId(preferred?.id || availableCovers[0].id);
      }
    } else {
      setSelectedCoverId('');
    }
  }, [selectedProgramId]);

  const selectedCoverAsset =
    availableCovers.find((c) => c.id === selectedCoverId) || null;

  // Audio preview controls
  const handleTogglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = speed;
    }
  }, [speed, audioPath]);

  // Load title font when program changes
  useEffect(() => {
    const fontPath =
      globalConfig?.titleFontPath || selectedProgram?.titleFontPath;
    if (!fontPath) {
      setTitleFontFamily('sans-serif');
      return;
    }
    ensureFontLoaded(fontPath).then((fam) => setTitleFontFamily(fam));
  }, [selectedProgram?.titleFontPath, globalConfig?.titleFontPath]);

  const handleSelectAudio = async () => {
    const result = await window.ipc.invoke('selectFile', {
      type: 'audio',
      title: '选择音频文件',
    });
    if (result?.filePath) {
      setAudioPath(result.filePath);
      setIsPlaying(false);
      autoDetectSubtitle(result.filePath);
    }
  };

  const autoDetectSubtitle = async (audioFilePath: string) => {
    // Try same directory, same name, .srt extension
    const dir = audioFilePath.substring(0, audioFilePath.lastIndexOf('/'));
    const baseName = audioFilePath
      .substring(audioFilePath.lastIndexOf('/') + 1)
      .replace(/\.[^.]+$/, '');
    const srtPath = dir + '/' + baseName + '.srt';
    const exists = await window.ipc.invoke(
      'audioVisualize:fileExists',
      srtPath,
    );
    if (exists) {
      setSubtitlePath(srtPath);
      toast.success('已自动检测到字幕文件');
    } else {
      setSubtitlePath('');
    }
  };

  const handleSelectSubtitle = async () => {
    const result = await window.ipc.invoke('selectFile', {
      type: 'subtitle',
      title: '选择字幕文件',
    });
    if (result?.filePath) setSubtitlePath(result.filePath);
  };

  const AUDIO_EXTENSIONS = ['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg', 'opus'];
  const SUBTITLE_EXTENSIONS = ['srt', 'vtt', 'ass', 'ssa', 'lrc'];

  const handleAudioDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setAudioDragOver(false);
      const file = e.dataTransfer.files[0];
      if (!file) return;
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      if (!AUDIO_EXTENSIONS.includes(ext)) {
        toast.error('不支持的音频格式，支持: ' + AUDIO_EXTENSIONS.join(', '));
        return;
      }
      const filePath = (file as any).path as string;
      setAudioPath(filePath);
      setIsPlaying(false);
      autoDetectSubtitle(filePath);
    },
    [autoDetectSubtitle],
  );

  const handleSubtitleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setSubtitleDragOver(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    if (!SUBTITLE_EXTENSIONS.includes(ext)) {
      toast.error('不支持的字幕格式，支持: ' + SUBTITLE_EXTENSIONS.join(', '));
      return;
    }
    const filePath = (file as any).path as string;
    setSubtitlePath(filePath);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  // Play a short notification sound
  function playNotificationSound() {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.5);
      setTimeout(() => ctx.close(), 1000);
    } catch {}
  }

  // 提取当前配置快照
  const captureParams = useCallback(
    (previewDuration?: number) => ({
      audioPath,
      coverPath: selectedCoverAsset?.path || '',
      logoPath: selectedLogo?.path || undefined,
      aspectRatio:
        selectedCoverAsset?.ratio || selectedProgram?.defaultRatio || '16:9',
      width: selectedCoverAsset?.width || undefined,
      height: selectedCoverAsset?.height || undefined,
      logoPosition: selectedProgram?.logoPosition || 'bottom-right',
      speed,
      previewDuration,
      spectrumStyle,
      programId: selectedProgramId,
      subtitlePath: subtitlePath || undefined,
      subtitleTopPx: parseInt(subtitleTopPx) || 0,
      watermarkEnabled,
    }),
    [
      audioPath,
      selectedCoverAsset,
      selectedLogo,
      selectedProgram,
      speed,
      spectrumStyle,
      selectedProgramId,
      subtitlePath,
      subtitleTopPx,
      watermarkEnabled,
    ],
  );

  // 实际执行生成
  const doGenerate = useCallback(async (params: any) => {
    setGenerating(true);
    setOutputPath('');
    setGenProgress(0);
    setGenElapsed(0);
    // 立即在合成记录中添加一条"生成中"记录
    const pendingId = 'pending-' + Date.now().toString(36);
    const pendingName =
      params.audioPath
        ?.split('/')
        .pop()
        ?.replace(/\.[^.]+$/, '') || '未命名';
    setTasks((prev) => [
      {
        id: pendingId,
        outputPath:
          pendingName +
          (params.previewDuration ? ` (预览${params.previewDuration}s)` : ''),
        status: 'running',
        progress: 0,
        elapsed: 0,
        startTime: Date.now(),
        params: JSON.stringify(params),
      },
      ...prev.filter((t) => t.id !== pendingId),
    ]);
    const startTime = Date.now();
    const elapsedTimer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      setGenElapsed(elapsed);
      setTasks((prev) =>
        prev.map((t) => (t.status === 'running' ? { ...t, elapsed } : t)),
      );
    }, 1000);
    try {
      const res = await window.ipc.invoke('audioVisualize:generate', params);
      if (res.success) {
        setOutputPath(res.outputPath);
        const secs = Math.floor((Date.now() - startTime) / 1000);
        const mm = String(Math.floor(secs / 60)).padStart(2, '0');
        const ss = String(secs % 60).padStart(2, '0');
        toast.success(`生成完成！耗时 ${mm}:${ss}`);
        playNotificationSound();
      } else {
        toast.error(res.error || '生成失败');
      }
    } catch (e: any) {
      toast.error(e.message || '生成失败');
    } finally {
      clearInterval(elapsedTimer);
      setGenerating(false);
    }
  }, []);

  // 直接生成（原按钮）
  const handleGenerate = useCallback(
    async (previewDuration?: number) => {
      if (!audioPath) {
        toast.error('请先选择音频文件');
        return;
      }
      if (!selectedCoverAsset?.path) {
        toast.error('请先选择封面图片');
        return;
      }
      doGenerate(captureParams(previewDuration));
    },
    [audioPath, selectedCoverAsset, captureParams, doGenerate],
  );

  // 加入队列（新按钮）
  const handleEnqueue = useCallback(() => {
    if (!audioPath) {
      toast.error('请先选择音频文件');
      return;
    }
    if (!selectedCoverAsset?.path) {
      toast.error('请先选择封面图片');
      return;
    }
    const params = captureParams();
    if (generating) {
      setGenQueue((prev) => [...prev, { label: '正式生成', params }]);
      toast.info(`已加入队列（排队中，前面 ${genQueue.length} 个任务）`);
    } else {
      doGenerate(params);
    }
  }, [
    audioPath,
    selectedCoverAsset,
    generating,
    genQueue,
    captureParams,
    doGenerate,
  ]);

  // 当前任务完成后自动处理队列
  const prevGeneratingRef = useRef(generating);
  useEffect(() => {
    if (prevGeneratingRef.current && !generating && genQueue.length > 0) {
      const next = genQueue[0];
      setGenQueue((prev) => prev.slice(1));
      toast.info(`开始生成队列任务：${next.label}`);
      doGenerate(next.params);
    }
    prevGeneratingRef.current = generating;
  }, [generating, genQueue, doGenerate]);

  const handleStop = async () => {
    await window.ipc.invoke('audioVisualize:stopGenerate');
    setGenerating(false);
    setGenProgress(0);
    setGenElapsed(0);
    // 将当前运行中的任务标记为已取消
    setTasks((prev) =>
      prev.map((t) =>
        t.status === 'running'
          ? {
              ...t,
              status: 'stopped',
              endTime: Date.now(),
              elapsed: Math.floor((Date.now() - t.startTime) / 1000),
            }
          : t,
      ),
    );
    toast.info('已停止生成');
  };

  const handleOpenOutput = () => {
    if (outputPath) window.ipc.invoke('download:openPath', outputPath);
  };
  const handleShowInFolder = () => {
    if (outputPath) window.ipc.invoke('download:showItemInFolder', outputPath);
  };
  const audioFileName = audioPath ? audioPath.split('/').pop() : '';
  const subtitleFileName = subtitlePath ? subtitlePath.split('/').pop() : '';

  return (
    <div className="flex flex-col gap-4 min-h-0">
      {/* Hidden audio */}
      {audioPath && (
        <audio
          ref={audioRef}
          src={`media://${audioPath}`}
          onEnded={() => setIsPlaying(false)}
          preload="metadata"
        />
      )}

      {/* Panel 1: 节目 */}
      <Panel>
        <PanelHeader
          title="选择节目"
          actions={
            <div className="flex items-center gap-2">
              <Link href={`/${locale || 'zh'}/globalStyleConfig`}>
                <Button variant="outline" size="sm" className="h-7 px-2.5">
                  <Palette className="h-3.5 w-3.5 mr-1" /> 样式分类
                </Button>
              </Link>
              <Link
                href={`/${locale || 'zh'}/audioVisualizeConfig${selectedProgramId ? `?program=${selectedProgramId}` : ''}`}
              >
                <Button variant="outline" size="sm" className="h-7 px-2.5">
                  <Settings className="h-3.5 w-3.5 mr-1" /> 节目配置
                </Button>
              </Link>
            </div>
          }
        />
        <div className="p-3">
          <div className="flex flex-wrap gap-1.5">
            {programs.map((program) => (
              <button
                key={program.id}
                type="button"
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm transition-all',
                  selectedProgramId === program.id
                    ? 'border-primary bg-primary/10 text-primary font-medium'
                    : 'border-muted-foreground/20 hover:border-muted-foreground/40 hover:bg-accent',
                )}
                onClick={() => setSelectedProgramId(program.id)}
              >
                <div
                  className={cn(
                    'h-2 w-2 rounded-full shrink-0',
                    selectedProgramId === program.id
                      ? 'bg-primary'
                      : 'bg-muted-foreground/30',
                  )}
                />
                {program.name}
                {program.category === 'meeting' ? ' 📊' : ''}
              </button>
            ))}
          </div>
        </div>
      </Panel>

      {/* 主区域：两列 */}
      <div className="flex gap-4 flex-1 min-h-0">
        {/* 左侧：设置 */}
        <div className="flex flex-col gap-3 flex-1 min-w-0">
          <Panel>
            <PanelHeader title="素材" />
            <div className="p-3 flex flex-col gap-3">
              <div className="flex flex-wrap items-start gap-4">
                <div className="flex-1 min-w-0">
                  {/* 封面选择 */}
                  {selectedProgram && availableCovers.length > 0 && (
                    <div className="flex flex-col gap-2">
                      <Label className="text-sm font-medium">选择封面</Label>
                      <div className="flex gap-3">
                        {availableCovers.map((c) => {
                          const info = RATIO_LABELS[c.ratio];
                          const ar =
                            c.width && c.height ? c.width / c.height : 1;
                          const h = 110;
                          const w = Math.max(40, Math.round(h * ar));
                          return (
                            <div
                              key={c.id}
                              className={cn(
                                'flex flex-col gap-1.5 cursor-pointer transition-all',
                                selectedCoverId === c.id
                                  ? 'opacity-100'
                                  : 'opacity-60 hover:opacity-80',
                              )}
                              onClick={() => setSelectedCoverId(c.id)}
                            >
                              <div
                                className={cn(
                                  'relative rounded-lg overflow-hidden border-2 transition-all',
                                  selectedCoverId === c.id
                                    ? 'border-primary ring-1 ring-primary'
                                    : 'border-transparent',
                                )}
                                style={{ width: w, height: h }}
                              >
                                <img
                                  src={'media://' + c.path}
                                  alt={info?.label || c.ratio}
                                  className="w-full h-full object-cover"
                                />
                                {selectedCoverId === c.id && (
                                  <div className="absolute top-1 right-1 bg-primary rounded-full p-0.5">
                                    <Check className="h-3 w-3 text-white" />
                                  </div>
                                )}
                              </div>
                              <span className="text-xs text-center text-muted-foreground">
                                {info?.label || c.ratio}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {selectedProgram && availableCovers.length === 0 && (
                    <div className="text-sm text-orange-500">
                      该节目未配置封面图，请先
                      <Link
                        href={`/${locale || 'zh'}/audioVisualizeConfig${selectedProgramId ? `?program=${selectedProgramId}` : ''}`}
                        className="underline ml-1"
                      >
                        去配置
                      </Link>
                    </div>
                  )}
                </div>
                <div className="shrink-0">
                  {/* Logo 选择 */}
                  {selectedProgram && programLogos.length > 0 && (
                    <div className="flex flex-col gap-2">
                      <Label className="text-sm font-medium">选择Logo</Label>
                      <div className="grid grid-cols-5 gap-2">
                        {(logosExpanded
                          ? programLogos
                          : programLogos.slice(0, 9)
                        ).map((l) => (
                          <div
                            key={l.id}
                            title={l.label || 'Logo'}
                            className={cn(
                              'relative cursor-pointer transition-all rounded-lg overflow-hidden border-2',
                              selectedLogo?.id === l.id
                                ? 'border-primary ring-1 ring-primary'
                                : 'border-transparent opacity-70 hover:opacity-100',
                            )}
                            onClick={() => setSelectedLogoId(l.id)}
                          >
                            <img
                              src={'media://' + l.path}
                              alt={l.label || 'Logo'}
                              className="w-12 h-12 object-contain bg-muted/30"
                            />
                            {selectedLogo?.id === l.id && (
                              <div className="absolute top-0.5 right-0.5 bg-primary rounded-full p-0.5">
                                <Check className="h-3 w-3 text-white" />
                              </div>
                            )}
                            {l.label && (
                              <div className="text-[10px] text-center text-muted-foreground truncate max-w-[48px] px-0.5">
                                {l.label}
                              </div>
                            )}
                          </div>
                        ))}
                        {programLogos.length > 9 && (
                          <div
                            className="flex items-center justify-center w-12 h-12 rounded-lg border-2 border-dashed border-muted-foreground/30 cursor-pointer hover:border-muted-foreground/60 transition-all"
                            onClick={() => setLogosExpanded(!logosExpanded)}
                          >
                            <span className="text-xs text-muted-foreground">
                              {logosExpanded
                                ? '收起'
                                : `+${programLogos.length - 9}`}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* 音频文件 */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <Label className="text-sm font-medium flex items-center gap-1.5">
                    <Music className="h-4 w-4" /> 音频文件
                  </Label>
                  {audioInfo && (
                    <span className="text-[10px] text-muted-foreground">
                      {Math.floor(audioInfo.duration / 60)}:
                      {String(Math.floor(audioInfo.duration % 60)).padStart(
                        2,
                        '0',
                      )}{' '}
                      · {Math.round(audioInfo.bitrate / 1000)}kbps ·{' '}
                      {(audioInfo.size / 1024 / 1024).toFixed(1)}MB
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  <div
                    className={cn(
                      'flex-1 min-w-0 overflow-hidden flex items-center gap-2 px-3 py-2 border-2 border-dashed rounded-md cursor-pointer hover:bg-accent min-h-[40px] transition-colors',
                      audioDragOver && 'border-primary bg-primary/5',
                    )}
                    onClick={handleSelectAudio}
                    onDragOver={handleDragOver}
                    onDragEnter={(e) => {
                      e.preventDefault();
                      setAudioDragOver(true);
                    }}
                    onDragLeave={() => setAudioDragOver(false)}
                    onDrop={handleAudioDrop}
                  >
                    {audioFileName ? (
                      <span className="text-sm truncate">{audioFileName}</span>
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        点击选择或拖放音频文件
                      </span>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-[40px] w-10 shrink-0"
                    onClick={handleSelectAudio}
                  >
                    <Upload className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* 字幕文件 */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <Label className="text-sm font-medium shrink-0 flex items-center gap-1.5">
                    <Subtitles className="h-4 w-4" /> 字幕文件{' '}
                    <span className="text-xs text-muted-foreground font-normal">
                      (可选)
                    </span>
                  </Label>
                  {subtitlePath && (
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <span>距顶</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={subtitleTopPx}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === '' || /^\d{0,4}$/.test(v)) {
                            subtitleUserEditedRef.current = true;
                            setSubtitleTopPx(v);
                          }
                        }}
                        onBlur={(e) => {
                          if (e.target.value === '') setSubtitleTopPx('0');
                        }}
                        className="w-10 h-5 rounded border bg-background px-1 text-center"
                      />
                      <span>px</span>
                      {selectedProgramId && selectedCoverId && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-5 px-1 text-muted-foreground"
                          onClick={async () => {
                            const val = parseInt(subtitleTopPx) || 0;
                            await window.ipc.invoke(
                              'audioVisualize:updateCoverField',
                              {
                                programId: selectedProgramId,
                                coverId: selectedCoverId,
                                field: 'subtitleTopPx',
                                value: val,
                              },
                            );
                            toast.success('已保存');
                          }}
                        >
                          保存
                        </Button>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <div
                    className={cn(
                      'flex-1 min-w-0 overflow-hidden flex items-center gap-2 px-3 py-2 border-2 border-dashed rounded-md cursor-pointer hover:bg-accent min-h-[40px] transition-colors',
                      subtitleDragOver && 'border-primary bg-primary/5',
                    )}
                    onClick={handleSelectSubtitle}
                    onDragOver={handleDragOver}
                    onDragEnter={(e) => {
                      e.preventDefault();
                      setSubtitleDragOver(true);
                    }}
                    onDragLeave={() => setSubtitleDragOver(false)}
                    onDrop={handleSubtitleDrop}
                  >
                    {subtitleFileName ? (
                      <span className="text-sm truncate flex-1">
                        {subtitleFileName}
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground flex-1">
                        点击选择或拖放字幕文件（.srt/.vtt/.ass）
                      </span>
                    )}
                    {subtitlePath && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSubtitlePath('');
                        }}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-[40px] w-10 shrink-0"
                    onClick={handleSelectSubtitle}
                  >
                    <Upload className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* 试听 + 倍速 */}
              {audioPath && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" onClick={handleTogglePlay}>
                    {isPlaying ? (
                      <>
                        <Pause className="h-4 w-4 mr-1" /> 暂停
                      </>
                    ) : (
                      <>
                        <Volume2 className="h-4 w-4 mr-1" /> 试听
                      </>
                    )}
                  </Button>
                  <span className="text-xs text-muted-foreground">倍速</span>
                  <Input
                    type="number"
                    value={speed}
                    onChange={(e) =>
                      setSpeed(
                        Math.max(
                          0.5,
                          Math.min(3, parseFloat(e.target.value) || 1),
                        ),
                      )
                    }
                    step="0.05"
                    min="0.5"
                    max="3"
                    className="w-20 h-8 text-center text-xs"
                  />
                  <div className="flex gap-1">
                    {SPEED_PRESETS.map((s) => (
                      <Button
                        key={s}
                        variant={
                          Math.abs(speed - s) < 0.01 ? 'default' : 'outline'
                        }
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => setSpeed(s)}
                      >
                        {s}x
                      </Button>
                    ))}
                  </div>
                  {audioInfo && (
                    <span className="text-xs text-muted-foreground">
                      预计总时长 {formatDuration(audioInfo.duration / speed)}
                    </span>
                  )}
                </div>
              )}

              {/* 频谱 */}
              <div className="space-y-1.5">
                <div className="flex flex-wrap gap-2">
                  {[
                    { value: 'none', label: '无频谱' },
                    { value: 'bars', label: '底部条形' },
                    { value: 'radial', label: '镭射' },
                    { value: 'rings', label: '频谱环' },
                    { value: 'radar', label: '声呐' },
                    { value: 'wave', label: '彩虹' },
                    { value: 'pulse', label: '脉冲环' },
                  ].map((opt) => (
                    <label
                      key={opt.value}
                      className={cn(
                        'flex items-center gap-1.5 cursor-pointer rounded-md border px-2.5 py-1 text-xs transition-colors',
                        spectrumStyle === opt.value
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-input hover:bg-muted/50',
                      )}
                    >
                      <input
                        type="radio"
                        name="spectrum-style"
                        className="accent-primary"
                        value={opt.value}
                        checked={spectrumStyle === opt.value}
                        onChange={() => setSpectrumStyle(opt.value)}
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
              </div>

              {/* 进度条 */}
              {generating && (
                <div className="flex flex-col gap-1">
                  <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-primary h-full rounded-full transition-all duration-300"
                      style={{ width: `${genProgress}%` }}
                    />
                  </div>
                </div>
              )}

              {/* 生成操作 */}
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <Button
                  onClick={() => handleGenerate()}
                  disabled={
                    generating || !audioPath || !selectedCoverAsset?.path
                  }
                  className="min-w-[120px]"
                >
                  {generating ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />{' '}
                      {`${String(Math.floor(genElapsed / 60)).padStart(2, '0')}:${String(genElapsed % 60).padStart(2, '0')}`}
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4 mr-1" /> 生成视频
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleEnqueue}
                  disabled={!audioPath || !selectedCoverAsset?.path}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  加入队列{genQueue.length > 0 ? ` (${genQueue.length})` : ''}
                </Button>
                <div className="flex items-center gap-1.5 text-xs">
                  <Switch
                    checked={watermarkEnabled}
                    onCheckedChange={setWatermarkEnabled}
                    className="h-4 w-7 [&>span]:h-3 [&>span]:w-3 [&>span[data-state=checked]]:translate-x-3"
                  />
                  <span>水印</span>
                </div>
                {generating && (
                  <Button variant="destructive" onClick={handleStop}>
                    <X className="h-4 w-4 mr-1" /> 停止
                  </Button>
                )}
                <div className="flex items-center gap-1.5">
                  <select
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                    value={previewSecs}
                    onChange={(e) => setPreviewSecs(Number(e.target.value))}
                  >
                    <option value={15}>15秒</option>
                    <option value={25}>25秒</option>
                    <option value={45}>45秒</option>
                    <option value={60}>60秒</option>
                    <option value={90}>90秒</option>
                  </select>
                  <Button
                    variant="outline"
                    onClick={() => handleGenerate(previewSecs)}
                    disabled={
                      generating || !audioPath || !selectedCoverAsset?.path
                    }
                  >
                    <Play className="h-4 w-4 mr-1" /> 预览
                  </Button>
                </div>
              </div>
            </div>
          </Panel>
        </div>

        {/* 右侧：预览 */}
        <div className="w-96 flex flex-col gap-3 shrink-0 min-h-0">
          <Panel>
            <PanelHeader title="预览" />
            <div className="p-3 flex flex-col gap-3">
              {selectedProgram &&
                selectedCoverAsset?.path &&
                (() => {
                  const logoX =
                    selectedProgram.logoXRatio ??
                    {
                      'bottom-left': 0.09,
                      'bottom-right': 0.91,
                      'top-left': 0.09,
                      'top-right': 0.91,
                      'center-top': 0.5,
                      center: 0.5,
                      'center-bottom': 0.5,
                    }[selectedProgram.logoPosition] ??
                    0.09;
                  const logoY =
                    selectedProgram.logoYRatio ??
                    {
                      'bottom-left': 0.89,
                      'bottom-right': 0.89,
                      'top-left': 0.11,
                      'top-right': 0.11,
                      'center-top': 0.38,
                      center: 0.5,
                      'center-bottom': 0.82,
                    }[selectedProgram.logoPosition] ??
                    0.89;
                  const logoSizePct =
                    (selectedProgram.logoSizeRatio ?? 0.15) * 100;
                  const titleColor = globalConfig?.titleColor || '#F5DE65';
                  const titleText = audioFileName
                    ? audioFileName.replace(/\.[^.]+$/, '')
                    : '';
                  let titleMain = '';
                  let titleDate = '';
                  if (titleText) {
                    const dm = titleText.match(
                      /^(20\d{2})\s*[-./年]\s*(\d{1,2})\s*[-./月]\s*(\d{1,2})\s*日?/,
                    );
                    if (dm) {
                      titleDate = dm[0];
                      titleMain = titleText
                        .slice(dm[0].length)
                        .replace(/^[\s\-—：:；;，,、]+/, '')
                        .trim();
                    } else {
                      const dm2 = titleText.match(/^(20\d{2})(\d{2})(\d{2})/);
                      if (dm2) {
                        titleDate = dm2[0];
                        titleMain = titleText
                          .slice(dm2[0].length)
                          .replace(/^[\s\-—：:；;，,、]+/, '')
                          .trim();
                      } else {
                        titleMain = titleText;
                      }
                    }
                  }
                  const hasTitle = !!(titleMain || titleDate);
                  const maxDim = 300;
                  const cw = selectedCoverAsset?.width || 0;
                  const ch = selectedCoverAsset?.height || 0;
                  const ar = cw && ch ? cw / ch : 16 / 9;
                  let pw, ph;
                  if (ar >= 1) {
                    pw = maxDim;
                    ph = Math.round(maxDim / ar);
                  } else {
                    ph = maxDim;
                    pw = Math.round(maxDim * ar);
                  }
                  const spectrumBars =
                    spectrumStyle !== 'none'
                      ? Array.from({ length: 48 }, (_, i) => {
                          const h =
                            100 *
                            Math.pow(
                              0.25 +
                                0.75 *
                                  Math.abs(
                                    Math.sin(i * 0.55) * 0.6 +
                                      Math.cos(i * 0.18) * 0.5,
                                  ),
                              1.2,
                            );
                          return { h: Math.max(8, Math.min(100, h)) };
                        })
                      : [];
                  const showOv = resolvedConfig?.showOverlay;
                  const ovOpacity = resolvedConfig?.overlayOpacity ?? 0;
                  const ovBlur = resolvedConfig?.overlayBlur ?? 0;
                  // 根据封面图实际尺寸计算视频尺寸（与 fitCoverSize 同逻辑）
                  const _fitScale =
                    selectedCoverAsset?.width && selectedCoverAsset?.height
                      ? Math.min(
                          1920 / selectedCoverAsset.width,
                          1920 / selectedCoverAsset.height,
                          1,
                        )
                      : 1;
                  const actualVideoW = selectedCoverAsset?.width
                    ? Math.round(selectedCoverAsset.width * _fitScale)
                    : ar >= 1
                      ? 1920
                      : Math.round(1920 * ar);
                  const videoH = selectedCoverAsset?.height
                    ? Math.round(selectedCoverAsset.height * _fitScale)
                    : ar >= 1
                      ? Math.round(1920 / ar)
                      : 1920;
                  const previewBlur =
                    Math.round(ovBlur * (ph / videoH) * 10) / 10;
                  const titleYpct = (resolvedConfig?.titleYRatio ?? 0.15) * 100;
                  // 视频实际尺寸（与 fitCoverSize 同逻辑）
                  const _fs =
                    selectedCoverAsset?.width && selectedCoverAsset?.height
                      ? Math.min(
                          1920 / selectedCoverAsset.width,
                          1920 / selectedCoverAsset.height,
                          1,
                        )
                      : 1;
                  const vidW = selectedCoverAsset?.width
                    ? Math.round(selectedCoverAsset.width * _fs)
                    : ar >= 1
                      ? 1920
                      : Math.round(1920 * ar);
                  const vidH = selectedCoverAsset?.height
                    ? Math.round(selectedCoverAsset.height * _fs)
                    : ar >= 1
                      ? Math.round(1920 / ar)
                      : 1920;
                  const vidTitleFs =
                    resolvedConfig?.titleFontSize || Math.round(vidH * 0.045);
                  // 预览字号 = 视频字号 × (预览高度 / 视频高度)
                  const titleFs = Math.max(
                    8,
                    Math.round(vidTitleFs * (ph / vidH)),
                  );
                  const titleDateFs = Math.max(6, Math.round(titleFs * 0.8));
                  const titleShadow = resolvedConfig?.titleShadowEnabled
                    ? (resolvedConfig?.titleShadowWidth ?? 3) + 'px'
                    : '0px';
                  const titleStroke = resolvedConfig?.titleStrokeEnabled
                    ? '0 0 ' +
                      (resolvedConfig?.titleStrokeWidth ?? 4) +
                      'px rgba(0,0,0,0.8)'
                    : 'none';
                  const titleLetterSp =
                    (resolvedConfig?.titleLetterSpacing ?? 0) + 'px';
                  // 行高 = 字号 + 行间距，整体按预览/视频比例缩放
                  const titleLineH =
                    Math.round(
                      (vidTitleFs + (resolvedConfig?.titleLineSpacing ?? 12)) *
                        (ph / vidH),
                    ) + 'px';
                  const titleCol = resolvedConfig?.titleColor || titleColor;
                  return (
                    <div className="flex flex-col gap-2">
                      <div
                        className="mx-auto relative rounded-lg overflow-hidden border"
                        style={{ width: pw, height: ph }}
                      >
                        <img
                          src={`media://${selectedCoverAsset?.path}`}
                          alt="封面"
                          className="w-full h-full"
                          style={{
                            objectFit: 'cover',
                            filter:
                              showOv && ovBlur > 0
                                ? `blur(${previewBlur}px)`
                                : 'none',
                          }}
                        />
                        {showOv && (
                          <div
                            className="absolute inset-0"
                            style={{
                              backgroundColor: 'rgba(0,0,0,' + ovOpacity + ')',
                            }}
                          />
                        )}
                        {spectrumStyle === 'bars' &&
                          spectrumBars.map((bar, i) => (
                            <div
                              key={i}
                              className="absolute bottom-0"
                              style={{
                                left: (i / spectrumBars.length) * 100 + '%',
                                bottom: '9%',
                                width: (100 / spectrumBars.length) * 0.68 + '%',
                                height: (bar.h / 100) * ph * 0.14 + 'px',
                                backgroundColor: '#FFF79B',
                                borderRadius: '1px 1px 0 0',
                                boxShadow: '0 0 4px rgba(255,247,155,0.6)',
                                opacity: 0.85,
                              }}
                            />
                          ))}
                        {spectrumStyle === 'radial' &&
                          (() => {
                            const cx = selectedLogo ? logoX * pw : pw / 2;
                            const cy = selectedLogo ? logoY * ph : ph / 2;
                            const maxR = Math.min(pw, ph) * 0.3;
                            const n = 36;
                            const lines = Array.from({ length: n }, (_, i) => {
                              const a = (i / n) * Math.PI * 2 - Math.PI / 2;
                              const mag =
                                (spectrumBars[i % spectrumBars.length]?.h ??
                                  40) / 100;
                              const r = 4 + maxR * mag;
                              const x2 = cx + Math.cos(a) * r;
                              const y2 = cy + Math.sin(a) * r;
                              return {
                                x1: cx,
                                y1: cy,
                                x2,
                                y2,
                                a: 150 + 105 * mag,
                              };
                            });
                            return (
                              <svg
                                className="absolute inset-0 w-full h-full pointer-events-none"
                                viewBox={'0 0 ' + pw + ' ' + ph}
                              >
                                {lines.map((l, i) => (
                                  <line
                                    key={i}
                                    x1={l.x1}
                                    y1={l.y1}
                                    x2={l.x2}
                                    y2={l.y2}
                                    stroke={
                                      'rgba(255,247,155,' +
                                      (l.a / 255).toFixed(2) +
                                      ')'
                                    }
                                    strokeWidth={Math.max(1, pw / n / 2)}
                                    strokeLinecap="round"
                                  />
                                ))}
                              </svg>
                            );
                          })()}
                        {spectrumStyle === 'rings' &&
                          selectedLogo &&
                          (() => {
                            const cx = logoX * pw;
                            const cy = logoY * ph;
                            const logoR = ((logoSizePct / 100) * pw) / 2;
                            const rings = 6;
                            const gap = Math.max(3, logoR * 0.12);
                            const amp = Math.max(2, gap * 0.6);
                            const pts = 48;
                            const hueOffset = (Date.now() / 100) % 360;
                            return (
                              <svg
                                className="absolute inset-0 w-full h-full pointer-events-none"
                                viewBox={'0 0 ' + pw + ' ' + ph}
                              >
                                {Array.from({ length: rings }, (_, ring) => {
                                  const r0 = logoR + gap + ring * gap;
                                  const path = [];
                                  for (let j = 0; j <= pts; j++) {
                                    const a = (j / pts) * Math.PI * 2;
                                    const mag =
                                      (spectrumBars[
                                        (j + ring * 3) % spectrumBars.length
                                      ]?.h ?? 50) / 100;
                                    const r = r0 + mag * amp;
                                    const x = cx + Math.cos(a) * r;
                                    const y = cy + Math.sin(a) * r;
                                    path.push(
                                      (j === 0 ? 'M' : 'L') +
                                        x.toFixed(1) +
                                        ',' +
                                        y.toFixed(1),
                                    );
                                  }
                                  const hue =
                                    (hueOffset + (ring * 360) / rings) % 360;
                                  const sat = 100;
                                  const light =
                                    50 + 15 * (ring % 2 === 0 ? 1 : -1);
                                  return (
                                    <path
                                      key={ring}
                                      d={path.join(' ')}
                                      fill="none"
                                      stroke={
                                        'hsla(' +
                                        hue +
                                        ',' +
                                        sat +
                                        '%,' +
                                        light +
                                        '%,0.75)'
                                      }
                                      strokeWidth={1.5}
                                      strokeLinecap="round"
                                    />
                                  );
                                })}
                              </svg>
                            );
                          })()}
                        {spectrumStyle === 'wave' &&
                          (() => {
                            const n = Math.min(spectrumBars.length, 64);
                            const barHMax = ph * 0.15;
                            const baseY = ph - ph * 0.08;
                            const barW = Math.max(4, pw / n);
                            const gap = Math.max(1, Math.floor(barW / 4));
                            const step = barW + gap;
                            const offset = (pw - n * step) / 2;
                            const hueStep = 300 / Math.max(n - 1, 1);
                            return (
                              <svg
                                className="absolute inset-0 w-full h-full pointer-events-none"
                                viewBox={'0 0 ' + pw + ' ' + ph}
                              >
                                {Array.from({ length: n }, (_, i) => {
                                  const mag = (spectrumBars[i]?.h ?? 0) / 100;
                                  const barH = Math.max(1, barHMax * mag);
                                  const x = offset + i * step;
                                  const y0 = baseY - barH;
                                  const hue = i * hueStep;
                                  return (
                                    <rect
                                      key={i}
                                      x={x}
                                      y={y0}
                                      width={barW}
                                      height={barH}
                                      fill={'hsl(' + hue + ',100%,70%)'}
                                      rx="1"
                                    />
                                  );
                                })}
                              </svg>
                            );
                          })()}
                        {spectrumStyle === 'pulse' &&
                          (() => {
                            const cx = selectedLogo ? logoX * pw : pw / 2;
                            const cy = selectedLogo ? logoY * ph : ph / 2;
                            const logoR = ((logoSizePct / 100) * pw) / 2;
                            if (logoR < 3) return null;
                            const rings = 6;
                            const gap = Math.max(4, logoR * 0.18);
                            const baseR = logoR + gap / 2;
                            const amp = Math.max(2, gap * 0.6);
                            const colors = [
                              'rgb(0,82,136)',
                              'rgb(44,100,140)',
                              'rgb(30,110,110)',
                              'rgb(120,90,50)',
                              'rgb(60,110,80)',
                              'rgb(100,100,130)',
                            ];
                            return (
                              <svg
                                className="absolute inset-0 w-full h-full pointer-events-none"
                                viewBox={'0 0 ' + pw + ' ' + ph}
                              >
                                {Array.from({ length: rings }, (_, ring) => {
                                  const r = baseR + ring * gap + amp;
                                  return (
                                    <circle
                                      key={ring}
                                      cx={cx}
                                      cy={cy}
                                      r={r}
                                      fill="none"
                                      stroke={colors[ring % colors.length]}
                                      strokeWidth={Math.max(2, gap / 3)}
                                    />
                                  );
                                })}
                              </svg>
                            );
                          })()}
                        {spectrumStyle === 'radar' &&
                          (() => {
                            const cx = selectedLogo ? logoX * pw : pw / 2;
                            const cy = selectedLogo ? logoY * ph : ph / 2;
                            const maxR = Math.min(pw, ph) * 0.3;
                            const rad15 = Math.PI / 12;
                            const arcRanges = [
                              [rad15 * 1, rad15 * 5],
                              [rad15 * 7, rad15 * 11],
                              [rad15 * 13, rad15 * 17],
                              [rad15 * 19, rad15 * 23],
                            ];
                            const half = Math.floor(spectrumBars.length / 2);
                            const lowBars = spectrumBars.slice(0, half);
                            const highBars = spectrumBars.slice(half);
                            return (
                              <svg
                                className="absolute inset-0 w-full h-full pointer-events-none"
                                viewBox={'0 0 ' + pw + ' ' + ph}
                              >
                                {lowBars.map((bar, i) => {
                                  const mag = (bar.h || 0) / 100;
                                  if (mag < 0.05) return null;
                                  const r = maxR * mag;
                                  const v =
                                    0.75 - r / (Math.min(pw, ph) / 2 - 4);
                                  return arcRanges.map(([a0, a1], ri) => {
                                    const A = a0 + v;
                                    const B = a1 - v;
                                    if (B <= A) return null;
                                    const pts = [];
                                    const steps = 12;
                                    for (let j = 0; j <= steps; j++) {
                                      const a = A + ((B - A) * j) / steps;
                                      pts.push(
                                        (cx + Math.cos(a) * r).toFixed(1) +
                                          ',' +
                                          (cy + Math.sin(a) * r).toFixed(1),
                                      );
                                    }
                                    return (
                                      <polyline
                                        key={'l' + i + '-' + ri}
                                        points={pts.join(' ')}
                                        fill="none"
                                        stroke="rgba(0,150,136,0.7)"
                                        strokeWidth="1.5"
                                      />
                                    );
                                  });
                                })}
                                {highBars.map((bar, i) => {
                                  const mag = (bar.h || 0) / 100;
                                  if (mag < 0.05) return null;
                                  const r = maxR * mag * 0.5;
                                  const off = i * rad15 * 0.4;
                                  return arcRanges.map(([a0, a1], ri) => {
                                    const A = a0 + off;
                                    const B = a1 + off;
                                    if (B <= A) return null;
                                    const pts = [];
                                    const steps = 12;
                                    for (let j = 0; j <= steps; j++) {
                                      const a = A + ((B - A) * j) / steps;
                                      pts.push(
                                        (cx + Math.cos(a) * r).toFixed(1) +
                                          ',' +
                                          (cy + Math.sin(a) * r).toFixed(1),
                                      );
                                    }
                                    return (
                                      <polyline
                                        key={'h' + i + '-' + ri}
                                        points={pts.join(' ')}
                                        fill="none"
                                        stroke="rgba(255,152,0,0.7)"
                                        strokeWidth="1.5"
                                      />
                                    );
                                  });
                                })}
                              </svg>
                            );
                          })()}
                        {hasTitle && (
                          <div
                            className="absolute left-0 right-0 text-center px-2"
                            style={{ top: titleYpct + '%' }}
                          >
                            <div
                              style={{
                                color: titleCol,
                                fontFamily: titleFontFamily,
                                textShadow:
                                  titleStroke +
                                  ', 1px 1px ' +
                                  titleShadow +
                                  ' rgba(0,0,0,0.8)',
                                lineHeight: titleLineH,
                                letterSpacing: titleLetterSp,
                                whiteSpace: 'pre-line',
                              }}
                            >
                              {(() => {
                                // 用视频尺寸决定在哪里换行（与生成端一致）
                                const vidRatio =
                                  vidH > vidW ? 0.92 : vidW > vidH ? 0.65 : 0.8;
                                const { lines: titleLines } = wrapTitleJS(
                                  titleMain,
                                  vidW * vidRatio,
                                  vidTitleFs,
                                );
                                return (
                                  <>
                                    {titleLines.map((line, i) => (
                                      <div
                                        key={i}
                                        style={{ fontSize: titleFs + 'px' }}
                                      >
                                        {line}
                                      </div>
                                    ))}
                                  </>
                                );
                              })()}
                              {titleDate && (
                                <div
                                  style={{
                                    fontSize: titleDateFs + 'px',
                                    marginTop: '4px',
                                  }}
                                >
                                  （{titleDate}）
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                        {/* 标题换行调试信息 */}
                        <div className="flex items-center gap-1 mt-1 ml-1">
                          <div className="relative group cursor-pointer">
                            <Info className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                            <div className="hidden group-hover:block absolute left-0 top-5 z-50 bg-background border rounded-lg shadow-lg p-3 text-[9px] text-foreground whitespace-pre font-mono leading-tight max-w-[320px]">
                              {(() => {
                                const vw =
                                  selectedCoverAsset?.width &&
                                  selectedCoverAsset?.height
                                    ? Math.round(
                                        selectedCoverAsset.width *
                                          Math.min(
                                            1920 / selectedCoverAsset.width,
                                            1920 / selectedCoverAsset.height,
                                            1,
                                          ),
                                      )
                                    : ar >= 1
                                      ? 1920
                                      : Math.round(1920 * ar);
                                const vh =
                                  selectedCoverAsset?.width &&
                                  selectedCoverAsset?.height
                                    ? Math.round(
                                        selectedCoverAsset.height *
                                          Math.min(
                                            1920 / selectedCoverAsset.width,
                                            1920 / selectedCoverAsset.height,
                                            1,
                                          ),
                                      )
                                    : ar >= 1
                                      ? Math.round(1920 / ar)
                                      : 1920;
                                const vfs =
                                  resolvedConfig?.titleFontSize ||
                                  Math.round(vh * 0.045);
                                const { debug } = wrapTitleJS(
                                  titleMain,
                                  pw * 0.6,
                                  titleFs,
                                  { vw, vh, vFontSize: vfs },
                                );
                                return debug;
                              })()}
                            </div>
                          </div>
                          <span className="text-[8px] text-muted-foreground">
                            标题换行详情
                          </span>
                        </div>
                        {subtitlePath &&
                          (() => {
                            const subFs =
                              resolvedConfig?.subtitleFontSize ||
                              Math.round(vidH * 0.035);
                            const previewSubFs = Math.max(
                              6,
                              Math.round(subFs * (ph / vidH)),
                            );
                            const subStroke =
                              globalConfig?.subtitleStrokeWidth ?? 3;
                            const previewSubStroke = Math.max(
                              1,
                              Math.round(subStroke * (ph / vidH)),
                            );
                            return (
                              <div
                                className="absolute left-0 right-0 text-center px-3"
                                style={{
                                  top:
                                    ((parseInt(subtitleTopPx) || 0) / videoH) *
                                      100 +
                                    '%',
                                }}
                              >
                                <span
                                  style={{
                                    color:
                                      globalConfig?.subtitleColor || '#FFF79B',
                                    fontSize: previewSubFs + 'px',
                                    textShadow: `0 0 ${previewSubStroke}px rgba(0,0,0,0.8), 1px 1px ${Math.max(1, previewSubStroke - 1)}px rgba(0,0,0,0.6)`,
                                  }}
                                >
                                  这里是字幕预览效果
                                </span>
                              </div>
                            );
                          })()}
                        {selectedLogo && (
                          <div
                            className="absolute"
                            style={{
                              width: logoSizePct + '%',
                              left: logoX * 100 + '%',
                              top: logoY * 100 + '%',
                              transform: 'translate(-50%, -50%)',
                            }}
                          >
                            <img
                              src={'media://' + selectedLogo.path}
                              alt="Logo"
                              className="w-full rounded-full"
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}

              {outputPath && (
                <div className="flex flex-col gap-2 rounded-lg border border-green-200 bg-green-50/50 dark:border-green-900 dark:bg-green-950/20 p-4">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    <span className="text-sm font-medium">生成完成</span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {outputPath}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleOpenOutput}
                    >
                      <Play className="h-3 w-3 mr-1" /> 播放
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleShowInFolder}
                    >
                      <FolderOpen className="h-3 w-3 mr-1" /> 打开目录
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </Panel>

          <Panel>
            <PanelHeader
              title="合成记录"
              actions={
                <div className="flex items-center gap-2">
                  {(generating || genQueue.length > 0) && (
                    <span className="text-[10px] text-muted-foreground">
                      {generating ? '▶ 生成中' : ''}
                      {genQueue.length > 0 ? ` · 排队 ${genQueue.length}` : ''}
                    </span>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={() => {
                      window.ipc
                        .invoke('audioVisualize:clearTasks')
                        .then(() => setTasks([]));
                    }}
                  >
                    清空
                  </Button>
                </div>
              }
            />
            <div
              className="overflow-y-auto"
              style={{ maxHeight: 'calc(100vh - 520px)', minHeight: '120px' }}
            >
              {/* 前端队列中的任务 */}
              {genQueue.map((q, i) => (
                <div
                  key={'q-' + i}
                  className="flex items-center gap-2 text-xs px-2 py-1.5 border-b border-border/50"
                >
                  <div className="h-2 w-2 rounded-full shrink-0 bg-yellow-400" />
                  <div className="flex-1 min-w-0 truncate text-muted-foreground">
                    排队中：{q.label}
                  </div>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    #{i + 1}
                  </span>
                </div>
              ))}
              {/* 后端任务记录 */}
              {tasks
                .filter((t) => t && t.id && t.status)
                .slice(0, 30)
                .map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center gap-2 text-xs px-2 py-1.5 border-b border-border/50 hover:bg-muted/30"
                  >
                    <div
                      className={`h-2 w-2 rounded-full shrink-0 ${t.status === 'running' ? 'bg-blue-500 animate-pulse' : t.status === 'done' ? 'bg-green-500' : t.status === 'error' ? 'bg-red-500' : t.status === 'stopped' ? 'bg-yellow-500' : 'bg-gray-400'}`}
                    />
                    <div className="flex-1 min-w-0 overflow-hidden">
                      <span
                        className="block truncate font-medium"
                        title={t.outputPath?.split('/').pop()}
                      >
                        {(t.outputPath?.split('/').pop() || '').length > 35
                          ? t.outputPath?.split('/').pop().slice(0, 35) + '…'
                          : t.outputPath?.split('/').pop()}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 text-muted-foreground">
                      {t.status === 'running' && (
                        <span className="text-blue-500">
                          {t.progress?.toFixed(0)}% {Math.floor(t.elapsed / 60)}
                          :{String(t.elapsed % 60).padStart(2, '0')}
                        </span>
                      )}
                      {t.status === 'done' && (
                        <>
                          <span className="text-green-600">✓</span>
                          {t.elapsed > 0 && (
                            <span>
                              {Math.floor(t.elapsed / 60)}:
                              {String(t.elapsed % 60).padStart(2, '0')}
                            </span>
                          )}
                        </>
                      )}
                      {t.status === 'stopped' && (
                        <span className="text-yellow-500">已取消</span>
                      )}
                      {t.status === 'error' && (
                        <span className="text-red-500 truncate max-w-[100px]">
                          {t.error}
                        </span>
                      )}
                    </div>
                    {t.status === 'done' && t.outputPath && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 w-5 p-0 shrink-0"
                        onClick={() =>
                          window.ipc.invoke('download:openPath', t.outputPath)
                        }
                      >
                        <FolderOpen className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                ))}
              {tasks.length === 0 && genQueue.length === 0 && !generating && (
                <div className="text-xs text-muted-foreground text-center py-4">
                  暂无合成记录
                </div>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
