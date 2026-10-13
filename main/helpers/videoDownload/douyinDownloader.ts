/**
 * 抖音下载器
 * 使用 Electron BrowserWindow 加载页面并拦截 API 响应
 * 绕过 ArgusSecurityPlugin 签名检查
 */

import * as fs from 'fs';
import * as path from 'path';
import { BrowserWindow } from 'electron';
import { logMessage } from '../storeManager';
import { app } from 'electron';

/**
 * 检测是否为抖音链接
 */
export function isDouyinUrl(url: string): boolean {
  return /douyin\.com|iesdouyin\.com|v\.douyin\.com/.test(url);
}

/**
 * 从抖音 URL 中提取视频 ID
 */
export function extractDouyinId(url: string): string | null {
  const patterns = [
    /\/video\/(\d+)/,
    /\/note\/(\d+)/,
    /\/gallery\/(\d+)/,
    /\/slides\/(\d+)/,
    /modal_id=(\d+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  return null;
}

/**
 * 通过 Electron BrowserWindow 获取抖音视频信息
 * 使用 webRequest 在网络层拦截 API 响应，无需等待页面渲染
 */

/**
 * 直接通过 Electron session 获取抖音视频详情
 * 先加载抖音首页获取 cookies，然后用这些 cookies 调用 API
 */
async function getDouyinDetailViaSessionApi(url: string): Promise<any> {
  const partition = 'persist:douyin_api_' + Date.now();
  const ses = require('electron').session.fromPartition(partition);

  // Extract aweme_id
  const awemeIdMatch = url.match(/\/(?:video|note|gallery|slides)\/(\d+)/);
  if (!awemeIdMatch) return null;
  const awemeId = awemeIdMatch[1];

  logMessage(`[douyin-api] Trying direct API for aweme_id: ${awemeId}`, 'info');

  // Create a hidden BrowserWindow to load douyin.com and get cookies
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      partition,
    },
  });
  win.webContents.setAudioMuted(true);

  try {
    // Load douyin.com to get necessary cookies (ttwid, UIFID, etc.)
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => resolve(), 8000); // Don't wait too long
      win.webContents.on('did-finish-load', () => {
        clearTimeout(timer);
        setTimeout(resolve, 1000); // Wait a bit for cookies to be set
      });
      win.loadURL('https://www.douyin.com/').catch(() => resolve());
    });

    // Get cookies from the session
    const cookies = await ses.cookies.get({ domain: '.douyin.com' });
    const cookieStr = cookies
      .map((c: any) => `${c.name}=${c.value}`)
      .join('; ');

    logMessage(`[douyin-api] Got ${cookies.length} cookies`, 'info');

    if (!cookieStr) {
      logMessage('[douyin-api] No cookies obtained', 'warning');
      win.destroy();
      return null;
    }

    // Make direct API call using Electron's net module
    const result = await new Promise<any>((resolve, reject) => {
      const { net } = require('electron');
      const apiUrl = `https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=${awemeId}&aid=6383&cookie_enabled=true&browser_language=zh-CN&browser_platform=MacIntel&browser_name=Chrome&browser_version=120.0.0.0`;

      const request = net.request({
        method: 'GET',
        url: apiUrl,
        partition,
      });

      request.setHeader('Referer', 'https://www.douyin.com/');
      request.setHeader('Accept', 'application/json');
      request.setHeader('Cookie', cookieStr);

      let responseData = '';
      request.on('response', (response: any) => {
        response.on('data', (chunk: Buffer) => {
          responseData += chunk.toString();
        });
        response.on('end', () => {
          try {
            const data = JSON.parse(responseData);
            if (data.aweme_detail) {
              resolve(data.aweme_detail);
            } else if (
              data.status_code !== undefined &&
              data.status_code !== 0
            ) {
              logMessage(
                `[douyin-api] API error: status_code=${data.status_code} status_msg=${data.status_msg}`,
                'warning',
              );
              resolve(null);
            } else {
              resolve(null);
            }
          } catch {
            resolve(null);
          }
        });
        response.on('error', () => resolve(null));
      });
      request.on('error', () => resolve(null));
      request.end();
    });

    win.destroy();
    return result;
  } catch (e) {
    logMessage(`[douyin-api] Error: ${e}`, 'error');
    if (!win.isDestroyed()) win.destroy();
    return null;
  }
}

