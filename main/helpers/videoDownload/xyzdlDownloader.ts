/**
 * 小宇宙播客下载器
 * 基于 xyz-dl 的核心逻辑，直接实现而非引入 npm 依赖
 * 参考: https://github.com/Cyronlee/xyz-dl
 */

import * as https from 'https';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { logMessage } from '../storeManager';

/** 小宇宙 API 基础配置 */
const XYZ_API = {
  EPISODE_DETAIL: 'https://www.xiaoyuzhoufm.com/api/v1/episode',
  EPISODE_MEDIA: 'https://www.xiaoyuzhoufm.com/api/v1/episode/media',
};

/** 小宇宙 Episode 信息 */
export interface XyzEpisode {
  id: string;
  title: string;
  podcastName: string;
  podcastAuthor: string;
  duration: number; // 秒
  description: string;
  mediaUrl: string;
  coverUrl: string | null;
}

/**
 * 从小宇宙 Episode URL 中提取 episode ID
 * 支持格式:
 *   - https://www.xiaoyuzhoufm.com/episode/xxxx
 *   - 直接传入 episode ID
 */
export function parseXyzEpisodeId(input: string): string | null {
  // 直接是 ID
  if (/^[a-f0-9]{24}$/i.test(input)) {
    return input;
  }
  // 从 URL 提取
  const match = input.match(/xiaoyuzhoufm\.com\/episode\/([a-f0-9]{24})/i);
  return match ? match[1] : null;
}

/**
 * 检测是否为小宇宙链接
 */
export function isXiaoyuzhouUrl(url: string): boolean {
  return /xiaoyuzhoufm\.com\/episode\//.test(url);
}

/**
 * HTTP GET 请求（带重定向支持）
 */
function httpGet(
  url: string,
  headers: Record<string, string> = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const req = protocol.get(url, { headers, timeout: 15000 }, (res) => {
      // 处理重定向
      if (
        res.statusCode &&
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location
      ) {
        httpGet(res.headers.location, headers).then(resolve).catch(reject);
        return;
      }

      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(data));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('请求超时'));
    });
  });
}

/**
 * 从小宇宙页面提取音频 URL
 * 小宇宙的音频 URL 嵌入在页面 HTML 的 og:audio meta 标签中
 */
async function extractAudioUrlFromPage(
  episodeUrl: string,
): Promise<string | null> {
  try {
    const html = await httpGet(episodeUrl, {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    });
    // 从 og:audio meta 标签提取
    const ogAudioMatch =
      html.match(/<meta\s+property="og:audio"\s+content="([^"]+)"/i) ||
      html.match(/<meta\s+content="([^"]+)"\s+property="og:audio"/i);
    if (ogAudioMatch) {
      return ogAudioMatch[1];
    }
    // 备用：从 audio src 提取
    const audioSrcMatch = html.match(
      /src="(https?:\/\/[^"]+\.(?:mp3|m4a|aac)[^"]*)"/i,
    );
    return audioSrcMatch ? audioSrcMatch[1] : null;
  } catch (error) {
    logMessage(`[xyz-dl] extract audio URL error: ${error}`, 'error');
    return null;
  }
}

/**
 * 从小宇宙页面提取元信息
 */
async function extractMetaFromPage(episodeUrl: string): Promise<{
  title: string;
  podcastName: string;
  description: string;
  coverUrl: string | null;
} | null> {
  try {
    const html = await httpGet(episodeUrl, {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    });

    const titleMatch =
      html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i) ||
      html.match(/<meta\s+content="([^"]+)"\s+property="og:title"/i);
    const siteMatch =
      html.match(/<meta\s+property="og:site_name"\s+content="([^"]+)"/i) ||
      html.match(/<meta\s+content="([^"]+)"\s+property="og:site_name"/i);
    const descMatch =
      html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i) ||
      html.match(/<meta\s+content="([^"]+)"\s+property="og:description"/i);
    const imageMatch =
      html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i) ||
      html.match(/<meta\s+content="([^"]+)"\s+property="og:image"/i);

    return {
      title: titleMatch ? decodeHtmlEntities(titleMatch[1]) : '未知剧集',
      podcastName: siteMatch ? decodeHtmlEntities(siteMatch[1]) : '小宇宙播客',
      description: descMatch ? decodeHtmlEntities(descMatch[1]) : '',
      coverUrl: imageMatch ? imageMatch[1] : null,
    };
  } catch {
    return null;
  }
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

