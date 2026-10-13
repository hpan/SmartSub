/**
 * 工作台 - Pipeline 任务看板
 * 即将到来的排期 + 任务流水线 + 监控日志
 */

import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from 'react';
import { getStaticPaths, makeStaticProperties } from '../../lib/get-static';
import PageHeader from '@/components/PageHeader';
import { cn } from 'lib/utils';
import { toast } from 'sonner';
import {
  Download,
  Scissors,
  ImageIcon,
  Upload,
  Video,
  FileText,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Clock,
  Loader2,
  Play,
  FolderOpen,
  RotateCw,
  XCircle,
  Square,
  CalendarDays,
  Timer,
  Trash2,
  Monitor,
  ExternalLink,
  Copy,
  Plus,
} from 'lucide-react';

/* ── 排期 ── */
interface ProgramSchedule {
  name: string;
  dayOfWeek: number;
  targetHour: number;
}
const PROGRAM_SCHEDULES: ProgramSchedule[] = [
  { name: '大摩宏观策略谈', dayOfWeek: 1, targetHour: 12 },
  { name: '中金宏观策略周论', dayOfWeek: 1, targetHour: 12 },
  { name: '大摩周期论剑', dayOfWeek: 3, targetHour: 12 },
  { name: '大摩新经济热点前瞻', dayOfWeek: 5, targetHour: 12 },
  { name: '招商宏观周周谈', dayOfWeek: 0, targetHour: 21 },
  { name: '华创宏观张瑜旬度', dayOfWeek: 0, targetHour: 21 },
];
const DAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/* ── Pipeline ── */
const PIPELINE_STEPS = [
  { key: 'download', label: '下载', icon: Download },
  { key: 'rename', label: '改名', icon: FileText },
  { key: 'trim', label: '裁割', icon: Scissors },
  { key: 'cover', label: '封面', icon: ImageIcon },
  { key: 'ima', label: 'IMA', icon: Upload },
  { key: 'compose', label: '音画', icon: Video },
] as const;

type StepStatus = 'pending' | 'running' | 'done' | 'error';
type TaskStatus = 'processing' | 'done' | 'error' | 'waiting_confirm';

interface PipelineTask {
  id: string;
  programName: string;
  episodeTitle: string;
  bvid?: string;
  sourceUrl?: string;
  detectedAt: string;
  status: TaskStatus;
  steps: Record<string, StepStatus>;
  stepProgress?: Record<string, number>;
  stepDetails?: Record<string, string>;
  filePaths?: {
    audio?: string;
    subtitle?: string;
    cover?: string;
    video?: string;
  };
  audioPath?: string;
  cancelled?: boolean;
  pausedAt?: string;
}

interface ActivityLog {
  id: string;
  timestamp: string;
  type: 'scan' | 'match' | 'skip' | 'start' | 'step' | 'done' | 'error';
  message: string;
  detail?: string;
  url?: string;
  videoTitle?: string;
  bvid?: string;
  pubDate?: string;
}

const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; bgColor: string }
> = {
  processing: {
    label: '处理中',
    color: 'text-violet-500',
    bgColor: 'bg-violet-500/10',
  },
  done: {
    label: '已完成',
    color: 'text-green-500',
    bgColor: 'bg-green-500/10',
  },
  error: { label: '失败', color: 'text-red-500', bgColor: 'bg-red-500/10' },
  waiting_confirm: {
    label: '待确认',
    color: 'text-amber-500',
    bgColor: 'bg-amber-500/10',
  },
};

const LOG_TYPE_CONFIG: Record<string, { color: string; label: string }> = {
  scan: { color: 'text-blue-500', label: '扫描' },
  match: { color: 'text-green-500', label: '匹配' },
  skip: { color: 'text-muted-foreground', label: '跳过' },
  start: { color: 'text-violet-500', label: '执行' },
  step: { color: 'text-violet-500', label: '步骤' },
  done: { color: 'text-green-500', label: '完成' },
  error: { color: 'text-red-500', label: '错误' },
};