async function getDouyinDetailViaBrowser(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    logMessage(`[douyin-browser] Loading page: ${url}`, 'info');

    // Use a unique partition to avoid cookie conflicts
    const partition = 'persist:douyin_' + Date.now();
    const ses = require('electron').session.fromPartition(partition);

    let resolved = false;
    let win: BrowserWindow | null = null;

    // Extract aweme_id from URL for matching
    const awemeIdMatch = url.match(/\/(?:video|note|gallery|slides)\/(\d+)/);
    const targetAwemeId = awemeIdMatch ? awemeIdMatch[1] : '';
    logMessage(
      `[douyin-browser] Target aweme_id: ${targetAwemeId || '(will detect from page)'}`,
      'info',
    );

    // Helper to check if a parsed JSON contains aweme data
    function extractAwemeDetail(data: any): any | null {
      if (!data || typeof data !== 'object') return null;

      // Standard web API response - /aweme/v1/web/aweme/detail/
      if (data.aweme_detail && data.aweme_detail.aweme_id) {
        // Verify it matches our target if we have one
        if (!targetAwemeId || data.aweme_detail.aweme_id === targetAwemeId) {
          return data.aweme_detail;
        }
      }

      // Mobile share page API - item info
      if (
        data.item_list &&
        Array.isArray(data.item_list) &&
        data.item_list.length > 0
      ) {
        if (targetAwemeId) {
          for (const item of data.item_list) {
            if (item.aweme_id === targetAwemeId) return item;
          }
        }
        // Only return first item if no target ID (unknown what we're looking for)
        if (!targetAwemeId) return data.item_list[0];
      }

      // aweme_list - only match if we can find the target aweme_id
      if (data.aweme_list && Array.isArray(data.aweme_list) && targetAwemeId) {
        for (const item of data.aweme_list) {
          if (item.aweme_id === targetAwemeId) return item;
        }
      }

      // Share page SSR data - video_info (only if it has play_addr)
      if (data.video_info && data.video_info.play_addr) return data;

      // Check nested structures
      if (data.data) {
        const nested = extractAwemeDetail(data.data);
        if (nested) return nested;
      }

      return null;
    }

    function finish(detail: any) {
      if (resolved) return;
      resolved = true;
      if (win && !win.isDestroyed()) win.destroy();
      resolve(detail);
    }

    function fail(err: Error) {
      if (resolved) return;
      resolved = true;
      if (win && !win.isDestroyed()) win.destroy();
      reject(err);
    }

    const timeout = setTimeout(() => {
      fail(new Error('Timeout waiting for Douyin video info (30s)'));
    }, 30000);

    // Use session.webRequest to intercept API responses at the network level
    // This is more reliable than the debugger approach
    const interceptedBodies: Map<string, string> = new Map();

    // Track API response URLs
    ses.webRequest.onCompleted(
      {
        urls: [
          '*://*.douyin.com/*',
          '*://*.iesdouyin.com/*',
          '*://*.snssdk.com/*',
        ],
      },
      async (details: any) => {
        if (resolved) return;
        const respUrl = details.url || '';

        // Skip static resources
        if (
          respUrl.match(
            /\.(js|css|png|jpg|jpeg|gif|svg|woff|ttf|ico|webp|mp4|mp3)(\?|$)/i,
          )
        )
          return;

        // Only process JSON API responses
        const contentType =
          details.responseHeaders?.['content-type']?.[0] || '';
        if (!contentType.includes('json') && !contentType.includes('text'))
          return;

        // Match any API that might contain aweme/video/note data
        const isRelevant =
          respUrl.includes('aweme') ||
          respUrl.includes('detail') ||
          respUrl.includes('item_info') ||
          respUrl.includes('note') ||
          respUrl.includes('video') ||
          respUrl.includes('share');

        if (!isRelevant || details.statusCode !== 200) return;

        logMessage(
          `[douyin-browser] API response: ${respUrl.substring(0, 120)}`,
          'info',
        );
      },
    );

    // Create BrowserWindow
    win = new BrowserWindow({
      show: false,
      width: 1920,
      height: 1080,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        partition,
      },
    });
    win.webContents.setAudioMuted(true);

    // Attach debugger BEFORE loading the page to catch early API calls
    try {
      win.webContents.debugger.attach('1.3');
      win.webContents.debugger.on(
        'message',
        (_event: any, method: string, params: any) => {
          if (resolved || method !== 'Network.responseReceived') return;

          const respUrl = params.response?.url || '';
          // Skip static resources
          if (
            respUrl.match(
              /\.(js|css|png|jpg|jpeg|gif|svg|woff|ttf|ico|webp|mp4|mp3|m3u8|ts)(\?|$)/i,
            )
          )
            return;
          if (
            respUrl.includes('sentry') ||
            respUrl.includes('slardar') ||
            respUrl.includes('log/') ||
            respUrl.includes('monitor')
          )
            return;

          // Only process responses from Douyin domains
          const isRelevant =
            respUrl.includes('douyin.com') ||
            respUrl.includes('iesdouyin.com') ||
            respUrl.includes('snssdk.com') ||
            respUrl.includes('bytedance.com') ||
            respUrl.includes('bytecdn.com');

          if (!isRelevant) return;

          // Check content type - only read JSON responses
          const contentType = params.response?.mimeType || '';
          if (
            contentType &&
            !contentType.includes('json') &&
            !contentType.includes('text/plain')
          )
            return;

          try {
            win!.webContents.debugger
              .sendCommand('Network.getResponseBody', {
                requestId: params.requestId,
              })
              .then((result: any) => {
                if (!result?.body || resolved) return;
                try {
                  const data = JSON.parse(result.body);
                  const detail = extractAwemeDetail(data);
                  if (detail && detail.aweme_id) {
                    logMessage(
                      `[douyin-browser] Found aweme from API: ${respUrl.substring(0, 100)}`,
                      'info',
                    );
                    finish(detail);
                  }
                } catch {} // Not JSON, skip
              })
              .catch(() => {});
          } catch {}
        },
      );
      win.webContents.debugger.sendCommand('Network.enable');
      logMessage('[douyin-browser] Debugger attached before page load', 'info');
    } catch (e) {
      logMessage(`[douyin-browser] debugger attach failed: ${e}`, 'error');
    }

    // After page loads, try to extract embedded data and set up fetch interceptor
    win.webContents.on('did-finish-load', () => {
      if (resolved || !win || win.isDestroyed()) return;

      // Try to read SSR/embedded data
      win.webContents
        .executeJavaScript(
          `
        (function() {
          try {
            // Check iesdouyin share page SSR data
            if (window._ROUTER_DATA && window._ROUTER_DATA.loaderData) {
              const ld = window._ROUTER_DATA.loaderData;
              for (const key of Object.keys(ld)) {
                const val = ld[key];
                if (val && typeof val === 'object') {
                  if (val.awemeDetail) return JSON.stringify(val.awemeDetail);
                  if (val.aweme_detail) return JSON.stringify(val.aweme_detail);
                  if (val.itemInfo) return JSON.stringify(val.itemInfo);
                  if (val.videoData) return JSON.stringify(val.videoData);
                  // Check deeper
                  if (val.data) {
                    for (const k2 of Object.keys(val.data)) {
                      const v2 = val.data[k2];
                      if (v2 && (v2.aweme_detail || v2.awemeDetail || v2.item_list)) {
                        return JSON.stringify(v2);
                      }
                    }
                  }
                }
              }
            }
            if (window._SSR_DATA && window._SSR_DATA.data) {
              for (const key of Object.keys(window._SSR_DATA.data)) {
                const val = window._SSR_DATA.data[key];
                if (val && (val.aweme_detail || val.awemeDetail || val.item_list)) {
                  return JSON.stringify(val);
                }
              }
            }
            if (window.__NEXT_DATA__ && window.__NEXT_DATA__.props) {
              const pp = window.__NEXT_DATA__.props.pageProps || {};
              if (pp.awemeDetail) return JSON.stringify(pp.awemeDetail);
              if (pp.videoData) return JSON.stringify(pp.videoData);
            }
          } catch(e) {}
          return null;
        })()
      `,
        )
        .then((result: string | null) => {
          if (result && !resolved) {
            try {
              const data = JSON.parse(result);
              const detail = extractAwemeDetail(data);
              if (detail && detail.aweme_id) {
                logMessage('[douyin-browser] Got data from SSR', 'info');
                finish(detail);
              }
            } catch {}
          }
        })
        .catch(() => {});

      // Install fetch/XHR interceptor - pass target aweme_id for filtering
      win.webContents
        .executeJavaScript(
          `
        (function() {
          if (window.__douyin_interceptor_installed) return;
          window.__douyin_interceptor_installed = true;
          window.__target_aweme_id = "${targetAwemeId}";
          
          function isTargetData(data) {
            if (!data || typeof data !== 'object') return false;
            var tid = window.__target_aweme_id;
            
            // aweme_detail - exact match
            if (data.aweme_detail && data.aweme_detail.aweme_id) {
              if (!tid || data.aweme_detail.aweme_id === tid) return true;
            }
            // item_list - search for target
            if (data.item_list && Array.isArray(data.item_list)) {
              if (tid) {
                for (var i = 0; i < data.item_list.length; i++) {
                  if (data.item_list[i].aweme_id === tid) return true;
                }
              } else if (data.item_list.length > 0) return true;
            }
            // aweme_list - search for target (don't match if no target)
            if (data.aweme_list && Array.isArray(data.aweme_list) && tid) {
              for (var i = 0; i < data.aweme_list.length; i++) {
                if (data.aweme_list[i].aweme_id === tid) return true;
              }
            }
            // Nested
            if (data.data) return isTargetData(data.data);
            return false;
          }
          
          const origFetch = window.fetch;
          window.fetch = async function(...args) {
            const resp = await origFetch.apply(this, args);
            try {
              const clone = resp.clone();
              const text = await clone.text();
              try {
                const data = JSON.parse(text);
                if (isTargetData(data)) {
                  window.__douyin_detail_result = text;
                }
              } catch {}
            } catch {}
            return resp;
          };
          
          const origXHR = XMLHttpRequest.prototype.open;
          XMLHttpRequest.prototype.open = function(method, url, ...rest) {
            this.__url = url;
            return origXHR.call(this, method, url, ...rest);
          };
          const origXHRSend = XMLHttpRequest.prototype.send;
          XMLHttpRequest.prototype.send = function(...args) {
            this.addEventListener('load', function() {
              try {
                const data = JSON.parse(this.responseText);
                if (isTargetData(data)) {
                  window.__douyin_detail_result = this.responseText;
                }
              } catch {}
            });
            return origXHRSend.apply(this, args);
          };
        })()
      `,
        )
        .catch(() => {});
    });

    // Periodically check for JS interceptor results
    const checkInterval = setInterval(async () => {
      if (resolved || !win || win.isDestroyed()) {
        clearInterval(checkInterval);
        return;
      }
      try {
        const result = await win.webContents.executeJavaScript(
          'window.__douyin_detail_result',
        );
        if (result && !resolved) {
          const data = typeof result === 'string' ? JSON.parse(result) : result;
          const detail = extractAwemeDetail(data);
          if (detail && detail.aweme_id) {
            logMessage(
              '[douyin-browser] Got data from fetch interceptor',
              'info',
            );
            clearInterval(checkInterval);
            finish(detail);
          }
        }
      } catch {}
    }, 1000);

    // Periodically check DOM for video element (every 2s for 10s)
    const domCheckInterval = setInterval(async () => {
      if (resolved || !win || win.isDestroyed()) {
        clearInterval(domCheckInterval);
        return;
      }
      if (resolved || !win || win.isDestroyed()) return;
      win.webContents
        .executeJavaScript(
          `
        (function() {
          // 1. Check for video element
          var videos = document.querySelectorAll('video');
          for (var i = 0; i < videos.length; i++) {
            var v = videos[i];
            var src = v.src || v.currentSrc || '';
            // Check source children
            if (!src) {
              var sources = v.querySelectorAll('source');
              for (var j = 0; j < sources.length; j++) {
                src = sources[j].src || '';
                if (src) break;
              }
            }
            if (src && !src.startsWith('blob:')) {
              return JSON.stringify({ __videoSrc: src, __poster: v.poster || '' });
            }
          }
          
          // 2. Check _ROUTER_DATA for embedded note data
          try {
            if (window._ROUTER_DATA && window._ROUTER_DATA.loaderData) {
              var ld = window._ROUTER_DATA.loaderData;
              for (var key in ld) {
                var val = ld[key];
                if (val && val.awemeDetail) {
                  return JSON.stringify(val.awemeDetail);
                }
                if (val && val.itemInfo) {
                  return JSON.stringify(val.itemInfo);
                }
                // Check for nested data
                if (val && val.data) {
                  for (var k2 in val.data) {
                    var v2 = val.data[k2];
                    if (v2 && (v2.aweme_detail || v2.awemeDetail || v2.video)) {
                      return JSON.stringify(v2.aweme_detail || v2.awemeDetail || v2);
                    }
                  }
                }
              }
            }
          } catch(e) {}
          
          // 3. Check SSR_DATA
          try {
            if (window._SSR_DATA && window._SSR_DATA.data) {
              for (var key in window._SSR_DATA.data) {
                var val = window._SSR_DATA.data[key];
                if (val && (val.aweme_detail || val.awemeDetail || val.video_info)) {
                  return JSON.stringify(val);
                }
              }
            }
          } catch(e) {}
          
          // 4. Check __NEXT_DATA__
          try {
            if (window.__NEXT_DATA__ && window.__NEXT_DATA__.props) {
              var pp = window.__NEXT_DATA__.props.pageProps || {};
              if (pp.awemeDetail || pp.videoData) {
                return JSON.stringify(pp.awemeDetail || pp.videoData);
              }
            }
          } catch(e) {}
          
          // 5. Search all script tags for embedded video data
          try {
            var scripts = document.querySelectorAll('script');
            for (var i = 0; i < scripts.length; i++) {
              var text = scripts[i].textContent || '';
              if (text.includes('play_addr') || text.includes('playAddr') || text.includes('originVideoKey')) {
                // Try to find aweme_detail or video data
                var patterns = [
                  /"aweme_detail"\s*:\s*(\{[^}]*"video"\s*:\s*\{[^}]*"play_addr")/,
                  /"play_addr"\s*:\s*\{[^}]*"url_list"\s*:\s*\[/
                ];
                for (var p = 0; p < patterns.length; p++) {
                  if (patterns[p].test(text)) {
                    return JSON.stringify({ __scriptData: text.substring(0, 5000) });
                  }
                }
              }
            }
          } catch(e) {}
          
          return null;
        })()
      `,
        )
        .then((result: string | null) => {
          if (result && !resolved) {
            try {
              const data = JSON.parse(result);
              if (data.__videoSrc) {
                logMessage(`[douyin-browser] Found video src in DOM`, 'info');
                finish({
                  aweme_id: targetAwemeId || 'unknown',
                  desc: 'Douyin Video',
                  video: {
                    play_addr: {
                      url_list: [data.__videoSrc],
                      width: 0,
                      height: 0,
                    },
                    cover: data.__poster
                      ? { url_list: [data.__poster] }
                      : { url_list: [] },
                  },
                  author: { nickname: '' },
                  duration: 0,
                });
              }
            } catch {}
          }
        })
        .catch(() => {});
    }, 2000);
    // Clear interval after 10 seconds
    setTimeout(() => clearInterval(domCheckInterval), 10000);

    // For iesdouyin share pages, block navigation away so the page stays on the share content
    if (url.includes('iesdouyin.com')) {
      win.webContents.on('will-navigate', (event: any, navUrl: string) => {
        if (resolved) return;
        // Allow navigation within iesdouyin, block redirect to douyin.com
        if (
          navUrl.includes('douyin.com') &&
          !navUrl.includes('iesdouyin.com')
        ) {
          logMessage(
            `[douyin-browser] Blocked redirect to: ${navUrl.substring(0, 100)}`,
            'info',
          );
          event.preventDefault();
        }
      });
      // Also block server-side redirects
      win.webContents.on('will-redirect', (event: any, navUrl: string) => {
        if (resolved) return;
        if (
          navUrl.includes('douyin.com') &&
          !navUrl.includes('iesdouyin.com')
        ) {
          logMessage(
            `[douyin-browser] Blocked server redirect to: ${navUrl.substring(0, 100)}`,
            'info',
          );
          event.preventDefault();
        }
      });
    }

    win.loadURL(url).catch((err) => {
      fail(err);
    });
  });
}

