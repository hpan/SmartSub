import React, { useState, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import {
  FileVideo,
  Upload,
  Loader2,
  CheckCircle2,
  FolderOpen,
  Music,
} from 'lucide-react';
import { toast } from 'sonner';

export default function AudioExtractPanel() {
  const [filePath, setFilePath] = useState('');
  const [fileName, setFileName] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [result, setResult] = useState<{ outputPath: string } | null>(null);
  const dragCounter = useRef(0);
  const [isDragging, setIsDragging] = useState(false);

  const handleFile = useCallback((f: File) => {
    setFilePath(f.path);
    setFileName(f.name);
    setResult(null);
  }, []);

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.types.includes('Files')) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
  };

  const handleSelectFile = async () => {
    const res = await window.ipc.invoke('audioCut:selectFile');
    if (res.success) {
      const fp = res.data as string;
      setFilePath(fp);
      setFileName(fp.split('/').pop() || fp);
      setResult(null);
    }
  };

  const handleExtract = async () => {
    if (!filePath) return;
    setExtracting(true);
    setResult(null);
    try {
      const res = await window.ipc.invoke('audioCut:extractAudio', {
        filePath,
      });
      if (res.success) {
        setResult({ outputPath: res.data.outputPath });
        toast.success('音频分离完成');
      } else {
        toast.error(res.error || '分离失败');
      }
    } catch (err: any) {
      toast.error('分离失败: ' + (err.message || err));
    } finally {
      setExtracting(false);
    }
  };

  const handleOpenFolder = async () => {
    if (result?.outputPath) {
      await window.ipc.invoke('audioCut:openFolder', {
        filePath: result.outputPath,
      });
    }
  };

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Drop zone */}
      <div
        className={`flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 transition-colors min-h-[200px] cursor-pointer ${
          isDragging
            ? 'border-emerald-400 bg-emerald-500/10'
            : 'border-zinc-600 hover:border-zinc-400 bg-zinc-900/40'
        }`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={handleSelectFile}
      >
        {filePath ? (
          <>
            <FileVideo className="h-10 w-10 text-emerald-400" />
            <div className="text-center">
              <p className="text-sm font-medium text-white">{fileName}</p>
            </div>
          </>
        ) : (
          <>
            <Upload className="h-10 w-10 text-zinc-400" />
            <div className="text-center">
              <p className="text-sm text-zinc-300">
                拖放视频文件到此处，或点击选择
              </p>
              <p className="text-xs text-zinc-500 mt-1">
                支持 MP4, MKV, AVI, MOV, WebM, TS 等格式
              </p>
            </div>
          </>
        )}
      </div>

      {/* Extract button */}
      {filePath && (
        <div className="flex items-center gap-3">
          <Button
            onClick={handleExtract}
            disabled={extracting}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {extracting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                分离中...
              </>
            ) : (
              <>
                <Music className="h-4 w-4 mr-2" />
                分离音频
              </>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setFilePath('');
              setFileName('');
              setResult(null);
            }}
          >
            清除
          </Button>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="flex items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
          <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-emerald-300">分离完成</p>
            <p className="text-xs text-zinc-400 truncate mt-1">
              {result.outputPath}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={handleOpenFolder}>
            <FolderOpen className="h-3.5 w-3.5 mr-1" />
            打开目录
          </Button>
        </div>
      )}
    </div>
  );
}
