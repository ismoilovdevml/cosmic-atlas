#!/usr/bin/env python
"""Check figures for data/tiles/dust/, made from the SHIPPED files only (mean_u8.bin + meta.json +
PROVENANCE.json), so they show what the viewer gets.

  figures/dust-xy-check.png    z = 0 slice (left) and A_V integrated over |z| < 402 pc (right), with the
                               validation clouds: o = literature distance, + = peak of the map along that
                               line of sight; Radcliffe Wave model (Alves+2020) and the 1248 pc data edge
  figures/dust-xy-vs-paper.png the integrated panel next to Edenhofer et al. 2024 Fig. 5 (top), when
                               data/cache/dust/paper/galactic.jpg exists (arXiv:2308.01295v2 HTML figure)

Needs matplotlib, numpy, pillow (not in the project venv; any Python with them works):
  python -I scripts/plot_dust_check.py [--tiles data/tiles/dust] [--cache data/cache/dust] [--figures figures]
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]


def decode(c, lo, hi):
    c = c.astype(np.float64)
    return np.where(c >= 1.0, 10.0 ** (lo + (c - 1.0) / 254.0 * (hi - lo)), c * 10.0**lo)


def lbvec(l, b):
    l, b = np.radians(l), np.radians(b)
    return np.array([np.cos(b) * np.cos(l), np.cos(b) * np.sin(l), np.sin(b)])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tiles", type=Path, default=ROOT / "data" / "tiles" / "dust")
    ap.add_argument("--cache", type=Path, default=ROOT / "data" / "cache" / "dust")
    ap.add_argument("--figures", type=Path, default=ROOT / "figures")
    a = ap.parse_args()
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.colors import LogNorm

    meta = json.loads((a.tiles / "meta.json").read_text())
    prov = json.loads((a.tiles / "PROVENANCE.json").read_text())
    f = meta["fine"]
    nx, ny, nz = f["dims"]
    vox = f["voxelPc"]
    o = np.array(f["origin"])
    raw = np.frombuffer((a.tiles / f["file"]).read_bytes(), dtype=np.uint8).reshape(nz, ny, nx)
    av = decode(raw, meta["mean"]["lo"], meta["mean"]["hi"])
    ext = [o[0], o[0] + nx * vox, o[1], o[1] + ny * vox]
    z0 = av[nz // 2 - 1:nz // 2 + 1].mean(axis=0)
    zint = av.sum(axis=0) * vox / 1e3
    checks = prov["checks"]["clouds"]
    rwp = a.cache / "radcliffe_wave_best_fit.csv"
    wave = np.loadtxt(rwp, delimiter=",", skiprows=1) if rwp.exists() else None
    a.figures.mkdir(parents=True, exist_ok=True)

    def decorate(ax, full=False, lim=1300):
        ax.plot(0, 0, marker="*", color="gold", ms=13, mec="k", zorder=5)
        if wave is not None:
            ax.plot(wave[:, 0], wave[:, 1], color="tab:blue", lw=1.3, alpha=0.85, label="Radcliffe Wave model (Alves et al. 2020)")
        for c in checks:
            lit = c["d"] * lbvec(c["l"], c["b"])
            x, y, _ = c["xyz_peak"]
            ax.plot([lit[0]], [lit[1]], "o", mfc="none", mec="tab:red", ms=10, mew=1.5)
            ax.plot([x], [y], "+", color="tab:red", ms=10, mew=1.5)
            if full:
                off = {"Ophiuchus": (10, 10), "Lupus I-IV": (10, -14), "Taurus": (-10, 12), "Perseus": (-10, 12)}.get(c["name"].split(" (")[0], (10, -4))
                ax.annotate(f"{c['name'].split(' (')[0]}: lit. {c['d']} pc, map {c['grid6pc']['peak_pc']:.0f} pc", (x, y),
                            xytext=off, textcoords="offset points", color="tab:red", fontsize=9,
                            ha="right" if off[0] < 0 else "left", bbox=dict(fc="white", ec="none", alpha=0.7, pad=1))
        ax.add_patch(plt.Circle((0, 0), meta["dataRadiusPc"][1], fill=False, ls=":", color="0.45"))
        ax.text(0, -meta["dataRadiusPc"][1] + 25, "edge of the map (1248 pc)", ha="center", fontsize=8, color="0.35", clip_on=True)
        ax.set_xlim(-lim, lim)
        ax.set_ylim(-lim, lim)
        ax.set_aspect("equal")
        ax.set_xlabel("x [pc]  (toward the Galactic Centre, l = 0°)")
        ax.set_ylabel("y [pc]  (toward l = 90°)")

    fig, axs = plt.subplots(1, 3, figsize=(24, 7.6), constrained_layout=True)
    im = axs[0].imshow(z0, origin="lower", extent=ext, cmap="binary", norm=LogNorm(0.03, 30), interpolation="nearest")
    fig.colorbar(im, ax=axs[0], shrink=0.82, label="A_V per kpc [mag/kpc], posterior mean")
    axs[0].set_title("Face-on slice at z = 0 (the 6 pc planes at z = ±3 pc)")
    decorate(axs[0])
    im = axs[1].imshow(zint, origin="lower", extent=ext, cmap="binary", norm=plt.Normalize(0, float(np.percentile(zint, 99.9))),
                       interpolation="nearest")
    fig.colorbar(im, ax=axs[1], shrink=0.82, label="A_V [mag] integrated over |z| < 402 pc")
    axs[1].set_title("Integrated over z (layout of Edenhofer et al. 2024, Fig. 5 top)")
    decorate(axs[1])
    axs[1].legend(loc="lower left", fontsize=8.5)
    im = axs[2].imshow(zint, origin="lower", extent=ext, cmap="binary", norm=plt.Normalize(0, float(np.percentile(zint, 99.9))),
                       interpolation="nearest")
    axs[2].set_title("Same, ±550 pc: o literature distance, + map peak on that sight line")
    decorate(axs[2], full=True, lim=550)
    lb = prov["checks"]["local_bubble"]["wall_b0"]
    fig.suptitle("Shipped 6 pc dust grid (Edenhofer et al. 2024, A&A 685, A82). Taurus (z ≈ −40 pc) and Orion A (z ≈ −140 pc) lie "
                 f"out of the z = 0 plane. In-plane Local Bubble wall (first > 1 mag/kpc): median {lb['median_pc']:.0f} pc, "
                 f"10-90 % {lb['p10_pc']:.0f}-{lb['p90_pc']:.0f} pc", fontsize=11)
    fig.savefig(a.figures / "dust-xy-check.png", dpi=105)
    plt.close(fig)

    paper = a.cache / "paper" / "galactic.jpg"
    if paper.exists():
        from PIL import Image
        img = Image.open(paper)
        w, h = img.size
        fig, axs = plt.subplots(1, 2, figsize=(17, 8.4), constrained_layout=True, gridspec_kw={"width_ratios": [1, 1.05]})
        axs[0].imshow(zint, origin="lower", extent=ext, cmap="binary", norm=plt.Normalize(0, float(np.percentile(zint, 99.9))),
                      interpolation="nearest")
        axs[0].set_xlim(-1250, 1250)
        axs[0].set_ylim(-1250, 1250)
        axs[0].set_aspect("equal")
        axs[0].set_xlabel("x [pc]")
        axs[0].set_ylabel("y [pc]")
        axs[0].set_title("This build: A_V integrated over |z| < 402 pc, linear, saturating at the 99.9 % quantile")
        axs[1].imshow(np.asarray(img.crop((0, 0, w, int(h * 0.575)))), cmap="gray")
        axs[1].set_axis_off()
        axs[1].set_title("Edenhofer et al. 2024, Fig. 5 top (|z| < 400 pc; arXiv:2308.01295v2, CC BY 4.0)")
        fig.savefig(a.figures / "dust-xy-vs-paper.png", dpi=95)
        plt.close(fig)
    print("wrote", a.figures / "dust-xy-check.png", "and dust-xy-vs-paper.png" if paper.exists() else "")


if __name__ == "__main__":
    main()
