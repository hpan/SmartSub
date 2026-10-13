#!/usr/bin/env python3
"""
音频频谱可视化视频生成器
numpy FFT + PIL 逐帧渲染 + FFmpeg 管道编码
"""

import argparse
import math
import random
import os
import subprocess
import sys
import numpy as np
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

FFMPEG = '/opt/homebrew/bin/ffmpeg'
FFPROBE = '/opt/homebrew/bin/ffprobe'


def hex_to_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))



def parse_srt(srt_path):
    """Parse SRT file, return list of (start_sec, end_sec, text)."""
    import re
    entries = []
    if not srt_path or not os.path.exists(srt_path):
        return entries
    with open(srt_path, 'r', encoding='utf-8-sig') as f:
        text = f.read()
    # Split by double newline to get blocks
    blocks = re.split(r'\n\n+', text.strip())
    for block in blocks:
        lines = block.strip().split('\n')
        if len(lines) < 3:
            continue
        # Line 0: index, Line 1: timestamp, Line 2+: text
        m = re.match(r'(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})', lines[1])
        if not m:
            continue
        g = m.groups()
        start = int(g[0])*3600 + int(g[1])*60 + int(g[2]) + int(g[3])/1000
        end = int(g[4])*3600 + int(g[5])*60 + int(g[6]) + int(g[7])/1000
        txt = ' '.join(lines[2:]).strip()
        # Remove HTML tags
        txt = re.sub(r'<[^>]+>', '', txt)
        if txt:
            entries.append((start, end, txt))
    return entries

def get_subtitle_for_time(subs, t):
    """Get subtitle text active at time t."""
    for start, end, text in subs:
        if start <= t <= end:
            return text
    return None

def load_audio(path):
    tmp_wav = '/tmp/_yinhua_temp.wav'
    subprocess.run([FFMPEG, '-y', '-i', path, '-ac', '1', '-ar', '22050', '-f', 'wav', tmp_wav], capture_output=True)
    from scipy.io import wavfile
    sr, data = wavfile.read(tmp_wav)
    if data.dtype == np.int16:
        data = data.astype(np.float32) / 32768.0
    elif data.dtype == np.int32:
        data = data.astype(np.float32) / 2147483648.0
    try: os.remove(tmp_wav)
    except: pass
    return data, sr


def get_duration(path):
    out = subprocess.check_output([FFPROBE, '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=0', path], text=True).strip()
    if '=' in out:
        out = out.split('=')[-1]
    return float(out)


def compute_spectrum_frame(audio, sr, frame_time, fps, n_bars=128, fft_size=2048):
    center = int(frame_time * sr)
    half = fft_size // 2
    start = max(0, center - half)
    end = min(len(audio), center + half)
    chunk = audio[start:end]
    if len(chunk) < fft_size:
        chunk = np.pad(chunk, (0, fft_size - len(chunk)))
    window = np.hanning(len(chunk))
    fft_result = np.abs(np.fft.rfft(chunk * window))
    freqs = np.fft.rfftfreq(len(chunk), 1.0 / sr)
    bar_freqs = np.logspace(np.log10(20), np.log10(sr / 2), n_bars + 1)
    bars = np.zeros(n_bars)
    for i in range(n_bars):
        mask = (freqs >= bar_freqs[i]) & (freqs < bar_freqs[i + 1])
        if mask.any():
            bars[i] = fft_result[mask].mean()
    max_val = bars.max()
    if max_val > 0:
        bars = bars / max_val
    bars = np.convolve(bars, np.ones(3)/3, mode='same')
    return bars


