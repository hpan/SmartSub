/**
 * 下载任务进度卡片
 */

import React from 'react';
import { useTranslation } from 'next-i18next';
import {
  X,
  Trash2,
  FolderOpen,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Clock,
  Music,
  FileVideo,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { cn } from 'lib/utils';
import type { DownloadTask } from '../../../types/videoDownload';

interface Props {
  task: DownloadTask;
  onCancel: () => void;
  onClear: () => void;
  onShowInFolder: () => void;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '--';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatSpeed(bytesPerSec: number): string {
  if (!bytesPerSec || bytesPerSec <= 0) return '';
  return `${formatBytes(bytesPerSec)}/s`;
}

function formatEta(seconds: number): string {
  if (!seconds || seconds <= 0) return '';
  if (seconds < 60) return `${seconds}秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}时${m}分`;
}

const STATUS_CONFIG: Record<
  string,
  { icon: React.ComponentType<any>; color: string; label: string }
> = {
  pending: { icon: Clock, color: 'text-muted-foreground', label: 'waiting' },
  fetching: { icon: Loader2, color: 'text-blue-500', label: 'fetching' },
  ready: { icon: Clock, color: 'text-muted-foreground', label: 'ready' },
  downloading: { icon: Loader2, color: 'text-blue-500', label: 'downloading' },
  completed: {
    icon: CheckCircle2,
    color: 'text-green-500',
    label: 'completed',
  },
  failed: { icon: AlertCircle, color: 'text-red-500', label: 'failed' },
  cancelled: { icon: X, color: 'text-muted-foreground', label: 'cancelled' },
};

export function TaskProgressCard({
  task,
  onCancel,
  onClear,
  onShowInFolder,
}: Props) {
  const { t } = useTranslation('download');
  const statusCfg = STATUS_CONFIG[task.status] || STATUS_CONFIG.pending;
  const StatusIcon = statusCfg.icon;
  const isActive =
    task.status === 'downloading' ||
    task.status === 'fetching' ||
    task.status === 'pending';
  const isCompleted = task.status === 'completed';
  const isFailed = task.status === 'failed';

  // 构建进度条下方的状态文字
  const progressStatusText =
    task.status === 'downloading'
      ? (task as any).statusText || '' // 主进程发来的 statusText
      : '';

  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-lg border p-3 transition-colors',
        isCompleted &&
          'border-green-200 bg-green-50/50 dark:border-green-900 dark:bg-green-950/20',
        isFailed &&
          'border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/20',
      )}
    >
      {/* 头部: 标题 + 状态 + 操作 */}
      <div className="flex items-start gap-3">
        {/* 图标 */}
        <div className="mt-0.5">
          {task.videoInfo.platform === 'xiaoyuzhou' ? (
            <Music className="h-4 w-4 text-orange-500" />
          ) : (
            <FileVideo className="h-4 w-4 text-blue-500" />
          )}
        </div>

        {/* 标题 */}
        <div className="min-w-0 flex-1">
          <p className="line-clamp-1 text-sm font-medium">
            {task.videoInfo.title}
          </p>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
            {task.videoInfo.uploader && <span>{task.videoInfo.uploader}</span>}
          </div>
        </div>

        {/* 状态 */}
        <div className="flex items-center gap-1.5">
          <Badge
            variant={
              isCompleted ? 'default' : isFailed ? 'destructive' : 'secondary'
            }
            className="shrink-0"
          >
            <StatusIcon
              className={cn(
                'mr-1 h-3 w-3',
                statusCfg.color,
                (task.status === 'downloading' || task.status === 'fetching') &&
                  'animate-spin',
              )}
            />
            {t(statusCfg.label)}
          </Badge>

          {/* 操作按钮 */}
          {isActive && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={onCancel}
            >
              <X className="h-3 w-3" />
            </Button>
          )}
          {(isCompleted || isFailed || task.status === 'cancelled') && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={onClear}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
          {isCompleted && task.outputPath && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={onShowInFolder}
            >
              <FolderOpen className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      {/* 进度条 */}
      {isActive && (
        <div className="flex flex-col gap-1">
          <Progress value={task.progress} className="h-2" />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-2">
              <span className="font-medium text-foreground">
                {task.progress.toFixed(1)}%
              </span>
              {progressStatusText && (
                <span className="text-blue-500 dark:text-blue-400">
                  {progressStatusText}
                </span>
              )}
            </span>
            <div className="flex items-center gap-3">
              {task.speed > 0 && <span>{formatSpeed(task.speed)}</span>}
              {task.totalSize > 0 && (
                <span>
                  {formatBytes(task.downloaded)} / {formatBytes(task.totalSize)}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 错误信息 */}
      {isFailed && task.error && (
        <p className="text-xs text-red-500 dark:text-red-400">{task.error}</p>
      )}

      {/* 完成信息 */}
      {isCompleted && task.outputPath && (
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-xs text-green-600 dark:text-green-400">
            {task.outputPath}
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 shrink-0 px-2 text-xs"
            onClick={onShowInFolder}
          >
            <FolderOpen className="mr-1 h-3 w-3" />
            打开目录
          </Button>
        </div>
      )}
    </div>
  );
}
