/**
 * 视频画面裁切面板
 * 支持按比例居中裁切视频画面
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'next-i18next';
import {
  Crop,
  FolderOpen,
  Square,
  RectangleHorizontal,
  RectangleVertical,
  Monitor,
  Smartphone,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Scissors,
  Upload,
  FileVideo,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { cn } from 'lib/utils';

/** 预设比例 */
interface AspectPreset {
  key: string;
  label: string;
  ratio: number; // width / height
  icon: React.ComponentType<{ className?: string }>;
}

const ASPECT_PRESETS: AspectPreset[] = [
  { key: '16:9', label: '16:9', ratio: 16 / 9, icon: Monitor },
  { key: '9:16', label: '9:16', ratio: 9 / 16, icon: Smartphone },
  { key: '4:3', label: '4:3', ratio: 4 / 3, icon: RectangleHorizontal },
  { key: '3:4', label: '3:4', ratio: 3 / 4, icon: RectangleVertical },
  { key: '1:1', label: '1:1', ratio: 1, icon: Square },
];

interface VideoInfo {
  path: string;
  fileName: string;
  width: number;
  height: number;
  duration: number;
  format: string;
}

interface CropResult {
  success: boolean;
  outputPath?: string;
  error?: string;
}

export default function VideoCropPanel() {
  const { t } = useTranslation('videoCrop');
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);

  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<string>('16:9');
  const [outputDir, setOutputDir] = useState<string>('');
  const [isCropping, setIsCropping] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    message: string;
    outputPath?: string;
  } | null>(null);

  // 加载视频文件（通过路径）
  const loadFile = useCallback(async (filePath: string) => {
    try {
      const res = await window.ipc.invoke('videoCrop:getInfo', { filePath });
      if (res?.success && res.data) {
        setVideoInfo(res.data);
        setResult(null);
        setProgress(0);
      } else {
        setResult({
          success: false,
          message: res?.error || '读取视频信息失败',
        });
      }
    } catch (err: any) {
      setResult({ success: false, message: err.message || '读取视频信息失败' });
    }
  }, []);

  // 拖放处理
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) {
        const filePath = window.ipc.getPathForFile(file);
        loadFile(filePath);
      }
    },
    [loadFile],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
  }, []);

  // 计算裁切区域
  const getCropRect = useCallback(() => {
    if (!videoInfo) return null;
    const preset = ASPECT_PRESETS.find((p) => p.key === selectedPreset);
    if (!preset) return null;

    const { width: srcW, height: srcH } = videoInfo;
    const targetRatio = preset.ratio;
    const srcRatio = srcW / srcH;

    let cropW: number;
    let cropH: number;

    if (srcRatio > targetRatio) {
      // 源视频更宽，以高度为基准
      cropH = srcH;
      cropW = Math.round(srcH * targetRatio);
    } else {
      // 源视频更高，以宽度为基准
      cropW = srcW;
      cropH = Math.round(srcW / targetRatio);
    }

    // 确保偶数
    cropW = cropW % 2 === 0 ? cropW : cropW - 1;
    cropH = cropH % 2 === 0 ? cropH : cropH - 1;

    const offsetX = Math.round((srcW - cropW) / 2);
    const offsetY = Math.round((srcH - cropH) / 2);

    return { cropW, cropH, offsetX, offsetY };
  }, [videoInfo, selectedPreset]);

  // 选择文件
  const handleSelectFile = useCallback(async () => {
    try {
      const res = await window.ipc.invoke('videoCrop:selectFile');
      if (res?.success && res.data) {
        setVideoInfo(res.data);
        setResult(null);
        setProgress(0);
      }
    } catch (err) {
      console.error('select file error:', err);
    }
  }, []);

  // 选择输出目录
  const handleSelectOutputDir = useCallback(async () => {
    try {
      const dir = await window.ipc.invoke('videoCrop:selectOutputDir');
      if (dir) setOutputDir(dir);
    } catch (err) {
      console.error('select output dir error:', err);
    }
  }, []);

  // 执行裁切
  const handleCrop = useCallback(async () => {
    if (!videoInfo) return;
    const cropRect = getCropRect();
    if (!cropRect) return;

    setIsCropping(true);
    setProgress(0);
    setResult(null);

    const ext = videoInfo.fileName.split('.').pop() || 'mp4';
    const baseName = videoInfo.fileName.replace(/\.[^.]+$/, '');
    const presetKey = selectedPreset.replace(':', 'x');
    const outName = `${baseName}_crop_${presetKey}.${ext}`;
    const outDir = outputDir || videoInfo.path.replace(/[/\\][^/\\]+$/, '');
    const outputPath = `${outDir}/${outName}`;

    try {
      const res: CropResult = await window.ipc.invoke('videoCrop:crop', {
        inputPath: videoInfo.path,
        outputPath,
        ...cropRect,
        duration: videoInfo.duration,
      });

      if (res.success) {
        setResult({
          success: true,
          message: '裁切完成！',
          outputPath: res.outputPath,
        });
      } else {
        setResult({ success: false, message: res.error || '裁切失败' });
      }
    } catch (err: any) {
      setResult({ success: false, message: err.message || '裁切失败' });
    } finally {
      setIsCropping(false);
    }
  }, [videoInfo, getCropRect, selectedPreset, outputDir]);

  // 监听进度
  useEffect(() => {
    const unsub = window.ipc.on(
      'videoCrop:progress',
      (_: any, data: { percent: number }) => {
        setProgress(data.percent);
      },
    );
    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, []);

  // 计算预览区域的裁切框样式
  const cropRect = getCropRect();
  const previewCropStyle =
    cropRect && videoInfo
      ? {
          left: `${(cropRect.offsetX / videoInfo.width) * 100}%`,
          top: `${(cropRect.offsetY / videoInfo.height) * 100}%`,
          width: `${(cropRect.cropW / videoInfo.width) * 100}%`,
          height: `${(cropRect.cropH / videoInfo.height) * 100}%`,
        }
      : null;

  return (
    <div
      className="relative flex flex-col gap-4 h-full"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
    >
      {/* 拖放遮罩 */}
      {dragging && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-primary/10 border-2 border-dashed border-primary rounded-lg pointer-events-none">
          <div className="flex flex-col items-center gap-2 text-primary">
            <Upload className="h-12 w-12" />
            <span className="text-lg font-medium">
              {t('dropHere', '拖放视频文件到这里')}
            </span>
          </div>
        </div>
      )}

      {/* 文件选择栏（支持点击和拖放） */}
      <div
        className={cn(
          'flex items-center gap-3 p-4 border-2 rounded-lg cursor-pointer transition-colors',
          dragging
            ? 'border-primary bg-primary/5'
            : 'border-dashed border-muted-foreground/25 hover:border-muted-foreground/50',
        )}
        onClick={handleSelectFile}
      >
        <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
          {videoInfo ? (
            <FileVideo className="h-5 w-5 text-muted-foreground" />
          ) : (
            <Upload className="h-5 w-5 text-muted-foreground" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          {videoInfo ? (
            <div>
              <div className="font-medium truncate">{videoInfo.fileName}</div>
              <div className="text-sm text-muted-foreground">
                {videoInfo.width}×{videoInfo.height} ·{' '}
                {Math.round(videoInfo.duration)}秒
              </div>
            </div>
          ) : (
            <div>
              <div className="font-medium text-muted-foreground">
                {t('selectFile', '选择或拖放视频文件')}
              </div>
              <div className="text-sm text-muted-foreground">
                {t('supportedFormats', '支持 MP4、MKV、AVI、MOV、WebM 等格式')}
              </div>
            </div>
          )}
        </div>
      </div>

      {videoInfo && (
        <div className="flex flex-1 gap-4 min-h-0">
          {/* 左侧：预览区域 */}
          <div className="flex-1 flex flex-col gap-3 min-w-0">
            <div
              ref={previewContainerRef}
              className="relative bg-black rounded-lg overflow-hidden flex items-center justify-center"
              style={{ minHeight: 300 }}
            >
              {/* 视频预览 */}
              <video
                ref={videoRef}
                src={`media://${videoInfo.path}`}
                className="max-w-full max-h-[500px] object-contain"
                controls
                muted
              />

              {/* 裁切框叠加层 */}
              {previewCropStyle && (
                <div className="absolute inset-0 pointer-events-none">
                  {/* 暗色遮罩 */}
                  <div className="absolute inset-0 bg-black/50" />
                  {/* 亮色裁切区域 */}
                  <div
                    className="absolute border-2 border-primary"
                    style={{
                      ...previewCropStyle,
                      boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)',
                      background: 'transparent',
                    }}
                  />
                  {/* 裁切区域标签 */}
                  <div
                    className="absolute text-xs text-white bg-primary/80 px-1.5 py-0.5 rounded"
                    style={{
                      left: previewCropStyle.left,
                      top: `calc(${previewCropStyle.top} - 24px)`,
                    }}
                  >
                    {selectedPreset} · {cropRect.cropW}×{cropRect.cropH}
                  </div>
                </div>
              )}
            </div>

            {/* 裁切结果提示 */}
            {result && (
              <div
                className={cn(
                  'flex items-center gap-2 p-3 rounded-lg text-sm',
                  result.success
                    ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400'
                    : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400',
                )}
              >
                {result.success ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                ) : (
                  <AlertCircle className="h-4 w-4 shrink-0" />
                )}
                <span className="flex-1">{result.message}</span>
                {result.outputPath && (
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-green-700 dark:text-green-400"
                    onClick={() =>
                      window.ipc.invoke('videoCrop:revealFile', {
                        filePath: result.outputPath,
                      })
                    }
                  >
                    在 Finder 中显示
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* 右侧：控制面板 */}
          <div className="w-72 flex flex-col gap-4 shrink-0">
            {/* 比例选择 */}
            <Card className="p-4">
              <Label className="text-sm font-medium mb-3 block">
                {t('selectRatio', '选择裁切比例')}
              </Label>
              <div className="grid grid-cols-3 gap-2">
                {ASPECT_PRESETS.map((preset) => {
                  const Icon = preset.icon;
                  const isActive = selectedPreset === preset.key;
                  return (
                    <button
                      key={preset.key}
                      className={cn(
                        'flex flex-col items-center gap-1 p-2.5 rounded-lg border-2 transition-all text-sm',
                        isActive
                          ? 'border-primary bg-primary/10 text-primary font-medium'
                          : 'border-transparent bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground',
                      )}
                      onClick={() => setSelectedPreset(preset.key)}
                    >
                      <Icon className="h-5 w-5" />
                      <span className="text-xs">{preset.label}</span>
                    </button>
                  );
                })}
              </div>
            </Card>

            {/* 裁切信息 */}
            {cropRect && (
              <Card className="p-4">
                <Label className="text-sm font-medium mb-2 block">
                  {t('cropInfo', '裁切信息')}
                </Label>
                <div className="space-y-1.5 text-sm text-muted-foreground">
                  <div className="flex justify-between">
                    <span>原始尺寸</span>
                    <span>
                      {videoInfo.width}×{videoInfo.height}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>裁切尺寸</span>
                    <span className="text-foreground font-medium">
                      {cropRect.cropW}×{cropRect.cropH}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>裁切位置</span>
                    <span>
                      偏移 ({cropRect.offsetX}, {cropRect.offsetY})
                    </span>
                  </div>
                </div>
              </Card>
            )}

            {/* 输出目录 */}
            <Card className="p-4">
              <Label className="text-sm font-medium mb-2 block">
                {t('outputDir', '输出目录')}
              </Label>
              <div className="flex gap-2">
                <Input
                  value={outputDir}
                  placeholder="默认与源文件相同目录"
                  onChange={(e) => setOutputDir(e.target.value)}
                  className="text-xs"
                  readOnly
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSelectOutputDir}
                >
                  <FolderOpen className="h-4 w-4" />
                </Button>
              </div>
            </Card>

            {/* 执行按钮 */}
            <div className="flex flex-col gap-2">
              <Button
                onClick={handleCrop}
                disabled={isCropping}
                className="gap-2"
              >
                {isCropping ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t('cropping', '裁切中...')} {progress}%
                  </>
                ) : (
                  <>
                    <Scissors className="h-4 w-4" />
                    {t('startCrop', '开始裁切')}
                  </>
                )}
              </Button>

              {/* 进度条 */}
              {isCropping && (
                <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-primary h-full transition-all duration-300 rounded-full"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              )}

              <Button
                variant="outline"
                onClick={() => {
                  setVideoInfo(null);
                  setResult(null);
                  setProgress(0);
                }}
                className="gap-2"
              >
                <RotateCcw className="h-4 w-4" />
                {t('reset', '重置')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
