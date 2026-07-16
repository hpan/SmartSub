/**
 * 视频/播客下载功能类型定义
 */

/** 支持的平台 */
export type DownloadPlatform =
  | 'bilibili'
  | 'youtube'
  | 'xiaohongshu'
  | 'xiaoyuzhou'
  | 'weixin_video'
  | 'generic'; // yt-dlp 通用兜底

/** 下载媒体类型 */
export type DownloadMediaType = 'video' | 'audio';

/** 下载格式信息（yt-dlp --list-formats 输出） */
export interface DownloadFormat {
  formatId: string;
  ext: string;
  resolution: string; // e.g. "1920x1080" or "audio only"
  fps: number | null;
  vcodec: string;
  acodec: string;
  filesize: number | null; // bytes
  /** human-readable label, e.g. "1080p · mp4 · 120MB" */
  label: string;
  /** 是否仅音频 */
  audioOnly: boolean;
}

/** 视频元信息（解析链接后获取） */
export interface DownloadVideoInfo {
  /** 唯一标识 */
  id: string;
  title: string;
  /** 缩略图 URL */
  thumbnail: string | null;
  /** 时长（秒） */
  duration: number | null;
  /** 作者/上传者 */
  uploader: string | null;
  /** 上传日期 (YYYYMMDD) */
  uploadDate: string | null;
  /** 原始 URL */
  originalUrl: string;
  /** 平台 */
  platform: DownloadPlatform;
  /** 可用格式列表 */
  formats: DownloadFormat[];
  /** 是否有字幕 */
  hasSubtitles: boolean;
  /** 可用字幕语言列表 */
  subtitleLanguages: string[];
  /** 是否为播放列表 */
  isPlaylist: boolean;
  /** 播放列表中的条目数 */
  playlistCount: number | null;
  /** 播放列表中的条目（仅当 isPlaylist=true 时） */
  playlistEntries?: PlaylistEntry[];
}

/** 播放列表条目 */
export interface PlaylistEntry {
  id: string;
  title: string;
  url: string;
  duration: number | null;
  thumbnail: string | null;
}

/** 单个下载任务 */
export interface DownloadTask {
  /** 内部 ID */
  id: string;
  /** 视频信息 */
  videoInfo: DownloadVideoInfo;
  /** 选择的格式 ID */
  selectedFormatId: string | null;
  /** 是否同时下载字幕 */
  downloadSubtitles: boolean;
  /** 选择的字幕语言 */
  subtitleLanguages: string[];
  /** 保存目录 */
  outputDir: string;
  /** 下载状态 */
  status: DownloadTaskStatus;
  /** 下载进度 0-100 */
  progress: number;
  /** 下载速度（bytes/s） */
  speed: number;
  /** 已下载大小（bytes） */
  downloaded: number;
  /** 总大小（bytes） */
  totalSize: number;
  /** 输出文件路径（下载完成后填充） */
  outputPath: string | null;
  /** 错误信息 */
  error: string | null;
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
  /** 是否来自小宇宙 */
  isXiaoyuzhou: boolean;
  /** 小宇宙 Episode URL（仅小宇宙用） */
  xyzEpisodeUrl?: string;
}

export type DownloadTaskStatus =
  | 'pending' // 等待下载
  | 'fetching' // 正在获取视频信息
  | 'ready' // 信息获取完成，等待用户选择格式
  | 'downloading' // 正在下载
  | 'completed' // 下载完成
  | 'failed' // 下载失败
  | 'cancelled'; // 用户取消

/** Cookie 模式 */
export type CookieMode =
  | 'none' // 不使用 Cookie
  | 'from-file' // 从文件读取
  | 'from-browser-firefox' // 自动读取 Firefox
  | 'from-browser-edge' // 自动读取 Edge
  | 'from-browser-chrome'; // 自动读取 Chrome

/** 下载配置 */
export interface DownloadConfig {
  /** 默认保存目录 */
  defaultOutputDir: string;
  /** 默认是否下载字幕 */
  downloadSubtitles: boolean;
  /** 默认字幕语言 */
  subtitleLanguages: string[];
  /** yt-dlp 自定义参数（高级用户） */
  extraArgs: string;
  /** 代理设置 */
  proxy: string;
  /** 下载完成后是否自动导入转写 */
  autoImportToTranscribe: boolean;
  /** Cookie 模式 */
  cookieMode: CookieMode;
  /** Cookie 文件路径（当 cookieMode='from-file' 时使用） */
  cookieFile: string;
}

/** yt-dlp 二进制管理状态 */
export interface YtdlpStatus {
  /** 是否已安装 */
  installed: boolean;
  /** 版本号 */
  version: string | null;
  /** 二进制路径 */
  binaryPath: string | null;
  /** 是否正在检查更新 */
  checking: boolean;
  /** 是否正在下载/更新 */
  downloading: boolean;
  /** 下载进度 0-100 */
  downloadProgress: number;
}

/** 批量链接解析结果 */
export interface BatchParseResult {
  url: string;
  platform: DownloadPlatform;
  success: boolean;
  videoInfo: DownloadVideoInfo | null;
  error: string | null;
}

/** IPC 通道名称常量 */
export const DOWNLOAD_IPC_CHANNELS = {
  // yt-dlp 管理
  GET_YTDLP_STATUS: 'download:getYtdlpStatus',
  INSTALL_YTDLP: 'download:installYtdlp',
  UPDATE_YTDLP: 'download:updateYtdlp',

  // 视频信息解析
  PARSE_URL: 'download:parseUrl',
  PARSE_BATCH: 'download:parseBatch',

  // 下载任务管理
  START_DOWNLOAD: 'download:startDownload',
  CANCEL_DOWNLOAD: 'download:cancelDownload',
  GET_TASKS: 'download:getTasks',
  CLEAR_TASK: 'download:clearTask',
  CLEAR_ALL_TASKS: 'download:clearAllTasks',

  // 配置
  GET_CONFIG: 'download:getConfig',
  SAVE_CONFIG: 'download:saveConfig',
  SELECT_OUTPUT_DIR: 'download:selectOutputDir',
  SELECT_COOKIE_FILE: 'download:selectCookieFile',

  // 进度事件（主进程 → 渲染进程）
  TASK_PROGRESS: 'download:taskProgress',
  TASK_STATUS_CHANGE: 'download:taskStatusChange',
  TASK_COMPLETE: 'download:taskComplete',
  TASK_ERROR: 'download:taskError',

  // 封面图下载
  DOWNLOAD_THUMBNAIL: 'download:downloadThumbnail',

  // 小宇宙
  PARSE_XYZ: 'download:parseXyz',
  DOWNLOAD_XYZ: 'download:downloadXyz',

  // 重命名规则
  GET_RENAME_CONFIG: 'download:getRenameConfig',
  SAVE_RENAME_CONFIG: 'download:saveRenameConfig',
} as const;
