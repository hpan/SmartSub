/**
 * 下载历史记录组件
 * 显示已完成的下载文件，并提供后续操作入口
 */

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { v4 as uuidv4 } from 'uuid';
import {
  FileVideo,
  Music,
  FolderOpen,
  ExternalLink,
  Subtitles,
  Film,
  Trash2,
  Clock,
  Download,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { cn } from 'lib/utils';

interface DownloadRecord {
  id: string;
  title: string;
  filePath: string;
  fileType: 'video' | 'audio';
  platform: string;
  downloadDate: string;
  thumbnail?: string;
}

const HISTORY_KEY = 'smartsub_download_history';

function loadHistory(): DownloadRecord[] {
  try {
    const data = localStorage.getItem(HISTORY_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function saveHistory(records: DownloadRecord[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(records));
}

function formatFileType(filePath: string): 'video' | 'audio' {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  if (['mp3', 'm4a', 'wav', 'flac', 'aac', 'opus'].includes(ext))
    return 'audio';
  return 'video';
}

function getPlatformLabel(platform: string): string {
  const map: Record<string, string> = {
    bilibili: 'B站',
    youtube: 'YouTube',
    douyin: '抖音',
    xiaohongshu: '小红书',
    weixin_video: '视频号',
    xiaoyuzhou: '小宇宙',
    generic: '其他',
  };
  return map[platform] || platform;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return '刚刚';
  if (diffMins < 60) return `${diffMins}分钟前`;
  if (diffHours < 24) return `${diffHours}小时前`;
  if (diffDays < 7) return `${diffDays}天前`;
  return d.toLocaleDateString('zh-CN');
}

export function DownloadHistory() {
  const router = useRouter();
  const { locale } = router.query;
  const [records, setRecords] = useState<DownloadRecord[]>([]);

  useEffect(() => {
    setRecords(loadHistory());
  }, []);

  const handleClearAll = () => {
    setRecords([]);
    saveHistory([]);
  };

  const handleRemove = (id: string) => {
    const updated = records.filter((r) => r.id !== id);
    setRecords(updated);
    saveHistory(updated);
  };

  const handleOpenFile = (filePath: string) => {
    window.ipc.invoke('download:openPath', filePath);
  };

  const handleShowInFolder = (filePath: string) => {
    window.ipc.invoke('download:showItemInFolder', filePath);
  };

  const handleGoToSubtitle = async (record: DownloadRecord) => {
    try {
      const loc = String(locale || 'zh');
      // Validate the file exists (use 'media' taskType since audio/video files are media inputs)
      const dropped = await window?.ipc?.invoke('getDroppedFiles', {
        files: [record.filePath],
        taskType: 'media',
      });
      if (!dropped?.length) {
        // Fallback: just navigate to home
        router.push(`/${loc}/home`);
        return;
      }
      // Create a new task project
      const id = uuidv4();
      await window?.ipc?.invoke('saveTaskProject', {
        id,
        taskType: 'generateOnly',
        files: dropped,
      });
      router.push(`/${loc}/tasks/generate?project=${id}`);
    } catch (e) {
      console.error('Navigate to subtitle failed:', e);
      router.push(`/${String(locale || 'zh')}/home`);
    }
  };

  const handleGoToCompose = (record: DownloadRecord) => {
    const loc = String(locale || 'zh');
    router.push(
      `/${loc}/audioVisualize?file=${encodeURIComponent(record.filePath)}`,
    );
  };

  if (records.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
        <Clock className="h-8 w-8" />
        <p className="text-sm">暂无下载记录</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          共 {records.length} 条记录
        </span>
        <Button variant="ghost" size="sm" onClick={handleClearAll}>
          <Trash2 className="mr-1 h-3 w-3" />
          清空记录
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-2 pr-4">
          {records.map((record) => (
            <div
              key={record.id}
              className={cn(
                'flex flex-col gap-2 rounded-lg border p-3 transition-colors hover:bg-accent/50',
              )}
            >
              {/* 标题行 */}
              <div className="flex items-start gap-2">
                {record.fileType === 'audio' ? (
                  <Music className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
                ) : (
                  <FileVideo className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                )}
                <div className="min-w-0 flex-1">
                  <p
                    className="truncate text-sm font-medium"
                    title={record.title}
                  >
                    {record.title}
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs">
                      {getPlatformLabel(record.platform)}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      {record.fileType === 'audio' ? '音频' : '视频'}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(record.downloadDate)}
                    </span>
                  </div>
                </div>
              </div>

              {/* 操作按钮行 */}
              <div className="flex flex-wrap gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => handleOpenFile(record.filePath)}
                >
                  <ExternalLink className="mr-1 h-3 w-3" />
                  打开文件
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => handleShowInFolder(record.filePath)}
                >
                  <FolderOpen className="mr-1 h-3 w-3" />
                  打开目录
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => handleGoToSubtitle(record)}
                >
                  <Subtitles className="mr-1 h-3 w-3" />
                  识别字幕
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => handleGoToCompose(record)}
                >
                  <Film className="mr-1 h-3 w-3" />
                  音频可视化
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-muted-foreground"
                  onClick={() => handleRemove(record.id)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

/**
 * 添加下载记录到历史
 */
export function addDownloadRecord(
  record: Omit<DownloadRecord, 'id' | 'downloadDate'>,
) {
  const history = loadHistory();
  const newRecord: DownloadRecord = {
    ...record,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    downloadDate: new Date().toISOString(),
  };
  // Avoid duplicates by file path
  const filtered = history.filter((r) => r.filePath !== record.filePath);
  filtered.unshift(newRecord);
  // Keep max 200 records
  saveHistory(filtered.slice(0, 200));
}
