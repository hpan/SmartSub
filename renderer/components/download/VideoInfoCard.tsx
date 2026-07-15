/**
 * 视频信息卡片
 * 显示解析后的视频元信息，支持下载封面图
 */

import React, { useState } from 'react';
import { useTranslation } from 'next-i18next';
import { Clock, User, Globe, Film, Download } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import type { DownloadVideoInfo } from '../../../types/videoDownload';

interface Props {
  info: DownloadVideoInfo;
  isXiaoyuzhou: boolean;
  outputDir?: string;
}

const PLATFORM_LABELS: Record<string, { label: string; color: string }> = {
  bilibili: {
    label: 'Bilibili',
    color: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300',
  },
  youtube: {
    label: 'YouTube',
    color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  },
  xiaohongshu: {
    label: '小红书',
    color: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
  },
  xiaoyuzhou: {
    label: '小宇宙',
    color:
      'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  },
  weixin_video: {
    label: '视频号',
    color:
      'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  },
  generic: {
    label: '其他',
    color: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  },
};

function formatDuration(seconds: number | null): string {
  if (!seconds) return '--';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0)
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function VideoInfoCard({ info, isXiaoyuzhou, outputDir }: Props) {
  const { t } = useTranslation('download');
  const platform = PLATFORM_LABELS[info.platform] || PLATFORM_LABELS.generic;
  const [downloading, setDownloading] = useState(false);

  const handleDownloadThumbnail = async () => {
    if (!info.thumbnail) {
      toast.error('没有封面图可下载');
      return;
    }

    if (!outputDir) {
      toast.error('请先选择保存目录');
      return;
    }

    setDownloading(true);
    try {
      const result = await window.ipc.invoke('download:downloadThumbnail', {
        thumbnailUrl: info.thumbnail,
        outputDir,
        title: info.title,
      });

      if (result.success) {
        toast.success('封面图已保存');
        // 打开文件所在目录
        await window.ipc.invoke('download:showItemInFolder', result.data);
      } else {
        toast.error(result.error || '下载封面图失败');
      }
    } catch (error) {
      toast.error(`下载封面图失败: ${error}`);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex gap-4 rounded-lg border bg-card p-4">
      {/* 缩略图 */}
      {info.thumbnail && (
        <div className="relative h-24 w-40 shrink-0 overflow-hidden rounded-md bg-muted group">
          <img
            src={info.thumbnail}
            alt={info.title}
            className="h-full w-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
          {/* 下载封面图按钮 */}
          <Button
            size="sm"
            variant="secondary"
            className="absolute bottom-1 right-1 h-7 gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={handleDownloadThumbnail}
            disabled={downloading}
          >
            <Download className="h-3 w-3" />
            {downloading ? '下载中...' : '保存封面'}
          </Button>
        </div>
      )}

      {/* 信息 */}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h3 className="line-clamp-2 text-sm font-medium leading-tight">
          {info.title}
        </h3>

        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="secondary" className={platform.color}>
            {isXiaoyuzhou ? t('xiaoyuzhou') : platform.label}
          </Badge>

          {info.uploader && (
            <span className="flex items-center gap-1">
              <User className="h-3 w-3" />
              {info.uploader}
            </span>
          )}

          {info.duration != null && info.duration > 0 && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatDuration(info.duration)}
            </span>
          )}

          {info.formats.length > 0 && (
            <span className="flex items-center gap-1">
              <Film className="h-3 w-3" />
              {info.formats.length} 个格式
            </span>
          )}

          {info.isPlaylist && info.playlistCount && (
            <Badge variant="outline">
              播放列表 · {info.playlistCount} 个视频
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
}
