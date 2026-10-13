import { v4 as uuidv4 } from 'uuid';
import { useRouter } from 'next/router';
/**
 * 下载面板主组件
 * 包含 URL 输入、格式选择、下载队列
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'next-i18next';
import {
  Download,
  Link as LinkIcon,
  Play,
  X,
  Trash2,
  FolderOpen,
  FileVideo,
  Music,
  Settings as SettingsIcon,
  Loader2,
  CheckCircle2,
  AlertCircle,
  RotateCw,
  List,
  LayoutGrid,
  Clock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from 'lib/utils';

/** 标题关键词 → 本地保存目录的映射规则 */
const TITLE_DIR_RULES: { keywords: string[]; dir: string }[] = [
  {
    keywords: ['大摩', 'Morgan'],
    dir: '/Users/vangogh/Downloads/财经大咖观点/大摩闭门会2026',
  },
  {
    keywords: ['中金', 'CICC'],
    dir: '/Users/vangogh/Downloads/财经大咖观点/中金观点',
  },
  {
    keywords: ['招商'],
    dir: '/Users/vangogh/Downloads/财经大咖观点/招商宏观周周谈',
  },
  {
    keywords: ['华创', '张瑜'],
    dir: '/Users/vangogh/Downloads/财经大咖观点/华创张瑜旬度时间2026',
  },
  { keywords: ['国海'], dir: '/Users/vangogh/Downloads/财经大咖观点/国海证券' },
  { keywords: ['中信'], dir: '/Users/vangogh/Downloads/财经大咖观点/中信证券' },
  { keywords: ['广发'], dir: '/Users/vangogh/Downloads/财经大咖观点/广发策略' },
];

/** 平台 → 本地保存目录的映射规则（优先于标题关键词匹配） */
const PLATFORM_DIR_RULES: Record<string, string> = {
  douyin: '/Users/vangogh/Downloads/财经大咖观点/抖音/incoming',
  xiaohongshu: '/Users/vangogh/Downloads/财经大咖观点/小红书/incoming',
};

function guessOutputDir(
  title: string,
  platform?: string,
  originalUrl?: string,
): string {
  // 平台规则优先
  if (platform && PLATFORM_DIR_RULES[platform]) {
    return PLATFORM_DIR_RULES[platform];
  }
  // 兜底：从 URL 检测平台
  if (originalUrl) {
    const lower = originalUrl.toLowerCase();
    if (
      lower.includes('douyin.com') ||
      lower.includes('iesdouyin.com') ||
      lower.includes('v.douyin.com')
    )
      return PLATFORM_DIR_RULES['douyin'] || '';
    if (
      lower.includes('xiaohongshu.com') ||
      lower.includes('xhslink.com') ||
      lower.includes('xhslink.cn')
    )
      return PLATFORM_DIR_RULES['xiaohongshu'] || '';
  }
  // 标题关键词匹配
  const t = title.toLowerCase();
  for (const rule of TITLE_DIR_RULES) {
    if (rule.keywords.some((kw) => t.includes(kw.toLowerCase()))) {
      return rule.dir;
    }
  }
  return '';
}
import { toast } from 'sonner';
import type {
  DownloadVideoInfo,
  DownloadFormat,
  DownloadTask,
  DownloadConfig,
  YtdlpStatus,
} from '../../../types/videoDownload';
import { DOWNLOAD_IPC_CHANNELS } from '../../../types/videoDownload';
import { DownloadSettingsSheet } from './DownloadSettingsSheet';
import { TaskProgressCard } from './TaskProgressCard';
import { VideoInfoCard } from './VideoInfoCard';

type TabKey = 'input' | 'queue';

const QUEUE_KEY = 'smartsub_download_queue';

function saveQueueToStorage(tasks: DownloadTask[]) {
  try {
    const completed = tasks.filter(
      (t) => t.status === 'completed' && t.outputPath,
    );
    // Keep last 200 completed tasks
    const toSave = completed.slice(-200).map((t) => ({
      id: t.id,
      status: t.status,
      videoInfo: t.videoInfo,
      outputPath: t.outputPath,
      totalSize: t.totalSize,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }));
    localStorage.setItem(QUEUE_KEY, JSON.stringify(toSave));
  } catch {}
}

