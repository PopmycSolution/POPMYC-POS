#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Generates the POPMYC POS application icon (icon.ico) using Python/Pillow.
    Creates a professional multi-resolution ICO file from the brand colours.

    Output: desktop/resources/icon.ico

.DESCRIPTION
    Run from the project root:
        .\scripts\generate-icon.ps1

    For production, replace the generated icon with the official POPMYC POS
    brand icon file (same path: desktop/resources/icon.ico).
    The icon must be a valid Windows ICO with at least 256x256 pixels.
#>

$ErrorActionPreference = "Stop"
$Root      = Split-Path -Parent $PSScriptRoot
$IconPath  = Join-Path $Root "desktop\resources\icon.ico"
$Runtime   = Join-Path $Root "desktop\runtime\python\python.exe"
$VenvProd  = Join-Path $Root "backend\.venv-prod\Scripts\python.exe"

# Choose Python
$Python = $null
if (Test-Path $Runtime)  { $Python = $Runtime }
elseif (Test-Path $VenvProd) { $Python = $VenvProd }
else { $Python = "python" }

Write-Host "Generating icon using: $Python" -ForegroundColor Cyan

$iconScript = @"
"""Generate a multi-resolution POPMYC POS icon.ico using Pillow.
Uses BMP sub-images for maximum ICO compatibility (not PNG compression).
electron-builder requires at least one 256x256 image."""
import struct, os, sys
from PIL import Image, ImageDraw

OUTPUT = sys.argv[1] if len(sys.argv) > 1 else "icon.ico"

DARK_TEAL = (0, 77, 64)
MID_TEAL  = (0, 137, 123)
MINT      = (78, 204, 163)
WHITE     = (255, 255, 255)

def draw_icon(size):
    img  = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    pad  = max(2, size // 10)
    draw.rounded_rectangle([pad, pad, size-pad, size-pad], radius=size//4, fill=DARK_TEAL)
    cx, cy = size//2, size//2
    ir = size//3
    draw.ellipse([cx-ir, cy-ir, cx+ir, cy+ir], fill=MID_TEAL)
    cw, ch = size//2, size//3
    cx2, cy2 = cx-cw//2, cy-ch//4
    st = max(1, size//24)
    draw.rectangle([cx2, cy2, cx2+cw, cy2+ch], outline=WHITE, fill=MINT, width=st)
    wr = max(2, size//10)
    for wx in [cx2+cw//5, cx2+cw-cw//5]:
        wy = cy2+ch+wr
        draw.ellipse([wx-wr, wy-wr, wx+wr, wy+wr], fill=WHITE)
    return img.convert("RGBA")

def image_to_bmp_data(img):
    w, h = img.size
    hdr = struct.pack("<LLLHHLLLLLL", 40, w, h*2, 1, 32, 0, 0, 0, 0, 0, 0)
    pixels = bytearray()
    for row in reversed(range(h)):
        for col in range(w):
            r, g, b, a = img.getpixel((col, row))
            pixels += bytes([b, g, r, a])
    and_row = ((w + 31)//32)*4
    return hdr + bytes(pixels) + bytes(and_row * h)

sizes  = [16, 32, 48, 64, 128, 256]
imgs   = [draw_icon(s) for s in sizes]
datas  = [image_to_bmp_data(img) for img in imgs]
num    = len(sizes)
hdr_sz = 6 + 16 * num
offset = hdr_sz
ico_hdr = struct.pack("<HHH", 0, 1, num)
directory = bytearray()
for i, size in enumerate(sizes):
    wf = 0 if size == 256 else size
    directory += struct.pack("<BBBBHHLL", wf, wf, 0, 0, 1, 32, len(datas[i]), offset)
    offset += len(datas[i])
with open(OUTPUT, "wb") as f:
    f.write(ico_hdr + bytes(directory) + b"".join(datas))
sz = os.path.getsize(OUTPUT)
print(f"Icon saved: {OUTPUT} ({sz/1024:.0f} KB) sizes={sizes}")
"@

# Write temp script
$tmpScript = Join-Path $env:TEMP "popmyc_gen_icon.py"
$iconScript | Set-Content -Path $tmpScript -Encoding UTF8

Write-Host "Generating icon at: $IconPath"
& $Python $tmpScript $IconPath 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "Icon generation failed. Please provide icon.ico manually." -ForegroundColor Yellow
} else {
    $iconSize = (Get-Item $IconPath).Length
    Write-Host "Icon generated: $([math]::Round($iconSize/1KB, 1)) KB" -ForegroundColor Green
    Write-Host ""
    Write-Host "NOTE: Replace desktop/resources/icon.ico with the official" -ForegroundColor Yellow
    Write-Host "      POPMYC brand icon before final production distribution." -ForegroundColor Yellow
}

Remove-Item $tmpScript -ErrorAction SilentlyContinue
