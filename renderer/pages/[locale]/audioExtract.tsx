/**
 * 音频分离页面 - 从视频中快速提取音频
 */

import React from 'react';
import { useTranslation } from 'next-i18next';
import { getStaticPaths, makeStaticProperties } from '../../lib/get-static';
import PageHeader from '@/components/PageHeader';
import AudioExtractPanel from '@/components/audioExtract/AudioExtractPanel';

export default function AudioExtractPage() {
  const { t } = useTranslation('audioExtract');

  return (
    <div className="flex h-full flex-col gap-4 p-4 overflow-hidden">
      <PageHeader title={t('pageTitle')} description={t('pageDesc')} />
      <div className="min-h-0 flex-1 overflow-auto">
        <AudioExtractPanel />
      </div>
    </div>
  );
}

export const getStaticProps = makeStaticProperties(['common', 'audioExtract']);
export { getStaticPaths };
