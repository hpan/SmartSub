#!/usr/bin/env python3
"""
Douyin Video/Audio Downloader - Playwright-based
Loads page with headless Chromium, intercepts the detail API response,
falls back to DOM extraction for image notes with audio.

Usage:
  python3 douyin_dl.py <url> -o <output_dir> [--parse-only]
"""

import asyncio
import json
import os
import sys
import re
import subprocess
import tempfile
import urllib.parse
import urllib.request

PYTHON_PATH = "/Users/vangogh/miniforge3/bin/python3"


def resolve_share_url(url: str) -> str:
    """Resolve v.douyin.com short URL to full URL."""
    short_match = re.search(r'https?://v\.douyin\.com/[\w-]+/?', url, re.IGNORECASE)
    if short_match:
        try:
            req = urllib.request.Request(short_match.group(0), headers={'User-Agent': 'Mozilla/5.0'})
            resp = urllib.request.urlopen(req)
            return resp.url
        except:
            pass
    return url


WORKER_SCRIPT = r'''
import asyncio
import json
import os
import re
import sys
import urllib.parse
import urllib.request


async def main():
    from playwright.async_api import async_playwright

    url = sys.argv[1]
    output_dir = sys.argv[2]
    parse_only = sys.argv[3] == '1'

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=['--no-sandbox'])
        context = await browser.new_context()
        page = await context.new_page()

        # Intercept detail API
        api_detail = {}

        async def on_response(response):
            resp_url = response.url
            if '/aweme/v1/web/aweme/detail' in resp_url and response.status == 200:
                try:
                    data = await response.json()
                    if data.get('aweme_detail'):
                        api_detail['data'] = data['aweme_detail']
                except:
                    pass

        page.on('response', on_response)

        try:
            await page.goto(url, wait_until='domcontentloaded', timeout=20000)
            await asyncio.sleep(3)
        except Exception as e:
            print(json.dumps({"success": False, "error": f"Page load failed: {e}"}))
            await browser.close()
            return

        # Trigger video playback to force the detail API call
        await page.evaluate('() => { const v = document.querySelector("video"); if(v){v.muted=true; v.play().catch(()=>{});} }')

        # Wait for API response (up to 10 seconds)
        for _ in range(20):
            if api_detail.get('data'):
                break
            await asyncio.sleep(0.5)

        # === Strategy 1: Use API detail data ===
        title = ''
        author = ''
        thumbnail = ''
        media_src = ''
        media_duration = 0
        media_type = 'video'

        if api_detail.get('data'):
            d = api_detail['data']
            title = d.get('desc', '')
            author = (d.get('author') or {}).get('nickname', '')
            video = d.get('video', {})
            cover_urls = (video.get('cover', {}).get('url_list', []) or [])
            thumbnail = cover_urls[0] if cover_urls else ''
            duration_ms = d.get('duration', 0) or video.get('duration', 0) or 0
            media_duration = duration_ms / 1000 if duration_ms > 1000 else duration_ms

            # Get video URL from play_addr
            play_addr = video.get('play_addr', {})
            url_list = play_addr.get('url_list', [])
            if url_list:
                # Prefer watermark-free URL
                for u in url_list:
                    if 'watermark=0' in u:
                        media_src = u
                        break
                if not media_src:
                    media_src = url_list[0]
                media_type = 'video'

        # === Strategy 2: Fallback to DOM extraction ===
        if not media_src:
            media_info = await page.evaluate(
                "() => {"
                "  const vids = document.querySelectorAll('video');"
                "  const results = [];"
                "  for (const v of vids) {"
                "    let src = v.src || v.currentSrc || '';"
                "    if (!src || src.startsWith('blob:')) {"
                "      const sources = v.querySelectorAll('source');"
                "      for (const s of sources) {"
                "        if (s.src && !s.src.startsWith('blob:')) { src = s.src; break; }"
                "      }"
                "    }"
                "    if (src && !src.startsWith('blob:')) results.push({src: src, duration: v.duration || 0});"
                "  }"
                "  return results;"
                "}"
            )
            if media_info:
                longest = max(media_info, key=lambda x: x['duration'])
                media_src = longest['src']
                media_duration = longest['duration']
                media_type = 'audio' if '.mp3' in media_src else 'video'

        # === Strategy 3: Fallback to RENDER_DATA ===
        if not title:
            render_data = await page.evaluate(
                "() => { const el = document.getElementById('RENDER_DATA'); return el ? el.textContent : null; }"
            )
            if render_data:
                decoded = urllib.parse.unquote(render_data)
                descs = re.findall(r'"desc"\s*:\s*"([^"]{5,})"', decoded)
                for desc in descs:
                    if len(desc) > 5 and '\u7c89\u4e1d' not in desc and '\u5e73\u53f0' not in desc:
                        title = desc
                        break

        if not title:
            page_title = await page.title()
            title = page_title.replace(' - \u6296\u97f3', '').replace(' - \u6296\u97f3\u77ed\u89c6\u9891', '').strip()

        if not media_src:
            print(json.dumps({"success": False, "error": "No media found on page"}))
            await browser.close()
            return

        # === Output ===
        if parse_only:
            cookies = await context.cookies()
            cookie_str = '; '.join([f"{c['name']}={c['value']}" for c in cookies])
            result = {
                "success": True,
                "id": "",
                "title": title or "Untitled",
                "thumbnail": thumbnail,
                "duration": media_duration,
                "uploader": author,
                "width": 0,
                "height": 0,
                "hasVideo": media_type == 'video',
                "mediaSrc": media_src,
                "mediaType": media_type,
                "cookieStr": cookie_str,
            }
            print(json.dumps(result, ensure_ascii=False))
        else:
            ext = '.mp3' if media_type == 'audio' or '.mp3' in media_src else '.mp4'
            safe_title = re.sub(r'[<>:"/\\|?*]', '_', title or 'Untitled')[:100]
            os.makedirs(output_dir, exist_ok=True)
            output_path = os.path.join(output_dir, safe_title + ext)

            cookies = await context.cookies()
            cookie_str = '; '.join([f"{c['name']}={c['value']}" for c in cookies])

            try:
                req = urllib.request.Request(media_src, headers={
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
                    'Referer': 'https://www.douyin.com/',
                    'Cookie': cookie_str,
                })
                resp = urllib.request.urlopen(req, timeout=120)
                with open(output_path, 'wb') as f:
                    while True:
                        chunk = resp.read(65536)
                        if not chunk:
                            break
                        f.write(chunk)
            except Exception as e:
                print(json.dumps({"success": False, "error": f"Download failed: {e}"}))
                await browser.close()
                return

            result = {
                "success": True,
                "outputPath": output_path,
                "title": title or "Untitled",
                "uploader": author,
                "thumbnail": thumbnail,
                "duration": media_duration,
            }
            print(json.dumps(result, ensure_ascii=False))

        await browser.close()

asyncio.run(main())
'''


def main():
    import argparse
    parser = argparse.ArgumentParser(description='Douyin Video/Audio Downloader')
    parser.add_argument('url', help='Douyin URL or share text')
    parser.add_argument('-o', '--output', default='.', help='Output directory')
    parser.add_argument('--parse-only', action='store_true', help='Only parse, don\'t download')
    args = parser.parse_args()

    url = resolve_share_url(args.url)

    with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False) as f:
        f.write(WORKER_SCRIPT)
        temp_script = f.name

    try:
        result = subprocess.run(
            [PYTHON_PATH, temp_script, url, args.output, '1' if args.parse_only else '0'],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if result.returncode == 0 and result.stdout.strip():
            print(result.stdout.strip())
        else:
            error_msg = result.stderr or "Download failed"
            print(json.dumps({"success": False, "error": error_msg}))
            sys.exit(1)
    finally:
        os.unlink(temp_script)


if __name__ == '__main__':
    main()
