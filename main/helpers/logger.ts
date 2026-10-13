import { BrowserWindow } from 'electron';
import { LogEntry } from './store/types';
import { appendLog } from './logStorage';
import { sanitizeLogMessage } from './utils';
import { getTaskContext } from './taskContext';

export function logMessage(
  message: string | Error,
  type: 'info' | 'error' | 'warning' = 'info',
) {
  const messageStr =
    message instanceof Error ? message.message : String(message);

  // 对日志消息进行脱敏处理，防止泄露敏感信息
  const sanitizedMessage = sanitizeLogMessage(messageStr);

  const projectId = getTaskContext()?.projectId;
  const newLog: LogEntry = {
    message: sanitizedMessage,
    type,
    timestamp: Date.now(),
    ...(projectId ? { projectId } : {}),
  };
  appendLog(newLog);

  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send('newLog', newLog);
  });
}

/** 调试模式：通过环境变量 SMARTSUB_DEBUG=1 启用 */
const DEBUG = process.env.SMARTSUB_DEBUG === '1';

/**
 * 调试日志 — 仅在 SMARTSUB_DEBUG=1 时写入。
 * 用于记录详细参数、filter_complex、ffmpeg 命令等排查信息。
 * 正常运行不输出，不占磁盘。
 */
export function logDebug(
  message: string | Error,
  type: 'info' | 'error' | 'warning' = 'info',
) {
  if (!DEBUG) return;
  const messageStr =
    message instanceof Error ? message.message : String(message);
  const sanitizedMessage = sanitizeLogMessage(messageStr);
  const projectId = getTaskContext()?.projectId;
  const newLog: LogEntry = {
    message: `[DEBUG] ${sanitizedMessage}`,
    type,
    timestamp: Date.now(),
    ...(projectId ? { projectId } : {}),
  };
  appendLog(newLog);
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send('newLog', newLog);
  });
}
