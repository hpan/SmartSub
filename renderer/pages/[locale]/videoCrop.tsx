/**
 * 视频画面裁切页面
 */

import React from 'react';
import { useTranslation } from 'next-i18next';
import { getStaticPaths, makeStaticProperties } from '../../lib/get-static';
import PageHeader from '@/components/PageHeader';
import VideoCropPanel from '@/components/videoCrop/VideoCropPanel';

export default function VideoCropPage() {
  const { t } = useTranslation('videoCrop');

  return (
    <div className="flex h-full flex-col gap-4 p-4 overflow-hidden">
      <PageHeader title={t('pageTitle')} description={t('pageDesc')} />
      <div className="min-h-0 flex-1 overflow-auto">
        <VideoCropPanel />
      </div>
    </div>
  );
}

export const getStaticProps = makeStaticProperties(['common', 'videoCrop']);
export { getStaticPaths };
