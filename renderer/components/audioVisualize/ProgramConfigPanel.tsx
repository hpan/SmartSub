/**
 * 音画配置面板 - 管理节目模板
 * 通用样式已移至 /globalStyleConfig 页面
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Plus,
  Trash2,
  Upload,
  Save,
  Image as ImageIcon,
  Stamp,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { cn } from 'lib/utils';
import { Switch } from '@/components/ui/switch';

type LogoPosition =
  | 'bottom-left'
  | 'bottom-right'
  | 'top-left'
  | 'top-right'
  | 'center-top'
  | 'center'
  | 'center-bottom';
interface CoverAsset {
  id: string;
  path: string;
  width: number;
  height: number;
  ratio: string;
  subtitleTopPx?: number;
}

function ratioLabel(w: number, h: number): string {
  if (!w || !h) return '';
  const g = (a: number, b: number): number => (b ? g(b, a % b) : a);
  const k = g(w, h);
  const sw = w / k;
  const sh = h / k;
  const pairs: [number, number, string][] = [
    [16, 9, '16:9'],
    [9, 16, '9:16'],
    [4, 3, '4:3'],
    [3, 4, '3:4'],
    [1, 1, '1:1'],
  ];
  for (const [cw, ch, label] of pairs) if (sw === cw && sh === ch) return label;
  return sw + ':' + sh;
}

interface ProgramConfig {
  id: string;
  name: string;
  category?: 'talent' | 'meeting';
  covers: CoverAsset[];
  logoPath?: string;
  logos?: { id: string; path: string; label?: string }[];
  defaultLogoId?: string;
  logoPosition: LogoPosition;
  logoXRatio?: number;
  logoYRatio?: number;
  logoSizeRatio?: number;
  logoRotate?: boolean;
  logoRotateSpeed?: number;
  overlayOpacity?: number;
  showTitle?: boolean;
  showOverlay?: boolean;
  defaultSpectrumStyle?: string;
  defaultRatio?: string;
  watermarkText?: string;
  watermarkEnabled?: boolean;
}

const LOGO_POSITIONS: {
  value: LogoPosition;
  label: string;
  x: number;
  y: number;
}[] = [
  { value: 'bottom-left', label: '左下角', x: 9, y: 89 },
  { value: 'bottom-right', label: '右下角', x: 91, y: 89 },
  { value: 'top-left', label: '左上角', x: 9, y: 11 },
  { value: 'top-right', label: '右上角', x: 91, y: 11 },
  { value: 'center-top', label: '中央偏上', x: 50, y: 38 },
  { value: 'center', label: '正中央', x: 50, y: 50 },
  { value: 'center-bottom', label: '中央偏下', x: 50, y: 82 },
];

export default function ProgramConfigPanel({
  focusProgramId,
}: { focusProgramId?: string } = {}) {
  const [programs, setPrograms] = useState<ProgramConfig[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const loadedRef = useRef(false);
  const dragIdx = useRef<number>(-1);

  const reorderArray = <T,>(arr: T[], from: number, to: number): T[] => {
    const next = [...arr];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
  };

  useEffect(() => {
    window.ipc
      .invoke('audioVisualize:getPrograms')
      .then((d: ProgramConfig[]) => {
        const list = d || [];
        setPrograms(list);
        loadedRef.current = true;
        if (list.length > 0) {
          // 如果有 focusProgramId，优先定位到该节目
          const target = focusProgramId
            ? list.find((p) => p.id === focusProgramId)
            : null;
          setEditingId(target ? target.id : list[0].id);
        }
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 配置变动自动保存，避免漏点「保存配置」
  useEffect(() => {
    if (!loadedRef.current) return;
    const timer = setTimeout(() => {
      window.ipc.invoke('audioVisualize:savePrograms', programs);
    }, 400);
    return () => clearTimeout(timer);
  }, [programs]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await window.ipc.invoke('audioVisualize:savePrograms', programs);
      toast.success('配置已保存');
    } catch {
      toast.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleAdd = () => {
    const p: ProgramConfig = {
      id: `custom-${Date.now()}`,
      name: '新节目',
      covers: [],
      logoPosition: 'bottom-right',
      defaultRatio: '16:9',
    };
    setPrograms([...programs, p]);
    setEditingId(p.id);
  };

  const handleDel = (id: string) => {
    setPrograms(programs.filter((p) => p.id !== id));
    if (editingId === id) setEditingId(null);
  };

  const up = (id: string, updates: Partial<ProgramConfig>) =>
    setPrograms(programs.map((p) => (p.id === id ? { ...p, ...updates } : p)));

  const upCover = (
    pid: string,
    coverId: string,
    updates: Partial<CoverAsset>,
  ) =>
    setPrograms(
      programs.map((p) =>
        p.id === pid
          ? {
              ...p,
              covers: p.covers.map((c) =>
                c.id === coverId ? { ...c, ...updates } : c,
              ),
            }
          : p,
      ),
    );

  const handleImgWithPath = async (
    pid: string,
    type: string,
    filePath: string,
  ) => {
    if (!filePath) return;
    const res = await window.ipc.invoke('audioVisualize:saveAsset', {
      sourcePath: filePath,
      programId: pid,
      assetType: type,
    });
    if (res.success) {
      if (type === 'logo') {
        const p = programs.find((pr) => pr.id === pid)!;
        const logos = p.logos || [];
        const logoId = 'logo-' + Date.now();
        up(pid, {
          logos: [...logos, { id: logoId, path: res.path, label: '' }],
          defaultLogoId: logos.length === 0 ? logoId : p.defaultLogoId,
        });
      } else {
        const p = programs.find((pr) => pr.id === pid)!;
        const w = res.width || 0;
        const h = res.height || 0;
        up(pid, {
          covers: [
            ...(p.covers || []),
            {
              id: 'cover-' + Date.now(),
              path: res.path,
              width: w,
              height: h,
              ratio: w && h ? (w / h).toFixed(2) : '',
            },
          ],
        });
      }
    }
  };

  const handleImg = async (pid: string, type: string) => {
    const src = await window.ipc.invoke('audioVisualize:selectImage');
    if (!src) return;
    const res = await window.ipc.invoke('audioVisualize:saveAsset', {
      sourcePath: src,
      programId: pid,
      assetType: type,
    });
    if (res.success) {
      if (type === 'logo') {
        const p = programs.find((pr) => pr.id === pid)!;
        const logos = p.logos || [];
        const logoId = 'logo-' + Date.now();
        up(pid, {
          logos: [...logos, { id: logoId, path: res.path }],
          defaultLogoId: logos.length === 0 ? logoId : p.defaultLogoId,
        });
      } else {
        const p = programs.find((pr) => pr.id === pid)!;
        const w = res.width || 0;
        const h = res.height || 0;
        up(pid, {
          covers: [
            ...(p.covers || []),
            {
              id: 'cover-' + Date.now(),
              path: res.path,
              width: w,
              height: h,
              ratio: ratioLabel(w, h),
            },
          ],
        });
      }
      toast.success('已添加');
    } else {
      toast.error(res.error);
    }
  };

  const rmImg = (pid: string, type: string) => {
    if (type === 'logo') {
      const p = programs.find((pr) => pr.id === pid)!;
      if (p?.logoPath)
        window.ipc.invoke('audioVisualize:deleteAsset', p.logoPath);
      up(pid, { logoPath: undefined });
    } else if (type.startsWith('logo-')) {
      const logoId = type.replace('logo-', '');
      const p = programs.find((pr) => pr.id === pid)!;
      const logo = (p.logos || []).find((l) => l.id === logoId);
      if (logo?.path)
        window.ipc.invoke('audioVisualize:deleteAsset', logo.path);
      const remaining = (p.logos || []).filter((l) => l.id !== logoId);
      const nextDefault =
        p.defaultLogoId === logoId ? remaining[0]?.id : p.defaultLogoId;
      up(pid, { logos: remaining, defaultLogoId: nextDefault });
    } else {
      const coverId = type.replace('cover-', '');
      const p = programs.find((pr) => pr.id === pid)!;
      const cover = (p.covers || []).find((c) => c.id === coverId);
      if (cover?.path)
        window.ipc.invoke('audioVisualize:deleteAsset', cover.path);
      up(pid, { covers: (p.covers || []).filter((c) => c.id !== coverId) });
    }
  };

  // 自动滚动到正在编辑的节目
  useEffect(() => {
    if (editingId && listRef.current) {
      const el = listRef.current.querySelector(
        '[data-program-id="' + editingId + '"]',
      );
      if (el) {
        setTimeout(
          () => el.scrollIntoView({ behavior: 'smooth', block: 'center' }),
          100,
        );
      }
    }
  }, [editingId]);

  const editing = programs.find((p) => p.id === editingId) || null;

  const editingLogos = editing?.logos || [];
  const defaultLogo =
    editingLogos.find((l) => l.id === editing?.defaultLogoId) ||
    editingLogos[0];
  const logoX =
    editing?.logoXRatio ??
    LOGO_POSITIONS.find((l) => l.value === editing?.logoPosition)?.x / 100 ??
    0.09;
  const logoY =
    editing?.logoYRatio ??
    LOGO_POSITIONS.find((l) => l.value === editing?.logoPosition)?.y / 100 ??
    0.89;
  const logoSizePct = (editing?.logoSizeRatio ?? 0.15) * 100;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          <Button onClick={handleAdd} size="sm" variant="outline">
            <Plus className="h-4 w-4 mr-1" /> 添加节目
          </Button>
        </div>
        <Button onClick={handleSave} disabled={saving} size="sm">
          {saving ? (
            '保存中...'
          ) : (
            <>
              <Save className="h-4 w-4 mr-1" /> 保存配置
            </>
          )}
        </Button>
      </div>

      <div className="flex gap-4 min-h-0 flex-1">
        {/* 左侧：节目列表 */}
        <div
          ref={listRef}
          className="w-52 flex flex-col gap-1.5 border-r pr-3 overflow-auto"
        >
          {programs.map((p) => (
            <div
              key={p.id}
              data-program-id={p.id}
              className={`flex items-center justify-between px-2.5 py-1.5 rounded cursor-pointer text-sm ${
                editingId === p.id
                  ? 'bg-primary/10 border border-primary font-medium'
                  : 'hover:bg-accent border border-transparent'
              }`}
              onClick={() => setEditingId(p.id)}
            >
              <span className="truncate">{p.name}</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 shrink-0 opacity-50 hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDel(p.id);
                }}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>

        {/* 右侧：编辑 */}
        <div className="flex-1 overflow-auto pb-4">
          {editing ? (
            <div className="flex flex-col gap-4">
              {/* 名称 */}
              <div className="flex flex-col gap-1">
                <Label className="text-xs font-medium">节目名称</Label>
                <Input
                  value={editing.name}
                  onChange={(e) => up(editing.id, { name: e.target.value })}
                />
              </div>

              {/* 分类 */}
              <div className="flex flex-col gap-1">
                <Label className="text-xs font-medium">视频分类</Label>
                <div className="flex gap-2">
                  {[
                    ['talent', '大佬说', '标题+压暗+频谱'],
                    ['meeting', '闭门会', '无标题+多尺寸'],
                  ].map(([cat, label, desc]) => (
                    <button
                      key={cat}
                      type="button"
                      className={cn(
                        'flex-1 px-3 py-2 rounded-md border text-sm transition-all text-left',
                        editing.category === cat ||
                          (!editing.category && cat === 'talent')
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-muted-foreground/20 hover:bg-accent',
                      )}
                      onClick={() => up(editing.id, { category: cat as any })}
                    >
                      <div className="font-medium">{label}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        {desc}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* 封面图 */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium flex items-center gap-1">
                    <ImageIcon className="h-3.5 w-3.5" /> 封面图片
                  </Label>
                </div>
                <div className="flex flex-wrap gap-3">
                  {(editing.covers || []).map((c, i) => {
                    const ratio = c.width && c.height ? c.width / c.height : 1;
                    const drawW =
                      ratio >= 1 ? 112 : Math.max(56, Math.round(112 * ratio));
                    const drawH = ratio >= 1 ? Math.round(112 / ratio) : 112;
                    return (
                      <div
                        key={c.id}
                        className="flex flex-col items-center gap-1 cursor-grab active:cursor-grabbing"
                        draggable
                        onDragStart={(e) => {
                          dragIdx.current = i;
                          e.dataTransfer.effectAllowed = 'move';
                        }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = 'move';
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          const from = dragIdx.current;
                          const to = i;
                          if (from >= 0 && from !== to) {
                            const reordered = reorderArray(
                              editing.covers || [],
                              from,
                              to,
                            );
                            up(editing.id, { covers: reordered });
                          }
                          dragIdx.current = -1;
                        }}
                      >
                        <div className="relative rounded overflow-hidden border bg-muted/30">
                          <img
                            src={'media://' + c.path}
                            alt="封面"
                            className="object-cover"
                            style={{ width: drawW, height: drawH }}
                          />
                          {defaultLogo && (
                            <img
                              src={'media://' + defaultLogo.path}
                              alt="Logo预览"
                              className="absolute rounded-full pointer-events-none"
                              style={{
                                width: logoSizePct + '%',
                                left: logoX * 100 + '%',
                                top: logoY * 100 + '%',
                                transform: 'translate(-50%, -50%)',
                              }}
                            />
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="absolute right-0.5 top-0.5 h-5 w-5 bg-background/80 text-muted-foreground"
                            onClick={() => rmImg(editing.id, 'cover-' + c.id)}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                        <span className="text-[10px] text-muted-foreground">
                          {c.ratio || '图片'}
                          {c.width && c.height && ` ${c.width}×${c.height}`}
                        </span>
                        <div className="flex items-center gap-0.5">
                          <span className="text-[9px] text-muted-foreground">
                            距顶
                          </span>
                          <input
                            type="text"
                            inputMode="numeric"
                            className="w-10 h-4 rounded border bg-background px-0.5 text-[10px] text-center"
                            value={c.subtitleTopPx ?? ''}
                            placeholder="158"
                            onChange={(e) => {
                              const v = e.target.value;
                              if (v === '' || /^\d{0,4}$/.test(v))
                                upCover(editing.id, c.id, {
                                  subtitleTopPx:
                                    v === '' ? undefined : parseInt(v),
                                });
                            }}
                          />
                          <span className="text-[9px] text-muted-foreground">
                            px
                          </span>
                        </div>
                      </div>
                    );
                  })}
                  {/* 上传封面占位框 */}
                  <div
                    className="flex flex-col items-center justify-center gap-1 rounded border-2 border-dashed border-muted-foreground/30 hover:border-primary/50 cursor-pointer transition-colors"
                    style={{ width: 112, height: 112 }}
                    onClick={() => handleImg(editing.id, 'cover')}
                    onDragOver={(e) => {
                      e.preventDefault();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const file = e.dataTransfer.files[0];
                      if (file) {
                        const filePath = window.ipc.getPathForFile(file);
                        handleImgWithPath(editing.id, 'cover', filePath);
                      }
                    }}
                  >
                    <Plus className="h-5 w-5 text-muted-foreground/50" />
                    <span className="text-[10px] text-muted-foreground/50">
                      添加封面
                    </span>
                  </div>
                </div>
              </div>

              {/* Logo */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium flex items-center gap-1">
                    <Stamp className="h-3.5 w-3.5" /> Logo
                  </Label>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {(editing.logos || []).map((l, i) => {
                    const isDefault = defaultLogo?.id === l.id;
                    return (
                      <div
                        key={l.id}
                        className="relative flex flex-col items-center cursor-grab active:cursor-grabbing"
                        draggable
                        onDragStart={(e) => {
                          dragIdx.current = i;
                          e.dataTransfer.effectAllowed = 'move';
                        }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = 'move';
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          const from = dragIdx.current;
                          const to = i;
                          if (from >= 0 && from !== to) {
                            const reordered = reorderArray(
                              editing.logos || [],
                              from,
                              to,
                            );
                            up(editing.id, { logos: reordered });
                          }
                          dragIdx.current = -1;
                        }}
                      >
                        <button
                          type="button"
                          title={isDefault ? '默认Logo' : '点击设为默认Logo'}
                          className={cn(
                            'relative w-16 h-16 rounded-lg overflow-hidden bg-muted/30 border-2 transition-all',
                            isDefault
                              ? 'border-primary ring-1 ring-primary'
                              : 'border-muted-foreground/20 hover:border-muted-foreground/50',
                          )}
                          onClick={() =>
                            up(editing.id, { defaultLogoId: l.id })
                          }
                        >
                          <img
                            src={'media://' + l.path}
                            alt="Logo"
                            className="w-full h-full object-contain"
                          />
                          {isDefault && (
                            <span className="absolute bottom-0 left-0 right-0 bg-primary/90 text-white text-[9px] leading-tight text-center py-0.5">
                              默认
                            </span>
                          )}
                        </button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="absolute -top-1.5 -right-1.5 h-5 w-5 bg-background border text-muted-foreground rounded-full"
                          onClick={() => rmImg(editing.id, 'logo-' + l.id)}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                        <input
                          type="text"
                          value={l.label || ''}
                          placeholder="名称"
                          onChange={(e) => {
                            const newLabel = e.target.value;
                            const newLogos = (editing.logos || []).map(
                              (logo) =>
                                logo.id === l.id
                                  ? { ...logo, label: newLabel }
                                  : logo,
                            );
                            up(editing.id, { logos: newLogos });
                          }}
                          className="w-16 mt-0.5 text-[10px] text-center border rounded px-0.5 py-0.5 bg-background truncate"
                        />
                      </div>
                    );
                  })}
                  {/* 上传Logo占位框 */}
                  <div
                    className="flex flex-col items-center justify-center gap-0.5 rounded-lg border-2 border-dashed border-muted-foreground/30 hover:border-primary/50 cursor-pointer transition-colors"
                    style={{ width: 64, height: 64 }}
                    onClick={() => handleImg(editing.id, 'logo')}
                    onDragOver={(e) => {
                      e.preventDefault();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const file = e.dataTransfer.files[0];
                      if (file) {
                        const filePath = window.ipc.getPathForFile(file);
                        handleImgWithPath(editing.id, 'logo', filePath);
                      }
                    }}
                  >
                    <Plus className="h-4 w-4 text-muted-foreground/50" />
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground -mt-1">
                  点击Logo缩略图可设为默认，默认Logo会优先用于封面预览与视频生成
                </p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-2">
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-muted-foreground">
                      位置
                    </span>
                    <div className="flex gap-0.5">
                      {LOGO_POSITIONS.map((lp) => (
                        <button
                          key={lp.value}
                          type="button"
                          className={cn(
                            'px-1.5 py-0.5 rounded text-[10px] border transition-all',
                            editing.logoPosition === lp.value
                              ? 'border-primary bg-primary/10 text-primary'
                              : 'border-muted-foreground/20 hover:bg-accent',
                          )}
                          onClick={() =>
                            up(editing.id, {
                              logoPosition: lp.value,
                              logoXRatio: lp.x / 100,
                              logoYRatio: lp.y / 100,
                            })
                          }
                        >
                          {lp.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-muted-foreground">X</span>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      className="h-7 w-14 text-xs"
                      value={Math.round(
                        (editing.logoXRatio ??
                          (LOGO_POSITIONS.find(
                            (l) => l.value === editing.logoPosition,
                          )?.x ?? 50) / 100) * 100,
                      )}
                      onChange={(e) =>
                        up(editing.id, {
                          logoXRatio: parseInt(e.target.value) / 100,
                        })
                      }
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-muted-foreground">Y</span>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      className="h-7 w-14 text-xs"
                      value={Math.round(
                        (editing.logoYRatio ??
                          (LOGO_POSITIONS.find(
                            (l) => l.value === editing.logoPosition,
                          )?.y ?? 50) / 100) * 100,
                      )}
                      onChange={(e) =>
                        up(editing.id, {
                          logoYRatio: parseInt(e.target.value) / 100,
                        })
                      }
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-muted-foreground">
                      大小
                    </span>
                    <Input
                      type="number"
                      min={5}
                      max={80}
                      className="h-7 w-14 text-xs"
                      value={Math.round((editing.logoSizeRatio ?? 0.15) * 100)}
                      onChange={(e) =>
                        up(editing.id, {
                          logoSizeRatio: parseInt(e.target.value) / 100,
                        })
                      }
                    />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      id="logo-rotate"
                      className="h-3.5 w-3.5 accent-primary"
                      checked={editing.logoRotate === true}
                      onChange={(e) =>
                        up(editing.id, { logoRotate: e.target.checked })
                      }
                    />
                    <label
                      htmlFor="logo-rotate"
                      className="text-[10px] text-muted-foreground cursor-pointer select-none"
                    >
                      LOGO旋转
                    </label>
                    {editing.logoRotate && (
                      <div className="flex items-center gap-1 ml-1">
                        <input
                          type="number"
                          className="h-5 w-12 rounded border bg-background px-1 text-[10px] text-center"
                          value={editing.logoRotateSpeed ?? 90}
                          min={1}
                          max={3600}
                          onChange={(e) =>
                            up(editing.id, {
                              logoRotateSpeed: parseFloat(e.target.value) || 90,
                            })
                          }
                        />
                        <span className="text-[10px] text-muted-foreground">
                          °/s
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* 水印 */}
                <div className="space-y-2 pt-2 border-t">
                  <Label className="text-xs font-medium">水印文字</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      value={editing.watermarkText || ''}
                      onChange={(e) =>
                        up(editing.id, { watermarkText: e.target.value })
                      }
                      placeholder="留空则使用通用样式中的全局水印"
                      className="h-8 text-xs flex-1"
                    />
                    <div className="flex items-center gap-1 shrink-0">
                      <Switch
                        checked={editing.watermarkEnabled !== false}
                        onCheckedChange={(v) =>
                          up(editing.id, { watermarkEnabled: v })
                        }
                        className="h-4 w-7 [&>span]:h-3 [&>span]:w-3 [&>span[data-state=checked]]:translate-x-3"
                      />
                      <span className="text-[10px] text-muted-foreground">
                        {editing.watermarkEnabled !== false ? '开' : '关'}
                      </span>
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    以半透明斜向平铺方式叠加在视频背景上，留空使用全局设置
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              选择或添加一个节目
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
