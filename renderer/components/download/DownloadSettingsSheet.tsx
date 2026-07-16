/**
 * 下载设置面板
 */

import React, { useState } from 'react';
import { useTranslation } from 'next-i18next';
import {
  Settings as SettingsIcon,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Download,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { cn } from 'lib/utils';
import {
  DOWNLOAD_IPC_CHANNELS,
  type DownloadConfig,
  type CookieMode,
  type YtdlpStatus,
} from '../../../types/videoDownload';

interface RenameConfig {
  enabled: boolean;
  programs: Record<
    string,
    {
      keywords: string[];
      nameFormat?: string;
      weekdayNames?: Record<number, string>;
    }
  >;
}
import { toast } from 'sonner';

interface Props {
  config: DownloadConfig | null;
  ytdlpStatus: YtdlpStatus | null;
  onConfigChange: (config: DownloadConfig) => void;
  onInstallYtdlp: () => void;
  onUpdateYtdlp: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const COOKIE_MODE_OPTIONS: {
  value: CookieMode;
  label: string;
  description: string;
}[] = [
  { value: 'none', label: '不使用 Cookie', description: '适合公开内容' },
  {
    value: 'from-browser-firefox',
    label: 'Firefox 浏览器',
    description: '自动读取 Firefox 已登录的 Cookie（推荐）',
  },
  {
    value: 'from-browser-edge',
    label: 'Edge 浏览器',
    description: '自动读取 Edge 已登录的 Cookie',
  },
  {
    value: 'from-browser-chrome',
    label: 'Chrome 浏览器',
    description: '自动读取 Chrome 已登录的 Cookie',
  },
  {
    value: 'from-file',
    label: 'Cookie 文件',
    description: '手动导入 cookies.txt 文件',
  },
];

export function DownloadSettingsSheet({
  config,
  ytdlpStatus,
  onConfigChange,
  onInstallYtdlp,
  onUpdateYtdlp,
  open,
  onOpenChange,
}: Props) {
  const { t } = useTranslation('download');
  const [renameConfig, setRenameConfig] = useState<RenameConfig | null>(null);

  React.useEffect(() => {
    window.ipc
      .invoke(DOWNLOAD_IPC_CHANNELS.GET_RENAME_CONFIG)
      .then((c: RenameConfig) => {
        setRenameConfig(c);
      })
      .catch(() => {});
  }, []);

  const saveRenameEnabled = async (enabled: boolean) => {
    if (!renameConfig) return;
    const updated = { ...renameConfig, enabled };
    const saved = await window.ipc.invoke(
      DOWNLOAD_IPC_CHANNELS.SAVE_RENAME_CONFIG,
      updated,
    );
    setRenameConfig(saved);
    toast.success(enabled ? '自动重命名已开启' : '自动重命名已关闭');
  };

  const saveConfig = async (updates: Partial<DownloadConfig>) => {
    const newConfig = { ...config, ...updates };
    const saved = await window.ipc.invoke(
      DOWNLOAD_IPC_CHANNELS.SAVE_CONFIG,
      updates,
    );
    onConfigChange(saved);
    toast.success('设置已保存');
  };

  const handleSelectCookieFile = async () => {
    const filePath = await window.ipc.invoke(
      DOWNLOAD_IPC_CHANNELS.SELECT_COOKIE_FILE,
    );
    if (filePath) {
      saveConfig({ cookieFile: filePath, cookieMode: 'from-file' });
    }
  };

  const currentCookieMode = config?.cookieMode || 'none';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          <SettingsIcon className="mr-1.5 h-3.5 w-3.5" />
          {t('settings')}
        </Button>
      </SheetTrigger>
      <SheetContent className="w-[400px] sm:w-[540px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{t('settings')}</SheetTitle>
          <SheetDescription>配置下载工具和默认选项</SheetDescription>
        </SheetHeader>

        <div className="mt-6 flex flex-col gap-6">
          {/* yt-dlp 状态 */}
          <div className="flex flex-col gap-3">
            <Label className="text-sm font-medium">{t('ytdlpStatus')}</Label>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="flex items-center gap-2">
                {ytdlpStatus?.installed ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-amber-500" />
                )}
                <div>
                  <p className="text-sm font-medium">
                    {ytdlpStatus?.installed
                      ? t('ytdlpInstalled')
                      : t('ytdlpNotInstalled')}
                  </p>
                  {ytdlpStatus?.version && (
                    <p className="text-xs text-muted-foreground">
                      {t('ytdlpVersion')}: {ytdlpStatus.version}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                {ytdlpStatus?.installed ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onUpdateYtdlp}
                    disabled={ytdlpStatus.downloading}
                  >
                    {ytdlpStatus.downloading ? (
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-1 h-3 w-3" />
                    )}
                    {t('ytdlpUpdate')}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={onInstallYtdlp}
                    disabled={ytdlpStatus?.downloading}
                  >
                    {ytdlpStatus?.downloading ? (
                      <>
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        {t('ytdlpDownloading')}
                      </>
                    ) : (
                      <>
                        <Download className="mr-1 h-3 w-3" />
                        {t('ytdlpInstall')}
                      </>
                    )}
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* Cookie 设置 */}
          <div className="flex flex-col gap-3">
            <Label className="text-sm font-medium">Cookie 来源</Label>
            <p className="text-xs text-muted-foreground">
              B站等平台需要登录才能下载。推荐安装 Firefox 并登录后选择自动读取。
            </p>
            <Select
              value={currentCookieMode}
              onValueChange={(v) => saveConfig({ cookieMode: v as CookieMode })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COOKIE_MODE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    <div className="flex flex-col">
                      <span>{opt.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {opt.description}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Cookie 文件路径（仅 from-file 模式显示） */}
            {currentCookieMode === 'from-file' && (
              <div className="flex gap-2">
                <Input
                  placeholder="cookies.txt 文件路径"
                  value={config?.cookieFile || ''}
                  onChange={(e) => saveConfig({ cookieFile: e.target.value })}
                  className="flex-1 text-xs"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSelectCookieFile}
                >
                  选择文件
                </Button>
              </div>
            )}

            {/* 提示信息 */}
            {currentCookieMode === 'none' && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-200">
                <p className="font-medium mb-1">💡 如何获取 Cookie？</p>
                <ol className="list-decimal pl-4 space-y-1">
                  <li>
                    <strong>推荐</strong>：安装{' '}
                    <a
                      href="https://www.mozilla.org/firefox/"
                      target="_blank"
                      className="underline"
                    >
                      Firefox
                    </a>
                    ，登录 B站/YouTube，然后选择「Firefox 浏览器」
                  </li>
                  <li>
                    手动导出：安装 Chrome 扩展{' '}
                    <a
                      href="https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc"
                      target="_blank"
                      className="underline"
                    >
                      Get cookies.txt LOCALLY
                    </a>
                    ，在目标网站导出后选择「Cookie 文件」
                  </li>
                </ol>
              </div>
            )}

            {currentCookieMode === 'from-browser-firefox' && (
              <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-xs text-green-800 dark:border-green-800 dark:bg-green-950/30 dark:text-green-200">
                ✅ 使用前请确保 Firefox 已登录目标网站（如 B站），yt-dlp
                会自动读取浏览器 Cookie。
              </div>
            )}

            {currentCookieMode === 'from-browser-edge' && (
              <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-xs text-green-800 dark:border-green-800 dark:bg-green-950/30 dark:text-green-200">
                ✅ 使用前请确保 Edge 已登录目标网站，yt-dlp 会自动读取浏览器
                Cookie。
                {currentCookieMode === 'from-browser-chrome' && (
                  <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-xs text-green-800 dark:border-green-800 dark:bg-green-950/30 dark:text-green-200">
                    ✅ 使用前请确保 Chrome 已登录目标网站（如
                    X、YouTube），yt-dlp 会自动读取浏览器 Cookie。
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 默认保存位置 */}
          <div className="flex flex-col gap-2">
            <Label className="text-sm font-medium">{t('outputDir')}</Label>
            <div className="flex gap-2">
              <Input
                value={config?.defaultOutputDir || ''}
                readOnly
                className="flex-1 text-xs"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  const dir = await window.ipc.invoke(
                    DOWNLOAD_IPC_CHANNELS.SELECT_OUTPUT_DIR,
                  );
                  if (dir) saveConfig({ defaultOutputDir: dir });
                }}
              >
                {t('changeDir')}
              </Button>
            </div>
          </div>

          {/* 字幕设置 */}
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">
                {t('downloadSubtitles')}
              </Label>
              <p className="text-xs text-muted-foreground">
                下载时自动嵌入字幕
              </p>
            </div>
            <Switch
              checked={config?.downloadSubtitles ?? false}
              onCheckedChange={(v) => saveConfig({ downloadSubtitles: v })}
            />
          </div>

          {/* 自动重命名 */}
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">自动重命名</Label>
              <p className="text-xs text-muted-foreground">
                下载完成后按规则自动重命名（如 20260614-华创宏观张瑜：标题.mp3）
              </p>
            </div>
            <Switch
              checked={renameConfig?.enabled ?? true}
              onCheckedChange={saveRenameEnabled}
            />
          </div>

          {/* 代理 */}
          <div className="flex flex-col gap-2">
            <Label className="text-sm font-medium">{t('proxy')}</Label>
            <Input
              placeholder={t('proxyHint')}
              value={config?.proxy || ''}
              onChange={(e) => saveConfig({ proxy: e.target.value })}
            />
          </div>

          {/* 自定义参数 */}
          <div className="flex flex-col gap-2">
            <Label className="text-sm font-medium">{t('extraArgs')}</Label>
            <Input
              placeholder={t('extraArgsHint')}
              value={config?.extraArgs || ''}
              onChange={(e) => saveConfig({ extraArgs: e.target.value })}
            />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
