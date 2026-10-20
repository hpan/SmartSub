/**
 * 工作台 - Pipeline 任务管理
 * 负责：任务存储、B站监控、Pipeline执行、活动日志
 */

import { ipcMain, BrowserWindow, app, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { logMessage } from './storeManager';
import { renameAfterDownload } from './videoDownload/renameAfterDownload';

/* ── 数据目录 ── */
const userData =
  process.env.NODE_ENV === 'development'
    ? path.join(
        process.env.HOME || '',
        'Library/Application Support/smartsub-dev',
      )
    : path.join(process.env.HOME || '', 'Library/Application Support/smartsub');
const TASKS_FILE = path.join(userData, 'workspace-tasks.json');
const LOG_FILE = path.join(userData, 'workspace-log.json');

/* ── 类型定义 ── */
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
  currentStep?: string;
  progress?: number;
  error?: string;
  cancelled?: boolean;
  pausedAt?: string;
  stepDetails?: Record<string, string>;
}

interface ActivityLog {
  id: string;
  timestamp: string;
  type: 'scan' | 'match' | 'skip' | 'start' | 'step' | 'done' | 'error';
  message: string;
  detail?: string;
  url?: string;
  videoTitle?: string; // 完整标题，用于复制
  bvid?: string;
  pubDate?: string; // 格式化后的发布日期时间
}

/* ── 节目定义 ── */
interface ProgramDef {
  name: string;
  keywords: string[]; // 标题必须包含的关键词（全部匹配）
  anyKeywords?: string[]; // 标题包含任一即可
  dayOfWeek?: number; // 发布星期（0=周日）
  timeAfter?: number; // 发布时间晚于此小时（24h制）
  minDuration?: number; // 最短视频时长（秒），用于过滤AI合成的短视频
  knowledgeBase: string;
  folderName: string;
  targetHour: number;
}

const PROGRAMS: ProgramDef[] = [
  // 具体节目（优先匹配，dayOfWeek 仅作软参考不硬过滤）
  {
    name: '大摩宏观策略谈',
    keywords: ['大摩'],
    anyKeywords: ['宏观策略谈', '宏观策略'],
    knowledgeBase: '大摩闭门会',
    folderName: '',
    targetHour: 12,
  },
  {
    name: '中金宏观策略周论',
    keywords: ['中金'],
    anyKeywords: ['宏观策略', '周论'],
    knowledgeBase: '中金闭门会',
    folderName: '中金宏观策略周论2026',
    targetHour: 12,
  },
  {
    name: '大摩周期论剑',
    keywords: ['大摩'],
    anyKeywords: ['周期论剑'],
    knowledgeBase: '大摩闭门会',
    folderName: '',
    targetHour: 12,
  },
  {
    name: '大摩新经济热点前瞻',
    keywords: ['大摩'],
    anyKeywords: ['新经济'],
    knowledgeBase: '大摩闭门会',
    folderName: '',
    targetHour: 12,
  },
  {
    name: '招商宏观周周谈',
    keywords: ['招商'],
    // UP主实际栏目名为「招商开门会」，标题未必带 宏观/张静静/周周谈
    anyKeywords: ['宏观', '张静静', '周周谈', '开门'],
    timeAfter: 10,
    knowledgeBase: '中金闭门会',
    folderName: '招商宏观周周谈2026',
    targetHour: 21,
  },
  {
    name: '华创宏观张瑜旬度',
    keywords: ['华创'],
    // UP主实际栏目名为「华创开门会」，标题未必带 宏观/张瑜/旬度
    anyKeywords: ['宏观', '张瑜', '旬度', '开门'],
    timeAfter: 10,
    knowledgeBase: '中金闭门会',
    folderName: '华创宏观-张瑜旬度时间2026',
    targetHour: 21,
  },
  // 通用兜底：标题含"大摩"+"闭门会"，需中午12点后发布且时长>=30分钟（过滤AI合成短视频）
  {
    name: '大摩闭门会',
    keywords: ['大摩', '闭门会'],
    timeAfter: 12,
    minDuration: 1800,
    knowledgeBase: '大摩闭门会',
    folderName: '',
    targetHour: 12,
  },
  // 中金开门/闭门会（无时长限制，适用于各种时长的节目）
  {
    name: '中金闭门会',
    keywords: ['中金'],
    anyKeywords: ['开门', '闭门'],
    timeAfter: 10,
    knowledgeBase: '中金闭门会',
    folderName: '',
    targetHour: 12,
  },
];

/* ── 持久化 ── */
function loadJSON<T>(file: string, fallback: T): T {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {}
  return fallback;
}
function saveJSON(file: string, data: any): void {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}

const KNOWN_BVIDS_FILE = path.join(userData, 'workspace-known-bvids.json');
const loadTasks = () => loadJSON<PipelineTask[]>(TASKS_FILE, []);
const saveTasks = (tasks: PipelineTask[]) => saveJSON(TASKS_FILE, tasks);
const loadLogs = () => loadJSON<ActivityLog[]>(LOG_FILE, []);
const saveLogs = (logs: ActivityLog[]) => saveJSON(LOG_FILE, logs);

function addLog(
  type: ActivityLog['type'],
  message: string,
  detail?: string,
  url?: string,
  extra?: { videoTitle?: string; bvid?: string; pubDate?: string },
): ActivityLog {
  const logs = loadLogs();

  // 去重：如果已经存在相同的bvid或相同的message，就不重复添加
  if (extra?.bvid) {
    const exists = logs.some((l) => l.bvid === extra.bvid);
    if (exists) return logs.find((l) => l.bvid === extra.bvid)!;
  }
  if (type === 'skip' || type === 'match') {
    const exists = logs.some((l) => l.message === message && l.type === type);
    if (exists)
      return logs.find((l) => l.message === message && l.type === type)!;
  }

  const entry: ActivityLog = {
    id: `log-${Date.now()}`,
    timestamp: (() => {
      const n = new Date();
      const mm = String(n.getMonth() + 1).padStart(2, '0');
      const dd = String(n.getDate()).padStart(2, '0');
      const hh = String(n.getHours()).padStart(2, '0');
      const mi = String(n.getMinutes()).padStart(2, '0');
      const ss = String(n.getSeconds()).padStart(2, '0');
      return `${mm}/${dd} ${hh}:${mi}:${ss}`;
    })(),
    type,
    message,
    detail,
    url,
    ...extra,
  };
  logs.unshift(entry);
  // 只保留最近500条
  if (logs.length > 500) logs.length = 500;
  saveLogs(logs);
  notifyRenderer('workspace:logUpdate', entry);
  return entry;
}

