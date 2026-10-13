/**
 * 通用样式 & 视频分类配置页面
 * 两层：
 *   通用样式 — 字体 / 字号 / 颜色 / 描边
 *   视频分类 — 显示开关 / 位置比例 / 频谱默认
 */

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { ArrowLeft, Save, Palette, Layers } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { cn } from 'lib/utils';
import { getStaticPaths, makeStaticProperties } from '../../lib/get-static';

interface NumInputProps {
  value: number;
  onCommit: (v: number) => void;
  className?: string;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
}

/** 受控数字输入框，允许用户完全清空内容后重新输入 */
function NumInput({
  value,
  onCommit,
  className,
  min,
  max,
  step,
  placeholder,
}: NumInputProps) {
  const [text, setText] = React.useState<string>(String(value ?? '0'));
  const focusedRef = useRef(false);

  React.useEffect(() => {
    if (!focusedRef.current) {
      setText(String(value ?? '0'));
    }
  }, [value]);

  return (
    <input
      type="text"
      inputMode="decimal"
      className={
        'rounded-md border border-input bg-panel-2 shadow-sunken ring-offset-background transition-colors text-center placeholder:text-center focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50 ' +
        (className || '')
      }
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      value={text}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onBlur={() => {
        focusedRef.current = false;
        const t = text.trim();
        if (t === '' || isNaN(Number(t))) {
          const v = String(value ?? '0');
          setText(v);
          if (value !== 0) onCommit(0);
        } else {
          const n = Number(t);
          setText(String(n));
          onCommit(n);
        }
      }}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        const n = Number(t);
        if (t !== '' && !isNaN(n)) {
          onCommit(n);
        }
      }}
    />
  );
}

const FONT_OPTIONS = [
  { value: '', label: '系统默认' },
  { value: '/System/Library/Fonts/PingFang.ttc', label: '苹方' },
  { value: '/System/Library/Fonts/STHeiti Medium.ttc', label: '黑体' },
  { value: '/System/Library/Fonts/STHeiti Light.ttc', label: '黑体-细' },
  { value: '/System/Library/Fonts/Supplemental/Songti.ttc', label: '宋体' },
  { value: '/System/Library/Fonts/Supplemental/Kailasa.ttc', label: '楷体' },
  {
    value: '/Users/vangogh/Library/Fonts/SmileySans-Oblique.ttf',
    label: '得意黑',
  },
  {
    value: '/Users/vangogh/Library/Fonts/DingTalkJinBuTi-Regular.ttf',
    label: '钉钉进步体',
  },
  {
    value: '/Users/vangogh/Library/Fonts/AlimamaShuHeiTi-Bold.otf',
    label: '阿里妈妈数黑体',
  },
  {
    value: '/Users/vangogh/Library/Fonts/zaozigongfangyuanqipaopao.otf',
    label: '造字工坊泡泡',
  },
  {
    value: '/Users/vangogh/Library/Fonts/hanyituantuanyuanyuan.ttf',
    label: '汉仪团团圆圆',
  },
  {
    value: '/Users/vangogh/Library/Fonts/gongfansuannaibudingti.ttf',
    label: '贡粉丝奶布丁',
  },
  { value: '/Library/Fonts/Arial Unicode.ttf', label: 'Arial Unicode' },
  { value: '/System/Library/Fonts/Helvetica.ttc', label: 'Helvetica' },
  { value: '/System/Library/Fonts/Supplemental/Georgia.ttf', label: 'Georgia' },
];

interface GlobalConfig {
  titleFontPath: string;
  titleFontSize: number;
  titleColor: string;
  titleStrokeEnabled: boolean;
  titleStrokeWidth: number;
  titleShadowEnabled: boolean;
  titleShadowWidth: number;
  titleLetterSpacing: number;
  titleLineSpacing: number;
  subtitleFontPath: string;
  subtitleFontSize: number;
  subtitleColor: string;
  subtitleStrokeWidth: number;
  watermarkText?: string;
  watermarkDensity?: number;
  watermarkAngle?: number;
  disclaimerText?: string;
  disclaimerPosition?: string;
  watermarkOpacity?: number;
  disclaimerOpacity?: number;
}