/* ── 倒计时 ── */
function formatCountdown(ms: number): string {
  if (ms <= 0) return '即将到来';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h < 1) return `${m}分钟`;
  if (h < 24) return `${h}小时${m > 0 ? m + '分' : ''}`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return `${d}天${rh > 0 ? rh + '小时' : ''}`;
}

function getProximityStyle(hoursUntil: number) {
  if (hoursUntil <= 6)
    return {
      border: 'border-orange-400/60',
      bg: 'bg-orange-500/8',
      badgeText: 'text-orange-600',
    };
  if (hoursUntil <= 24)
    return {
      border: 'border-amber-400/40',
      bg: 'bg-amber-500/5',
      badgeText: 'text-amber-600',
    };
  if (hoursUntil <= 72)
    return {
      border: 'border-blue-400/30',
      bg: 'bg-blue-500/4',
      badgeText: 'text-blue-500',
    };
  return {
    border: 'border-muted-foreground/15',
    bg: 'bg-card',
    badgeText: 'text-muted-foreground',
  };
}

function getNextOccurrence(s: ProgramSchedule): Date {
  const now = new Date();
  let d = s.dayOfWeek - now.getDay();
  if (d < 0) d += 7;
  if (d === 0 && now.getHours() >= s.targetHour) d = 7;
  const next = new Date(now);
  next.setDate(next.getDate() + d);
  next.setHours(s.targetHour, 0, 0, 0);
  return next;
}

/* ── 步骤图标 ── */
function StepIcon({
  status,
  progress,
}: {
  status: StepStatus;
  progress?: number;
}) {
  if (status === 'done')
    return <CheckCircle2 className="h-4 w-4 text-green-500" />;
  if (status === 'running')
    return (
      <span className="flex items-center gap-1">
        <Loader2 className="h-4 w-4 text-violet-500 animate-spin" />
        {progress !== undefined && (
          <span className="text-[10px] text-violet-500">{progress}%</span>
        )}
      </span>
    );
  if (status === 'error') return <XCircle className="h-4 w-4 text-red-500" />;
  return <Clock className="h-4 w-4 text-muted-foreground/30" />;
}

/* ── 步骤详情 ── */
function StepDetail({ detail, stepKey }: { detail: string; stepKey?: string }) {
  // 提取路径（兼容 FILE: 前缀和旧数据的绝对路径）
  const filePath = detail.startsWith('FILE:')
    ? detail.slice(5)
    : detail.startsWith('/')
      ? detail
      : null;

  // 改名步骤：只显示文件名，不显示路径
  if (stepKey === 'rename') {
    const name = filePath ? filePath.split('/').pop() : detail;
    return (
      <span className="text-[10px] text-muted-foreground truncate" title={name}>
        {name}
      </span>
    );
  }

  // 文件路径：只显示小图标
  if (filePath) {
    return (
      <button
        className="text-[10px] text-blue-500 hover:text-blue-700"
        title={filePath}
        onClick={(e) => {
          e.stopPropagation();
          window.ipc.invoke('shell:showItemInFolder', filePath);
        }}
      >
        <FolderOpen className="h-3.5 w-3.5" />
      </button>
    );
  }

  // 纯文本
  return (
    <span className="text-[10px] text-green-600 dark:text-green-400 leading-tight">
      {detail}
    </span>
  );
}

/* ── 即将到来 ── */

/* ── 状态颜色 ── */
function statusColor(status: StepStatus): string {
  if (status === 'done') return 'text-green-500';
  if (status === 'running') return 'text-violet-500';
  if (status === 'error') return 'text-red-500';
  return 'text-muted-foreground/30';
}

