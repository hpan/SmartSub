/**
 * 音画页面 - 音频可视化：音频 + 封面图 → 视频
 */

import React from 'react';
import { getStaticPaths, makeStaticProperties } from '../../lib/get-static';
import AudioVisualizePanel from '@/components/audioVisualize/AudioVisualizePanel';

export default function AudioVisualizePage() {
  return (
    <div className="flex h-full flex-col gap-4 p-4 overflow-hidden">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold leading-tight tracking-tight">
          音画
        </h1>
        <p className="text-xs text-muted-foreground">音频 + 封面图生成视频</p>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <AudioVisualizePanel />
      </div>
    </div>
  );
}

export const getStaticProps = makeStaticProperties(['common']);
export { getStaticPaths };