function loadQueueFromStorage(): DownloadTask[] {
  try {
    const data = localStorage.getItem(QUEUE_KEY);
    if (!data) return [];
    return JSON.parse(data).map((t: any) => ({
      ...t,
      progress: 100,
      speed: 0,
      downloaded: t.totalSize || 0,
    }));
  } catch {
    return [];
  }
}

export function DownloadPanel() {
  const { t } = useTranslation('grab');

  // ---- State ----
  const [activeTab, setActiveTab] = useState<TabKey>('input');
  const [urlInput, setUrlInput] = useState('');
  const [batchMode, setBatchMode] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [parsedInfo, setParsedInfo] = useState<DownloadVideoInfo | null>(null);
  const [isXiaoyuzhou, setIsXiaoyuzhou] = useState(false);
  const [xyzEpisode, setXyzEpisode] = useState<any>(null);
  const [selectedVideoFormatId, setSelectedVideoFormatId] =
    useState<string>('none');
  const [selectedAudioFormatId, setSelectedAudioFormatId] =
    useState<string>('bestaudio');
  const [downloadCover, setDownloadCover] = useState(false);
  const [downloadSubtitles, setDownloadSubtitles] = useState(false);
  const [outputDir, setOutputDir] = useState('');
  const [customFilename, setCustomFilename] = useState('');
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [config, setConfig] = useState<DownloadConfig | null>(null);
  const [ytdlpStatus, setYtdlpStatus] = useState<YtdlpStatus | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const urlInputRef = useRef<HTMLTextAreaElement>(null);
  const router = useRouter();

  // ---- Load initial data ----
  useEffect(() => {
    loadConfig();
    loadYtdlpStatus();
    loadTasks();

    // 监听进度事件
    const unsubProgress = window.ipc.on(
      DOWNLOAD_IPC_CHANNELS.TASK_PROGRESS,
      (data: any) => {
        setTasks((prev) =>
          prev.map((t) =>
            t.id === data.taskId
              ? {
                  ...t,
                  progress: data.percent,
                  speed: data.speed || 0,
                  downloaded: data.downloaded || 0,
                  totalSize: data.totalSize || 0,
                  statusText: data.statusText || '',
                }
              : t,
          ),
        );
      },
    );

    const unsubStatus = window.ipc.on(
      DOWNLOAD_IPC_CHANNELS.TASK_STATUS_CHANGE,
      (data: any) => {
        setTasks((prev) =>
          prev.map((t) =>
            t.id === data.taskId
              ? {
                  ...t,
                  status: data.status,
                  error: data.error || t.error,
                  outputPath: data.outputPath || t.outputPath,
                }
              : t,
          ),
        );
      },
    );

    const unsubComplete = window.ipc.on(
      DOWNLOAD_IPC_CHANNELS.TASK_COMPLETE,
      (data: any) => {
        let completedTask: any = null;
        setTasks((prev) => {
          completedTask = prev.find((t) => t.id === data.taskId);
          const updated = prev.map((t) =>
            t.id === data.taskId
              ? {
                  ...t,
                  status: 'completed' as const,
                  progress: 100,
                  outputPath: data.outputPath,
                }
              : t,
          );
          saveQueueToStorage(updated);
          return updated;
        });
        toast.success(t('downloadComplete'));
        // 自动创建工作台任务
        if (completedTask && data.outputPath) {
          window.ipc
            .invoke('workspace:addFromDownload', {
              title: completedTask.videoInfo?.title || '未命名',
              filePath: data.outputPath,
              sourceUrl: completedTask.videoInfo?.originalUrl || '',
              bvid: completedTask.videoInfo?.bvid || '',
            })
            .catch(() => {});
        }
      },
    );

    const unsubError = window.ipc.on(
      DOWNLOAD_IPC_CHANNELS.TASK_ERROR,
      (data: any) => {
        setTasks((prev) =>
          prev.map((t) =>
            t.id === data.taskId
              ? { ...t, status: 'failed', error: data.error }
              : t,
          ),
        );
        toast.error(data.error || t('downloadError'));
      },
    );

    return () => {
      unsubProgress();
      unsubStatus();
      unsubComplete();
      unsubError();
    };
  }, []);

  const loadConfig = async () => {
    try {
      const c = await window.ipc.invoke(DOWNLOAD_IPC_CHANNELS.GET_CONFIG);
      setConfig(c);
      setOutputDir(c.defaultOutputDir || '');
      setDownloadSubtitles(c.downloadSubtitles || false);
    } catch {}
  };

  const loadYtdlpStatus = async () => {
    try {
      const status = await window.ipc.invoke(
        DOWNLOAD_IPC_CHANNELS.GET_YTDLP_STATUS,
      );
      setYtdlpStatus(status);
    } catch {}
  };

  const loadTasks = async () => {
    try {
      const t = await window.ipc.invoke(DOWNLOAD_IPC_CHANNELS.GET_TASKS);
      const currentTasks: DownloadTask[] = t || [];
      // Merge persisted completed tasks
      const persisted = loadQueueFromStorage();
      const currentIds = new Set(currentTasks.map((ct) => ct.id));
      const merged = [
        ...currentTasks,
        ...persisted.filter((pt) => !currentIds.has(pt.id)),
      ];
      // 按创建时间倒序，最新抓取的排在最上面
      merged.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      setTasks(merged);
    } catch {}
  };

  // 当 parsedInfo 变化时，自动从 URL 检测保存目录
  useEffect(() => {
    if (!parsedInfo) return;
    const guessed = guessOutputDir(
      parsedInfo.title || '',
      parsedInfo.platform,
      parsedInfo.originalUrl,
    );
    if (guessed) {
      setOutputDir(guessed);
    }
  }, [parsedInfo]);

  // ---- Parse URL ----
  const handleParse = useCallback(async () => {
    const urls = batchMode
      ? urlInput
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)
      : [urlInput.trim()];

    if (urls.length === 0 || !urls[0]) {
      toast.error(t('noResults'));
      return;
    }

    setParsing(true);
    setParsedInfo(null);

    try {
      if (batchMode) {
        // 批量解析 -> 每个都创建任务
        const results = await window.ipc.invoke(
          DOWNLOAD_IPC_CHANNELS.PARSE_BATCH,
          urls,
        );
        let successCount = 0;
        for (const result of results) {
          if (result.success) {
            successCount++;
            const guessedDir = guessOutputDir(
              result.data.title || '',
              result.data.platform,
              result.data.originalUrl,
            );
            await createDownloadTask(
              result.data,
              result.isXiaoyuzhou,
              result.xyzEpisode,
              guessedDir || undefined,
            );
          }
        }
        toast.success(`成功解析 ${successCount}/${urls.length} 个链接`);
        setActiveTab('queue');
      } else {
        const result = await window.ipc.invoke(
          DOWNLOAD_IPC_CHANNELS.PARSE_URL,
          urls[0],
        );
        if (result.success) {
          setParsedInfo(result.data);
          setIsXiaoyuzhou(result.isXiaoyuzhou);
          setXyzEpisode(result.xyzEpisode || null);
          setSelectedVideoFormatId('none');
          setSelectedAudioFormatId('bestaudio');
          setDownloadCover(false);
          // 根据标题自动匹配保存目录
          const guessed = guessOutputDir(
            result.data.title || '',
            result.data.platform,
            urls[0],
          );
          console.log(
            '[handleParse] guessed dir:',
            guessed,
            'platform:',
            result.data.platform,
          );
          if (guessed) setOutputDir(guessed);
          // Preview renamed filename
          try {
            const preview = await window.ipc.invoke('download:previewRename', {
              title: result.data.title || '',
              uploadDate: result.data.uploadDate || null,
              originalUrl: urls[0] || '',
              originalFilename: result.data.title || 'video',
              ext: 'mp4', // just for preview calculation
            });
            if (preview) {
              // Strip extension — we'll add the correct one per file type during download
              const baseName = preview.replace(/\.[^.]+$/, '');
              setCustomFilename(baseName);
            }
          } catch {}
        } else {
          toast.error(result.error || t('parseError'));
        }
      }
    } catch (error: any) {
      toast.error(error.message || t('parseError'));
    } finally {
      setParsing(false);
    }
  }, [urlInput, batchMode]);

  // ---- Create download task ----
  const createDownloadTask = async (
    info: DownloadVideoInfo,
    downloadType: 'video' | 'audio' = 'video',
    isXyz: boolean = false,
    xyzEp: any = null,
    overrideOutputDir?: string,
  ) => {
    const taskId = `dl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const isAudioOnly = downloadType === 'audio';
    // Resolve outputDir: override > state > platform guess > default
    let resolvedOutputDir = overrideOutputDir || outputDir || '';
    if (!resolvedOutputDir || resolvedOutputDir === config?.defaultOutputDir) {
      const platformGuess = guessOutputDir(
        info.title || '',
        info.platform,
        info.originalUrl,
      );
      if (platformGuess) resolvedOutputDir = platformGuess;
    }
    if (!resolvedOutputDir) resolvedOutputDir = config?.defaultOutputDir || '';
    console.log(
      '[download] createDownloadTask:',
      downloadType,
      'resolvedOutputDir:',
      resolvedOutputDir,
      'platform:',
      info.platform,
    );
    const task: Partial<DownloadTask> = {
      id: taskId,
      videoInfo: info,
      selectedVideoFormatId: isAudioOnly
        ? 'none'
        : selectedVideoFormatId === 'best'
          ? null
          : selectedVideoFormatId,
      selectedAudioFormatId: isAudioOnly
        ? selectedAudioFormatId === 'bestaudio'
          ? null
          : selectedAudioFormatId
        : 'none',
      downloadCover: false, // Cover is handled separately
      downloadSubtitles,
      outputDir: resolvedOutputDir,
      customFilename: customFilename || undefined,
      isXiaoyuzhou: isXyz,
      xyzEpisodeUrl: isXyz ? info.originalUrl : undefined,
    };

    // 先把任务卡片加到列表（状态为 downloading），再切到队列 tab
    const fullTask: DownloadTask = {
      ...(task as DownloadTask),
      status: 'downloading',
      progress: 0,
      speed: 0,
      downloaded: 0,
      totalSize: 0,
      outputPath: null,
      error: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setTasks((prev) => [fullTask, ...prev]);
    setActiveTab('queue');
    setParsedInfo(null);
    setUrlInput('');

    // 然后发起下载（不 await，让进度事件通过 listener 回来更新任务卡片）
    window.ipc
      .invoke(DOWNLOAD_IPC_CHANNELS.START_DOWNLOAD, task)
      .catch((err: any) => {
        console.error('[download] start failed:', err);
      });
  };

  // ---- Start download ----
  const handleStartDownload = async () => {
    if (!parsedInfo) return;

    const hasVideo = selectedVideoFormatId !== 'none';
    const hasAudio = selectedAudioFormatId !== 'none';

    console.log(
      '[download] selectedVideoFormatId:',
      selectedVideoFormatId,
      'selectedAudioFormatId:',
      selectedAudioFormatId,
      'downloadCover:',
      downloadCover,
    );
    console.log('[download] hasVideo:', hasVideo, 'hasAudio:', hasAudio);

    if (!hasVideo && !hasAudio && !downloadCover) {
      toast.error('请至少选择一项下载内容');
      return;
    }

    // 下载封面图
    if (downloadCover && parsedInfo.thumbnail) {
      try {
        const coverResult = await window.ipc.invoke(
          'download:downloadThumbnail',
          {
            thumbnailUrl: parsedInfo.thumbnail,
            outputDir: (() => {
              if (outputDir && outputDir !== config?.defaultOutputDir)
                return outputDir;
              const g = guessOutputDir(
                parsedInfo.title || '',
                parsedInfo.platform,
                parsedInfo.originalUrl,
              );
              return g || config?.defaultOutputDir || '';
            })(),
            title: parsedInfo.title || 'video',
          },
        );
        if (coverResult.success) {
          toast.success('封面图已保存');
        } else {
          toast.error(coverResult.error || '下载封面图失败');
        }
      } catch (err: any) {
        toast.error('下载封面图失败: ' + (err.message || err));
      }
    }

    // 下载视频和/或音频
    if (hasVideo) {
      await createDownloadTask(parsedInfo, 'video', isXiaoyuzhou, xyzEpisode);
    }
    if (hasAudio) {
      await createDownloadTask(parsedInfo, 'audio', isXiaoyuzhou, xyzEpisode);
    }
  };

  // ---- Cancel download ----
  const handleCancel = async (taskId: string) => {
    await window.ipc.invoke(DOWNLOAD_IPC_CHANNELS.CANCEL_DOWNLOAD, taskId);
  };

  // ---- Retry download ----
  const handleRetry = async (task: DownloadTask) => {
    const newId = `dl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const newTask: DownloadTask = {
      ...task,
      id: newId,
      status: 'downloading',
      progress: 0,
      speed: 0,
      downloaded: 0,
      totalSize: 0,
      outputPath: null,
      error: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setTasks((prev) => [newTask, ...prev]);
    setActiveTab('queue');

    const startPayload = {
      id: newId,
      videoInfo: task.videoInfo,
      selectedVideoFormatId: task.selectedVideoFormatId,
      selectedAudioFormatId: task.selectedAudioFormatId,
      downloadCover: task.downloadCover,
      downloadSubtitles: task.downloadSubtitles,
      outputDir: task.outputDir,
      customFilename: task.customFilename,
      isXiaoyuzhou: task.isXiaoyuzhou,
      xyzEpisodeUrl: task.xyzEpisodeUrl,
    };
    window.ipc
      .invoke(DOWNLOAD_IPC_CHANNELS.START_DOWNLOAD, startPayload)
      .catch((err: any) => {
        console.error('[download] retry start failed:', err);
      });
  };

  // ---- Clear task ----
  const handleClearTask = async (taskId: string) => {
    await window.ipc.invoke(DOWNLOAD_IPC_CHANNELS.CLEAR_TASK, taskId);
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
  };

  // ---- Clear all ----
  const handleClearAll = async () => {
    await window.ipc.invoke(DOWNLOAD_IPC_CHANNELS.CLEAR_ALL_TASKS);
    setTasks([]);
  };

  // ---- Select output dir ----
  const handleSelectDir = async () => {
    const dir = await window.ipc.invoke(
      DOWNLOAD_IPC_CHANNELS.SELECT_OUTPUT_DIR,
    );
    if (dir) setOutputDir(dir);
  };

  // ---- Open file/folder ----
  const handleOpenFile = (filePath: string) => {
    window.ipc.invoke('download:openPath', filePath);
  };
  const handleShowInFolder = (filePath: string) => {
    window.ipc.invoke('download:showItemInFolder', filePath);
  };

  // ---- Install/update yt-dlp ----
  const handleInstallYtdlp = async () => {
    setYtdlpStatus((prev) => (prev ? { ...prev, downloading: true } : prev));
    await window.ipc.invoke(DOWNLOAD_IPC_CHANNELS.INSTALL_YTDLP);
    await loadYtdlpStatus();
    toast.success('yt-dlp 安装完成');
  };

  const handleUpdateYtdlp = async () => {
    setYtdlpStatus((prev) => (prev ? { ...prev, downloading: true } : prev));
    await window.ipc.invoke(DOWNLOAD_IPC_CHANNELS.UPDATE_YTDLP);
    await loadYtdlpStatus();
    toast.success('yt-dlp 更新完成');
  };

  // ---- Format helpers ----
  const getFormatGroups = (formats: DownloadFormat[]) => {
    const videoFormats = formats.filter((f) => !f.audioOnly);
    const audioFormats = formats.filter((f) => f.audioOnly);

    // 去重: 按高度去重，取最佳
    const bestByHeight = new Map<string, DownloadFormat>();
    for (const f of videoFormats) {
      const height = f.resolution.split('x')[1] || f.resolution;
      const existing = bestByHeight.get(height);
      if (
        !existing ||
        (f.filesize && (!existing.filesize || f.filesize > existing.filesize))
      ) {
        bestByHeight.set(height, f);
      }
    }

    return {
      video: Array.from(bestByHeight.values()).sort((a, b) => {
        const hA = parseInt(a.resolution.split('x')[1]) || 0;
        const hB = parseInt(b.resolution.split('x')[1]) || 0;
        return hB - hA;
      }),
      audio: audioFormats.slice(0, 3), // 最多 3 个音频选项
    };
  };

  // ---- Active tasks count ----
  const activeTaskCount = tasks.filter(
    (t) =>
      t.status === 'downloading' ||
      t.status === 'fetching' ||
      t.status === 'pending',
  ).length;
  const completedTaskCount = tasks.filter(
    (t) => t.status === 'completed',
  ).length;

  // ---- Paste handler ----
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    let text = e.clipboardData.getData('text');
    // Strip markdown link syntax: [url](url) -> url
    text = text.replace(/\[(https?:\/\/[^\]]+)\]\([^)]*\)/g, '$1');
    // Extract URLs from pasted text (http/https or common platform patterns)
    const urlPattern = /https?:\/\/[^\s\]\)]+/g;
    const urls = (text.match(urlPattern) || ([] as string[])).filter((u) =>
      u.trim(),
    );
    // Only switch to batch mode if there are actually multiple URLs
    if (urls.length > 1) {
      e.preventDefault();
      setBatchMode(true);
      setUrlInput(urls.join('\n'));
    } else if (urls.length === 1) {
      // Single URL with surrounding text (e.g. Douyin share) — just use the URL
      e.preventDefault();
      setBatchMode(false);
      setUrlInput(urls[0]);
    }
  }, []);

  // ---- Render ----
  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden">
      {/* yt-dlp 未安装提示 */}
      {ytdlpStatus && !ytdlpStatus.installed && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
          <AlertCircle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span className="text-sm text-amber-800 dark:text-amber-200">
            {t('ytdlpNotInstalled')} — 需要安装 yt-dlp 才能下载视频
          </span>
          <Button
            size="sm"
            onClick={handleInstallYtdlp}
            disabled={ytdlpStatus.downloading}
          >
            {ytdlpStatus.downloading ? (
              <>
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                {t('ytdlpDownloading')}
              </>
            ) : (
              t('ytdlpInstall')
            )}
          </Button>
        </div>
      )}

      {/* Tab 切换 */}
      <div className="flex items-center gap-2">
        <div className="flex rounded-lg border p-0.5">
          <button
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              activeTab === 'input'
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setActiveTab('input')}
          >
            <LinkIcon className="h-3.5 w-3.5" />
            输入链接
          </button>
          <button
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              activeTab === 'queue'
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setActiveTab('queue')}
          >
            <List className="h-3.5 w-3.5" />
            {t('taskList')}
            {activeTaskCount > 0 && (
              <Badge
                variant="secondary"
                className="ml-1 h-5 min-w-5 justify-center px-1 text-xs"
              >
                {activeTaskCount}
              </Badge>
            )}
          </button>
        </div>

        <div className="flex-1" />

        {/* 设置按钮 */}
        <DownloadSettingsSheet
          config={config}
          ytdlpStatus={ytdlpStatus}
          onConfigChange={(c) => {
            setConfig(c);
            setOutputDir(c.defaultOutputDir || outputDir);
          }}
          onInstallYtdlp={handleInstallYtdlp}
          onUpdateYtdlp={handleUpdateYtdlp}
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
        />
      </div>

      {/* 输入面板 */}
      {activeTab === 'input' && (
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto">
          {/* URL 输入区域 */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Switch
                id="batchMode"
                checked={batchMode}
                onCheckedChange={setBatchMode}
              />
              <Label htmlFor="batchMode" className="text-sm">
                {t('batchMode')}
              </Label>
            </div>

            {batchMode ? (
              <textarea
                ref={urlInputRef as any}
                className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                placeholder={t('batchPlaceholder')}
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onPaste={handlePaste}
              />
            ) : (
              <div className="flex gap-2">
                <Input
                  ref={urlInputRef as any}
                  placeholder={t('urlPlaceholder')}
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  onPaste={handlePaste}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleParse();
                    }
                  }}
                />
              </div>
            )}

            <div className="flex gap-2">
              <Button
                onClick={handleParse}
                disabled={parsing || !urlInput.trim()}
              >
                {parsing ? (
                  <>
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    {t('parsing')}
                  </>
                ) : (
                  <>
                    <Play className="mr-1.5 h-4 w-4" />
                    {batchMode ? t('parseBatchBtn') : t('parseBtn')}
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* 解析结果 */}
          {parsedInfo && (
            <div className="flex flex-col gap-4">
              <VideoInfoCard
                info={parsedInfo}
                isXiaoyuzhou={isXiaoyuzhou}
                outputDir={outputDir || config?.defaultOutputDir}
              />

              {/* 格式选择：视频 + 音频 + 封面 — 同行 */}
              {!isXiaoyuzhou && parsedInfo.formats.length > 0 && (
                <div className="flex items-center gap-3 flex-wrap">
                  {/* 视频选择 */}
                  <div className="flex items-center gap-2">
                    <Label className="text-xs font-medium text-muted-foreground">
                      <FileVideo className="h-3.5 w-3.5 inline" /> 视频
                    </Label>
                    <Select
                      value={selectedVideoFormatId}
                      onValueChange={setSelectedVideoFormatId}
                    >
                      <SelectTrigger className="w-[180px] h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">不下载</SelectItem>
                        <SelectItem value="best">最佳画质</SelectItem>
                        {getFormatGroups(parsedInfo.formats).video.map((f) => (
                          <SelectItem key={f.formatId} value={f.formatId}>
                            {f.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* 音频选择 */}
                  <div className="flex items-center gap-2">
                    <Label className="text-xs font-medium text-muted-foreground">
                      <Music className="h-3.5 w-3.5 inline" /> 音频
                    </Label>
                    <Select
                      value={selectedAudioFormatId}
                      onValueChange={setSelectedAudioFormatId}
                    >
                      <SelectTrigger className="w-[180px] h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">不下载</SelectItem>
                        <SelectItem value="bestaudio">最佳音质</SelectItem>
                        {getFormatGroups(parsedInfo.formats).audio.map((f) => (
                          <SelectItem key={f.formatId} value={f.formatId}>
                            {f.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* 封面图 */}
                  {parsedInfo.thumbnail && (
                    <div className="flex items-center gap-1.5">
                      <Switch
                        id="downloadCover"
                        checked={downloadCover}
                        onCheckedChange={setDownloadCover}
                      />
                      <Label htmlFor="downloadCover" className="text-xs">
                        封面
                      </Label>
                    </div>
                  )}

                  {/* 字幕选项 */}
                  {parsedInfo.hasSubtitles && (
                    <div className="flex items-center gap-2">
                      <Switch
                        id="downloadSubs"
                        checked={downloadSubtitles}
                        onCheckedChange={setDownloadSubtitles}
                      />
                      <Label htmlFor="downloadSubs" className="text-sm">
                        {t('downloadSubtitles')}
                        <span className="ml-1 text-xs text-muted-foreground">
                          ({parsedInfo.subtitleLanguages.join(', ')})
                        </span>
                      </Label>
                    </div>
                  )}
                </div>
              )}

              {/* 保存位置 */}
              <div className="flex items-center gap-2">
                <Label className="shrink-0 text-sm">{t('outputDir')}:</Label>
                <div className="flex flex-1 items-center gap-1.5">
                  <code className="flex-1 truncate rounded bg-muted px-2 py-1 text-xs">
                    {outputDir || t('noResults')}
                  </code>
                  <Button variant="outline" size="sm" onClick={handleSelectDir}>
                    {t('changeDir')}
                  </Button>
                </div>
              </div>

              {/* 文件名预览 */}
              {parsedInfo && (
                <div className="flex items-center gap-2">
                  <Label className="shrink-0 text-sm">
                    文件名（不含扩展名）:
                  </Label>
                  <Input
                    value={customFilename}
                    onChange={(e) => setCustomFilename(e.target.value)}
                    className="flex-1 text-sm"
                    placeholder="下载后的文件名"
                  />
                </div>
              )}

              {/* 开始下载 */}
              <Button
                size="lg"
                onClick={handleStartDownload}
                className="w-full sm:w-auto"
              >
                <Download className="mr-2 h-4 w-4" />
                {t('downloadBtn')}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* 下载队列 */}
      {activeTab === 'queue' && (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
          {tasks.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
              <Download className="h-8 w-8" />
              <p className="text-sm">{t('emptyQueue')}</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {completedTaskCount > 0 && `${completedTaskCount} 已完成 · `}
                  {activeTaskCount > 0 && `${activeTaskCount} 下载中`}
                </span>
                <Button variant="ghost" size="sm" onClick={handleClearAll}>
                  <Trash2 className="mr-1 h-3 w-3" />
                  {t('clearAllBtn')}
                </Button>
              </div>
              <ScrollArea className="flex-1">
                <div className="flex flex-col gap-2 pr-4">
                  {tasks.map((task) => (
                    <TaskProgressCard
                      key={task.id}
                      task={task}
                      onRetry={
                        task.status === 'failed'
                          ? () => handleRetry(task)
                          : undefined
                      }
                      onCancel={() => handleCancel(task.id)}
                      onClear={() => handleClearTask(task.id)}
                      onShowInFolder={() =>
                        task.outputPath && handleShowInFolder(task.outputPath)
                      }
                      onOpenFile={() =>
                        task.outputPath &&
                        window.ipc.invoke('download:openPath', task.outputPath)
                      }
                      onRecognizeSubtitle={async () => {
                        try {
                          const loc = router.query.locale || 'zh';
                          const dropped = await window?.ipc?.invoke(
                            'getDroppedFiles',
                            { files: [task.outputPath], taskType: 'media' },
                          );
                          if (!dropped?.length) {
                            toast.error('无法导入文件');
                            return;
                          }
                          const id = uuidv4();
                          await window?.ipc?.invoke('saveTaskProject', {
                            id,
                            taskType: 'generateOnly',
                            files: dropped,
                          });
                          router.push(`/${loc}/tasks/generate?project=${id}`);
                        } catch (e) {
                          console.error('Navigate to subtitle failed:', e);
                        }
                      }}
                      onAudioVisualize={() => {
                        const loc = router.query.locale || 'zh';
                        router.push(
                          `/${loc}/audioVisualize?file=${encodeURIComponent(task.outputPath || '')}`,
                        );
                      }}
                      onAudioCut={() => {
                        const loc = router.query.locale || 'zh';
                        router.push(
                          `/${loc}/audioCut?file=${encodeURIComponent(task.outputPath || '')}`,
                        );
                      }}
                      onGenerateCovers={
                        task.outputPath
                          ? async () => {
                              try {
                                toast.loading('正在生成封面...', {
                                  id: 'gen-covers',
                                });
                                const res = await window.ipc.invoke(
                                  'download:generateCovers',
                                  task.outputPath,
                                );
                                if (res.success) {
                                  toast.success('封面生成完成', {
                                    id: 'gen-covers',
                                  });
                                } else {
                                  toast.error(res.error || '封面生成失败', {
                                    id: 'gen-covers',
                                  });
                                }
                              } catch (e: any) {
                                toast.error(
                                  '封面生成失败: ' + (e.message || e),
                                  { id: 'gen-covers' },
                                );
                              }
                            }
                          : undefined
                      }
                      onUploadIMA={
                        task.outputPath &&
                        task.videoInfo?.platform !== 'douyin' &&
                        task.videoInfo?.platform !== 'xiaohongshu'
                          ? async () => {
                              try {
                                toast.loading('正在上传到 IMA 知识库...', {
                                  id: 'ima-upload',
                                });
                                const res = await window.ipc.invoke(
                                  'ima:upload',
                                  task.outputPath,
                                  task.videoInfo?.title || '',
                                );
                                if (res.success) {
                                  toast.success('上传 IMA 成功', {
                                    id: 'ima-upload',
                                  });
                                } else {
                                  toast.error(res.error || '上传 IMA 失败', {
                                    id: 'ima-upload',
                                  });
                                }
                              } catch (e: any) {
                                toast.error(
                                  '上传 IMA 失败: ' + (e.message || e),
                                  { id: 'ima-upload' },
                                );
                              }
                            }
                          : undefined
                      }
                    />
                  ))}
                </div>
              </ScrollArea>
            </>
          )}
        </div>
      )}
    </div>
  );
}
