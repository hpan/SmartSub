/**
 * 抓取页面 - 自定义下载：智能重命名、下载历史、抖音/微信支持
 */

import React from 'react';
import { useTranslation } from 'next-i18next';
import { getStaticPaths, makeStaticProperties } from '../../lib/get-static';
import PageHeader from '@/components/PageHeader';
import { DownloadPanel } from '@/components/grab/GrabPanel';

export default function GrabPage() {
  const { t } = useTranslation('grab');

  return (
    <div className="flex h-full flex-col gap-4 p-4 overflow-hidden">
      <PageHeader title={t('pageTitle')} description={t('pageDesc')} />
      <div className="min-h-0 flex-1 overflow-hidden">
        <DownloadPanel />
      </div>
    </div>
  );
}

export const getStaticProps = makeStaticProperties(['common', 'grab']);
export { getStaticPaths };
