"""Procedural, seamless PBR texture generator for How It's Built.

Every set is written to public/tex/<name>/{albedo,normal,rough}.jpg (tileable).
Deterministic (fixed seeds). Run: python3 tools/texgen.py [name ...]
"""
import os, sys
import numpy as np
from PIL import Image
from scipy.spatial import cKDTree
from scipy.ndimage import gaussian_filter

N = 1024
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'tex')


# ---------------------------------------------------------------- noise helpers
def periodic_grid_noise(n, cells, rng):
    """Bicubic-ish smooth value noise that tiles (cells divides the period)."""
    g = rng.random((cells, cells))
    x = np.arange(n) * cells / n
    i0 = np.floor(x).astype(int)
    t = x - i0
    t = t * t * (3 - 2 * t)
    i1 = (i0 + 1) % cells
    i0 = i0 % cells
    a = g[np.ix_(i0, i0)] * (1 - t)[None, :] + g[np.ix_(i0, i1)] * t[None, :]
    b = g[np.ix_(i1, i0)] * (1 - t)[None, :] + g[np.ix_(i1, i1)] * t[None, :]
    return a * (1 - t)[:, None] + b * t[:, None]


def fbm(n, rng, base=4, octaves=6, gain=0.5):
    out = np.zeros((n, n))
    amp, tot, c = 1.0, 0.0, base
    for _ in range(octaves):
        if c > n:
            break
        out += amp * periodic_grid_noise(n, c, rng)
        tot += amp
        amp *= gain
        c *= 2
    return out / tot


def norm01(a):
    a = a - a.min()
    return a / (a.max() + 1e-9)


def blur_wrap(a, s):
    return gaussian_filter(a, s, mode='wrap')


def voronoi(n, count, rng, jitter=1.0, aspect=(1.0, 1.0)):
    """Periodic Voronoi: returns (cell id, F1, F2-F1 edge distance) in pixels."""
    pts = rng.random((count, 2))
    tiles = np.concatenate([pts + [dx, dy] for dx in (-1, 0, 1) for dy in (-1, 0, 1)])
    ids = np.tile(np.arange(count), 9)
    tree = cKDTree(tiles * [aspect[0], aspect[1]])
    yy, xx = np.mgrid[0:n, 0:n] / n
    q = np.stack([yy.ravel() * aspect[0], xx.ravel() * aspect[1]], 1)
    d, k = tree.query(q, k=2)
    cell = ids[k[:, 0]].reshape(n, n)
    f1 = d[:, 0].reshape(n, n) * n
    edge = (d[:, 1] - d[:, 0]).reshape(n, n) * n
    return cell, f1, edge


def height_to_normal(h, strength):
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5
    nx, ny, nz = -dx * strength, dy * strength, np.ones_like(h)
    l = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx / l, ny / l, nz / l], -1) * 0.5 + 0.5


def colorize(t, stops):
    """t in [0,1] -> RGB via list of (pos, (r,g,b)) stops, colors 0-255."""
    pos = np.array([s[0] for s in stops])
    cols = np.array([s[1] for s in stops], dtype=float) / 255
    out = np.zeros(t.shape + (3,))
    for c in range(3):
        out[..., c] = np.interp(t, pos, cols[:, c])
    return out


def save(name, albedo, height, rough, nstrength=6.0):
    d = os.path.join(OUT, name)
    os.makedirs(d, exist_ok=True)
    Image.fromarray((np.clip(albedo, 0, 1) * 255).astype(np.uint8)).save(f'{d}/albedo.jpg', quality=90)
    nm = height_to_normal(height, nstrength)
    Image.fromarray((nm * 255).astype(np.uint8)).save(f'{d}/normal.jpg', quality=92)
    Image.fromarray((np.clip(rough, 0, 1) * 255).astype(np.uint8), 'L').save(f'{d}/rough.jpg', quality=90)
    print('wrote', name)


