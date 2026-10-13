#!/usr/bin/env python3
"""
小红书视频下载器
使用 curl_cffi (chrome146 TLS指纹) 绕过反爬
"""

import json
import re
import sys
from curl_cffi.requests import Session
from lxml.etree import HTML
from yaml import safe_load

IMPERSONATE = "chrome146"
CDN_BASE = "https://sns-video-bd.xhscdn.com/"


def extract_note_id(url):
    m = re.search(r'(?:explore|discovery/item)/([a-f0-9]{24})', url)
    return m.group(1) if m else None


def resolve_short_link(url, cookie=""):
    """解析短链接，返回完整重定向URL（含xsec_token等参数）"""
    if "xhslink.com" not in url and "xhslink.cn" not in url:
        return url
    with Session(impersonate=IMPERSONATE, verify=False, allow_redirects=False, timeout=15) as s:
        if cookie:
            s.cookies = cookie
        resp = s.get(url)
        location = resp.headers.get("location", "")
        if location:
            return location
        return url


def parse_xhs(url, cookie=""):
    try:
        resolved = resolve_short_link(url, cookie)
        note_id = extract_note_id(resolved)
        if not note_id:
            return {"success": False, "error": "cannot extract note id from: " + resolved}

        # Use discovery/item URL format (same as redirect target) with all original params
        if "discovery/item" in resolved:
            explore_url = resolved
        else:
            # Convert explore URL to discovery/item format, preserving query params
            explore_url = resolved.replace("/explore/", "/discovery/item/")

        with Session(impersonate=IMPERSONATE, verify=False, allow_redirects=True, timeout=15) as s:
            if cookie:
                s.cookies = cookie
            resp = s.get(explore_url, headers={
                "Accept": "text/html,application/xhtml+xml",
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            })
            html = resp.text

        if len(html) < 500:
            return {"success": False, "error": "page too short (" + str(len(html)) + " bytes)"}

        # Parse like XHS-Downloader: use lxml + yaml safe_load
        tree = HTML(html)
        scripts = tree.xpath("//script/text()")
        scripts.reverse()
        state_text = next(
            (s for s in scripts if s.startswith("window.__INITIAL_STATE__")),
            "",
        )

        if not state_text:
            return {"success": False, "error": "no __INITIAL_STATE__ found"}

        cleaned = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', state_text.lstrip("window.__INITIAL_STATE__="))
        cleaned = cleaned.replace("new Map([])", "[]").replace("undefined", "null")
        data = safe_load(cleaned)

        # Navigate: note.noteDetailMap -> last value -> .note
        note_map = data.get("note", {}).get("noteDetailMap", {})
        note_data = None
        if note_map:
            if isinstance(note_map, dict):
                last_key = list(note_map.keys())[-1]
                note_data = note_map[last_key].get("note", {})
            elif isinstance(note_map, list) and note_map:
                note_data = note_map[-1].get("note", {})

        if not note_data:
            return {"success": False, "error": "noteDetailMap empty, note may require auth or be unavailable"}

        title = note_data.get("title", "xhs_video")
        note_type = note_data.get("type", "")
        video = note_data.get("video")

        if not video:
            return {"success": False, "error": "note is not a video (type: " + str(note_type) + ")"}

        consumer = video.get("consumer", {})
        video_key = consumer.get("originVideoKey")

        if video_key:
            video_url = CDN_BASE + video_key
        else:
            # Fallback: try stream URLs
            stream = video.get("media", {}).get("stream", {})
            video_url = None
            for codec, items in stream.items():
                if items:
                    best = items[-1]
                    video_url = best.get("masterUrl") or (best.get("backupUrls") or [None])[0]
                    if video_url:
                        break
            if not video_url:
                return {"success": False, "error": "no video URL found in stream data"}

        user = note_data.get("user", {})
        author = user.get("nickname") or user.get("nickName")
        # Extract cover from imageList (not from 'cover' field)
        cover_url = None
        image_list = note_data.get("imageList", [])
        if image_list:
            first_img = image_list[0]
            info_list = first_img.get("infoList", [])
            for info in info_list:
                if info.get("imageScene") == "WB_DFT":
                    cover_url = info.get("url")
                    break
            if not cover_url and info_list:
                cover_url = info_list[0].get("url")

        return {
            "success": True,
            "id": note_id,
            "title": title,
            "author": author,
            "thumbnail": cover_url if cover_url else None,
            "videoUrl": video_url,
            "resolvedUrl": resolved,
            "originalUrl": url,
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"success": False, "error": "Usage: xhs_dl.py parse <url> [cookie]"}))
        sys.exit(1)

    action = sys.argv[1]
    url = sys.argv[2]
    cookie = sys.argv[3] if len(sys.argv) > 3 else ""

    if action == "parse":
        result = parse_xhs(url, cookie)
        print(json.dumps(result, ensure_ascii=False))
    else:
        print(json.dumps({"success": False, "error": "Unknown action: " + action}))
