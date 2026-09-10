#!/usr/bin/env python3
"""Regenerate the Sophi-A wordmark lockups from brand/favicon-src.svg (the transparent mark) plus
the project's own Space Grotesk / IBM Plex Sans font files. Run from the repo root or from
brand/ - paths below are resolved relative to this file, not the cwd.

Not wired into any build step on purpose - these are marketing/README assets, not app assets
(compare src/styles.css's own @font-face setup, which IS load-bearing for the running app and
stays untouched here). Re-run by hand after editing brand/sophi-a-mark.svg or public/favicon.svg.
"""
import os
import gi

gi.require_version("Rsvg", "2.0")
from gi.repository import Rsvg
import cairo
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)

BG = (10, 9, 8, 255)  # #0a0908, matches --bg exactly
GOLD_BRIGHT = (233, 201, 127, 255)  # #e9c97f, matches --gold-bright exactly
TEXT_SECONDARY = (179, 172, 156, 255)  # #b3ac9c, matches --text-secondary exactly

FONT_BOLD = os.path.join(REPO, "src/fonts/SpaceGrotesk/SpaceGrotesk-Bold.ttf")
FONT_BODY = os.path.join(REPO, "src/fonts/IBMPlexSans/IBMPlexSans-Regular.ttf")
MARK_SVG = os.path.join(REPO, "public/favicon.svg")  # transparent variant - see its own header


def render_svg(path, size):
    handle = Rsvg.Handle.new_from_file(path)
    dim = handle.get_dimensions()
    surface = cairo.ImageSurface(cairo.FORMAT_ARGB32, size, size)
    ctx = cairo.Context(surface)
    ctx.scale(size / dim.width, size / dim.height)
    handle.render_cairo(ctx)
    buf = surface.get_data()
    return Image.frombuffer("RGBA", (size, size), bytes(buf), "raw", "BGRA", 0, 1)


def horizontal_lockup():
    """README header / wide banner: mark left, wordmark + tagline right."""
    W, H = 1400, 400
    canvas = Image.new("RGBA", (W, H), BG)
    mark = render_svg(MARK_SVG, 320)
    canvas.alpha_composite(mark, (60, (H - 320) // 2))

    draw = ImageDraw.Draw(canvas)
    title_font = ImageFont.truetype(FONT_BOLD, 96)
    tag_font = ImageFont.truetype(FONT_BODY, 30)

    text_x = 60 + 320 + 50
    title_bbox = draw.textbbox((0, 0), "Sophi-A", font=title_font)
    title_h = title_bbox[3] - title_bbox[1]
    tag = "the AI harness for the models you already pay for"
    tag_bbox = draw.textbbox((0, 0), tag, font=tag_font)
    tag_h = tag_bbox[3] - tag_bbox[1]
    gap = 22
    block_h = title_h + gap + tag_h
    top = (H - block_h) // 2

    draw.text((text_x, top - title_bbox[1]), "Sophi-A", font=title_font, fill=GOLD_BRIGHT)
    draw.text(
        (text_x, top + title_h + gap - tag_bbox[1]),
        tag,
        font=tag_font,
        fill=TEXT_SECONDARY,
    )
    canvas.convert("RGB").save(os.path.join(HERE, "sophi-a-lockup-horizontal.png"))


def square_lockup():
    """Stripe product image / social share card: mark centered, wordmark below."""
    S = 1000
    canvas = Image.new("RGBA", (S, S), BG)
    mark = render_svg(MARK_SVG, 520)
    canvas.alpha_composite(mark, ((S - 520) // 2, 130))

    draw = ImageDraw.Draw(canvas)
    title_font = ImageFont.truetype(FONT_BOLD, 100)
    title_bbox = draw.textbbox((0, 0), "Sophi-A", font=title_font)
    title_w = title_bbox[2] - title_bbox[0]
    title_h = title_bbox[3] - title_bbox[1]
    draw.text(
        ((S - title_w) // 2 - title_bbox[0], 700 - title_bbox[1]),
        "Sophi-A",
        font=title_font,
        fill=GOLD_BRIGHT,
    )

    tag_font = ImageFont.truetype(FONT_BODY, 32)
    tag = "one build, one price, every model you already pay for"
    tag_bbox = draw.textbbox((0, 0), tag, font=tag_font)
    tag_w = tag_bbox[2] - tag_bbox[0]
    draw.text(
        ((S - tag_w) // 2 - tag_bbox[0], 700 + title_h + 40 - tag_bbox[1]),
        tag,
        font=tag_font,
        fill=TEXT_SECONDARY,
    )
    canvas.convert("RGB").save(os.path.join(HERE, "sophi-a-lockup-square.png"))


if __name__ == "__main__":
    horizontal_lockup()
    square_lockup()
    print("wrote sophi-a-lockup-horizontal.png, sophi-a-lockup-square.png")