# ---------------------------------------------------------------- generators
def masonry(name, rows, cols_per_row, stone_stops, mortar_rgb, seed, gap=0.012, bevel=0.03,
            irregular=0.25, chip=0.5, rough_base=0.85, mortar_depth=1.0):
    """Ashlar / brick-like courses with running bond, varied block lengths, chipped edges."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:N, 0:N] / N
    row = np.floor(yy * rows).astype(int)
    vy = yy * rows - row  # 0..1 within row
    # per-row random breaks, tileable horizontally
    block_id = np.zeros((N, N), int)
    u_in = np.zeros((N, N))
    w_block = np.zeros((N, N))
    nid = 0
    for r in range(rows):
        k = cols_per_row
        w = rng.random(k) * irregular + (1 - irregular / 2)
        edges = np.concatenate([[0], np.cumsum(w / w.sum())])
        off = rng.random() if r % 2 else (rng.random() * 0.3)
        m = row == r
        x = (xx[m] + off) % 1.0
        j = np.searchsorted(edges, x, side='right') - 1
        j = np.clip(j, 0, k - 1)
        block_id[m] = nid + j
        u_in[m] = (x - edges[j]) / (edges[j + 1] - edges[j])
        w_block[m] = (edges[j + 1] - edges[j])
        nid += k
    # distance to block edge in uv units (approx, in pixels)
    bw = w_block * N
    bh = N / rows
    dx = np.minimum(u_in, 1 - u_in) * bw
    dy = np.minimum(vy, 1 - vy) * bh
    edge = np.minimum(dx, dy)
    # chipped edges: perturb edge distance with noise
    nchip = fbm(N, rng, base=16, octaves=5) - 0.5
    edge_p = edge + nchip * chip * bh * 0.25
    g = gap * N
    mortar = edge_p < g
    # per-block colour + height variation
    nb = block_id.max() + 1
    tone = rng.random(nb)
    tilt_x = (rng.random(nb) - 0.5)
    tilt_y = (rng.random(nb) - 0.5)
    face_noise = fbm(N, rng, base=8, octaves=7)
    fine = fbm(N, rng, base=64, octaves=4)
    t = np.clip(0.55 * tone[block_id] + 0.35 * face_noise + 0.15 * fine, 0, 1)
    alb = colorize(t, stone_stops)
    # edge darkening / grime
    grime = np.clip(1 - (edge_p - g) / (bevel * N + 1e-6), 0, 1)
    alb *= (1 - 0.25 * grime[..., None])
    mort = np.array(mortar_rgb) / 255 * (0.85 + 0.3 * fbm(N, rng, base=32, octaves=4))[..., None]
    alb = np.where(mortar[..., None], mort, alb)
    # height
    bev = np.clip((edge_p - g) / (bevel * N), 0, 1)
    bev = np.sqrt(bev)
    h = bev * (0.75 + 0.15 * (tilt_x[block_id] * (u_in - 0.5) + tilt_y[block_id] * (vy - 0.5))) \
        + 0.18 * face_noise + 0.05 * fine
    h = np.where(mortar, -0.15 * mortar_depth + 0.05 * fine, h)
    rough = np.where(mortar, 0.95, rough_base - 0.1 * fine)
    # ambient occlusion-ish into albedo
    ao = blur_wrap(h, 6)
    alb *= (0.8 + 0.2 * norm01(ao))[..., None]
    save(name, alb, blur_wrap(h, 0.8), rough, nstrength=8)


def rubble(name, stops, mortar_rgb, seed, count=90, mortar_w=5.0):
    rng = np.random.default_rng(seed)
    cell, f1, edge = voronoi(N, count, rng, aspect=(1.0, 1.0))
    nn = fbm(N, rng, base=16, octaves=5)
    e = edge + (nn - 0.5) * 10
    tone = rng.random(count)
    face = fbm(N, rng, base=8, octaves=7)
    t = np.clip(0.55 * tone[cell] + 0.45 * face, 0, 1)
    alb = colorize(t, stops)
    mortar = e < mortar_w
    dome = np.clip(e / 40, 0, 1) ** 0.6
    h = dome * 0.8 + 0.2 * face
    mort = np.array(mortar_rgb) / 255 * (0.85 + 0.3 * fbm(N, rng, base=32, octaves=4))[..., None]
    alb = np.where(mortar[..., None], mort, alb * (0.75 + 0.25 * dome[..., None]))
    h = np.where(mortar, -0.1, h)
    rough = np.where(mortar, 0.95, 0.85 - 0.1 * face)
    save(name, alb, blur_wrap(h, 1), rough, nstrength=7)


def cobbles(name, stops, seed, count=160):
    rng = np.random.default_rng(seed)
    cell, f1, edge = voronoi(N, count, rng)
    face = fbm(N, rng, base=16, octaves=6)
    tone = rng.random(count)
    dome = np.clip(edge / 22, 0, 1) ** 0.5
    t = np.clip(0.6 * tone[cell] + 0.4 * face, 0, 1)
    alb = colorize(t, stops) * (0.55 + 0.45 * dome[..., None])
    gap = edge < 2.5
    dirt = np.array([70, 60, 48]) / 255
    alb = np.where(gap[..., None], dirt, alb)
    h = np.where(gap, -0.2, dome + 0.1 * face)
    save(name, alb, blur_wrap(h, 1), np.where(gap, 1.0, 0.7 - 0.2 * face), nstrength=7)


def ground(name, stops, seed, base=6, grain=0.25, ripples=0.0, rough=0.95, nstrength=3.5, pebbles=0):
    rng = np.random.default_rng(seed)
    big = fbm(N, rng, base=base, octaves=7)
    fine = fbm(N, rng, base=128, octaves=3)
    t = np.clip(0.75 * big + grain * (fine - 0.5) + 0.1, 0, 1)
    h = big * 0.6 + fine * 0.4
    if ripples:
        yy, xx = np.mgrid[0:N, 0:N] / N
        warp = fbm(N, rng, base=4, octaves=3)
        r = np.sin((xx * 9 + yy * 3 + warp * 1.5) * 2 * np.pi * 2) * 0.5 + 0.5
        h = h + ripples * r
        t = np.clip(t + 0.08 * (r - 0.5), 0, 1)
    alb = colorize(t, stops)
    if pebbles:
        cell, f1, edge = voronoi(N, pebbles, rng)
        sel = rng.random(pebbles) < 0.35
        rad = rng.random(pebbles) * 5 + 3
        m = sel[cell] & (f1 < rad[cell])
        pc = colorize(rng.random(pebbles)[cell], [(0, (110, 100, 90)), (1, (190, 180, 165))])
        alb = np.where(m[..., None], pc * (0.7 + 0.3 * (1 - f1 / rad[cell]))[..., None], alb)
        h = np.where(m, h + 0.4 * (1 - f1 / rad[cell]), h)
    save(name, alb, h, rough - 0.1 * fine, nstrength=nstrength)


def grass(name, seed):
    rng = np.random.default_rng(seed)
    big = fbm(N, rng, base=6, octaves=6)
    # blades: many short vertical strokes at random positions/lengths
    blades = np.zeros((N, N))
    count = 60000
    xs = rng.integers(0, N, count); ys = rng.integers(0, N, count)
    ln = rng.integers(6, 22, count); val = rng.random(count)
    lean = rng.integers(-3, 4, count)
    for k in range(22):
        m = ln > k
        yy = (ys[m] - k) % N
        xx = (xs[m] + (lean[m] * k) // 22) % N
        blades[yy, xx] = np.maximum(blades[yy, xx], val[m] * (1 - k / 24))
    blades = blur_wrap(blades, 0.6)
    blades = norm01(blades + 0.25 * fbm(N, rng, base=128, octaves=2))
    t = np.clip(0.45 * big + 0.55 * blades, 0, 1)
    alb = colorize(t, [(0, (38, 60, 22)), (0.3, (62, 96, 34)), (0.6, (96, 132, 52)), (0.85, (132, 158, 70)), (1, (168, 176, 96))])
    dirt = big < 0.2
    alb = np.where(dirt[..., None], alb * 0.6 + np.array([96, 78, 52]) / 255 * 0.4, alb)
    save(name, alb, blades * 0.8 + big * 0.2, 0.92 - 0.1 * blades, nstrength=6)


def wood_planks(name, stops, seed, planks=6, rough=0.75):
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:N, 0:N] / N
    p = np.floor(yy * planks).astype(int)
    vy = yy * planks - p
    off = rng.random(planks)
    lens = rng.integers(1, 3, planks)
    seg = np.floor(((xx + off[p]) % 1.0) * lens[p]).astype(int)
    pid = p * 4 + seg
    tone = rng.random(planks * 4)
    warp = fbm(N, rng, base=4, octaves=4)
    rings = np.sin((vy * 18 + warp * 6 + tone[pid] * 10) * np.pi) * 0.5 + 0.5
    grain = fbm(N, rng, base=256, octaves=2)
    streak = np.array(Image.fromarray((rng.random((N, N // 32)) * 255).astype(np.uint8)).resize((N, N), Image.BILINEAR)) / 255
    t = np.clip(0.35 * rings + 0.3 * streak + 0.25 * tone[pid] + 0.1 * grain, 0, 1)
    alb = colorize(t, stops)
    gapy = np.minimum(vy, 1 - vy) * N / planks < 2
    u = ((xx + off[p]) % 1.0) * lens[p]
    gapx = np.minimum(u % 1, 1 - u % 1) * N / lens[p] < 1.5
    gap = gapy | gapx
    alb = np.where(gap[..., None], alb * 0.35, alb)
    h = np.where(gap, -0.3, 0.3 * rings + 0.3 * streak)
    save(name, alb, h, np.where(gap, 1.0, rough - 0.1 * streak), nstrength=4)


def bark(name, seed):
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:N, 0:N] / N
    warp = fbm(N, rng, base=4, octaves=4)
    ridges = np.abs(np.sin((xx * 14 + warp * 1.5) * np.pi))
    v = np.array(Image.fromarray((rng.random((N // 16, N)) * 255).astype(np.uint8)).resize((N, N), Image.BILINEAR)) / 255
    h = ridges * 0.6 + v * 0.4
    t = norm01(h)
    alb = colorize(t, [(0, (45, 32, 22)), (0.5, (92, 68, 46)), (1, (140, 112, 82))])
    save(name, alb, h, 0.9 + 0 * h, nstrength=8)


def roof_tiles(name, seed, rows=10, cols=12):
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:N, 0:N] / N
    r = np.floor(yy * rows).astype(int)
    vy = yy * rows - r
    x = (xx * cols + (r % 2) * 0.5) % cols
    c = np.floor(x).astype(int)
    u = x - c
    tid = r * cols + c
    tone = rng.random(rows * cols)
    curve = np.sin(u * np.pi) ** 0.7
    shade = 0.55 + 0.45 * vy
    t = np.clip(0.4 * tone[tid] + 0.3 * curve + 0.3 * fbm(N, rng, base=16, octaves=5), 0, 1)
    alb = colorize(t, [(0, (120, 52, 32)), (0.5, (168, 78, 46)), (1, (200, 110, 70))]) * shade[..., None]
    h = curve * 0.5 + vy * 0.5
    save(name, alb, h, 0.6 + 0.2 * (1 - curve), nstrength=6)


def concrete(name, seed, stops=None, forms=0):
    rng = np.random.default_rng(seed)
    big = fbm(N, rng, base=4, octaves=7)
    pores = fbm(N, rng, base=256, octaves=2)
    pits = pores > 0.78
    stops = stops or [(0, (120, 120, 116)), (0.5, (160, 158, 152)), (1, (195, 192, 186))]
    alb = colorize(np.clip(big * 0.8 + 0.2 * pores, 0, 1), stops)
    alb = np.where(pits[..., None], alb * 0.6, alb)
    h = big * 0.3 + pores * 0.2 - pits * 0.3
    if forms:  # formwork board lines
        yy = np.mgrid[0:N, 0:N][0] / N
        line = np.abs(((yy * forms) % 1) - 0.5) > 0.495
        alb = np.where(line[..., None], alb * 0.75, alb)
        h = h - line * 0.3
    save(name, alb, h, 0.9 - 0.15 * big, nstrength=3)


def metal(name, seed, base_rgb=(150, 155, 162), rust=0.0, brushed=True):
    rng = np.random.default_rng(seed)
    big = fbm(N, rng, base=4, octaves=6)
    if brushed:
        s = np.array(Image.fromarray((rng.random((N, N // 64)) * 255).astype(np.uint8)).resize((N, N), Image.BILINEAR)) / 255
    else:
        s = fbm(N, rng, base=64, octaves=3)
    alb = (np.array(base_rgb) / 255) * (0.85 + 0.15 * s + 0.1 * (big - 0.5))[..., None]
    rough = 0.35 + 0.15 * s
    h = s * 0.2
    if rust > 0:
        rm = np.clip((fbm(N, rng, base=8, octaves=7) - (1 - rust)) * 6, 0, 1)
        rc = colorize(fbm(N, rng, base=32, octaves=5), [(0, (90, 40, 20)), (0.5, (140, 70, 30)), (1, (180, 110, 60))])
        alb = alb * (1 - rm[..., None]) + rc * rm[..., None]
        rough = rough * (1 - rm) + 0.9 * rm
        h = h + rm * 0.4 * fbm(N, rng, base=64, octaves=3)
    save(name, alb, h, rough, nstrength=3)


def water(name, seed):
    rng = np.random.default_rng(seed)
    h = fbm(N, rng, base=8, octaves=6)
    alb = colorize(h, [(0, (20, 70, 90)), (1, (50, 120, 130))])
    save(name, alb, h, 0.08 + 0 * h, nstrength=10)


def snow(name, seed):
    rng = np.random.default_rng(seed)
    h = fbm(N, rng, base=6, octaves=7)
    sparkle = fbm(N, rng, base=256, octaves=1) > 0.82
    alb = colorize(h, [(0, (196, 210, 228)), (1, (246, 250, 255))])
    alb = np.where(sparkle[..., None], 1.0, alb)
    save(name, alb, h, 0.55 - 0.3 * sparkle, nstrength=3)


def plaster(name, stops, seed):
    rng = np.random.default_rng(seed)
    big = fbm(N, rng, base=6, octaves=7)
    stains = np.clip((fbm(N, rng, base=3, octaves=4) - 0.55) * 3, 0, 1)
    alb = colorize(big, stops) * (1 - 0.25 * stains[..., None])
    save(name, alb, big * 0.5, 0.85 + 0 * big, nstrength=4)


SANDSTONE = [(0, (168, 128, 82)), (0.4, (196, 158, 108)), (0.75, (214, 182, 132)), (1, (232, 206, 160))]
LIMESTONE = [(0, (150, 146, 136)), (0.4, (182, 178, 166)), (0.75, (204, 200, 188)), (1, (224, 220, 208))]
GREYSTONE = [(0, (96, 96, 98)), (0.4, (128, 126, 124)), (0.75, (152, 150, 146)), (1, (178, 176, 170))]
GRANITE = [(0, (88, 86, 90)), (0.5, (140, 136, 138)), (1, (190, 184, 182))]
TUFF = [(0, (150, 120, 88)), (0.5, (184, 152, 112)), (1, (210, 184, 140))]
BRICK = [(0, (110, 42, 28)), (0.5, (150, 64, 40)), (0.8, (172, 86, 56)), (1, (190, 110, 76))]
ROMAN_BRICK = [(0, (140, 70, 45)), (0.5, (176, 98, 62)), (1, (205, 132, 92))]
OAK = [(0, (92, 62, 36)), (0.5, (134, 94, 56)), (1, (176, 132, 86))]
PINE = [(0, (150, 110, 66)), (0.5, (190, 148, 96)), (1, (222, 186, 132))]

SETS = {
    'sandstone_blocks': lambda: masonry('sandstone_blocks', 6, 3, SANDSTONE, (196, 176, 140), 1, gap=0.006, bevel=0.04),
    'limestone_ashlar': lambda: masonry('limestone_ashlar', 8, 4, LIMESTONE, (170, 164, 150), 2, gap=0.008),
    'castle_stone': lambda: masonry('castle_stone', 10, 5, GREYSTONE, (150, 146, 136), 3, gap=0.010, irregular=0.6, chip=1.0),
    'granite_blocks': lambda: masonry('granite_blocks', 6, 3, GRANITE, (150, 148, 144), 4, gap=0.006),
    'tuff_blocks': lambda: masonry('tuff_blocks', 7, 3, TUFF, (190, 176, 150), 5, gap=0.007, irregular=0.4),
    'brick_red': lambda: masonry('brick_red', 16, 4, BRICK, (186, 178, 164), 6, gap=0.012, bevel=0.02, irregular=0.08, chip=0.3, rough_base=0.9),
    'roman_brick': lambda: masonry('roman_brick', 24, 3, ROMAN_BRICK, (200, 186, 160), 7, gap=0.016, bevel=0.02, irregular=0.15, chip=0.4),
    'rubble_wall': lambda: rubble('rubble_wall', GREYSTONE, (160, 154, 140), 8),
    'rubble_core': lambda: rubble('rubble_core', SANDSTONE, (190, 178, 150), 9, count=220, mortar_w=8),
    'cobblestones': lambda: cobbles('cobblestones', GRANITE, 10),
    'sand': lambda: ground('sand', [(0, (190, 152, 100)), (0.5, (218, 184, 132)), (1, (240, 214, 166))], 11, grain=0.55, ripples=0.35, nstrength=5),
    'dirt': lambda: ground('dirt', [(0, (78, 58, 40)), (0.5, (112, 86, 60)), (1, (146, 118, 86))], 12, pebbles=900),
    'gravel': lambda: ground('gravel', [(0, (110, 104, 96)), (1, (170, 164, 154))], 13, base=16, grain=0.5, pebbles=2500, nstrength=6),
    'grass': lambda: grass('grass', 14),
    'wood_oak': lambda: wood_planks('wood_oak', OAK, 15),
    'wood_pine': lambda: wood_planks('wood_pine', PINE, 16, planks=5),
    'bark': lambda: bark('bark', 17),
    'roof_tiles': lambda: roof_tiles('roof_tiles', 18),
    'concrete': lambda: concrete('concrete', 19),
    'concrete_formed': lambda: concrete('concrete_formed', 20, forms=6),
    'asphalt': lambda: concrete('asphalt', 21, stops=[(0, (40, 40, 42)), (0.6, (62, 62, 64)), (1, (92, 90, 88))]),
    'steel': lambda: metal('steel', 22),
    'steel_painted_red': lambda: metal('steel_painted_red', 23, base_rgb=(170, 50, 38), brushed=False),
    'steel_rusty': lambda: metal('steel_rusty', 24, base_rgb=(120, 118, 116), rust=0.6, brushed=False),
    'iron_dark': lambda: metal('iron_dark', 25, base_rgb=(70, 66, 62), rust=0.25, brushed=False),
    'water': lambda: water('water', 26),
    'snow': lambda: snow('snow', 27),
    'plaster_white': lambda: plaster('plaster_white', [(0, (200, 196, 186)), (1, (238, 234, 224))], 28),
    'plaster_ochre': lambda: plaster('plaster_ochre', [(0, (186, 146, 90)), (1, (222, 186, 128))], 29),
    'mud_brick': lambda: masonry('mud_brick', 12, 4, [(0, (140, 106, 70)), (1, (184, 150, 106))], (150, 120, 84), 30, gap=0.014, irregular=0.2, chip=1.2, rough_base=0.95),
}

def stone_face(name, stops, seed, chisel=0.35):
    """Single dressed stone surface (no joints) with chisel marks and pits — for big individual blocks."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:N, 0:N] / N
    big = fbm(N, rng, base=4, octaves=7)
    mid = fbm(N, rng, base=24, octaves=5)
    warp = fbm(N, rng, base=6, octaves=3)
    marks = np.abs(np.sin((xx * 0.7 + yy * 0.7 + warp * 0.4) * 2 * np.pi * 26))
    marks = (1 - marks) ** 6 * (mid > 0.45)
    pits = fbm(N, rng, base=192, octaves=2) > 0.8
    t = np.clip(0.6 * big + 0.3 * mid - 0.15 * marks, 0, 1)
    alb = colorize(t, stops) * (1 - 0.12 * pits[..., None])
    h = 0.5 * big + 0.3 * mid - chisel * marks - 0.2 * pits
    save(name, alb, h, 0.85 - 0.1 * mid, nstrength=5)


