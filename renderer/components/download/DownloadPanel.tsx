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

function guessOutputDir(title: string): string {
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

export function DownloadPanel() {
  const { t } = useTranslation('download');

  // ---- State ----
  const [activeTab, setActiveTab] = useState<TabKey>('input');
  const [urlInput, setUrlInput] = useState('');
  const [batchMode, setBatchMode] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [parsedInfo, setParsedInfo] = useState<DownloadVideoInfo | null>(null);
  const [isXiaoyuzhou, setIsXiaoyuzhou] = useState(false);
  const [xyzEpisode, setXyzEpisode] = useState<any>(null);
  const [selectedFormatId, setSelectedFormatId] = useState<string>('best');
  const [downloadSubtitles, setDownloadSubtitles] = useState(false);
  const [outputDir, setOutputDir] = useState('');
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [config, setConfig] = useState<DownloadConfig | null>(null);
  const [ytdlpStatus, setYtdlpStatus] = useState<YtdlpStatus | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const urlInputRef = useRef<HTMLTextAreaElement>(null);

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
        setTasks((prev) =>
          prev.map((t) =>
            t.id === data.taskId
              ? {
                  ...t,
                  status: 'completed',
                  progress: 100,
                  outputPath: data.outputPath,
                }
              : t,
          ),
        );
        toast.success(t('downloadComplete'));
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
      setTasks(t || []);
    } catch {}
  };

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
            await createDownloadTask(
              result.data,
              result.isXiaoyuzhou,
              result.xyzEpisode,
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
          setSelectedFormatId('best');
          // 根据标题自动匹配保存目录
          const guessed = guessOutputDir(result.data.title || '');
          if (guessed) setOutputDir(guessed);
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
    isXyz: boolean = false,
    xyzEp: any = null,
  ) => {
    const taskId = `dl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const task: Partial<DownloadTask> = {
      id: taskId,
      videoInfo: info,
      selectedFormatId: selectedFormatId === 'best' ? null : selectedFormatId,
      downloadSubtitles,
      outputDir: outputDir || config?.defaultOutputDir || '',
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
    await createDownloadTask(parsedInfo, isXiaoyuzhou, xyzEpisode);
  };

  // ---- Cancel download ----
  const handleCancel = async (taskId: string) => {
    await window.ipc.invoke(DOWNLOAD_IPC_CHANNELS.CANCEL_DOWNLOAD, taskId);
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
    const text = e.clipboardData.getData('text');
    const lines = text.split('\n').filter((l) => l.trim());
    if (lines.length > 1) {
      e.preventDefault();
      setBatchMode(true);
      setUrlInput(lines.map((l) => l.trim()).join('\n'));
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

              {/* 格式选择 */}
              {!isXiaoyuzhou && parsedInfo.formats.length > 0 && (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-3">
                    <Label className="text-sm font-medium">
                      {t('selectQuality')}
                    </Label>
                    <Select
                      value={selectedFormatId}
                      onValueChange={setSelectedFormatId}
                    >
                      <SelectTrigger className="w-[280px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="best">
                          <span className="flex items-center gap-1.5">
                            <FileVideo className="h-3.5 w-3.5" />
                            {t('bestQuality')}
                          </span>
                        </SelectItem>
                        {getFormatGroups(parsedInfo.formats).video.map((f) => (
                          <SelectItem key={f.formatId} value={f.formatId}>
                            <span className="flex items-center gap-1.5">
                              <FileVideo className="h-3.5 w-3.5" />
                              {f.label}
                            </span>
                          </SelectItem>
                        ))}
                        {getFormatGroups(parsedInfo.formats).audio.length >
                          0 && (
                          <>
                            <SelectItem
                              value="bestaudio"
                              disabled
                              className="text-xs text-muted-foreground"
                            >
                              ── 音频 ──
                            </SelectItem>
                            {getFormatGroups(parsedInfo.formats).audio.map(
                              (f) => (
                                <SelectItem
                                  key={`audio-${f.formatId}`}
                                  value={f.formatId}
                                >
                                  <span className="flex items-center gap-1.5">
                                    <Music className="h-3.5 w-3.5" />
                                    {f.label}
                                  </span>
                                </SelectItem>
                              ),
                            )}
                          </>
                        )}
                      </SelectContent>
                    </Select>
                  </div>

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
                      onCancel={() => handleCancel(task.id)}
                      onClear={() => handleClearTask(task.id)}
                      onShowInFolder={() =>
                        task.outputPath && handleShowInFolder(task.outputPath)
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