/**
 * 获取抖音视频信息（通过 BrowserWindow）
 */

/**
 * 运行 Python Playwright 脚本来解析/下载抖音内容
 */
async function runDouyinPythonScript(
  url: string,
  outputDir: string,
  parseOnly: boolean,
): Promise<any> {
  const { spawn } = require('child_process');
  const pythonPath = '/Users/vangogh/miniforge3/bin/python3';
  const scriptPath = path
    .join(app.getAppPath(), 'tools', 'douyin-dl', 'douyin_dl.py')
    .replace('app.asar', 'app.asar.unpacked');

  const args = [scriptPath, url, '-o', outputDir || '.'];
  if (parseOnly) args.push('--parse-only');

  logMessage(
    `[douyin] Running Python script: ${pythonPath} ${args.join(' ')}`,
    'info',
  );

  return new Promise((resolve) => {
    const proc = spawn(pythonPath, args, {
      timeout: 120000,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });
    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('close', (code: number) => {
      if (code === 0 && stdout.trim()) {
        try {
          const result = JSON.parse(stdout.trim());
          resolve(result);
        } catch {
          resolve({ success: false, error: 'Failed to parse Python output' });
        }
      } else {
        logMessage(`[douyin] Python script failed: ${stderr}`, 'error');
        resolve({ success: false, error: stderr || 'Python script failed' });
      }
    });

    proc.on('error', (err: Error) => {
      resolve({ success: false, error: err.message });
    });
  });
}