SETS.update({
    'stone_face_sand': lambda: stone_face('stone_face_sand', SANDSTONE, 31),
    'stone_face_lime': lambda: stone_face('stone_face_lime', LIMESTONE, 32),
    'stone_face_grey': lambda: stone_face('stone_face_grey', GREYSTONE, 33),
    'stone_face_tuff': lambda: stone_face('stone_face_tuff', TUFF, 34),
    'linen': lambda: plaster('linen', [(0, (200, 190, 168)), (1, (236, 228, 208))], 35),
    'rope': lambda: bark('rope', 36),
})


def tuff_carved(name, seed):
    """Hand-carved soft tuff: overlapping pick gouges in random directions + faint ash bedding + pumice specks."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:N, 0:N] / N
    big = fbm(N, rng, base=4, octaves=7)
    mid = fbm(N, rng, base=32, octaves=4)
    bed = np.sin((yy * 5 + 0.15 * fbm(N, rng, base=4, octaves=3)) * 2 * np.pi) * 0.5 + 0.5
    # pick gouges: voronoi cells, each with its own stroke direction -> scalloped tool marks
    cell, f1, edge = voronoi(N, 260, rng)
    ang = rng.random(260) * np.pi
    a = ang[cell]
    stripe = np.abs(np.sin((xx * np.cos(a) + yy * np.sin(a)) * 2 * np.pi * 70))
    gouge = (1 - stripe) ** 4 * 0.6 + np.clip(1 - edge / 10, 0, 1) * 0.5
    scallop = -(f1 / (f1.max() + 1e-9)) * 0.5
    pits = fbm(N, rng, base=256, octaves=2)
    specks = pits > 0.78
    t = np.clip(0.5 * big + 0.25 * mid + 0.18 * bed - 0.1 * gouge, 0, 1)
    stops = [(0, (152, 124, 94)), (0.45, (190, 162, 126)), (0.8, (216, 194, 156)), (1, (232, 214, 180))]
    alb = colorize(t, stops) * (1 - 0.18 * specks[..., None])
    alb = alb + (np.array([0.03, 0.0, -0.02]) * (bed[..., None] - 0.5))
    h = 0.35 * big + 0.25 * mid + scallop - 0.35 * gouge - 0.25 * specks
    save(name, alb, blur_wrap(h, 0.8), 0.92 - 0.08 * mid, nstrength=7)


def tuff_strata(name, seed):
    """Section face through volcanic ash deposits: horizontal bands of varied colour/grain, pumice clasts."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:N, 0:N] / N
    warp = fbm(N, rng, base=4, octaves=4)
    y = yy + 0.035 * (warp - 0.5)
    nb = 12
    band = np.floor(y * nb) % nb
    tone = rng.random(nb)
    grain = rng.random(nb)
    palette = np.array([(214, 196, 162), (196, 168, 132), (226, 212, 184), (184, 150, 118), (204, 178, 150), (170, 152, 136)]) / 255
    pick = rng.integers(0, len(palette), nb)
    base = palette[pick[band.astype(int)]]
    fine = fbm(N, rng, base=128, octaves=3)
    big = fbm(N, rng, base=6, octaves=6)
    lam = np.sin(y * nb * 2 * np.pi * 3) * 0.5 + 0.5
    cell, f1, edge = voronoi(N, 700, rng)
    rad = rng.random(700) * 4 + 1.5
    clast = (f1 < rad[cell]) & (rng.random(700)[cell] < grain[band.astype(int)] * 0.6)
    alb = base * (0.86 + 0.14 * big[..., None]) * (0.94 + 0.06 * lam[..., None]) * (0.92 + 0.08 * fine[..., None])
    alb = np.where(clast[..., None], alb * 1.08 + 0.03, alb)
    edgeb = np.abs(((y * nb) % 1) - 0.0) < 0.02
    alb = alb * (1 - 0.1 * edgeb[..., None])
    h = 0.3 * big + 0.3 * fine + 0.15 * lam + 0.3 * clast - 0.2 * edgeb
    save(name, alb, blur_wrap(h, 0.7), 0.93 - 0.06 * fine, nstrength=5)