/* ── 步骤芯片（单行显示） ── */
function StepChip({
  status,
  progress,
  w,
  children,
}: {
  status: StepStatus;
  progress?: number;
  w?: string;
  children: React.ReactNode;
}) {
  const borderColor =
    status === 'done'
      ? 'border-green-500/30'
      : status === 'running'
        ? 'border-violet-500/30'
        : status === 'error'
          ? 'border-red-500/30'
          : 'border-transparent';
  const bgColor =
    status === 'done'
      ? 'bg-green-500/5'
      : status === 'running'
        ? 'bg-violet-500/5'
        : status === 'error'
          ? 'bg-red-500/5'
          : 'bg-muted/10';
  return (
    <div
      className={cn(
        'min-w-0 flex items-center gap-1 px-1.5 py-1.5 rounded-md text-xs border shrink-0',
        w,
        borderColor,
        bgColor,
      )}
    >
      {children}
    </div>
  );
}
function UpcomingSchedule() {
  const now = new Date();
  const upcoming = useMemo(() => {
    return PROGRAM_SCHEDULES.map((s) => {
      const nd = getNextOccurrence(s);
      const ms = nd.getTime() - now.getTime();
      return { ...s, nextDate: nd, msUntil: ms, hoursUntil: ms / 3600000 };
    })
      .sort((a, b) => a.msUntil - b.msUntil)
      .slice(0, 4);
  }, []);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <CalendarDays className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-medium">即将到来</h3>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {upcoming.map((item) => {
          const style = getProximityStyle(item.hoursUntil);
          const dayLabel = DAY_NAMES[item.nextDate.getDay()];
          const dateStr = `${String(item.nextDate.getMonth() + 1).padStart(2, '0')}/${String(item.nextDate.getDate()).padStart(2, '0')}`;
          return (
            <div
              key={item.name + item.dayOfWeek}
              className={cn(
                'border rounded-lg px-3 py-2.5',
                style.border,
                style.bg,
              )}
            >
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="text-sm font-medium truncate">
                  {item.name}
                </span>
                <span className="text-xs text-muted-foreground shrink-0">
                  ({dayLabel})
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  {dateStr} {String(item.targetHour).padStart(2, '0')}:00
                </span>
                <div className="flex items-center gap-1">
                  <Timer className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className={cn('font-medium', style.badgeText)}>
                    {formatCountdown(item.msUntil)}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── 任务行 ── */
function TaskRow({
  task,
  onAction,
}: {
  task: PipelineTask;
  onAction: (a: string, id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const config = STATUS_CONFIG[task.status] || STATUS_CONFIG.waiting_confirm;

  return (
    <div className="border rounded-lg bg-card hover:bg-accent/20 transition-colors">
      <div
        className="flex items-center gap-3 px-4 py-2.5 cursor-pointer select-none"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <span
          className={cn(
            'text-xs px-2 py-0.5 rounded-full font-medium shrink-0',
            config.bgColor,
            config.color,
          )}
        >
          {task.programName}
        </span>
        <span className="flex-1 min-w-0 text-sm truncate">
          {task.episodeTitle}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          {PIPELINE_STEPS.map((step) => {
            const s = task.steps[step.key] || 'pending';
            return (
              <span
                key={step.key}
                className={cn(
                  'text-xs',
                  s === 'done'
                    ? 'text-green-500'
                    : s === 'running'
                      ? 'text-violet-500 font-medium'
                      : s === 'error'
                        ? 'text-red-500'
                        : 'text-muted-foreground/40',
                )}
              >
                {step.label}
              </span>
            );
          })}
        </div>
        <span
          className={cn(
            'text-xs px-2 py-0.5 rounded shrink-0',
            config.bgColor,
            config.color,
          )}
        >
          {config.label}
        </span>
        <span className="text-xs text-muted-foreground shrink-0">
          {task.detectedAt}
        </span>
      </div>
      {expanded && (
        <div className="px-4 pb-3 border-t">
          <div className="flex gap-1.5 mt-3 items-center">
            {/* 下载 */}
            <StepChip
              status={task.steps.download}
              progress={task.stepProgress?.download}
              w="w-[8%]"
            >
              <Download
                className={cn(
                  'h-3.5 w-3.5 shrink-0',
                  statusColor(task.steps.download),
                )}
              />
              <span className="font-medium">下载</span>
              {task.stepDetails?.download && (
                <StepDetail
                  detail={task.stepDetails.download}
                  stepKey="download"
                />
              )}
            </StepChip>
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/30" />
            {/* 改名 */}
            <StepChip
              status={task.steps.rename}
              progress={task.stepProgress?.rename}
              w="w-[40%]"
            >
              <div className="flex items-center gap-1 shrink-0">
                <FileText
                  className={cn(
                    'h-3.5 w-3.5 shrink-0',
                    statusColor(task.steps.rename),
                  )}
                />
                <span className="font-medium whitespace-nowrap">改名</span>
              </div>
              {task.pausedAt === 'rename' ? (
                <div className="flex-1 min-w-0 flex items-center gap-1">
                  <textarea
                    className="flex-1 min-w-0 text-[11px] bg-background border rounded px-1.5 py-0.5 outline-none focus:border-primary resize-none"
                    defaultValue={task.stepDetails?.rename || ''}
                    id={`rename-input-${task.id}`}
                    rows={2}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <button
                    className="px-1.5 py-0.5 text-[11px] bg-primary text-primary-foreground rounded hover:bg-primary/90 shrink-0 self-center"
                    onClick={(e) => {
                      e.stopPropagation();
                      onAction('confirmRename', task.id);
                    }}
                  >
                    确定
                  </button>
                </div>
              ) : task.stepDetails?.rename ? (
                <span
                  className="flex-1 min-w-0 text-[10px] text-muted-foreground line-clamp-3 leading-tight"
                  title={task.stepDetails.rename}
                >
                  {task.stepDetails.rename.split('/').pop()}
                </span>
              ) : null}
            </StepChip>
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/30" />
            {/* 裁割 */}
            <StepChip
              status={task.steps.trim}
              progress={task.stepProgress?.trim}
              w="w-[12%]"
            >
              <Scissors
                className={cn(
                  'h-3.5 w-3.5 shrink-0',
                  statusColor(task.steps.trim),
                )}
              />
              <span className="font-medium">裁割</span>
              {task.stepDetails?.trim && (
                <span className="text-[10px] text-green-600 dark:text-green-400">
                  {task.stepDetails.trim}
                </span>
              )}
            </StepChip>
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/30" />
            {/* 封面 */}
            <StepChip status={task.steps.cover} w="w-[8%]">
              <ImageIcon
                className={cn(
                  'h-3.5 w-3.5 shrink-0',
                  statusColor(task.steps.cover),
                )}
              />
              <span className="font-medium">封面</span>
              {task.stepDetails?.cover && (
                <StepDetail detail={task.stepDetails.cover} stepKey="cover" />
              )}
            </StepChip>
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/30" />
            {/* IMA */}
            <StepChip status={task.steps.ima} w="w-[8%]">
              <Upload
                className={cn(
                  'h-3.5 w-3.5 shrink-0',
                  statusColor(task.steps.ima),
                )}
              />
              <span className="font-medium">IMA</span>
              {task.stepDetails?.ima && (
                <span className="text-[10px] text-green-600 dark:text-green-400">
                  {task.stepDetails.ima}
                </span>
              )}
            </StepChip>
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/30" />
            {/* 音画 */}
            <div className="w-[10%] min-w-0 flex items-center gap-1.5 px-1.5 py-1.5 rounded-md text-xs border opacity-40 bg-muted/10 border-transparent">
              <Video className="h-3.5 w-3.5 shrink-0 text-muted-foreground/30" />
              <span className="font-medium">音画</span>
              <span className="text-[10px] text-muted-foreground ml-auto">
                跳过
              </span>
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            {task.status === 'waiting_confirm' && (
              <button
                onClick={() => onAction('execute', task.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
              >
                <Play className="h-3.5 w-3.5" /> 开始执行
              </button>
            )}
            {task.status === 'processing' && (
              <button
                onClick={() => onAction('stop', task.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-red-500 text-white rounded-md hover:bg-red-600"
              >
                <Square className="h-3.5 w-3.5" /> 停止执行
              </button>
            )}
            {task.status === 'error' && (
              <button
                onClick={() => onAction('retry', task.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
              >
                <RotateCw className="h-3.5 w-3.5" /> 重试
              </button>
            )}
            {task.status === 'done' && (
              <button
                onClick={() => onAction('openFile', task.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs border rounded-md hover:bg-accent"
              >
                <FolderOpen className="h-3.5 w-3.5" /> 打开文件
              </button>
            )}
            {task.status === 'done' && (
              <button
                onClick={() => onAction('openFolder', task.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs border rounded-md hover:bg-accent"
              >
                <FolderOpen className="h-3.5 w-3.5" /> 打开文件夹
              </button>
            )}
            {task.status === 'done' && (
              <button
                onClick={() => onAction('rerun', task.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs border rounded-md hover:bg-accent"
              >
                <RotateCw className="h-3.5 w-3.5" /> 重新执行
              </button>
            )}
            <button
              onClick={() => onAction('delete', task.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs border rounded-md hover:bg-accent text-muted-foreground"
            >
              <Trash2 className="h-3.5 w-3.5" /> 删除
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── 主页面 ── */
export default function WorkspacePage() {
  const [tasks, setTasks] = useState<PipelineTask[]>([]);
  const tasksRef = useRef(tasks);
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [filter, setFilter] = useState<string>('all');

  const loadTasks = useCallback(async () => {
    try {
      const d = await window.ipc.invoke('workspace:getTasks');
      if (Array.isArray(d)) setTasks(d);
    } catch {}
  }, []);
  const loadLogs = useCallback(async () => {
    try {
      const d = await window.ipc.invoke('workspace:getLogs');
      if (Array.isArray(d)) setLogs(d);
    } catch {}
  }, []);

  useEffect(() => {
    loadTasks();
    loadLogs();
    const unsubT = window.ipc.on(
      'workspace:taskUpdate',
      (task: PipelineTask) => {
        setTasks((prev) => {
          const i = prev.findIndex((t) => t.id === task.id);
          if (i >= 0) {
            const n = [...prev];
            n[i] = task;
            return n;
          }
          return [task, ...prev];
        });
      },
    );
    const unsubL = window.ipc.on('workspace:logUpdate', (log: ActivityLog) => {
      setLogs((prev) => [log, ...prev].slice(0, 200));
    });
    return () => {
      if (unsubT) unsubT();
      if (unsubL) unsubL();
    };
  }, [loadTasks, loadLogs]);

  const handleAction = useCallback(async (action: string, taskId: string) => {
    if (action === 'execute')
      await window.ipc.invoke('workspace:execute', taskId);
    else if (action === 'retry')
      await window.ipc.invoke('workspace:retry', taskId);
    else if (action === 'rerun')
      await window.ipc.invoke('workspace:rerun', taskId);
    else if (action === 'stop')
      await window.ipc.invoke('workspace:stop', taskId);
    else if (action === 'confirmRename') {
      const input = document.getElementById(
        `rename-input-${taskId}`,
      ) as HTMLTextAreaElement;
      const newName = input?.value?.trim();
      console.log('[workspace] confirmRename:', { taskId, newName });
      try {
        const result = await window.ipc.invoke(
          'workspace:confirmRename',
          taskId,
          newName,
        );
        console.log('[workspace] confirmRename result:', result);
        if (result && !result.success) {
          console.error('[workspace] confirmRename failed:', result.error);
        }
      } catch (err) {
        console.error('[workspace] confirmRename error:', err);
      }
    } else if (action === 'openFile') {
      const t = tasksRef.current.find((t) => t.id === taskId);
      if (t?.audioPath)
        await window.ipc.invoke('shell:showItemInFolder', t.audioPath);
    } else if (action === 'openFolder') {
      const t = tasksRef.current.find((t) => t.id === taskId);
      if (t?.audioPath) {
        const folderPath = t.audioPath.substring(
          0,
          t.audioPath.lastIndexOf('/'),
        );
        await window.ipc.invoke('shell:openFolder', folderPath);
      }
    } else if (action === 'delete') {
      const u = await window.ipc.invoke('workspace:deleteTask', taskId);
      if (Array.isArray(u)) setTasks(u);
    }
  }, []);

  const handleCopy = useCallback((text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
  }, []);
  const handleManualScan = useCallback(async () => {
    await window.ipc.invoke('workspace:manualScan');
  }, []);
  const handleClearLogs = useCallback(async () => {
    const c = await window.ipc.invoke('workspace:clearLogs');
    if (Array.isArray(c)) setLogs(c);
  }, []);
  const handleAddFromLog = useCallback(async (log: ActivityLog) => {
    const res = await window.ipc.invoke('workspace:addFromLog', {
      title: log.videoTitle || log.message,
      url: log.url,
      bvid: log.bvid,
    });
    if (res?.success) toast.success('已添加到任务记录');
    else toast.info(res?.error || '添加失败');
  }, []);

  const filteredTasks =
    filter === 'all' ? tasks : tasks.filter((t) => t.status === filter);

  return (
    <div className="flex h-full flex-col gap-4 p-4 overflow-hidden">
      <PageHeader
        title="工作台"
        description="自动化流水线 · 监控 → 下载 → 裁割 → 封面 → IMA → 音画"
      />

      <div className="min-h-0 flex-1 overflow-auto space-y-5">
        <UpcomingSchedule />

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">任务记录</h3>
            <div className="flex items-center gap-1.5">
              {(
                [
                  'all',
                  'processing',
                  'waiting_confirm',
                  'done',
                  'error',
                ] as const
              ).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    'px-2.5 py-1 text-xs rounded-full transition-colors',
                    filter === f
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:text-foreground',
                  )}
                >
                  {f === 'all' ? '全部' : STATUS_CONFIG[f]?.label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            {filteredTasks.map((task) => (
              <TaskRow key={task.id} task={task} onAction={handleAction} />
            ))}
            {filteredTasks.length === 0 && (
              <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
                暂无任务
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 监控日志 - 固定底部 */}
      <div className="shrink-0 border-t pt-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Monitor className="h-4 w-4 text-muted-foreground" />
            监控日志
            {logs.length > 0 && (
              <span className="text-xs text-muted-foreground">
                ({logs.length})
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleManualScan}
              className="text-xs px-2 py-1 border rounded hover:bg-accent transition-colors"
            >
              手动扫描
            </button>
            {logs.length > 0 && (
              <button
                onClick={handleClearLogs}
                className="text-xs px-2 py-1 border rounded hover:bg-accent transition-colors text-muted-foreground"
              >
                清空
              </button>
            )}
          </div>
        </div>
        <div
          className="border rounded-lg bg-card overflow-auto"
          style={{ height: '240px' }}
        >
          {logs.length === 0 ? (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              暂无日志，等待首次扫描...
            </div>
          ) : (
            logs.slice(0, 200).map((log) => {
              const cfg = LOG_TYPE_CONFIG[log.type] || LOG_TYPE_CONFIG.scan;
              return (
                <div
                  key={log.id}
                  className="flex items-center gap-2 px-3 py-1.5 text-xs border-b last:border-b-0 hover:bg-accent/30"
                >
                  <span
                    className="text-muted-foreground shrink-0 font-mono"
                    style={{ width: '120px' }}
                  >
                    {log.timestamp}
                  </span>
                  <span
                    className={cn('shrink-0 font-medium', cfg.color)}
                    style={{ width: '28px' }}
                  >
                    {cfg.label}
                  </span>
                  <span className="flex-1 min-w-0 truncate">{log.message}</span>
                  {log.pubDate && (
                    <span
                      className="text-muted-foreground shrink-0 font-mono"
                      style={{ width: '90px' }}
                    >
                      {log.pubDate}
                    </span>
                  )}
                  {log.bvid && (
                    <span
                      className="text-muted-foreground shrink-0 font-mono"
                      style={{ width: '100px' }}
                    >
                      {log.bvid}
                    </span>
                  )}
                  <div className="flex items-center gap-1 shrink-0">
                    {log.videoTitle && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopy(log.videoTitle!);
                        }}
                        className="text-muted-foreground hover:text-primary transition-colors"
                        title="复制标题"
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                    )}
                    {log.url && (
                      <a
                        href={log.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-primary transition-colors"
                        title="在浏览器中打开"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                    {log.videoTitle && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAddFromLog(log);
                        }}
                        className="text-muted-foreground hover:text-primary transition-colors"
                        title="添加到任务"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

export const getStaticProps = makeStaticProperties(['common']);
export { getStaticPaths };
