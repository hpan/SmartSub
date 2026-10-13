/**
 * 节目配置页面 - 管理节目模板
 */

import React from 'react';
import { useRouter } from 'next/router';
import { ArrowLeft } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import ProgramConfigPanel from '@/components/audioVisualize/ProgramConfigPanel';
import { getStaticPaths, makeStaticProperties } from '../../lib/get-static';

export default function AudioVisualizeConfigPage() {
  const router = useRouter();
  const { locale, program: focusProgramId } = router.query;

  return (
    <div className="flex h-full flex-col gap-4 p-4 overflow-hidden">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.push(`/${locale || 'zh'}/audioVisualize`)}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <PageHeader
          title="节目配置"
          description="管理节目封面、Logo等模板配置"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <ProgramConfigPanel
          focusProgramId={
            typeof focusProgramId === 'string' ? focusProgramId : undefined
          }
        />
      </div>
    </div>
  );
}

export const getStaticProps = makeStaticProperties(['common']);
export { getStaticPaths };