def straw(name, seed):
    """Loose straw/hay on a floor."""
    rng = np.random.default_rng(seed)
    big = fbm(N, rng, base=6, octaves=5)
    acc = np.zeros((N, N)); val = np.zeros((N, N))
    count = 9000
    xs = rng.random(count) * N; ys = rng.random(count) * N
    ang = rng.random(count) * np.pi; ln = rng.random(count) * 50 + 20; v = rng.random(count)
    for k in range(60):
        m = ln > k
        px = ((xs[m] + np.cos(ang[m]) * k) % N).astype(int); py = ((ys[m] + np.sin(ang[m]) * k) % N).astype(int)
        acc[py, px] = np.maximum(acc[py, px], 0.5 + 0.5 * v[m]); val[py, px] = v[m]
    acc = blur_wrap(acc, 0.7)
    t = np.clip(0.4 * big + 0.6 * acc, 0, 1)
    alb = colorize(t, [(0, (92, 72, 40)), (0.4, (160, 130, 70)), (0.8, (210, 182, 110)), (1, (232, 210, 140))])
    save(name, alb, acc * 0.8 + 0.2 * big, 0.9 - 0.1 * acc, nstrength=6)


SETS.update({
    'tuff_carved': lambda: tuff_carved('tuff_carved', 41),
    'tuff_strata': lambda: tuff_strata('tuff_strata', 42),
    'straw': lambda: straw('straw', 43),
})