def draw_bottom_spectrum(draw, w, h, bars, color, alpha=200, bar_h_max_ratio=0.15, bottom_margin=0.08):
    """Horizontal bar spectrum at the bottom area, above subtitle."""
    n = min(len(bars), 80)
    bar_h_max = int(h * bar_h_max_ratio)
    base_y = h - int(h * bottom_margin)
    bar_w = max(3, w // n)
    gap = 2
    for i in range(n):
        mag = bars[i] ** 0.55
        bh = int(bar_h_max * mag)
        x = i * bar_w + gap // 2
        bw = max(1, bar_w - gap)
        y = base_y - bh
        # Draw bar with gradient
        for j in range(bh):
            a = int(alpha * (0.2 + 0.8 * (j / max(bh, 1))))
            draw.rectangle([x, y + j, x + bw, y + j + 1], fill=(*color, a))
        # Peak dot
        if bh > 2:
            dot_r = max(1, bw // 2)
            draw.ellipse([x, base_y - bh - dot_r * 2, x + bw, base_y - bh], fill=(255, 255, 255, int(alpha * 0.9)))


def draw_radial_spectrum(draw, cx, cy, bars, color, w, h, bars_count=48, max_radius=100, alpha=200, logo_radius=0):
    """Radial (laser) spectrum: bars emanating from center outward, with glow.
    Centered on logo (cx, cy)."""
    n = min(len(bars), bars_count)
    max_r = min(max_radius, min(w, h) * 0.25)
    gap_angle = math.pi * 2 / n
    line_w = max(1, int(gap_angle * max_r * 0.15))
    for i in range(n):
        mag = bars[i] ** 0.55
        angle = i * gap_angle - math.pi / 2
        r = max(3, max_r * mag)
        x1 = cx + math.cos(angle) * 3
        y1 = cy + math.sin(angle) * 3
        x2 = cx + math.cos(angle) * r
        y2 = cy + math.sin(angle) * r
        a_val = int(alpha * (0.3 + 0.7 * mag))
        # Glow layer (wider, more transparent)
        glow_w = line_w * 3
        draw.line([x1, y1, x2, y2], fill=(*color, a_val // 3), width=glow_w)
        # Main bar
        draw.line([x1, y1, x2, y2], fill=(*color, a_val), width=line_w)


def draw_spectrum_rings(draw, cx, cy, bars, t, logo_radius=0, rings=6, samples=60, ring_gap_ratio=0.1, amp_scale_ratio=0.8, rotation_speed=0.15):
    """Compact spectrum rings tightly surrounding the logo (inspired by WaveDancer Rings).
    Outer ring radius stays within ~1.5x logo_radius."""
    if logo_radius < 5:
        return
    ring_gap = max(3, int(logo_radius * ring_gap_ratio))
    base_r = logo_radius + max(2, ring_gap // 2)
    amp_scale = max(2, int(ring_gap * amp_scale_ratio))
    hue_offset = (t * 60) % 360
    for ring in range(rings):
        r0 = base_r + ring * ring_gap
        pts = []
        for i in range(samples + 1):
            idx = int((i + ring * 3) * len(bars) / samples) % len(bars)
            amp = bars[idx] ** 0.55
            angle = (i / samples) * math.pi * 2 + t * rotation_speed * (1 if ring % 2 == 0 else -1) * (ring + 1) * 0.2
            r = r0 + amp * amp_scale
            x = cx + math.cos(angle) * r
            y = cy + math.sin(angle) * r
            pts.append((x, y))
        hue = (hue_offset + ring * 360 / rings) % 360
        hsv = hue / 360.0
        r_frag = 6 * hsv
        r_i = int(r_frag)
        r_f = r_frag - r_i
        if r_i == 0: r2, g2, b2 = 255, int(255 * r_f), 0
        elif r_i == 1: r2, g2, b2 = int(255 * (1 - r_f)), 255, 0
        elif r_i == 2: r2, g2, b2 = 0, 255, int(255 * r_f)
        elif r_i == 3: r2, g2, b2 = 0, int(255 * (1 - r_f)), 255
        elif r_i == 4: r2, g2, b2 = int(255 * r_f), 0, 255
        else: r2, g2, b2 = 255, 0, int(255 * (1 - r_f))
        ring_color = (r2, g2, b2, 200)
        draw.line(pts, fill=ring_color, width=2)


def draw_arc_segment(draw, cx, cy, r, start_angle, end_angle, color, width=2, steps=24):
    """Draw a smooth arc segment centered at (cx, cy)."""
    if end_angle <= start_angle or r < 2:
        return
    pts = []
    for i in range(steps + 1):
        a = start_angle + (end_angle - start_angle) * i / steps
        pts.append((cx + math.cos(a) * r, cy + math.sin(a) * r))
    draw.line(pts, fill=color, width=width)


# Radar smoothing state (persists across frames within one render)
_radar_smooth_bars = None


def draw_radar_spectrum(draw, cx, cy, bars, w, h, max_radius=100, alpha=200):
    """Sonar/radar style: concentric teal arcs (low freq) + orange spikes (high freq).
    Ported from https://github.com/Teoxoy/audio-visualizer"""
    n = min(len(bars), 48)
    if n < 2:
        return
    half = max(1, n // 2)
    # Temporal smoothing: slow down the response to avoid flickering
    global _radar_smooth_bars
    if _radar_smooth_bars is None or len(_radar_smooth_bars) != n:
        _radar_smooth_bars = list(bars[:n])
    else:
        smooth = 0.15  # lower = slower (12% toward target per frame)
        for i in range(n):
            _radar_smooth_bars[i] += (bars[i] - _radar_smooth_bars[i]) * smooth
    bars = _radar_smooth_bars
    low_bars = bars[:half]
    high_bars = bars[half:]
    max_r = min(max_radius, min(w, h) * 0.175)
    rad15 = math.pi / 12
    margin = 8
    # 4 fixed arc angle ranges: 15deg blocks [1,5] [7,11] [13,17] [19,23]
    arc_ranges = [
        (rad15 * 1, rad15 * 5),
        (rad15 * 7, rad15 * 11),
        (rad15 * 13, rad15 * 17),
        (rad15 * 19, rad15 * 23),
    ]
    teal = (0, 150, 136, alpha)
    orange = (255, 152, 0, alpha)
    # Low frequency: teal arcs at fixed positions
    for i, amp in enumerate(low_bars):
        mag = amp ** 0.6
        if mag < 0.04:
            continue
        r = max(5, max_r * mag)
        v = 0.75 - r / (min(w, h) / 2 - margin)
        for a0, a1 in arc_ranges:
            A = a0 + v
            B = a1 - v
            if B > A:
                draw_arc_segment(draw, cx, cy, r, A, B, teal, width=2, steps=18)
    # High frequency: orange spikes, angle offset by index
    for i, amp in enumerate(high_bars):
        mag = amp ** 0.6
        if mag < 0.04:
            continue
        r = max(5, max_r * mag * 0.5)
        off = i * rad15 * 0.4
        for a0, a1 in arc_ranges:
            A = a0 + off
            B = a1 + off
            if B > A:
                draw_arc_segment(draw, cx, cy, r, A, B, orange, width=2, steps=14)



def draw_rainbow_wave(draw, w, h, bars, alpha=200, bar_h_max_ratio=0.15, bottom_margin=0.08):
    """Rainbow-colored sound wave bars (剪映-style 7-color spectrum).
    Each bar is colored with a rainbow hue based on its position."""
    n = min(len(bars), 64)
    bar_h_max = int(h * bar_h_max_ratio)
    base_y = h - int(h * bottom_margin)
    bar_w = max(4, w // n)
    gap = max(1, bar_w // 4)
    step = bar_w + gap
    offset = (w - n * step) // 2
    hue_step = 300.0 / max(n - 1, 1)  # 0=red → 300=purple
    for i in range(n):
        mag = bars[i] ** 0.55
        if mag < 0.005:
            continue
        bar_h = max(1, int(bar_h_max * mag))
        x = offset + i * step
        y0 = base_y - bar_h
        y1 = base_y
        # Rainbow color via HSL: hue from 0 to 300
        hue = i * hue_step
        # Convert HSL to RGB (simplified cone model)
        h_i = hue / 60.0
        sector = int(h_i)
        f = h_i - sector
        s, v = 1.0, 0.9
        p = v * (1 - s)
        q = v * (1 - s * f)
        t_val = v * (1 - s * (1 - f))
        if sector == 0: r2, g2, b2 = v, t_val, p
        elif sector == 1: r2, g2, b2 = q, v, p
        elif sector == 2: r2, g2, b2 = p, v, t_val
        elif sector == 3: r2, g2, b2 = p, q, v
        elif sector == 4: r2, g2, b2 = t_val, p, v
        else: r2, g2, b2 = v, p, q
        color = (int(r2 * 255), int(g2 * 255), int(b2 * 255), alpha)
        # Rounded top
        draw.rectangle([x, y0, x + bar_w, y1], fill=color)
        # Glow effect
        if bar_h > 4:
            glow = (color[0], color[1], color[2], alpha // 4)
            draw.rectangle([x, y0 - 2, x + bar_w, y0], fill=glow)


def _hsv_to_rgb(h, s, v):
    """Convert HSV (0-360, 0-1, 0-1) to RGB tuple (0-255)."""
    h_i = (h / 60.0) % 6
    f = h / 60.0 - int(h / 60.0)
    p = v * (1 - s)
    q = v * (1 - s * f)
    t = v * (1 - s * (1 - f))
    if h_i < 1: r2, g2, b2 = v, t, p
    elif h_i < 2: r2, g2, b2 = q, v, p
    elif h_i < 3: r2, g2, b2 = p, v, t
    elif h_i < 4: r2, g2, b2 = p, q, v
    elif h_i < 5: r2, g2, b2 = t, p, v
    else: r2, g2, b2 = v, p, q
    return (int(r2 * 255), int(g2 * 255), int(b2 * 255))


def draw_pulse_rings(frame, cx, cy, bars, t, logo_radius=0, rings=6, alpha=200):
    """Smooth concentric circles around the logo that pulse with audio.
    Anti-aliased via supersampling on a localized region around the logo
    (much cheaper than a full-frame oversize overlay)."""
    if logo_radius < 5:
        return
    w, h = frame.size
    n = min(len(bars), rings * 6)
    ring_gap = max(4, int(logo_radius * 0.18))
    base_r = logo_radius + ring_gap // 2
    amp_scale = max(2, ring_gap * 0.6)
    # Professional finance palette: deep, subdued colors
    finance_colors = [
        (0, 82, 136),      # Deep navy blue
        (44, 100, 140),    # Steel blue
        (30, 110, 110),    # Teal
        (120, 90, 50),     # Dark gold/amber
        (60, 110, 80),     # Muted sage green
        (100, 100, 130),   # Slate grey-blue
    ]
    # Compute each ring's radius (in frame pixels) first
    ring_rs = []
    for ring in range(rings):
        idx_s = ring * (n // rings)
        idx_e = min((ring + 1) * (n // rings), n)
        mean_amp = sum(bars[idx_s:idx_e]) / max(idx_e - idx_s, 1)
        mag = mean_amp ** 0.55
        ring_rs.append(base_r + ring * ring_gap + mag * amp_scale)
    max_r = max(ring_rs) + ring_gap  # include stroke width margin
    # Build a small supersampled overlay centered on the logo
    ss = 2  # supersample factor (keeps smooth edges, tiny region = cheap)
    size = int(2 * max_r) + 2
    ov = Image.new('RGBA', (size * ss, size * ss), (0, 0, 0, 0))
    ov_draw = ImageDraw.Draw(ov)
    cen = size * ss / 2.0
    for ring in range(rings):
        c = finance_colors[ring % len(finance_colors)]
        lighten = 1.0 + ring * 0.08
        color = (min(255, int(c[0] * lighten)), min(255, int(c[1] * lighten)), min(255, int(c[2] * lighten)))
        rs = ring_rs[ring] * ss
        ov_draw.ellipse(
            [cen - rs, cen - rs, cen + rs, cen + rs],
            outline=color,
            width=max(3, ring_gap // 3 * ss),
        )
    ov = ov.resize((size, size), Image.LANCZOS)
    # Paste at logo center, clipping to frame bounds
    left, top = cx - size // 2, cy - size // 2
    ox0 = max(0, -left)
    oy0 = max(0, -top)
    ox1 = min(size, w - left)
    oy1 = min(size, h - top)
    if ox1 <= ox0 or oy1 <= oy0:
        return
    frame.paste(ov.crop((ox0, oy0, ox1, oy1)), (left + ox0, top + oy0), ov.crop((ox0, oy0, ox1, oy1)))

def make_circular_image(img_path, size):
    img = Image.open(img_path).convert('RGBA')
    img = img.resize((size, size), Image.LANCZOS)
    mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size - 1, size - 1), fill=255)
    result = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    result.paste(img, (0, 0), mask)
    return result


def add_dark_overlay(img, opacity=0.6):
    """Add dark overlay to image."""
    overlay = Image.new('RGBA', img.size, (0, 0, 0, int(255 * opacity)))
    return Image.alpha_composite(img, overlay)



def draw_watermark(img, text, font_path=None, opacity=25, angle_deg=-45, font_size_ratio=0.035, spacing_ratio=0.18):
    """Draw tiled semi-transparent watermark text across the image."""
    from PIL import ImageDraw, ImageFont
    import math
    
    w, h = img.size
    font_size = max(12, int(w * font_size_ratio))
    spacing = max(60, int(w * spacing_ratio))
    
    try:
        font = ImageFont.truetype(font_path or '/Users/vangogh/Library/Fonts/DingTalkJinBuTi-Regular.ttf', font_size)
    except Exception:
        font = ImageFont.load_default()
    
    # Create a transparent overlay for the watermark
    overlay = Image.new('RGBA', (w * 2, h * 2), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    
    # Measure text
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    
    # Draw text in a grid pattern
    angle_rad = math.radians(angle_deg)
    for row in range(-2, int(h * 2 / spacing) + 2):
        for col in range(-2, int(w * 2 / spacing) + 2):
            x = col * spacing
            y = row * spacing
            draw.text((x, y), text, fill=(255, 255, 255, opacity), font=font)
    
    # Rotate the overlay
    overlay = overlay.rotate(angle_deg, resample=Image.BICUBIC, expand=False)
    
    # Crop back to original size from center
    cx, cy = overlay.size[0] // 2, overlay.size[1] // 2
    overlay = overlay.crop((cx - w // 2, cy - h // 2, cx - w // 2 + w, cy - h // 2 + h))
    
    # Composite onto the original image
    if img.mode != 'RGBA':
        img = img.convert('RGBA')
    img = Image.alpha_composite(img, overlay)
    return img


def draw_text_with_effects(draw, text, font, x, y, fill, stroke_width=0, stroke_fill=None, shadow_offset=0):
    """Draw text with stroke and shadow effects using Pillow built-in stroke_width."""
    sw = stroke_width if stroke_width > 0 and stroke_fill else 0
    sf = stroke_fill if stroke_fill else None
    # Shadow
    if shadow_offset > 0:
        shadow_color = (0, 0, 0, 180)
        for sx, sy in [(-shadow_offset, 0), (shadow_offset, 0), (0, -shadow_offset), (0, shadow_offset),
                       (-shadow_offset, shadow_offset), (shadow_offset, shadow_offset),
                       (-shadow_offset, -shadow_offset), (shadow_offset, -shadow_offset)]:
            draw.text((x + sx, y + sy), text, font=font, fill=shadow_color, stroke_width=sw, stroke_fill=sf)
    # Main text with built-in stroke (single call, no nested loop)
    draw.text((x, y), text, font=font, fill=fill, stroke_width=sw, stroke_fill=sf)


def draw_text_letter_spacing(draw, text, font, x, y, fill, stroke_width=0, stroke_fill=None, shadow_offset=0, letter_spacing=0):
    """Draw text with per-character letter spacing, supporting stroke and shadow."""
    cur_x = x
    for ch in text:
        if ch == " ":
            try:
                cur_x += draw.textlength(ch, font=font) + letter_spacing
            except:
                cur_x += font.getbbox(" ")[2] + letter_spacing
            continue
        draw_text_with_effects(draw, ch, font, cur_x, y, fill, stroke_width, stroke_fill, shadow_offset)
        try:
            cur_x += draw.textlength(ch, font=font) + letter_spacing
        except:
            cur_x += font.getbbox(ch)[2] + letter_spacing


def wrap_text(font, text, max_width):
    """Wrap text at punctuation, using real font metrics to check width."""

    def _text_w(t):
        return font.getbbox(t)[2] if t else 0

    # Break-eligible punctuation (ranked by priority)
    strong = set('：—:')  # colon, em-dash
    medium = set('，；、')  # comma, semicolon, enumeration comma
    weak = set('。！？,. ')  # period, exclamation, question, comma, dot, space

    # Collect all break positions with priority
    breaks = []
    for i, ch in enumerate(text):
        if ch in strong:
            breaks.append((i + 1, 1))
        elif ch in medium:
            breaks.append((i + 1, 2))
        elif ch in weak:
            breaks.append((i + 1, 3))

    lines_out = []
    pos = 0
    while pos < len(text):
        remaining = text[pos:]
        if _text_w(remaining) <= max_width:
            lines_out.append(remaining)
            break

        # Find rightmost break within width, highest priority
        best = -1
        best_pri = 999
        for bp, pri in breaks:
            if bp <= pos:
                continue
            # Use REAL font metrics to check width
            if _text_w(text[pos:bp]) <= max_width:
                if pri < best_pri or (pri == best_pri and bp > best):
                    best = bp
                    best_pri = pri

        if best > pos:
            line = text[pos:best].strip()
            if line:
                lines_out.append(line)
            pos = best
            continue

        # No punctuation within width — hard cut
        cut = len(remaining)
        for i in range(1, len(remaining) + 1):
            if _text_w(remaining[:i]) > max_width:
                cut = max(1, i - 1)
                break
        lines_out.append(remaining[:cut].strip())
        pos += cut

    return lines_out

def main():
    pa = argparse.ArgumentParser()
    pa.add_argument('--audio', required=True)
    pa.add_argument('--cover', required=True)
    pa.add_argument('--logo', default=None)
    pa.add_argument('--output', required=True)
    pa.add_argument('--width', type=int, required=True)
    pa.add_argument('--height', type=int, required=True)
    pa.add_argument('--fps', type=int, default=10)
    pa.add_argument('--speed', type=float, default=1.0)
    pa.add_argument('--preview-seconds', type=int, default=0)
    pa.add_argument('--logo-position', default='bottom-left')
    pa.add_argument('--logo-size-ratio', type=float, default=0.15, help='Logo size as ratio of canvas height')
    pa.add_argument('--overlay-opacity', type=float, default=0.6, help='Dark overlay opacity')
    pa.add_argument('--overlay-blur', type=float, default=0.0, help='Background gaussian blur radius')
    pa.add_argument('--spectrum-style', choices=['none', 'bars', 'radial', 'rings', 'radar', 'wave', 'pulse'], default='bars', help='Spectrum style: none (no spectrum), bars (bottom), radial (starburst from center), rings (around logo), radar (sonar arcs), wave (rainbow wave), pulse (pulse rings)')
    pa.add_argument('--spectrum-color', default='#FFF79B')
    pa.add_argument('--tag-text', default=None)
    pa.add_argument('--logo-x-ratio', type=float, default=None)
    pa.add_argument('--logo-y-ratio', type=float, default=None)
    pa.add_argument('--logo-rotate', type=int, default=0, help='Rotate logo 360deg over the video duration (1=on, 0=off)')
    pa.add_argument('--logo-rotate-speed', type=float, default=90.0, help='Logo rotation speed in degrees per second')
    pa.add_argument('--title', default=None)
    pa.add_argument('--title-font-size', type=int, default=0)
    pa.add_argument('--title-date', default=None)
    pa.add_argument('--title-date-font-size', type=int, default=0)
    pa.add_argument('--title-color', default='#FFFFFF')
    pa.add_argument('--title-stroke-enabled', type=int, default=1)
    pa.add_argument('--title-shadow-enabled', type=int, default=0)
    pa.add_argument('--title-shadow-width', type=int, default=3)
    pa.add_argument('--title-letter-spacing', type=int, default=0)
    pa.add_argument('--title-line-spacing', type=int, default=12)
    pa.add_argument('--title-stroke-width', type=int, default=4)
    pa.add_argument('--title-y-ratio', type=float, default=0.15)
    pa.add_argument('--title-font', default=None)
    pa.add_argument('--subtitle', default=None, help='SRT subtitle file path')
    pa.add_argument('--subtitle-font', default=None)
    pa.add_argument('--subtitle-font-size', type=int, default=0)
    pa.add_argument('--subtitle-color', default='#FFF79B')
    pa.add_argument('--subtitle-stroke-width', type=int, default=3)
    pa.add_argument('--subtitle-bottom-ratio', type=float, default=0.08)
    pa.add_argument('--watermark-text', default='', help='Watermark text to tile across the background')
    pa.add_argument('--watermark-density', type=float, default=0.18, help='Watermark spacing ratio (smaller = denser)')
    pa.add_argument('--watermark-angle', type=float, default=-45, help='Watermark text rotation angle in degrees')
    pa.add_argument('--disclaimer-text', default='', help='Disclaimer text to display on video')
    pa.add_argument('--disclaimer-position', default='bottom-center', help='Disclaimer position: top-left/top-center/top-right/bottom-left/bottom-center/bottom-right')
    pa.add_argument('--watermark-opacity', type=int, default=25, help='Watermark text opacity 0~255')
    pa.add_argument('--disclaimer-opacity', type=int, default=153, help='Disclaimer text opacity 0~255')
    args = pa.parse_args()

    w, h = args.width, args.height
    fps = args.fps

    print(f'[音画] Loading audio...')
    audio, sr = load_audio(args.audio)
    duration = get_duration(args.audio)
    if args.preview_seconds > 0:
        duration = min(duration, args.preview_seconds)
    total_frames = int(duration * fps)
    print(f'[音画] Duration: {duration:.1f}s, {total_frames} frames @ {fps}fps')

    # Load and prepare cover with dark overlay
    cover = Image.open(args.cover).convert('RGBA').resize((w, h), Image.LANCZOS)
    if args.overlay_blur > 0:
        print(f'[音画] Cover blur: {args.overlay_blur:.0f}px')
        cover = cover.filter(ImageFilter.GaussianBlur(args.overlay_blur))
    cover = add_dark_overlay(cover, args.overlay_opacity)
    print(f'[音画] Cover overlay: {args.overlay_opacity*100:.0f}%')

    # Logo setup
    logo_size = int(h * args.logo_size_ratio)
    logo_img = None
    if args.logo and os.path.exists(args.logo):
        logo_img = make_circular_image(args.logo, logo_size * 4)
    print(f'[音画] Logo size: {logo_size}px ({args.logo_size_ratio*100:.0f}% of height)')

    # Logo position
    pos_map = {
        'bottom-left': (0.09, 0.89), 'bottom-right': (0.91, 0.89),
        'top-left': (0.09, 0.11), 'top-right': (0.91, 0.11), 'center-top': (0.5, 0.38),
        'center': (0.5, 0.5), 'center-bottom': (0.5, 0.82),
    }
    lx, ly = pos_map.get(args.logo_position, (0.5, 0.38))
    # Override with custom ratios if provided
    if args.logo_x_ratio is not None: lx = args.logo_x_ratio
    if args.logo_y_ratio is not None: ly = args.logo_y_ratio
    print(f'[音画] Logo position: {args.logo_position} ({lx}, {ly})')

    # Spectrum setup
    n_bars = 64
    spec_rgb = hex_to_rgb(args.spectrum_color)

    # Title setup
    title_text = args.title or Path(args.audio).stem
    title_font_size = args.title_font_size if args.title_font_size > 0 else int(h * 0.045)
    # Try multiple Chinese fonts
    font_candidates = [
        args.title_font,
        '/System/Library/Fonts/PingFang.ttc',
        '/System/Library/Fonts/STHeiti Medium.ttc',
        '/System/Library/Fonts/Hiragino Sans GB.ttc',
        '/Library/Fonts/Arial Unicode.ttf',
    ]
    title_font = None
    for fp in font_candidates:
        if fp and os.path.exists(fp):
            try:
                title_font = ImageFont.truetype(fp, title_font_size)
                print(f'[音画] Title font: {fp}')
                break
            except: continue
    if not title_font:
        title_font = ImageFont.load_default()
        print('[音画] Warning: using default font (Chinese may not render)')
    title_rgb = hex_to_rgb(args.title_color)
    # 自适应标题宽度比例：竖屏宽一些，横屏窄一些
    if h > w:
        title_width_ratio = 0.92  # 竖屏（9:16等）充分利用宽度
    elif w > h:
        title_width_ratio = 0.65  # 横屏（16:9等）留出边距
    else:
        title_width_ratio = 0.80  # 方形
    title_max_width = int(w * title_width_ratio)
    title_date_text = (args.title_date or '').strip()
    title_date_font_size = args.title_date_font_size if args.title_date_font_size > 0 else max(0, title_font_size - 8)
    title_date_font = None
    if title_date_text:
        for fp in font_candidates:
            if fp and os.path.exists(fp):
                try:
                    title_date_font = ImageFont.truetype(fp, title_date_font_size)
                    break
                except: continue
        if not title_date_font:
            title_date_font = ImageFont.load_default()

    # Subtitle setup
    subs = parse_srt(args.subtitle)
    if subs:
        print(f'[音画] Loaded {len(subs)} subtitle entries')
    sub_font_size = args.subtitle_font_size if args.subtitle_font_size > 0 else int(h * 0.035)
    sub_font = None
    sub_font_candidates = [args.subtitle_font, '/Users/vangogh/Library/Fonts/SmileySans-Oblique.ttf', '/System/Library/Fonts/PingFang.ttc']
    for fp in sub_font_candidates:
        if fp and os.path.exists(fp):
            try:
                sub_font = ImageFont.truetype(fp, sub_font_size)
                break
            except: continue
    if not sub_font:
        sub_font = ImageFont.load_default()
    sub_rgb = hex_to_rgb(args.subtitle_color)
    sub_bottom_px = int(h * args.subtitle_bottom_ratio)
    # 始终用真实字体度量重新换行（忽略上游预换行）
    # 如果标题过长，自动缩小字号以保证不溢出
    raw_title = title_text.replace('\n', '').strip()
    title_lines = []
    if raw_title:
        for scale_pct in [100, 85, 72, 62]:
            scaled_size = max(16, int(title_font_size * scale_pct / 100))
            if scaled_size != title_font_size:
                try:
                    scaled_font = ImageFont.truetype(title_font.path, scaled_size)
                except:
                    scaled_font = title_font
            else:
                scaled_font = title_font
            lines_try = wrap_text(scaled_font, raw_title, title_max_width)
            # 检查每行是否都在宽度内（wrap_text 已保证，但双重确认）
            if all(scaled_font.getbbox(l)[2] <= title_max_width for l in lines_try):
                title_lines = lines_try
                if scaled_size != title_font_size:
                    title_font_size = scaled_size
                    title_font = scaled_font
                    title_line_h = title_font_size + args.title_line_spacing
                break
        if not title_lines:
            title_lines = wrap_text(title_font, raw_title, title_max_width)
    title_line_h = title_font_size + args.title_line_spacing

    # Tag text
    tag_font = None
    if args.tag_text:
        try:
            tag_font_size = int(h * 0.048)
            tag_font = ImageFont.truetype('/System/Library/Fonts/PingFang.ttc', tag_font_size)
        except:
            tag_font = ImageFont.load_default()

    # FFmpeg pipe
    enc_cmd = [
        FFMPEG, '-y', '-v', 'warning',
        '-f', 'rawvideo', '-vcodec', 'rawvideo', '-s', f'{w}x{h}', '-pix_fmt', 'rgb24',
        '-r', str(fps), '-i', '-',
        '-i', args.audio,
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '28', '-threads', '0', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '160k', '-ac', '2',
        '-filter:a', f'atempo={args.speed}',
        '-shortest', '-movflags', '+faststart',
        args.output
    ]
    enc = subprocess.Popen(enc_cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)

    print(f'[音画] Rendering {total_frames} frames...')
    # Logo setup (static or rotating)
    logo_display = None
    circle_mask = None
    logo_rotate = args.logo_rotate == 1
    if logo_img:
        logo_display = logo_img.resize((logo_size, logo_size), Image.LANCZOS)
        # Anti-aliased circle mask via 2x supersampling
        mask_hi = Image.new('L', (logo_size * 2, logo_size * 2), 0)
        ImageDraw.Draw(mask_hi).ellipse((0, 0, logo_size * 2 - 1, logo_size * 2 - 1), fill=255)
        circle_mask = mask_hi.resize((logo_size, logo_size), Image.LANCZOS)
    lx_px = int(w * lx - logo_size / 2)
    ly_px = int(h * ly - logo_size / 2)
    lcx = lx_px + logo_size // 2
    lcy = ly_px + logo_size // 2

    # Precompute a smooth anti-aliased ring around the logo for radial spectrum
    radial_ring_mask = None
    if args.spectrum_style == 'radial' and logo_img and logo_size > 4:
        ring_width = max(6, logo_size // 24)
        ring_mask_img = Image.new('L', (w, h), 0)
        ring_md = ImageDraw.Draw(ring_mask_img)
        outer_r = logo_size // 2 + ring_width // 2
        inner_r = max(0, logo_size // 2 - ring_width // 2)
        ring_md.ellipse([lcx - outer_r, lcy - outer_r, lcx + outer_r, lcy + outer_r], fill=255)
        if inner_r > 0:
            ring_md.ellipse([lcx - inner_r, lcy - inner_r, lcx + inner_r, lcy + inner_r], fill=0)
        radial_ring_mask = ring_mask_img.filter(ImageFilter.GaussianBlur(radius=2.0))

    # Pre-compute all spectrum frames for performance
    print(f'[音画] Pre-computing {total_frames} spectrum frames...')
    all_bars = []
    for f_idx in range(total_frames):
        t = f_idx / fps
        all_bars.append(compute_spectrum_frame(audio, sr, t, fps, n_bars))
    print(f'[音画] Spectrum pre-computed, starting render...')

    # Pre-compute watermarked cover if watermark text is set
    if args.watermark_text:
        cover = draw_watermark(cover, args.watermark_text, spacing_ratio=args.watermark_density, angle_deg=args.watermark_angle, opacity=args.watermark_opacity)
        print(f"[音画] Watermark applied: {args.watermark_text}")

    # Pre-compute disclaimer font
    disclaimer_font = None
    disclaimer_y_fn = None
    if args.disclaimer_text:
        dm_font_size = max(12, int(w * 0.022))
        try:
            disclaimer_font = ImageFont.truetype('/Users/vangogh/Library/Fonts/DingTalkJinBuTi-Regular.ttf', dm_font_size)
        except Exception:
            disclaimer_font = ImageFont.load_default()

    for f_idx in range(total_frames):
        t = f_idx / fps
        frame = cover.copy()
        draw = ImageDraw.Draw(frame)

        # Spectrum (choose style)
        if args.spectrum_style != 'none':
            bars = all_bars[f_idx]
            if args.spectrum_style == 'bars':
                draw_bottom_spectrum(draw, w, h, bars, spec_rgb)
            elif args.spectrum_style == 'radial':
                draw_radial_spectrum(draw, lx_px + logo_size // 2, ly_px + logo_size // 2, bars, spec_rgb, w, h, max_radius=int(min(h, w) * 0.3), logo_radius=logo_size // 2)
                if radial_ring_mask is not None:
                    overlay = Image.new('RGB', (w, h), spec_rgb)
                    frame.paste(overlay, (0, 0), radial_ring_mask)
            elif args.spectrum_style == 'rings':
                draw_spectrum_rings(draw, lx_px + logo_size // 2, ly_px + logo_size // 2, bars, t, logo_radius=logo_size // 2)
            elif args.spectrum_style == 'radar':
                draw_radar_spectrum(draw, lx_px + logo_size // 2, ly_px + logo_size // 2, bars, w, h, max_radius=int(min(h, w) * 0.175))
            elif args.spectrum_style == 'wave':
                draw_rainbow_wave(draw, w, h, bars)
            elif args.spectrum_style == 'pulse':
                draw_pulse_rings(frame, lcx, lcy, bars, t, logo_radius=logo_size // 2)

        # Logo (static or rotating) with optional shake
        if logo_img:
            shake_x, shake_y = 0, 0
            if args.spectrum_style == 'pulse' and logo_size > 10:
                shake_x = random.randint(-2, 2)
                shake_y = random.randint(-1, 3)
            if logo_rotate:
                angle = (t * args.logo_rotate_speed) / args.speed  # degrees per second, compensated for playback speed
                rotated = logo_display.rotate(angle, resample=Image.BICUBIC, expand=False, center=(logo_size // 2, logo_size // 2))
                frame.paste(rotated, (lx_px + shake_x, ly_px + shake_y), circle_mask)
            else:
                frame.paste(logo_display, (lx_px + shake_x, ly_px + shake_y), circle_mask)

        # Tag text
        if args.tag_text and tag_font:
            tx, ty = int(w * 0.042), int(h * 0.056)
            draw_text_with_effects(draw, args.tag_text, tag_font, tx, ty,
                                   fill=(255, 255, 255, 191), stroke_width=4, stroke_fill=(0, 0, 0, 191), shadow_offset=4)

        # Title text - centered, upper area
        title_block_h = len(title_lines) * title_line_h
        if title_date_text:
            title_block_h += title_date_font_size + args.title_line_spacing
        title_y = max(0, min(int(h * args.title_y_ratio), max(0, h - title_block_h)))
        for line in title_lines:
            line_w = title_font.getbbox(line)[2] + (len(line) - 1) * args.title_letter_spacing
            title_x = (w - line_w) // 2
            if args.title_letter_spacing > 0:
                draw_text_letter_spacing(draw, line, title_font, title_x, title_y,
                                         fill=(*title_rgb, 255),
                                         stroke_width=args.title_stroke_width if args.title_stroke_enabled else 0,
                                         stroke_fill=(0, 0, 0, 255) if args.title_stroke_enabled else None,
                                         shadow_offset=args.title_shadow_width if args.title_shadow_enabled else 0,
                                         letter_spacing=args.title_letter_spacing)
            else:
                draw_text_with_effects(draw, line, title_font, title_x, title_y,
                                       fill=(*title_rgb, 255),
                                       stroke_width=args.title_stroke_width if args.title_stroke_enabled else 0,
                                       stroke_fill=(0, 0, 0, 255) if args.title_stroke_enabled else None,
                                       shadow_offset=args.title_shadow_width if args.title_shadow_enabled else 0)
            title_y += title_line_h

        if title_date_text and title_date_font:
            date_line_w = title_date_font.getbbox(title_date_text)[2] + (len(title_date_text) - 1) * args.title_letter_spacing
            date_x = (w - date_line_w) // 2
            if args.title_letter_spacing > 0:
                draw_text_letter_spacing(draw, title_date_text, title_date_font, date_x, title_y,
                                         fill=(*title_rgb, 255),
                                         stroke_width=args.title_stroke_width if args.title_stroke_enabled else 0,
                                         stroke_fill=(0, 0, 0, 255) if args.title_stroke_enabled else None,
                                         shadow_offset=args.title_shadow_width if args.title_shadow_enabled else 0,
                                         letter_spacing=args.title_letter_spacing)
            else:
                draw_text_with_effects(draw, title_date_text, title_date_font, date_x, title_y,
                                       fill=(*title_rgb, 255),
                                       stroke_width=args.title_stroke_width if args.title_stroke_enabled else 0,
                                       stroke_fill=(0, 0, 0, 255) if args.title_stroke_enabled else None,
                                       shadow_offset=args.title_shadow_width if args.title_shadow_enabled else 0)

        # Subtitle text
        if subs:
            sub_text = get_subtitle_for_time(subs, t)
            if sub_text:
                sub_max_w = int(w * 0.8)
                sub_lines = wrap_text(sub_font, sub_text, sub_max_w)
                sub_line_h = sub_font_size + 6
                sub_total_h = len(sub_lines) * sub_line_h
                sub_y_start = h - sub_bottom_px - sub_total_h
                for si, sline in enumerate(sub_lines):
                    sline_w = sub_font.getbbox(sline)[2]
                    sx = (w - sline_w) // 2
                    sy = sub_y_start + si * sub_line_h
                    draw_text_with_effects(draw, sline, sub_font, sx, sy,
                                           fill=(*sub_rgb, 255),
                                           stroke_width=args.subtitle_stroke_width,
                                           stroke_fill=(0, 0, 0, 255),
                                           shadow_offset=2)

        # Disclaimer text (alpha-blended for correct opacity in yuv420p output)
        if args.disclaimer_text and disclaimer_font:
            dm_bbox = disclaimer_font.getbbox(args.disclaimer_text)
            dm_tw = dm_bbox[2] - dm_bbox[0]
            dm_th = dm_bbox[3] - dm_bbox[1]
            pad = max(40, int(h * 0.10))
            pos = args.disclaimer_position
            if 'left' in pos:
                dm_x = pad
            elif 'right' in pos:
                dm_x = w - dm_tw - pad
            else:
                dm_x = (w - dm_tw) // 2
            if 'top' in pos:
                dm_y = pad
            else:
                dm_y = h - dm_th - pad
            dm_ratio = args.disclaimer_opacity / 255.0
            dm_layer = Image.new('RGBA', (w, h), (0, 0, 0, 0))
            dm_draw = ImageDraw.Draw(dm_layer)
            draw_text_with_effects(dm_draw, args.disclaimer_text, disclaimer_font, dm_x, dm_y,
                                   fill=(255, 255, 255, 255), stroke_width=2, stroke_fill=(0, 0, 0, 255), shadow_offset=1)
            dm_layer = Image.blend(Image.new('RGBA', (w, h), (0, 0, 0, 0)), dm_layer, dm_ratio)
            frame = Image.alpha_composite(frame, dm_layer)

        # Convert RGBA to RGB so FFmpeg doesn't re-composite alpha on black
        if frame.mode == 'RGBA':
            bg = Image.new('RGB', frame.size, (0, 0, 0))
            bg.paste(frame, mask=frame.split()[3])
            frame = bg
        enc.stdin.write(frame.tobytes())
        if f_idx % (fps * 2) == 0:  # Report every 2 seconds
            pct = f_idx / total_frames * 100
            print(f'[PROGRESS] {pct:.1f}', flush=True)

    enc.stdin.close()
    enc.wait()
    print(f'[音画] Done: {args.output}')
    return 0

if __name__ == '__main__':
    sys.exit(main())
