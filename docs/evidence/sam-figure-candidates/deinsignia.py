"""Remove the NASA insignia from the airplane-parts figure (tail meatball + bottom-right logo block).
Pixel geometry measured on the original 1168x765 image; prints every number it uses."""
import hashlib
import numpy as np
from PIL import Image

SRC = 'plane.jpg'
OUT = 'plane-noinsignia.jpg'
im = Image.open(SRC).convert('RGB')
a = np.asarray(im).astype(np.int32)
H, W, _ = a.shape
out = a.copy()
yy, xx = np.mgrid[0:H, 0:W]

# ---------- 1. Tail meatball ----------
CX, CY, R = 775.0, 214.5, 16.5          # meatball circle (measured: x 759..791, y 198..231)
R_FILL = R + 2.0                         # cover the anti-aliased rim
circle = (xx - CX) ** 2 + (yy - CY) ** 2 <= R_FILL ** 2
# The red chevron sticks out of the circle (top-right over the rudder end, bottom-left): red pixels near the circle.
near = (xx >= 750) & (xx <= 802) & (yy >= 192) & (yy <= 236)
red = near & (a[..., 0] > 100) & (a[..., 0] > a[..., 2] - 40) & (a[..., 1] < 140)
red_d = red.copy()
for dy in (-1, 0, 1):
    for dx in (-1, 0, 1):
        red_d |= np.roll(np.roll(red, dy, 0), dx, 1)
# Faint anti-aliased chevron pixels just outside the circle (reddish/purple blends of red with the tail blue).
close = ((xx - CX) ** 2 + (yy - CY) ** 2 <= (R_FILL + 5) ** 2) & (xx < 795)
faint = close & (a[..., 0] > 90) & (a[..., 2] < 210) & (a[..., 0] < 230)
mask = circle | (red_d & near) | faint

# Palette sampled from untouched pixels around the meatball.
def med(sel):
    return np.median(a[sel], axis=0).round().astype(np.int32)

ring = ((xx - CX) ** 2 + (yy - CY) ** 2 > (R_FILL + 1) ** 2) & ((xx - CX) ** 2 + (yy - CY) ** 2 <= (R_FILL + 8) ** 2) & ~mask
light = ring & (a[..., 2] > 200) & (a[..., 0] > 50) & (a[..., 0] < 90)
TAIL = med(light)
fus_sel = (xx >= 752) & (xx <= 790) & (yy >= 238) & (yy <= 240) & (a[..., 2] < 180) & (a[..., 2] > 140)
FUS = med(fus_sel)
rud_sel = (xx >= 794) & (xx <= 800) & (yy >= 182) & (yy <= 194) & (a[..., 2] < 120)
RUD = med(rud_sel)
print('tail blue', TAIL.tolist(), 'n', int(light.sum()), '| fuselage', FUS.tolist(), '| rudder', RUD.tolist())

# Fuselage top edge (line through untouched boundary points left and right of the circle).
def fuselage_top(x):
    # measured boundary points (x, y): (745, 241), (756, 238), (782, 232), (800, 230)
    xs = np.array([745, 756, 782, 800], float); ys = np.array([241, 238, 232, 230], float)
    m, c = np.polyfit(xs, ys, 1)
    return m * x + c

# Rudder strip (dark) edges above the circle, extended down to where the strip visibly ends (y ~ 202).
def rudder_left(y):   # x of the strip's left edge: (792, 186) .. (789, 195)
    return 792 + (y - 186) * (789 - 792) / (195 - 186)

def rudder_right(y):  # (803, 189) .. (800, 195)
    return 803 + (y - 189) * (800 - 803) / (195 - 189)

RUDDER_END_Y = 199
ys, xs = np.nonzero(mask)
n_tail = n_fus = n_rud = n_nn = 0
unmasked = ~mask
for y, x in zip(ys, xs):
    if circle[y, x]:
        if y >= fuselage_top(x) + 0.5:
            out[y, x] = FUS; n_fus += 1
        elif y <= RUDDER_END_Y and rudder_left(y) <= x <= rudder_right(y):
            out[y, x] = RUD; n_rud += 1
        else:
            out[y, x] = TAIL; n_tail += 1
    else:
        # chevron pixel outside the circle: copy the nearest untouched pixel (keeps the rudder / trailing edges)
        best = None
        for r in range(1, 6):
            y0, y1, x0, x1 = max(0, y - r), min(H, y + r + 1), max(0, x - r), min(W, x + r + 1)
            win = unmasked[y0:y1, x0:x1]
            if win.any():
                wy, wx = np.nonzero(win)
                d = (wy + y0 - y) ** 2 + (wx + x0 - x) ** 2
                k = int(np.argmin(d)); best = a[wy[k] + y0, wx[k] + x0]; break
        out[y, x] = best; n_nn += 1
# The rudder strip's lower end: a straight cut at RUDDER_END_Y (the visible end on its right side), tail blue below it.
end_n = 0
for y in range(196, 209):
    for x in range(784, 801):
        if rudder_left(y) - 0.5 <= x <= rudder_right(y) + 0.5 and (mask[y, x] or circle[y, x] or y > RUDDER_END_Y):
            if out[y, x].min() > 235:
                continue  # background white stays
            out[y, x] = RUD if y <= RUDDER_END_Y else TAIL
            mask[y, x] = True; end_n += 1
print('rudder-end pixels set:', end_n)
print('meatball pixels replaced:', int(mask.sum()), {'tail': n_tail, 'fuselage': n_fus, 'rudder': n_rud, 'nearest': n_nn})
mb = np.argwhere(mask)
print('meatball edit bbox x %d..%d y %d..%d' % (mb[:, 1].min(), mb[:, 1].max(), mb[:, 0].min(), mb[:, 0].max()))

# ---------- 2. Bottom-right logo block ('NASA' meatball + 'Glenn Research Center') ----------
LX1, LY1, LX2, LY2 = 900, 706, 1160, 762   # measured ink x 906..1151, y 715..757; nothing else below y 700
ink = (a[LY1:LY2, LX1:LX2].min(axis=2) < 235)
around = np.concatenate([a[698:704, 880:1168].reshape(-1, 3), a[762:765, 880:1168].reshape(-1, 3)])
WHITE = np.median(around, axis=0).round().astype(np.int32)
out[LY1:LY2, LX1:LX2] = WHITE
print('logo block filled', (LX1, LY1, LX2, LY2), 'with', WHITE.tolist(), 'ink px', int(ink.sum()))
left = a[LY1:LY2, 0:LX1].min(axis=2) < 235
print('non-white pixels elsewhere in rows %d..%d: %d' % (LY1, LY2, int(left.sum())))

img = Image.fromarray(out.astype(np.uint8), 'RGB')
img.save(OUT, quality=95, subsampling=0, optimize=True)  # metadata (EXIF/XMP/Photoshop) not carried over
b = open(OUT, 'rb').read()
print(OUT, img.size, len(b), 'bytes sha256', hashlib.sha256(b).hexdigest())
img.crop((730, 170, 830, 250)).resize((500, 400), Image.NEAREST).save('z_tail_after.png')
Image.fromarray(np.concatenate([a[170:250, 730:830], out[170:250, 730:830]], axis=1).astype(np.uint8)).resize((1000, 400), Image.NEAREST).save('z_tail_compare.png')