export async function getDouyinVideoInfo(url: string): Promise<any> {
  // Use Python Playwright script (proven to work for Douyin)
  const result = await runDouyinPythonScript(url, '', true);
  if (!result.success) {
    throw new Error(result.error || 'Failed to get video info');
  }
  return result;
}

/**
 * 下载抖音视频
 */
export async function downloadDouyinVideo(
  url: string,
  outputDir: string,
  cookieString?: string,
  onProgress?: (progress: {
    percent: number;
    speed: number;
    downloaded: number;
  }) => void,
): Promise<{ success: boolean; outputPath?: string; error?: string }> {
  try {
    logMessage(`[douyin] Starting download: ${url}`, 'info');
    const result = await runDouyinPythonScript(url, outputDir, false);
    if (result.success) {
      logMessage(`[douyin] Download success: ${result.outputPath}`, 'info');
    }
    return result;
  } catch (err: any) {
    logMessage(`[douyin] Error: ${err.message}`, 'error');
    return { success: false, error: err.message };
  }
}

/**
 * 通过 BrowserWindow 下载文件
 */
function downloadViaBrowser(
  url: string,
  outputPath: string,
  onProgress?: (progress: {
    percent: number;
    speed: number;
    downloaded: number;
  }) => void,
): Promise<boolean> {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });
    win.webContents.setAudioMuted(true);

    // 使用 Electron 的 net 模块下载
    const { net } = require('electron');
    const request = net.request(url);
    request.setHeader('Referer', 'https://www.douyin.com/');

    const chunks: Buffer[] = [];
    let totalSize = 0;
    let downloadedSize = 0;

    request.on('response', (response: any) => {
      const contentLength = parseInt(
        response.headers['content-length']?.[0] || '0',
        10,
      );
      totalSize = contentLength;

      response.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
        downloadedSize += chunk.length;
        if (onProgress && totalSize > 0) {
          onProgress({
            percent: Math.round((downloadedSize / totalSize) * 100),
            speed: 0,
            downloaded: downloadedSize,
          });
        }
      });

      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        fs.writeFileSync(outputPath, buffer);
        win.destroy();
        resolve(true);
      });

      response.on('error', () => {
        win.destroy();
        resolve(false);
      });
    });

    request.on('error', () => {
      win.destroy();
      resolve(false);
    });

    request.end();
  });
}