function notifyRenderer(event: string, data: any): void {
  const wins = BrowserWindow.getAllWindows();
  if (wins.length > 0) {
    wins[0].webContents.send(event, data);
  }
}

/* ── 标题匹配节目（日期+时间+关键词综合判断） ── */
function matchProgram(
  title: string,
  pubTimestamp?: number,
  durationSec?: number,
): ProgramDef | null {
  const pubDate = pubTimestamp ? new Date(pubTimestamp * 1000) : null;
  const dayOfWeek = pubDate ? pubDate.getDay() : -1;
  const hour = pubDate ? pubDate.getHours() : -1;

  for (const prog of PROGRAMS) {
    // 1. 检查关键词：所有 keywords 必须全部匹配
    const allKeywordsMatch = prog.keywords.every((kw) => title.includes(kw));
    if (!allKeywordsMatch) continue;

    // 2. 检查 anyKeywords：至少匹配一个（如果有的话）
    if (prog.anyKeywords && prog.anyKeywords.length > 0) {
      const anyMatch = prog.anyKeywords.some((kw) => title.includes(kw));
      if (!anyMatch) continue;
    }

    // 3. 检查日期（如果指定了）
    if (
      prog.dayOfWeek !== undefined &&
      dayOfWeek >= 0 &&
      dayOfWeek !== prog.dayOfWeek
    ) {
      continue;
    }

    // 4. 检查时间（如果指定了）
    if (prog.timeAfter !== undefined && hour >= 0 && hour < prog.timeAfter) {
      continue;
    }

    // 5. 检查最小时长（过滤AI合成的短视频）
    if (
      prog.minDuration !== undefined &&
      durationSec !== undefined &&
      durationSec > 0 &&
      durationSec < prog.minDuration
    ) {
      continue;
    }

    // 6. 检查当前周期内是否已处理过该节目
    if (isAlreadyProcessedThisCycle(prog, pubTimestamp)) {
      continue;
    }

    return prog;
  }
  return null;
}

/* ── yt-dlp 路径 ── */
function getYtdlpPath(): string {
  const base = path.join(userData, 'downloaders/yt-dlp');
  try {
    const dirs = fs
      .readdirSync(base)
      .filter((d) => /^\d/.test(d))
      .sort()
      .reverse();
    if (dirs.length > 0) return path.join(base, dirs[0], 'yt-dlp-macos');
  } catch {}
  return path.join(base, 'yt-dlp');
}

