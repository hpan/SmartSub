/**
 * 视频下载页面
 */

import React from 'react';
import { useTranslation } from 'next-i18next';
import { getStaticPaths, makeStaticProperties } from '../../lib/get-static';
import PageHeader from '@/components/PageHeader';
import { DownloadPanel } from '@/components/download/DownloadPanel';

export default function DownloadPage() {
  const { t } = useTranslation('download');

  return (
    <div className="flex h-full flex-col gap-4 p-4 overflow-hidden">
      <PageHeader title={t('pageTitle')} description={t('pageDesc')} />
      <div className="min-h-0 flex-1 overflow-hidden">
        <DownloadPanel />
      </div>
    </div>
  );
}

export const getStaticProps = makeStaticProperties(['common', 'download']);
export { getStaticPaths };
