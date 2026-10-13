/**
 * 工坊页面 - 包含裁割、分离、祛印、裁画、裁片五个标签
 */

import React, { useState } from 'react';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { getStaticPaths, makeStaticProperties } from '../../lib/get-static';
import PageHeader from '@/components/PageHeader';
import AudioCutPanel from '@/components/audioCut/AudioCutPanel';
import AudioExtractPanel from '@/components/audioExtract/AudioExtractPanel';
import ScrubPanel from '@/components/watermarkScrub/ScrubPanel';
import VideoCropPanel from '@/components/videoCrop/VideoCropPanel';
import VideoTrimPanel from '@/components/videoTrim/VideoTrimPanel';
import SpeedPanel from '@/components/speed/SpeedPanel';
import { cn } from 'lib/utils';
import { Scissors, Music, ShieldCheck, Crop, Film, Gauge } from 'lucide-react';

const TABS = [
  { key: 'cut', labelKey: 'tabCut', icon: Scissors },
  { key: 'extract', labelKey: 'tabExtract', icon: Music },
  { key: 'scrub', labelKey: 'tabScrub', icon: ShieldCheck },
  { key: 'videoCrop', labelKey: 'tabVideoCrop', icon: Crop },
  { key: 'videoTrim', labelKey: 'tabVideoTrim', icon: Film },
  { key: 'speed', labelKey: 'tabSpeed', icon: Gauge },
] as const;

export default function AudioCutPage() {
  const { t } = useTranslation('audioCut');
  const router = useRouter();
  const initialFile =
    typeof router.query.file === 'string' ? router.query.file : undefined;
  const [activeTab, setActiveTab] = useState<string>('cut');

  return (
    <div className="flex h-full flex-col gap-4 p-4 overflow-hidden">
      <div className="flex items-center justify-between">
        <PageHeader title={t('pageTitle')} description={t('pageDesc')} />
        <div className="flex items-center gap-1 bg-muted p-1 rounded-lg">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors',
                  activeTab === tab.key
                    ? 'bg-background text-foreground shadow-sm font-medium'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                onClick={() => setActiveTab(tab.key)}
              >
                <Icon className="h-4 w-4" />
                {t(tab.labelKey)}
              </button>
            );
          })}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {activeTab === 'cut' && <AudioCutPanel initialFile={initialFile} />}
        {activeTab === 'extract' && <AudioExtractPanel />}
        {activeTab === 'scrub' && <ScrubPanel />}
        {activeTab === 'videoCrop' && <VideoCropPanel />}
        {activeTab === 'videoTrim' && <VideoTrimPanel />}
        {activeTab === 'speed' && <SpeedPanel />}
      </div>
    </div>
  );
}

export const getStaticProps = makeStaticProperties(['common', 'audioCut']);
export { getStaticPaths };