def ice(name, seed):
    """Clear-ish ice blocks: milky base, internal crack lines, tiny bubbles, faint frost."""
    rng = np.random.default_rng(seed)
    big = fbm(N, rng, base=4, octaves=6)
    frost = fbm(N, rng, base=48, octaves=4)
    cell, f1, edge = voronoi(N, 40, rng)
    crack = np.clip(1 - edge / 2.5, 0, 1)
    cell2, f12, edge2 = voronoi(N, 160, rng)
    crack2 = np.clip(1 - edge2 / 1.6, 0, 1) * (rng.random(160)[cell2] < 0.35)
    bub = fbm(N, rng, base=512, octaves=1) > 0.86
    t = np.clip(0.55 * big + 0.3 * frost + 0.35 * crack + 0.2 * crack2, 0, 1)
    alb = colorize(t, [(0, (150, 190, 214)), (0.5, (196, 222, 236)), (1, (244, 250, 255))])
    alb = np.where(bub[..., None], np.minimum(1, alb + 0.15), alb)
    h = 0.4 * big + 0.15 * frost - 0.5 * crack - 0.3 * crack2
    save(name, alb, blur_wrap(h, 0.6), 0.12 + 0.35 * frost + 0.3 * crack, nstrength=3)


def mud_plaster(name, seed):
    """Kahgel / sarooj render: smooth hand-trowelled earth with straw flecks, hairline cracks, trowel swirls."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:N, 0:N] / N
    big = fbm(N, rng, base=4, octaves=7)
    mid = fbm(N, rng, base=24, octaves=4)
    cell, f1, edge = voronoi(N, 70, rng)
    crack = np.clip(1 - edge / 1.4, 0, 1) * (rng.random(70)[cell] < 0.3)
    swirl = np.sin((xx * 9 + yy * 3 + 0.6 * fbm(N, rng, base=6, octaves=3)) * 2 * np.pi) * 0.5 + 0.5
    acc = np.zeros((N, N))
    count = 2600
    xs = rng.random(count) * N; ys = rng.random(count) * N; ang = rng.random(count) * np.pi; ln = rng.random(count) * 14 + 6
    for k in range(20):
        m = ln > k
        px = ((xs[m] + np.cos(ang[m]) * k) % N).astype(int); py = ((ys[m] + np.sin(ang[m]) * k) % N).astype(int)
        acc[py, px] = 1
    acc = blur_wrap(acc, 0.5)
    t = np.clip(0.6 * big + 0.25 * mid + 0.08 * swirl, 0, 1)
    alb = colorize(t, [(0, (150, 112, 74)), (0.45, (184, 146, 102)), (0.8, (206, 172, 126)), (1, (222, 192, 146))])
    alb = alb * (1 - 0.2 * crack[..., None]) + acc[..., None] * np.array([0.12, 0.10, 0.02])
    h = 0.3 * big + 0.2 * mid + 0.06 * swirl - 0.5 * crack + 0.15 * acc
    save(name, alb, blur_wrap(h, 0.7), 0.9 - 0.05 * swirl, nstrength=5)


def cracked_earth(name, seed):
    """Dry desert ground: sandy silt with polygonal shrinkage cracks and scattered pebbles."""
    rng = np.random.default_rng(seed)
    big = fbm(N, rng, base=5, octaves=7)
    fine = fbm(N, rng, base=96, octaves=3)
    cell, f1, edge = voronoi(N, 90, rng)
    crack = np.clip(1 - edge / 3.0, 0, 1) ** 1.5
    dome = -(f1 / (f1.max() + 1e-9))
    cellp, f1p, _ = voronoi(N, 900, rng)
    peb = (f1p < 2.5 + rng.random(900)[cellp] * 3) & (rng.random(900)[cellp] < 0.35)
    t = np.clip(0.55 * big + 0.3 * fine - 0.1 * dome, 0, 1)
    alb = colorize(t, [(0, (176, 138, 96)), (0.5, (206, 170, 124)), (1, (232, 204, 160))])
    alb = alb * (1 - 0.45 * crack[..., None])
    alb = np.where(peb[..., None], alb * 0.8, alb)
    h = 0.3 * big + 0.2 * fine + 0.25 * dome - 0.6 * crack + 0.3 * peb
    save(name, alb, blur_wrap(h, 0.7), 0.95 + 0 * h, nstrength=5)


SETS.update({
    'ice': lambda: ice('ice', 51),
    'mud_plaster': lambda: mud_plaster('mud_plaster', 52),
    'cracked_earth': lambda: cracked_earth('cracked_earth', 53),
})


if __name__ == '__main__':
    names = sys.argv[1:] or list(SETS)
    for n in names:
        SETS[n]()
