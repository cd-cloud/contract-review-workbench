import struct
import zlib

def png_chunk(chunk_type, data):
    chunk = chunk_type + data
    crc = zlib.crc32(chunk) & 0xffffffff
    return struct.pack(">I", len(data)) + chunk + struct.pack(">I", crc)

def create_png_rgba(width, height, pixels):
    raw = b''
    for y in range(height):
        raw += b'\x00'
        for x in range(width):
            raw += bytes(pixels[y * width + x])
    compressed = zlib.compress(raw, 9)
    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return sig + png_chunk(b'IHDR', ihdr) + png_chunk(b'IDAT', compressed) + png_chunk(b'IEND', b'')

def fill_rect(pixels, w, h, x1, y1, x2, y2, color):
    for y in range(max(0, y1), min(h, y2)):
        for x in range(max(0, x1), min(w, x2)):
            pixels[y * w + x] = color

def fill_circle(pixels, w, h, cx, cy, r, color):
    r2 = r * r
    for y in range(max(0, cy - r), min(h, cy + r + 1)):
        for x in range(max(0, cx - r), min(w, cx + r + 1)):
            if (x - cx) ** 2 + (y - cy) ** 2 <= r2:
                pixels[y * w + x] = color

W, H = 256, 256
T = (0, 0, 0, 0)
WHT = (255, 255, 255, 255)

# Option 1: Blue Shield + Document
px = [T] * (W * H)
fill_circle(px, W, H, 128, 118, 100, (59, 130, 246, 255))
# Cut bottom to make shield shape: remove below y=180 except center
for y in range(180, H):
    for x in range(W):
        if abs(x - 128) > (H - y) * 0.9:
            px[y * W + x] = T
fill_rect(px, W, H, 88, 70, 168, 190, WHT)
fill_rect(px, W, H, 104, 95, 152, 103, (59, 130, 246, 255))
fill_rect(px, W, H, 104, 115, 152, 123, (59, 130, 246, 255))
fill_rect(px, W, H, 104, 135, 140, 143, (59, 130, 246, 255))
with open('options/icon-option1-shield-doc.png', 'wb') as f:
    f.write(create_png_rgba(W, H, px))

# Option 2: Green Circle + Check
px = [T] * (W * H)
fill_circle(px, W, H, 128, 128, 108, (16, 185, 129, 255))
# Thick checkmark by drawing multiple lines
for t in range(-8, 9):
    pts = [(78, 128+t), (110, 160+t), (178, 88+t)]
    for i in range(len(pts)-1):
        x0,y0 = pts[i]
        x1,y1 = pts[i+1]
        steps = max(abs(x1-x0), abs(y1-y0)) + 1
        for s in range(steps):
            u = s/steps
            x = int(x0 + (x1-x0)*u)
            y = int(y0 + (y1-y0)*u)
            if 0 <= x < W and 0 <= y < H:
                px[y*W+x] = WHT
with open('options/icon-option2-check-green.png', 'wb') as f:
    f.write(create_png_rgba(W, H, px))

# Option 3: Purple Book
px = [T] * (W * H)
fill_rect(px, W, H, 52, 36, 204, 220, (124, 58, 237, 255))
fill_rect(px, W, H, 64, 48, 192, 208, (139, 92, 246, 255))
fill_rect(px, W, H, 90, 82, 166, 90, WHT)
fill_rect(px, W, H, 90, 104, 166, 112, WHT)
fill_rect(px, W, H, 90, 126, 150, 134, WHT)
fill_rect(px, W, H, 90, 148, 140, 156, WHT)
with open('options/icon-option3-lawbook.png', 'wb') as f:
    f.write(create_png_rgba(W, H, px))

# Option 4: Red Seal
px = [T] * (W * H)
fill_circle(px, W, H, 128, 128, 100, (220, 38, 38, 255))
fill_circle(px, W, H, 128, 128, 86, T)
fill_circle(px, W, H, 128, 128, 78, (220, 38, 38, 255))
fill_rect(px, W, H, 88, 72, 168, 184, (220, 38, 38, 255))
fill_rect(px, W, H, 108, 96, 148, 104, WHT)
fill_rect(px, W, H, 108, 118, 148, 126, WHT)
fill_rect(px, W, H, 108, 140, 138, 148, WHT)
with open('options/icon-option4-red-seal.png', 'wb') as f:
    f.write(create_png_rgba(W, H, px))

# Option 5: Dark Blue Hex-Tech
px = [T] * (W * H)
fill_circle(px, W, H, 128, 128, 110, (30, 58, 138, 255))
fill_circle(px, W, H, 128, 128, 90, (37, 99, 235, 255))
fill_rect(px, W, H, 86, 92, 170, 100, WHT)
fill_rect(px, W, H, 86, 114, 170, 122, WHT)
fill_rect(px, W, H, 86, 136, 150, 144, WHT)
fill_rect(px, W, H, 86, 158, 130, 166, WHT)
with open('options/icon-option5-hex-tech.png', 'wb') as f:
    f.write(create_png_rgba(W, H, px))

print("Generated 5 icon options in options/")