/* ── B站 API 获取视频详情 ── */
async function fetchBilibiliVideoInfo(
  bvid: string,
): Promise<{ title: string; created: number; duration: number } | null> {
  try {
    const resp = await fetch(
      `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          Referer: 'https://www.bilibili.com',
        },
      },
    );
    const data = (await resp.json()) as any;
    if (data.code === 0 && data.data) {
      return {
        title: data.data.title,
        created: data.data.pubdate,
        duration: data.data.duration || 0,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/* ── 读取下载配置获取 cookie 模式 ── */
function getCookieArgs(): string[] {
  try {
    const configPath = path.join(
      app.getPath('userData'),
      'download-config.json',
    );
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      switch (config.cookieMode) {
        case 'from-browser-firefox':
          return ['--cookies-from-browser', 'firefox'];
        case 'from-browser-edge':
          return ['--cookies-from-browser', 'edge'];
        case 'from-browser-chrome':
          return ['--cookies-from-browser', 'chrome'];
        case 'file':
          return config.cookieFile ? ['--cookies', config.cookieFile] : [];
        default:
          return [];
      }
    }
  } catch {}
  return [];
}

/* ── 获取B站视频列表（yt-dlp flat-playlist） ── */
function fetchBilibiliBVIds(): Promise<string[]> {
  return new Promise((resolve) => {
    const ytdlp = getYtdlpPath();
    const cookieArgs = getCookieArgs();
    const args = [
      ...cookieArgs,
      '--flat-playlist',
      '--print',
      '%(id)s',
      '--playlist-items',
      '1:50',
      'https://space.bilibili.com/1221628467/upload/video',
    ];
    logMessage(`[Workspace] yt-dlp args: ${args.join(' ')}`, 'info');
    execFile(ytdlp, args, { timeout: 60000 }, (err, stdout, stderr) => {
      if (err) {
        logMessage(`[Workspace] yt-dlp error: ${err.message}`, 'error');
        if (stderr)
          logMessage(
            `[Workspace] yt-dlp stderr: ${stderr.slice(0, 300)}`,
            'error',
          );
        resolve([]);
        return;
      }
      const bvids = stdout.trim().split('\n').filter(Boolean);
      resolve(bvids);
    });
  });
}

/* ── B站监控主逻辑 ── */
let monitorTimer: ReturnType<typeof setInterval> | null = null;
let knownBvids: Set<string> = new Set();

async function checkForNewEpisodes(): Promise<void> {
  addLog('scan', '开始检查B站更新...');

  // 确保 knownBvids 已从磁盘加载（热更新或手动扫描可能清空内存状态）
  if (knownBvids.size === 0) {
    const saved = loadJSON<string[]>(KNOWN_BVIDS_FILE, []);
    saved.forEach((bv) => knownBvids.add(bv));
    const existingTasks = loadTasks();
    for (const t of existingTasks) {
      if (t.bvid) knownBvids.add(t.bvid);
    }
  }

  const bvids = await fetchBilibiliBVIds();
  if (bvids.length === 0) {
    addLog('scan', '未获取到视频列表', '可能是B站限流或网络问题');
    return;
  }

  const tasks = loadTasks();
  let newCount = 0;
  let matchCount = 0;
  let skipCount = 0;

  // 今天处理的那期节目的时间点，之前的节目都不用处理
  const lastProcessed = loadLastProcessed();
  const cutoffTime = lastProcessed['大摩闭门会']
    ? new Date(lastProcessed['大摩闭门会']).getTime() / 1000
    : 0;

  for (const bvid of bvids) {
    // 跳过已知的（已创建任务的视频不再重复处理）
    if (knownBvids.has(bvid)) continue;
    newCount++;

    // 获取视频详情
    const info = await fetchBilibiliVideoInfo(bvid);
    if (!info) {
      addLog('error', `无法获取视频信息: ${bvid}`);
      continue;
    }

    const pubDate = new Date(info.created * 1000);

    // 如果发布时间早于今天处理的那期节目，直接跳过，不输出日志
    if (cutoffTime > 0 && info.created < cutoffTime) {
      continue;
    }
    const mm = String(pubDate.getMonth() + 1).padStart(2, '0');
    const dd = String(pubDate.getDate()).padStart(2, '0');
    const hh = String(pubDate.getHours()).padStart(2, '0');
    const mi = String(pubDate.getMinutes()).padStart(2, '0');
    const dateStr = `${mm}/${dd} ${hh}:${mi}`;
    const titleShort =
      info.title.length > 40 ? info.title.slice(0, 40) + '...' : info.title;
    const videoUrl = `https://www.bilibili.com/video/${bvid}`;

    // 匹配节目
    const program = matchProgram(info.title, info.created, info.duration);
    if (!program) {
      skipCount++;
      addLog('skip', titleShort, '不匹配', videoUrl, {
        videoTitle: info.title,
        bvid,
        pubDate: dateStr,
      });
      await new Promise((r) => setTimeout(r, 300));
      continue;
    }

    // 创建新任务
    matchCount++;
    const task: PipelineTask = {
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      programName: program.name,
      episodeTitle: info.title,
      bvid,
      sourceUrl: videoUrl,
      detectedAt: pubDate.toLocaleString('zh-CN'),
      status: 'waiting_confirm',
      steps: {
        download: 'pending',
        rename: 'pending',
        trim: 'pending',
        cover: 'pending',
        ima: 'pending',
        compose: 'pending',
      },
    };

    tasks.unshift(task);
    knownBvids.add(bvid);
    addLog('match', `✅ ${program.name}`, '', videoUrl, {
      videoTitle: info.title,
      bvid,
      pubDate: dateStr,
    });
    notifyRenderer('workspace:taskUpdate', task);

    // 匹配到节目后，当天任务完成，停止监测
    addLog('scan', '已匹配到节目，今天的监测任务完成');
    logMessage('[Workspace] 已匹配到节目，停止今天的监测', 'info');
    saveTasks(tasks);
    saveJSON(KNOWN_BVIDS_FILE, Array.from(knownBvids));
    stopMonitor();
    return;
  }

  saveTasks(tasks);
  saveJSON(KNOWN_BVIDS_FILE, Array.from(knownBvids));
  addLog(
    'scan',
    `扫描完成: 检查 ${bvids.length} 个视频, ${newCount} 个新视频 (${matchCount} 匹配, ${skipCount} 跳过)`,
  );
}

/* ── 判断当前是否在监控时间段内 ── */
function isInMonitorWindow(): boolean {
  const now = new Date();
  const day = now.getDay(); // 0=周日, 1=周一, 3=周三, 5=周五
  const hour = now.getHours();

  // 周一、周三、周五：12点之后
  if ([1, 3, 5].includes(day) && hour >= 12) return true;
  // 周日：21点之后
  if (day === 0 && hour >= 21) return true;

  return false;
}

/* ── 启停监控 ── */
export function startMonitor(): void {
  // 初始化已知 BV ID（从文件 + 现有任务中加载）
  const saved = loadJSON<string[]>(KNOWN_BVIDS_FILE, []);
  saved.forEach((bv) => knownBvids.add(bv));
  const tasks = loadTasks();
  for (const t of tasks) {
    if (t.bvid) knownBvids.add(t.bvid);
  }

  // 如果不在监控时间段，等待到下一个时间段
  if (!isInMonitorWindow()) {
    addLog('scan', '当前不在监控时间段，等待中...');
    logMessage('[Workspace] 不在监控时间段，等待中...', 'info');
    // 每10分钟检查一次是否到了监控时间
    monitorTimer = setInterval(
      () => {
        if (isInMonitorWindow()) {
          clearInterval(monitorTimer!);
          startMonitor(); // 重新启动监控
        }
      },
      10 * 60 * 1000,
    );
    return;
  }

  // 启动时延迟5秒检查一次
  setTimeout(() => checkForNewEpisodes(), 5000);
  // 每30分钟检查一次
  monitorTimer = setInterval(() => checkForNewEpisodes(), 30 * 60 * 1000);
  addLog('scan', 'B站监控已启动，每30分钟检查一次');
  logMessage('[Workspace] B站监控已启动，每30分钟检查一次', 'info');
}

export function stopMonitor(): void {
  if (monitorTimer) {
    clearInterval(monitorTimer);
    monitorTimer = null;
  }
}

/* ── 节目→保存目录+音画配置ID映射 ── */
const PROGRAM_DIR_MAP: Record<string, { dir: string; programId: string }> = {
  大摩宏观策略谈: {
    dir: '/Users/vangogh/Downloads/财经大咖观点/大摩闭门会2026',
    programId: 'morgan',
  },
  大摩周期论剑: {
    dir: '/Users/vangogh/Downloads/财经大咖观点/大摩闭门会2026',
    programId: 'morgan',
  },
  大摩新经济热点前瞻: {
    dir: '/Users/vangogh/Downloads/财经大咖观点/大摩闭门会2026',
    programId: 'morgan',
  },
  大摩闭门会: {
    dir: '/Users/vangogh/Downloads/财经大咖观点/大摩闭门会2026',
    programId: 'morgan',
  },
  中金宏观策略周论: {
    dir: '/Users/vangogh/Downloads/财经大咖观点/中金观点',
    programId: 'cicc',
  },
  中金闭门会: {
    dir: '/Users/vangogh/Downloads/财经大咖观点/中金观点',
    programId: 'cicc',
  },
  招商宏观周周谈: {
    dir: '/Users/vangogh/Downloads/财经大咖观点/招商宏观周周谈',
    programId: 'zhaoshang',
  },
  华创宏观张瑜旬度: {
    dir: '/Users/vangogh/Downloads/财经大咖观点/华创张瑜旬度时间2026',
    programId: 'huachuang',
  },
};

function getProgramDir(programName: string): string {
  return PROGRAM_DIR_MAP[programName]?.dir || path.join(userData, 'downloads');
}

function getProgramId(programName: string): string | null {
  return PROGRAM_DIR_MAP[programName]?.programId || null;
}

/* ── 运行中进程追踪（用于停止功能） ── */
const runningProcesses = new Map<string, Set<any>>();

function trackProcess(taskId: string, proc: any) {
  if (!runningProcesses.has(taskId)) runningProcesses.set(taskId, new Set());
  runningProcesses.get(taskId)!.add(proc);
  proc.on('close', () => {
    runningProcesses.get(taskId)?.delete(proc);
  });
  proc.on('error', () => {
    runningProcesses.get(taskId)?.delete(proc);
  });
}

function killTaskProcesses(taskId: string) {
  const procs = runningProcesses.get(taskId);
  if (procs) {
    for (const proc of procs) {
      try {
        proc.kill('SIGTERM');
      } catch {}
    }
    runningProcesses.delete(taskId);
  }
}

function cleanFileName(title: string): string {
  return title
    .replace(/[\/\\:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .substring(0, 150);
}

/** 获取 yt-dlp 路径 */
function getYtdlpPathLocal(): string {
  try {
    const { getDownloaderBinaryPath } = require('./downloaderManager');
    const p = getDownloaderBinaryPath('yt-dlp');
    if (p && fs.existsSync(p)) return p;
  } catch {}
  const base = path.join(userData, 'downloaders/yt-dlp');
  try {
    const dirs = fs
      .readdirSync(base)
      .filter((d: string) => /^\d/.test(d))
      .sort()
      .reverse();
    if (dirs.length > 0) return path.join(base, dirs[0], 'yt-dlp-macos');
  } catch {}
  return path.join(base, 'yt-dlp');
}

/** 获取 ffmpeg 路径 */
function getFfmpegPathLocal(): string {
  try {
    const ffmpegStatic = require('ffmpeg-static');
    return ffmpegStatic.replace('app.asar', 'app.asar.unpacked');
  } catch {}
  return 'ffmpeg';
}

/* ── Pipeline 步骤实现 ── */

/** 步骤1：下载音频 */
async function stepDownload(task: PipelineTask): Promise<string> {
  const outputDir = getProgramDir(task.programName);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  // 重跑时如果音频文件已存在，跳过下载
  if (task.audioPath && fs.existsSync(task.audioPath)) {
    logMessage(
      `[pipeline] audio file exists, skipping download: ${task.audioPath}`,
      'info',
    );
    return task.audioPath;
  }

  // 也检查目录中是否已有同名文件
  const safeName = cleanFileName(task.episodeTitle);
  const existing = fs
    .readdirSync(outputDir)
    .find(
      (f: string) =>
        f.startsWith(safeName) && /\.(m4a|mp3|aac|wav|opus)$/i.test(f),
    );
  if (existing) {
    const existingPath = path.join(outputDir, existing);
    logMessage(
      `[pipeline] found existing file, skipping download: ${existingPath}`,
      'info',
    );
    return existingPath;
  }

  const videoUrl =
    task.sourceUrl || `https://www.bilibili.com/video/${task.bvid}`;
  const ytdlp = getYtdlpPathLocal();
  if (!fs.existsSync(ytdlp)) throw new Error(`yt-dlp 未找到: ${ytdlp}`);

  const outputTemplate = path.join(outputDir, `${safeName}.%(ext)s`);
  const ffmpegDir = path.dirname(getFfmpegPathLocal());

  const cookieArgs = getCookieArgs();
  const args = [
    '--no-warnings',
    '--no-check-certificates',
    '--newline',
    '--extract-audio',
    '--audio-format',
    'm4a',
    '--ffmpeg-location',
    ffmpegDir,
    ...cookieArgs,
    '-o',
    outputTemplate,
    videoUrl,
  ];

  logMessage(`[pipeline] download: ${ytdlp} ${args.join(' ')}`, 'info');

  return new Promise((resolve, reject) => {
    const proc = require('child_process').spawn(ytdlp, args);
    trackProcess(task.id, proc);
    let stderr = '';
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    proc.stdout.on('data', (d: Buffer) => {
      const line = d.toString().trim();
      if (line.includes('%')) {
        const match = line.match(/([\d.]+)%/);
        if (match) {
          task.progress = Math.min(99, parseFloat(match[1]));
          const tasks = loadTasks();
          const idx = tasks.findIndex((t) => t.id === task.id);
          if (idx !== -1) {
            tasks[idx].progress = task.progress;
            saveTasks(tasks);
          }
          notifyRenderer('workspace:taskUpdate', task);
        }
      }
    });
    proc.on('close', (code: number) => {
      if (code === 0) {
        // 查找下载的文件
        const files = fs
          .readdirSync(outputDir)
          .filter(
            (f: string) =>
              f.startsWith(safeName) && /\.(m4a|mp3|aac|wav|opus)$/i.test(f),
          );
        if (files.length > 0) {
          const downloaded = path.join(outputDir, files[0]);
          logMessage(`[pipeline] download done: ${downloaded}`, 'info');
          resolve(downloaded);
        } else {
          // 尝试找任何最近的音频文件
          const allFiles = fs
            .readdirSync(outputDir)
            .filter((f: string) => /\.(m4a|mp3|aac|wav|opus)$/i.test(f))
            .map((f) => ({
              name: f,
              mtime: fs.statSync(path.join(outputDir, f)).mtimeMs,
            }))
            .sort((a, b) => b.mtime - a.mtime);
          if (allFiles.length > 0) {
            resolve(path.join(outputDir, allFiles[0].name));
          } else {
            reject(new Error('下载完成但未找到音频文件'));
          }
        }
      } else {
        reject(new Error(`下载失败 (code ${code}): ${stderr.slice(-300)}`));
      }
    });
    proc.on('error', (err: Error) =>
      reject(new Error(`启动yt-dlp失败: ${err.message}`)),
    );
  });
}

/** 步骤2：裁割静音 */
async function stepTrim(
  task: PipelineTask,
  audioPath: string,
): Promise<string> {
  const ffmpegPath = getFfmpegPathLocal();
  if (!fs.existsSync(ffmpegPath)) {
    logMessage('[pipeline] ffmpeg not found, skipping trim', 'info');
    return audioPath;
  }

  const duration = await new Promise<number>((resolve) => {
    const proc = require('child_process').spawn(ffmpegPath, [
      '-i',
      audioPath,
      '-f',
      'null',
      '-',
    ]);
    let stderr = '';
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on('close', () => {
      const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (match) {
        resolve(
          parseInt(match[1]) * 3600 +
            parseInt(match[2]) * 60 +
            parseFloat(match[3]),
        );
      } else {
        resolve(0);
      }
    });
    proc.on('error', () => resolve(0));
  });

  if (duration < 60) {
    logMessage('[pipeline] audio too short for trimming, skipping', 'info');
    return audioPath;
  }

  const CHECK_DURATION = 180;
  const silenceThreshold = -35;
  const minSilenceDuration = 1.5;

  const detectSilence = (
    args: string[],
  ): Promise<Array<{ start: number; end: number }>> =>
    new Promise((resolve) => {
      const proc = require('child_process').spawn(ffmpegPath, args);
      let stderr = '';
      proc.stderr.on('data', (d: Buffer) => {
        stderr += d.toString();
      });
      proc.on('close', () => {
        const ranges: Array<{ start: number; end: number }> = [];
        const lines = stderr.split('\n');
        let currentStart: number | null = null;
        for (const line of lines) {
          const sm = line.match(/silence_start:\s*([\d.]+)/);
          const em = line.match(/silence_end:\s*([\d.]+)/);
          if (sm) currentStart = parseFloat(sm[1]);
          else if (em && currentStart !== null) {
            ranges.push({ start: currentStart, end: parseFloat(em[1]) });
            currentStart = null;
          }
        }
        resolve(ranges);
      });
      proc.on('error', () => resolve([]));
    });

  const startCheckEnd = Math.min(CHECK_DURATION, duration);
  const endCheckStart = Math.max(0, duration - CHECK_DURATION);

  const [startRanges, endRanges] = await Promise.all([
    detectSilence([
      '-i',
      audioPath,
      '-t',
      String(startCheckEnd),
      '-af',
      `silencedetect=noise=${silenceThreshold}dB:d=${minSilenceDuration}`,
      '-f',
      'null',
      '-',
    ]),
    detectSilence([
      '-ss',
      String(endCheckStart),
      '-i',
      audioPath,
      '-af',
      `silencedetect=noise=${silenceThreshold}dB:d=${minSilenceDuration}`,
      '-f',
      'null',
      '-',
    ]),
  ]);

  let audioStart = 0;
  if (startRanges.length > 0 && startRanges[0].start < 1)
    audioStart = startRanges[0].end;
  let audioEnd = duration;
  if (endRanges.length > 0) {
    const last = endRanges[endRanges.length - 1];
    if (last.end >= duration - 1) audioEnd = last.start;
  }

  if (audioStart < 1 && audioEnd >= duration - 1) {
    logMessage(
      '[pipeline] no significant silence found, skipping trim',
      'info',
    );
    return audioPath;
  }

  const trimDuration = audioEnd - audioStart;
  const ext = path.extname(audioPath);
  const baseName = path.basename(audioPath, ext);
  const dir = path.dirname(audioPath);
  const outputPath = path.join(dir, `${baseName}_trimmed${ext}`);

  logMessage(
    `[pipeline] trimming: ${audioStart.toFixed(1)}s - ${audioEnd.toFixed(1)}s`,
    'info',
  );

  return new Promise((resolve, reject) => {
    const proc = require('child_process').spawn(ffmpegPath, [
      '-i',
      audioPath,
      '-ss',
      String(audioStart),
      '-t',
      String(trimDuration),
      '-c',
      'copy',
      '-y',
      outputPath,
    ]);
    trackProcess(task.id, proc);
    let stderr = '';
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on('close', (code: number) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        // 替换原文件
        fs.renameSync(outputPath, audioPath);
        logMessage('[pipeline] trim done', 'info');
        resolve(audioPath);
      } else {
        logMessage(`[pipeline] trim failed: ${stderr.slice(-200)}`, 'error');
        resolve(audioPath); // 失败时返回原文件
      }
    });
    proc.on('error', () => resolve(audioPath));
  });
}

/** 步骤3：生成封面 */
async function stepCover(task: PipelineTask, audioPath: string): Promise<void> {
  const dir = path.dirname(audioPath);
  const scriptPath = path.join(dir, 'generate_audio_covers.py');
  if (!fs.existsSync(scriptPath)) {
    logMessage(
      '[pipeline] generate_audio_covers.py not found, skipping cover',
      'info',
    );
    return;
  }

  logMessage('[pipeline] generating cover...', 'info');

  return new Promise((resolve) => {
    const proc = require('child_process').spawn('python3', [scriptPath], {
      cwd: dir,
    });
    let stderr = '';
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on('close', (code: number) => {
      if (code === 0) {
        logMessage('[pipeline] cover generated', 'info');
      } else {
        logMessage(
          `[pipeline] cover generation failed: ${stderr.slice(-200)}`,
          'error',
        );
      }
      resolve(); // 不阻塞pipeline
    });
    proc.on('error', () => resolve());
  });
}

/** 步骤4：上传IMA */
async function stepIMA(task: PipelineTask, audioPath: string): Promise<void> {
  try {
    const { uploadToIMA } = require('./imaUploader');
    const result = await uploadToIMA(audioPath, task.episodeTitle);
    if (result.success) {
      logMessage('[pipeline] IMA upload done', 'info');
    } else {
      logMessage(`[pipeline] IMA upload failed: ${result.error}`, 'error');
      throw new Error(result.error);
    }
  } catch (err: any) {
    if (err.message?.includes('凭证未配置')) {
      logMessage('[pipeline] IMA credentials not configured, skipping', 'info');
    } else {
      throw err;
    }
  }
}

/** 步骤5：音画合成 */
async function stepCompose(
  task: PipelineTask,
  audioPath: string,
): Promise<void> {
  const programId = getProgramId(task.programName);
  if (!programId) {
    logMessage('[pipeline] no program config found, skipping compose', 'info');
    return;
  }

  const programsFile = path.join(userData, 'audio-visualize/programs.json');
  if (!fs.existsSync(programsFile)) {
    logMessage('[pipeline] programs.json not found, skipping compose', 'info');
    return;
  }

  const programs = JSON.parse(fs.readFileSync(programsFile, 'utf-8'));
  const program = programs.find((p: any) => p.id === programId);
  if (!program || !program.covers || program.covers.length === 0) {
    logMessage(
      '[pipeline] program config incomplete, skipping compose',
      'info',
    );
    return;
  }

  const cover = program.covers[0];
  const logo = program.logos?.[0];
  const spectrumRenderer = path.join(
    app.getAppPath(),
    'tools',
    'audio-visualize',
    'spectrum_renderer.py',
  );
  if (!fs.existsSync(spectrumRenderer)) {
    logMessage(
      '[pipeline] spectrum_renderer.py not found, skipping compose',
      'info',
    );
    return;
  }

  const dir = path.dirname(audioPath);
  const baseName = path.basename(audioPath, path.extname(audioPath));
  const outputPath = path.join(dir, `${baseName}.mp4`);

  logMessage('[pipeline] composing video...', 'info');

  const args = [
    spectrumRenderer,
    '--audio',
    audioPath,
    '--cover',
    cover.path,
    '--output',
    outputPath,
    '--width',
    String(cover.width || 1440),
    '--height',
    String(cover.height || 2560),
    '--spectrum-style',
    program.defaultSpectrumStyle || 'bars',
  ];

  if (logo?.path) args.push('--logo', logo.path);
  if (program.logoPosition) args.push('--logo-position', program.logoPosition);
  if (program.logoSizeRatio)
    args.push('--logo-size-ratio', String(program.logoSizeRatio));
  if (program.overlayOpacity)
    args.push('--overlay-opacity', String(program.overlayOpacity));
  if (program.logoRotate) args.push('--logo-rotate');
  if (program.logoRotateSpeed)
    args.push('--logo-rotate-speed', String(program.logoRotateSpeed));
  if (program.titleFontPath) args.push('--title-font', program.titleFontPath);
  args.push('--title', task.episodeTitle);

  return new Promise((resolve, reject) => {
    const proc = require('child_process').spawn('python3', args);
    let stderr = '';
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    proc.stdout.on('data', (d: Buffer) => {
      const line = d.toString().trim();
      const match = line.match(/progress:\s*(\d+)/i);
      if (match) {
        task.progress = Math.min(99, parseInt(match[1]));
        notifyRenderer('workspace:taskUpdate', task);
      }
    });
    proc.on('close', (code: number) => {
      if (code === 0) {
        logMessage(`[pipeline] compose done: ${outputPath}`, 'info');
        resolve();
      } else {
        logMessage(`[pipeline] compose failed: ${stderr.slice(-300)}`, 'error');
        resolve(); // 不阻塞
      }
    });
    proc.on('error', () => resolve());
  });
}

/* ── Pipeline 执行 ── */
async function executePipeline(task: PipelineTask): Promise<void> {
  const tasks = loadTasks();
  const idx = tasks.findIndex((t) => t.id === task.id);
  if (idx === -1) return;

  task = tasks[idx];
  task.status = 'processing';
  task.progress = 0;
  addLog('start', `开始执行: ${task.programName}`, task.episodeTitle);
  saveTasks(tasks);
  notifyRenderer('workspace:taskUpdate', task);

  let audioPath = '';

  const stepHandlers: Record<string, () => Promise<void>> = {
    download: async () => {
      audioPath = await stepDownload(task);
      task.audioPath = audioPath;
      task.stepDetails = task.stepDetails || {};
      task.stepDetails['download'] = `FILE:${audioPath}`;
    },
    rename: async () => {
      if (!audioPath) throw new Error('无音频文件');
      // 计算建议文件名并暂停等待用户确认
      const result = renameAfterDownload(
        audioPath,
        task.episodeTitle,
        null,
        task.sourceUrl || '',
      );
      const proposedName = path.basename(result.newPath);
      task.stepDetails = task.stepDetails || {};
      task.stepDetails['rename'] = proposedName;
      task.stepDetails['_renameOriginalPath'] = audioPath;
      task.stepDetails['_renameProposedPath'] = result.newPath;
      task.pausedAt = 'rename';
      task.steps['rename'] = 'running';
      saveTasks(loadTasks().map((t) => (t.id === task.id ? task : t)));
      notifyRenderer('workspace:taskUpdate', task);
      // 暂停，等待用户确认后由 confirmRename handler 继续
      return new Promise(() => {});
    },
    trim: async () => {
      if (!audioPath) throw new Error('无音频文件');
      const beforeSize = fs.statSync(audioPath).size;
      audioPath = await stepTrim(task, audioPath);
      const afterSize = fs.statSync(audioPath).size;
      task.stepDetails = task.stepDetails || {};
      if (beforeSize !== afterSize) {
        const saved = ((beforeSize - afterSize) / 1024).toFixed(0);
        task.stepDetails['trim'] = `裁切 ${saved}KB`;
      } else {
        task.stepDetails['trim'] = '无静音';
      }
    },
    cover: async () => {
      if (!audioPath) throw new Error('无音频文件');
      await stepCover(task, audioPath);
      // 封面生成在节目目录的 cover 子目录中
      const dir = path.dirname(audioPath);
      const coverDir = path.join(dir, 'Cover');
      const altCoverDir = path.join(dir, 'cover');
      task.stepDetails = task.stepDetails || {};
      if (fs.existsSync(coverDir)) {
        task.stepDetails['cover'] = `FILE:${coverDir}`;
      } else if (fs.existsSync(altCoverDir)) {
        task.stepDetails['cover'] = `FILE:${altCoverDir}`;
      } else {
        task.stepDetails['cover'] = '跳过';
      }
    },
    ima: async () => {
      if (!audioPath) throw new Error('无音频文件');
      await stepIMA(task, audioPath);
      task.stepDetails = task.stepDetails || {};
      task.stepDetails['ima'] = '已上传';
    },
    compose: async () => {
      task.stepDetails = task.stepDetails || {};
      task.stepDetails['compose'] = '跳过';
    },
  };

  const STEPS = ['download', 'rename', 'trim', 'cover', 'ima', 'compose'];
  for (const key of STEPS) {
    // 检查是否已取消
    const freshTasks = loadTasks();
    const freshTask = freshTasks.find((t) => t.id === task.id);
    if (freshTask?.cancelled) {
      addLog('step', `⏹ 已停止`, task.episodeTitle);
      return;
    }

    task.steps[key] = 'running';
    task.currentStep = key;
    saveTasks(tasks);
    notifyRenderer('workspace:taskUpdate', task);
    addLog('step', `▶ ${key}`, task.episodeTitle);

    try {
      await stepHandlers[key]();
      task.steps[key] = 'done';
      addLog('step', `✓ ${key}`, task.episodeTitle);
    } catch (err: any) {
      task.steps[key] = 'error';
      task.error = err.message || String(err);
      addLog('error', `✗ ${key}: ${task.error}`, task.episodeTitle);
      task.status = 'error';
      saveTasks(tasks);
      notifyRenderer('workspace:taskUpdate', task);
      return;
    }

    saveTasks(tasks);
    notifyRenderer('workspace:taskUpdate', task);
  }

  task.status = 'done';
  task.progress = 100;
  saveTasks(tasks);
  notifyRenderer('workspace:taskUpdate', task);
  addLog('done', `完成: ${task.episodeTitle}`);
  updateLastProcessed(task.programName);
}

/* ── IPC 注册 ── */
export function registerWorkspaceHandlers(): void {
  ipcMain.handle('workspace:getTasks', () => loadTasks());
  ipcMain.handle('workspace:getLogs', () => loadLogs());
  ipcMain.handle('workspace:getSchedule', () =>
    PROGRAMS.map((p) => ({
      name: p.name,
      dayOfWeek: p.dayOfWeek,
      targetHour: p.targetHour,
    })),
  );
  ipcMain.handle('workspace:execute', async (_e, taskId: string) => {
    const task = loadTasks().find((t) => t.id === taskId);
    if (!task) return { success: false, error: '任务不存在' };
    executePipeline(task);
    return { success: true };
  });
  ipcMain.handle('workspace:retry', async (_e, taskId: string) => {
    const tasks = loadTasks();
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return { success: false };
    for (const key of Object.keys(task.steps)) {
      task.steps[key] = 'pending';
    }
    task.status = 'processing';
    task.progress = 0;
    task.currentStep = undefined;
    task.error = undefined;
    task.cancelled = undefined;
    task.pausedAt = undefined;
    task.stepDetails = {};
    saveTasks(tasks);
    executePipeline(task);
    return { success: true };
  });
  // 重新执行：重置所有步骤，从头开始
  ipcMain.handle('workspace:rerun', async (_e, taskId: string) => {
    const tasks = loadTasks();
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return { success: false };
    for (const key of Object.keys(task.steps)) {
      task.steps[key] = 'pending';
    }
    task.status = 'processing';
    task.progress = 0;
    task.currentStep = undefined;
    task.error = undefined;
    task.cancelled = undefined;
    task.pausedAt = undefined;
    task.stepDetails = {};
    saveTasks(tasks);
    executePipeline(task);
    return { success: true };
  });
  ipcMain.handle('workspace:stop', async (_e, taskId: string) => {
    const tasks = loadTasks();
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return { success: false };
    task.cancelled = true;
    task.status = 'error';
    task.error = '用户停止';
    if (task.currentStep) task.steps[task.currentStep] = 'error';
    saveTasks(tasks);
    notifyRenderer('workspace:taskUpdate', task);
    killTaskProcesses(taskId);
    addLog('step', `⏹ 用户停止执行`, task.episodeTitle);
    return { success: true };
  });
  ipcMain.handle(
    'workspace:confirmRename',
    async (_e, taskId: string, newName?: string) => {
      logMessage(
        `[workspace] confirmRename called: taskId=${taskId}, newName=${newName}`,
        'info',
      );
      const tasks = loadTasks();
      const task = tasks.find((t) => t.id === taskId);
      if (!task) {
        logMessage(`[workspace] confirmRename: task not found`, 'error');
        return { success: false, error: '任务不存在' };
      }
      if (task.pausedAt !== 'rename') {
        logMessage(
          `[workspace] confirmRename: pausedAt=${task.pausedAt}, expected 'rename'`,
          'error',
        );
        return { success: false, error: `状态不对: ${task.pausedAt}` };
      }

      const originalPath = task.stepDetails?.['_renameOriginalPath'];
      const proposedPath = task.stepDetails?.['_renameProposedPath'];
      if (!originalPath) return { success: false, error: '无原始文件路径' };

      // 使用用户修改的名字或建议名字
      const dir = path.dirname(originalPath);
      const finalName = newName || path.basename(proposedPath || originalPath);
      const finalPath = path.join(dir, finalName);

      try {
        // 文件可能已被 renameAfterDownload 重命名到 proposedPath
        // 需要从实际存在的路径重命名
        const proposedExists = proposedPath && fs.existsSync(proposedPath);
        const originalExists = fs.existsSync(originalPath);
        const currentPath = proposedExists
          ? proposedPath
          : originalExists
            ? originalPath
            : null;
        logMessage(
          `[workspace] confirmRename: currentPath=${currentPath}, finalPath=${finalPath}, proposedExists=${proposedExists}, originalExists=${originalExists}`,
          'info',
        );
        if (currentPath && currentPath !== finalPath) {
          fs.renameSync(currentPath, finalPath);
          logMessage(
            `[workspace] confirmRename: file renamed successfully`,
            'info',
          );
        } else {
          logMessage(
            `[workspace] confirmRename: no rename needed (same path or file not found)`,
            'warn',
          );
        }
        task.audioPath = finalPath;
        task.stepDetails!['rename'] = finalName;
        delete task.stepDetails!['_renameOriginalPath'];
        delete task.stepDetails!['_renameProposedPath'];
        task.pausedAt = undefined;
        task.steps['rename'] = 'done';
        saveTasks(tasks);
        notifyRenderer('workspace:taskUpdate', task);
        addLog('step', `✓ 改名: ${finalName}`, task.episodeTitle);

        // 继续执行后续步骤
        const remainingSteps = ['trim', 'cover', 'ima', 'compose'];
        for (const key of remainingSteps) {
          const freshTasks = loadTasks();
          const freshTask = freshTasks.find((t) => t.id === task.id);
          if (freshTask?.cancelled) break;

          task.steps[key] = 'running';
          task.currentStep = key;
          saveTasks(tasks);
          notifyRenderer('workspace:taskUpdate', task);
          addLog('step', `▶ ${key}`, task.episodeTitle);

          try {
            const stepHandlers: Record<string, () => Promise<void>> = {
              trim: async () => {
                const beforeSize = fs.statSync(finalPath).size;
                const trimmed = await stepTrim(task, finalPath);
                const afterSize = fs.statSync(trimmed).size;
                task.audioPath = trimmed;
                task.stepDetails!['trim'] =
                  beforeSize !== afterSize
                    ? `裁切 ${((beforeSize - afterSize) / 1024).toFixed(0)}KB`
                    : '无静音';
              },
              cover: async () => {
                await stepCover(task, finalPath);
                const coverDir = path.join(path.dirname(finalPath), 'Cover');
                const altDir = path.join(path.dirname(finalPath), 'cover');
                task.stepDetails!['cover'] = fs.existsSync(coverDir)
                  ? `FILE:${coverDir}`
                  : fs.existsSync(altDir)
                    ? `FILE:${altDir}`
                    : '跳过';
              },
              ima: async () => {
                await stepIMA(task, finalPath);
                task.stepDetails!['ima'] = '已上传';
              },
              compose: async () => {
                task.stepDetails!['compose'] = '跳过';
              },
            };
            await stepHandlers[key]();
            task.steps[key] = 'done';
            addLog('step', `✓ ${key}`, task.episodeTitle);
          } catch (err: any) {
            task.steps[key] = 'error';
            task.error = err.message || String(err);
            addLog('error', `✗ ${key}: ${task.error}`, task.episodeTitle);
            task.status = 'error';
            saveTasks(tasks);
            notifyRenderer('workspace:taskUpdate', task);
            return { success: false, error: task.error };
          }
          saveTasks(tasks);
          notifyRenderer('workspace:taskUpdate', task);
        }

        task.status = 'done';
        task.progress = 100;
        saveTasks(tasks);
        notifyRenderer('workspace:taskUpdate', task);
        addLog('done', `完成: ${task.episodeTitle}`);
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
  );
  ipcMain.handle('workspace:deleteTask', (_e, taskId: string) => {
    const tasks = loadTasks().filter((t) => t.id !== taskId);
    saveTasks(tasks);
    return tasks;
  });
  ipcMain.handle('workspace:clearLogs', () => {
    saveJSON(LOG_FILE, []);
    saveJSON(KNOWN_BVIDS_FILE, []);
    knownBvids.clear();
    return [];
  });
  ipcMain.handle('workspace:manualScan', async () => {
    await checkForNewEpisodes();
    return loadTasks();
  });
  ipcMain.handle('shell:showItemInFolder', (_e, filePath: string) => {
    if (filePath && fs.existsSync(filePath)) shell.showItemInFolder(filePath);
  });
  ipcMain.handle('shell:openFolder', (_e, folderPath: string) => {
    if (folderPath && fs.existsSync(folderPath)) shell.openPath(folderPath);
  });

  // 从手动下载创建任务（抓取页面下载完成后调用）
  ipcMain.handle(
    'workspace:addFromDownload',
    (
      _e,
      params: {
        title: string;
        filePath: string;
        sourceUrl?: string;
        bvid?: string;
      },
    ) => {
      const tasks = loadTasks();
      // 去重：同一来源不重复添加
      if (params.bvid && tasks.some((t) => t.bvid === params.bvid)) {
        return tasks.find((t) => t.bvid === params.bvid);
      }
      const program = matchProgram(params.title);
      const task: PipelineTask = {
        id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        programName: program?.name || '未识别',
        episodeTitle: params.title,
        bvid: params.bvid,
        sourceUrl: params.sourceUrl,
        detectedAt: new Date().toLocaleString('zh-CN'),
        status: program ? 'waiting_confirm' : 'done',
        steps: {
          download: 'done',
          trim: 'pending',
          cover: 'pending',
          ima: 'pending',
          compose: 'pending',
        },
        filePaths: { audio: params.filePath },
      };
      tasks.unshift(task);
      saveTasks(tasks);
      if (program) {
        addLog(
          'match',
          `📥 手动下载: ${program.name}`,
          params.title,
          params.sourceUrl,
          { videoTitle: params.title, bvid: params.bvid },
        );
      } else {
        addLog('scan', `📥 手动下载: ${params.title}`, '未匹配到节目规则');
      }
      notifyRenderer('workspace:taskUpdate', task);
      return task;
    },
  );

  // 从监控日志手动添加任务
  ipcMain.handle(
    'workspace:addFromLog',
    (_e, params: { title: string; url?: string; bvid?: string }) => {
      const tasks = loadTasks();
      // 去重
      if (params.bvid && tasks.some((t) => t.bvid === params.bvid)) {
        return {
          success: false,
          error: '该任务已存在',
          task: tasks.find((t) => t.bvid === params.bvid),
        };
      }
      const program = matchProgram(params.title);
      const task: PipelineTask = {
        id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        programName: program?.name || '未识别',
        episodeTitle: params.title,
        bvid: params.bvid,
        sourceUrl: params.url,
        detectedAt: new Date().toLocaleString('zh-CN'),
        status: 'waiting_confirm',
        steps: {
          download: 'pending',
          rename: 'pending',
          trim: 'pending',
          cover: 'pending',
          ima: 'pending',
          compose: 'pending',
        },
      };
      tasks.unshift(task);
      saveTasks(tasks);
      addLog(
        'match',
        `📋 手动添加: ${program?.name || '未识别'}`,
        params.title,
        params.url,
        { videoTitle: params.title, bvid: params.bvid },
      );
      notifyRenderer('workspace:taskUpdate', task);
      return { success: true, task };
    },
  );

  startMonitor();
}

/* ── 节目最后处理时间记录 ── */
const LAST_PROCESSED_FILE = path.join(
  userData,
  'workspace-last-processed.json',
);

interface LastProcessed {
  [programName: string]: string; // ISO 时间戳
}

function loadLastProcessed(): LastProcessed {
  return loadJSON<LastProcessed>(LAST_PROCESSED_FILE, {});
}

function saveLastProcessed(data: LastProcessed): void {
  saveJSON(LAST_PROCESSED_FILE, data);
}

function updateLastProcessed(programName: string): void {
  const data = loadLastProcessed();
  data[programName] = new Date().toISOString();
  saveLastProcessed(data);
}

// 检查这个节目在当前周期内是否已经处理过
function isAlreadyProcessedThisCycle(
  program: ProgramDef,
  pubTimestamp?: number,
): boolean {
  const lastProcessed = loadLastProcessed();
  const lastTime = lastProcessed[program.name];
  if (!lastTime) return false;

  const lastDate = new Date(lastTime);
  const now = new Date();

  // 大摩、中金的周一/三/五节目：同一天内不重复处理
  if (
    program.targetHour === 12 &&
    [
      '大摩宏观策略谈',
      '大摩周期论剑',
      '大摩新经济热点前瞻',
      '中金宏观策略周论',
      '大摩闭门会',
    ].includes(program.name)
  ) {
    // 如果最后处理时间是在今天12点之后，且现在还是同一天的12点之后，就跳过
    if (
      lastDate.toDateString() === now.toDateString() &&
      now.getHours() >= 12
    ) {
      return true;
    }
    // 如果最后处理时间是昨天或更早，那就不跳过
    return false;
  }

  // 招商、华创的周日节目：同一周内不重复处理
  if (
    program.targetHour === 21 &&
    ['招商宏观周周谈', '华创宏观张瑜旬度'].includes(program.name)
  ) {
    // 获取本周日的日期
    const getThisSunday = (d: Date) => {
      const day = d.getDay();
      const diff = d.getDate() - day;
      return new Date(d.getFullYear(), d.getMonth(), diff);
    };

    const lastSunday = getThisSunday(lastDate);
    const thisSunday = getThisSunday(now);

    // 如果最后处理时间是在本周日之后，就跳过
    if (lastSunday >= thisSunday) {
      return true;
    }
    return false;
  }

  return false;
}