interface CategoryConfig {
  showTitle: boolean;
  showOverlay: boolean;
  overlayOpacity: number;
  overlayBlur: number;
  defaultSpectrumStyle: string;
  titleYRatio: number;
  subtitleBottomRatio: number;
}

type CategoryConfigMap = Record<string, CategoryConfig>;

const CATEGORIES: { key: string; label: string; desc: string }[] = [
  { key: 'talent', label: '大佬说', desc: '标题+压暗+频谱 | 适合个人IP内容' },
  {
    key: 'meeting',
    label: '闭门会',
    desc: '无标题+无压暗+多尺寸封面 | 适合机构研报',
  },
];

export default function GlobalStyleConfigPage() {
  const router = useRouter();
  const { locale } = router.query;

  const [global, setGlobal] = useState<GlobalConfig | null>(null);
  const [categories, setCategories] = useState<CategoryConfigMap | null>(null);
  const [activeTab, setActiveTab] = useState<'global' | 'category'>('global');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    window.ipc
      .invoke('audioVisualize:getGlobalConfig')
      .then((cfg: GlobalConfig) => setGlobal(cfg));
    window.ipc
      .invoke('audioVisualize:getCategoryConfig')
      .then((cfg: CategoryConfigMap) => setCategories(cfg));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      if (global)
        await window.ipc.invoke('audioVisualize:saveGlobalConfig', global);
      if (categories)
        await window.ipc.invoke(
          'audioVisualize:saveCategoryConfig',
          categories,
        );
      toast.success('配置已保存');
    } catch (e: any) {
      toast.error('保存失败: ' + e.message);
    }
    setSaving(false);
  };

  if (!global || !categories) return <div className="p-4">加载中...</div>;

  return (
    <div className="flex h-full flex-col gap-4 p-4 overflow-hidden">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push(`/${locale || 'zh'}/audioVisualize`)}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <PageHeader
            title="通用样式 & 分类配置"
            description="配置全局默认样式和视频分类策略"
          />
        </div>
        <Button onClick={handleSave} disabled={saving}>
          <Save className="h-4 w-4 mr-1" /> {saving ? '保存中...' : '保存配置'}
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        <button
          className={cn(
            'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
            activeTab === 'global'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
          onClick={() => setActiveTab('global')}
        >
          <Palette className="h-4 w-4 inline mr-1" /> 通用样式
        </button>
        <button
          className={cn(
            'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
            activeTab === 'category'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
          onClick={() => setActiveTab('category')}
        >
          <Layers className="h-4 w-4 inline mr-1" /> 视频分类
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {activeTab === 'global' && (
          <div className="max-w-2xl space-y-6">
            <p className="text-sm text-muted-foreground">
              字体、字号、颜色、描边等全局默认样式。分类和节目可覆盖。
            </p>
            {/* 标题样式 */}
            <div className="rounded-lg border p-4 space-y-4">
              <h3 className="text-sm font-semibold">标题样式</h3>
              <div className="space-y-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-xs text-muted-foreground shrink-0">
                    字体
                  </span>
                  <select
                    className="flex-1 min-w-0 h-8 rounded-md border border-input bg-background px-2 text-xs"
                    value={global.titleFontPath}
                    onChange={(e) =>
                      setGlobal({ ...global, titleFontPath: e.target.value })
                    }
                  >
                    {FONT_OPTIONS.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                  <span className="text-xs text-muted-foreground shrink-0">
                    字号
                  </span>
                  <NumInput
                    value={global.titleFontSize}
                    onCommit={(n) => setGlobal({ ...global, titleFontSize: n })}
                    className="h-7 w-16 px-1 text-xs"
                    min={0}
                    max={200}
                  />
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-xs text-muted-foreground shrink-0">
                    颜色
                  </span>
                  <input
                    type="color"
                    value={global.titleColor}
                    onChange={(e) =>
                      setGlobal({ ...global, titleColor: e.target.value })
                    }
                    className="h-7 w-10 rounded border cursor-pointer"
                  />
                  <Input
                    value={global.titleColor}
                    onChange={(e) =>
                      setGlobal({ ...global, titleColor: e.target.value })
                    }
                    className="w-24 h-7 text-xs"
                  />
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={global.titleStrokeEnabled}
                      onChange={(e) =>
                        setGlobal({
                          ...global,
                          titleStrokeEnabled: e.target.checked,
                        })
                      }
                      className="rounded"
                    />
                    <span className="text-xs">描边</span>
                  </label>
                  <NumInput
                    value={global.titleStrokeWidth}
                    onCommit={(n) =>
                      setGlobal({ ...global, titleStrokeWidth: n })
                    }
                    className="h-7 w-16 px-1 text-xs"
                    min={0}
                    max={20}
                  />
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={global.titleShadowEnabled}
                      onChange={(e) =>
                        setGlobal({
                          ...global,
                          titleShadowEnabled: e.target.checked,
                        })
                      }
                      className="rounded"
                    />
                    <span className="text-xs">阴影</span>
                  </label>
                  <span className="text-xs text-muted-foreground">
                    阴影宽度
                  </span>
                  <NumInput
                    value={global.titleShadowWidth}
                    onCommit={(n) =>
                      setGlobal({ ...global, titleShadowWidth: n })
                    }
                    className="h-7 w-16 px-1 text-xs"
                    min={0}
                    max={20}
                  />
                  <span className="text-xs text-muted-foreground ml-1">
                    文字间距
                  </span>
                  <NumInput
                    value={global.titleLetterSpacing}
                    onCommit={(n) =>
                      setGlobal({ ...global, titleLetterSpacing: n })
                    }
                    className="h-7 w-16 px-1 text-xs"
                    min={-10}
                    max={50}
                  />
                  <span className="text-xs text-muted-foreground ml-1">
                    行间距
                  </span>
                  <NumInput
                    value={global.titleLineSpacing}
                    onCommit={(n) =>
                      setGlobal({ ...global, titleLineSpacing: n })
                    }
                    className="h-7 w-16 px-1 text-xs"
                    min={0}
                    max={50}
                  />
                </div>
              </div>
            </div>
            {/* 字幕样式 */}
            <div className="rounded-lg border p-4 space-y-3">
              <h3 className="text-sm font-semibold">字幕样式</h3>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-xs text-muted-foreground shrink-0">
                  字体
                </span>
                <select
                  className="flex-1 min-w-0 h-7 rounded-md border border-input bg-background px-2 text-xs"
                  value={global.subtitleFontPath}
                  onChange={(e) =>
                    setGlobal({ ...global, subtitleFontPath: e.target.value })
                  }
                >
                  {FONT_OPTIONS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-muted-foreground shrink-0">
                  字号
                </span>
                <NumInput
                  value={global.subtitleFontSize}
                  onCommit={(n) =>
                    setGlobal({ ...global, subtitleFontSize: n })
                  }
                  className="h-7 w-16 px-1 text-xs"
                  min={0}
                  max={200}
                />
                <span className="text-xs text-muted-foreground shrink-0 ml-1">
                  颜色
                </span>
                <input
                  type="color"
                  value={global.subtitleColor}
                  onChange={(e) =>
                    setGlobal({ ...global, subtitleColor: e.target.value })
                  }
                  className="h-7 w-8 rounded border cursor-pointer"
                />
                <span className="text-xs text-muted-foreground shrink-0 ml-1">
                  描边
                </span>
                <NumInput
                  value={global.subtitleStrokeWidth}
                  onCommit={(n) =>
                    setGlobal({ ...global, subtitleStrokeWidth: n })
                  }
                  className="h-7 w-14 px-1 text-xs"
                  min={0}
                  max={20}
                />
              </div>
            </div>

            {/* 水印 */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium">水印</h4>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-xs text-muted-foreground shrink-0">
                  文字
                </span>
                <Input
                  value={global.watermarkText || ''}
                  onChange={(e) =>
                    setGlobal({ ...global, watermarkText: e.target.value })
                  }
                  placeholder="留空则不显示水印"
                  className="h-7 text-xs flex-1 min-w-0"
                />
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-xs text-muted-foreground shrink-0">
                  密度
                </span>
                <NumInput
                  value={global.watermarkDensity ?? 0.18}
                  onCommit={(n) =>
                    setGlobal({ ...global, watermarkDensity: n })
                  }
                  min={0.05}
                  max={0.5}
                  step={0.02}
                  className="h-7 w-16 px-1 text-xs"
                />
                <span className="text-xs text-muted-foreground shrink-0 ml-1">
                  角度
                </span>
                <NumInput
                  value={global.watermarkAngle ?? -45}
                  onCommit={(n) => setGlobal({ ...global, watermarkAngle: n })}
                  min={-90}
                  max={90}
                  step={5}
                  className="h-7 w-16 px-1 text-xs"
                />
                <span className="text-xs text-muted-foreground shrink-0 ml-1">
                  透明度
                </span>
                <NumInput
                  value={global.watermarkOpacity ?? 25}
                  onCommit={(n) =>
                    setGlobal({ ...global, watermarkOpacity: n })
                  }
                  min={1}
                  max={255}
                  step={5}
                  className="h-7 w-16 px-1 text-xs"
                />
              </div>
              <p className="text-[10px] text-muted-foreground">
                节目级别可单独覆盖，为空时使用此全局水印
              </p>
            </div>

            {/* 免责声明 */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium">免责声明</h4>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-xs text-muted-foreground shrink-0">
                  文字
                </span>
                <Input
                  value={global.disclaimerText || ''}
                  onChange={(e) =>
                    setGlobal({ ...global, disclaimerText: e.target.value })
                  }
                  placeholder="留空则不显示免责声明"
                  className="h-7 text-xs flex-1 min-w-0"
                />
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-xs text-muted-foreground shrink-0">
                  位置
                </span>
                <select
                  value={global.disclaimerPosition || 'bottom-center'}
                  onChange={(e) =>
                    setGlobal({ ...global, disclaimerPosition: e.target.value })
                  }
                  className="h-7 w-28 rounded-md border border-input bg-panel-2 px-2 text-xs"
                >
                  <option value="top-left">左上角</option>
                  <option value="top-center">顶部居中</option>
                  <option value="top-right">右上角</option>
                  <option value="bottom-left">左下角</option>
                  <option value="bottom-center">底部居中</option>
                  <option value="bottom-right">右下角</option>
                </select>
                <span className="text-xs text-muted-foreground shrink-0 ml-1">
                  透明度
                </span>
                <NumInput
                  value={global.disclaimerOpacity ?? 153}
                  onCommit={(n) =>
                    setGlobal({ ...global, disclaimerOpacity: n })
                  }
                  min={1}
                  max={255}
                  step={10}
                  className="h-7 w-16 px-1 text-xs"
                />
              </div>
            </div>
          </div>
        )}

        {activeTab === 'category' && (
          <div className="max-w-2xl space-y-4">
            <p className="text-sm text-muted-foreground">
              分类参数优先于通用样式。节目配置优先于分类。未设置的参数逐级向上继承。
            </p>
            {CATEGORIES.map((cat) => {
              const cfg = categories[cat.key] || {
                showTitle: false,
                showOverlay: false,
                overlayOpacity: 0.6,
                overlayBlur: 0,
                defaultSpectrumStyle: 'none',
                titleYRatio: 0.15,
                subtitleBottomRatio: 0.08,
              };
              return (
                <div key={cat.key} className="rounded-lg border p-4 space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold">{cat.label}</h3>
                    <p className="text-xs text-muted-foreground">{cat.desc}</p>
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center gap-4">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={cfg.showTitle}
                          onChange={(e) =>
                            setCategories({
                              ...categories,
                              [cat.key]: {
                                ...cfg,
                                showTitle: e.target.checked,
                              },
                            })
                          }
                          className="rounded"
                        />
                        <span className="text-xs">显示标题</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <span className="text-xs">默认频谱样式</span>
                        <select
                          className="h-7 rounded border border-input bg-background px-1 text-xs"
                          value={cfg.defaultSpectrumStyle}
                          onChange={(e) =>
                            setCategories({
                              ...categories,
                              [cat.key]: {
                                ...cfg,
                                defaultSpectrumStyle: e.target.value,
                              },
                            })
                          }
                        >
                          <option value="none">无</option>
                          <option value="bars">底部条形</option>
                          <option value="radial">镭射</option>
                          <option value="rings">频谱环</option>
                          <option value="radar">声呐</option>
                          <option value="wave">彩虹</option>
                          <option value="pulse">脉冲环</option>
                        </select>
                      </label>
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={cfg.showOverlay}
                          onChange={(e) =>
                            setCategories({
                              ...categories,
                              [cat.key]: {
                                ...cfg,
                                showOverlay: e.target.checked,
                              },
                            })
                          }
                          className="rounded"
                        />
                        <span className="text-xs">背景压暗</span>
                      </label>
                      <span className="text-xs text-muted-foreground">
                        透明度
                      </span>
                      <NumInput
                        value={Math.round(cfg.overlayOpacity * 100)}
                        onCommit={(n) =>
                          setCategories({
                            ...categories,
                            [cat.key]: { ...cfg, overlayOpacity: n / 100 },
                          })
                        }
                        className="h-7 w-16 px-1 text-xs"
                        min={0}
                        max={100}
                        step={5}
                      />
                      <span className="text-xs text-muted-foreground">%</span>
                      <span className="text-xs text-muted-foreground ml-1">
                        高斯模糊
                      </span>
                      <NumInput
                        value={cfg.overlayBlur || 0}
                        onCommit={(n) =>
                          setCategories({
                            ...categories,
                            [cat.key]: { ...cfg, overlayBlur: n },
                          })
                        }
                        className="h-7 w-16 px-1 text-xs"
                        min={0}
                        max={50}
                        step={1}
                      />
                      <span className="text-xs text-muted-foreground">px</span>
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-xs text-muted-foreground">
                        标题Y位置
                      </span>
                      <NumInput
                        value={Math.round((cfg.titleYRatio ?? 0.15) * 100)}
                        onCommit={(n) =>
                          setCategories({
                            ...categories,
                            [cat.key]: { ...cfg, titleYRatio: n / 100 },
                          })
                        }
                        className="h-7 w-16 px-1 text-xs"
                        min={0}
                        max={50}
                        step={1}
                      />
                      <span className="text-xs text-muted-foreground">%</span>
                      <span className="text-xs text-muted-foreground ml-2">
                        字幕距底部
                      </span>
                      <NumInput
                        value={Math.round(
                          (cfg.subtitleBottomRatio ?? 0.08) * 100,
                        )}
                        onCommit={(n) =>
                          setCategories({
                            ...categories,
                            [cat.key]: { ...cfg, subtitleBottomRatio: n / 100 },
                          })
                        }
                        className="h-7 w-16 px-1 text-xs"
                        min={0}
                        max={30}
                        step={1}
                      />
                      <span className="text-xs text-muted-foreground">%</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export const getStaticProps = makeStaticProperties(['common']);
export { getStaticPaths };
