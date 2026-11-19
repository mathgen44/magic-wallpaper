"""Génère le thème vidéo par défaut « Ciel » : aube, jour, coucher, nuit.

Plan fixe : ciel en dégradé vertical, collines en silhouette, halo du soleil ou de la lune
qui respire doucement, étoiles qui scintillent. Toutes les animations sont périodiques
sur la durée de la vidéo : la boucle est sans raccord.

    python scripts/theme-ciel.py [dossier de sortie]   (nécessite numpy et ffmpeg)
"""

import subprocess
import sys
from pathlib import Path

import numpy as np

W, H, FPS, SECONDS = 1920, 1080, 24, 20
FRAMES = FPS * SECONDS
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).parent.parent / "src-tauri" / "video-themes" / "Ciel")


def rgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i : i + 2], 16) for i in (0, 2, 4)], dtype=np.float32)


PHASES = {
    "aube": dict(
        sky=[(0, "#1b2550"), (0.45, "#5b4a8a"), (0.74, "#e59a8a"), (0.86, "#ffd3a0")],
        glow=((0.66, 0.80), "#ffcf9a", 0.38, 0.55), disc=None,
        stars=0.35, hills=("#55406e", "#2a2140"),
    ),
    "jour": dict(
        sky=[(0, "#2c69c9"), (0.5, "#5aa2ec"), (0.8, "#bfe0fa"), (0.9, "#e8f5ff")],
        glow=((0.76, 0.17), "#fffbe8", 0.26, 0.55), disc=((0.76, 0.17), "#fffdf2", 34),
        stars=0, hills=("#7c9cbc", "#3d6656"),
    ),
    "coucher": dict(
        sky=[(0, "#241046"), (0.38, "#7a2a6e"), (0.66, "#e0564a"), (0.8, "#ff9a4a"), (0.9, "#ffc46a")],
        glow=((0.34, 0.80), "#ffb060", 0.42, 0.7), disc=((0.34, 0.785), "#ffe2a8", 40),
        stars=0.15, hills=("#5a2848", "#240c22"),
    ),
    "nuit": dict(
        sky=[(0, "#03040e"), (0.55, "#0b1236"), (0.85, "#1c2452"), (0.92, "#26305e")],
        glow=((0.78, 0.20), "#c8d4ff", 0.14, 0.35), disc=((0.78, 0.20), "#eef2ff", 26),
        stars=1.0, hills=("#121a40", "#05081c"),
    ),
}

ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
rng = np.random.default_rng(7)
DITHER = rng.uniform(-1.2, 1.2, (H, W, 1)).astype(np.float32)  # évite les bandes du dégradé
# Étoiles : position, éclat, vitesse (entière : boucle exacte) et phase du scintillement.
N = 420
STARS = dict(
    x=rng.integers(0, W, N), y=(rng.random(N) ** 1.6 * H * 0.7).astype(int),
    b=rng.uniform(0.25, 1, N), k=rng.integers(1, 4, N), p=rng.uniform(0, 2 * np.pi, N),
)


def ridge(base, amp, seed):
    r = np.random.default_rng(seed)
    x = np.arange(W, dtype=np.float32)
    y = np.full(W, base * H, dtype=np.float32)
    for i in range(5):
        f = (i + 1) * r.uniform(0.6, 1.4) * 2 * np.pi / W
        y += amp * r.uniform(0.3, 1) / (i + 1) * np.sin(f * x + r.uniform(0, 6.3))
    return y


FAR, NEAR = ridge(0.80, 38, 1), ridge(0.88, 46, 2)


def background(p):
    stops = p["sky"]
    t = ys[:, :1] / H
    img = np.zeros((H, 1, 3), np.float32)
    pos = [s[0] for s in stops]
    for c in range(3):
        img[:, 0, c] = np.interp(t[:, 0], pos, [rgb(s[1])[c] for s in stops])
    img = np.repeat(img, W, axis=1)
    return img


def frame(p, base, i):
    ph = 2 * np.pi * i / FRAMES
    img = base.copy()
    (gx, gy), gcol, grad, gint = p["glow"]
    breathe = 1 + 0.08 * np.sin(ph)
    cx, cy = gx * W + 12 * np.sin(ph), gy * H + 6 * np.sin(2 * ph)
    d2 = ((xs - cx) ** 2 + (ys - cy) ** 2) / (grad * H) ** 2
    g = (gint * breathe * np.exp(-d2))[..., None]
    img = img + (rgb(gcol) - img) * g
    if p["disc"]:
        (dx, dy), dcol, r = p["disc"]
        d = np.sqrt((xs - dx * W - 12 * np.sin(ph)) ** 2 + (ys - dy * H - 6 * np.sin(2 * ph)) ** 2)
        a = np.clip(r - d, 0, 1)[..., None]
        img = img + (rgb(dcol) - img) * a
    if p["stars"]:
        s = STARS
        tw = p["stars"] * s["b"] * (0.65 + 0.35 * np.sin(s["k"] * ph + s["p"]))
        img[s["y"], s["x"]] += (255 - img[s["y"], s["x"]]) * tw[:, None]
    for ridge_y, col in ((FAR, p["hills"][0]), (NEAR, p["hills"][1])):
        a = np.clip(ys - ridge_y[None, :], 0, 1)[..., None]
        img = img + (rgb(col) - img) * a
    return np.clip(img + DITHER, 0, 255).astype(np.uint8)


def render(name, p):
    OUT.mkdir(parents=True, exist_ok=True)
    out = OUT / f"{name}.mp4"
    cmd = [
        "ffmpeg", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
        "-r", str(FPS), "-i", "-", "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "21",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(out),
    ]
    enc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    base = background(p)
    for i in range(FRAMES):
        enc.stdin.write(frame(p, base, i).tobytes())
    enc.stdin.close()
    enc.wait()
    print(out, f"{out.stat().st_size / 1e6:.1f} Mo")


if __name__ == "__main__":
    for name, p in PHASES.items():
        if len(sys.argv) <= 2 or name in sys.argv[2:]:
            render(name, p)