/**
 * 解析小宇宙 Episode 链接，获取元信息和音频 URL
 */
export async function parseXyzEpisode(input: string): Promise<XyzEpisode> {
  const episodeId = parseXyzEpisodeId(input);
  if (!episodeId) {
    throw new Error('无效的小宇宙链接或 ID');
  }

  const episodeUrl = `https://www.xiaoyuzhoufm.com/episode/${episodeId}`;

  // 并行获取音频 URL 和页面元信息
  const [audioUrl, meta] = await Promise.all([
    extractAudioUrlFromPage(episodeUrl),
    extractMetaFromPage(episodeUrl),
  ]);

  if (!audioUrl) {
    throw new Error('无法获取音频地址，请确认链接是否正确');
  }

  return {
    id: episodeId,
    title: meta?.title || '未知剧集',
    podcastName: meta?.podcastName || '小宇宙播客',
    podcastAuthor: meta?.podcastName || '',
    duration: 0, // 页面不直接提供
    description: meta?.description || '',
    mediaUrl: audioUrl,
    coverUrl: meta?.coverUrl || null,
  };
}

export interface XyzDownloadProgress {
  downloaded: number;
  total: number;
  percent: number;
}

/**
 * 下载小宇宙音频文件
 */
export async function downloadXyzAudio(
  episode: XyzEpisode,
  outputDir: string,
  onProgress?: (progress: XyzDownloadProgress) => void,
): Promise<string> {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // 从 URL 推断扩展名
  const urlPath = new URL(episode.mediaUrl).pathname;
  const ext = path.extname(urlPath) || '.mp3';
  const safeTitle = episode.title
    .replace(/[\/\\:*?"<>|]/g, '_')
    .substring(0, 100);
  const outputFileName = `${safeTitle}${ext}`;
  const outputPath = path.join(outputDir, outputFileName);

  logMessage(`[xyz-dl] downloading: ${episode.title}`, 'info');

  return new Promise<string>((resolve, reject) => {
    const doDownload = (url: string) => {
      const protocol = url.startsWith('https') ? https : http;
      protocol
        .get(
          url,
          {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            },
            timeout: 30000,
          },
          (response) => {
            // 处理重定向
            if (
              response.statusCode &&
              response.statusCode >= 300 &&
              response.statusCode < 400 &&
              response.headers.location
            ) {
              doDownload(response.headers.location);
              return;
            }

            if (response.statusCode !== 200) {
              reject(new Error(`下载失败: HTTP ${response.statusCode}`));
              return;
            }

            const totalSize = parseInt(
              response.headers['content-length'] || '0',
              10,
            );
            let downloadedSize = 0;

            const fileStream = fs.createWriteStream(outputPath);

            response.on('data', (chunk: Buffer) => {
              downloadedSize += chunk.length;
              if (onProgress && totalSize > 0) {
                onProgress({
                  downloaded: downloadedSize,
                  total: totalSize,
                  percent: Math.round((downloadedSize / totalSize) * 100),
                });
              }
            });

            response.pipe(fileStream);

            fileStream.on('finish', () => {
              fileStream.close();
              logMessage(`[xyz-dl] download complete: ${outputPath}`, 'info');
              resolve(outputPath);
            });

            fileStream.on('error', (err) => {
              try {
                fs.unlinkSync(outputPath);
              } catch {}
              reject(err);
            });
          },
        )
        .on('error', reject);
    };

    doDownload(episode.mediaUrl);
  });
}
