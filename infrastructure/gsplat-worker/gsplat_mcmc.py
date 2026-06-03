#!/usr/bin/env python3
"""
Self-contained CUDA Gaussian-splat trainer — gsplat **MCMC** strategy.

Why this exists: splatfacto's default densification left a soft, hazy halo
around the figure on a turntable (the static-relative-to-the-rotating-figure
background accretes drifted Gaussians the masked loss never penalises), and the
Brush trainer needs Vulkan, which the host's NVIDIA driver won't expose inside the
container. gsplat is the CUDA rasteriser splatfacto builds on, and its **MCMC**
strategy is the clean fix: it caps the Gaussian count (`--cap-max`) and
*relocates* low-opacity Gaussians instead of letting them linger, so
floaters/haze are recycled into the figure and VRAM stays bounded. Pair that with
a foreground **loss mask** (background pixels contribute zero loss) and the halo
is gone.

It depends ONLY on what the image installs — torch, numpy, gsplat and Pillow — so
there is nothing to vendor (no gsplat `examples/` tree, no `pycolmap.SceneManager`,
no `fused_ssim`, no viewer deps). The MCMC + rasterization calls below target the
gsplat **1.4.0** API, which is identical through **1.5.3** (the pinned version) —
verified: same MCMCStrategy / step_post_backward / initialize_state signatures.

Input: an **undistorted** COLMAP dataset (run `colmap image_undistorter` first
so the cameras are PINHOLE — gsplat rasterises a pinhole model and does not
apply OPENCV distortion). Reads `<sparse>/cameras.bin|images.bin|points3D.bin`
and the images in `<images>/`; optional per-frame foreground masks in
`<masks>/<stem>.png` (white = keep). Output: a standard 3DGS `.ply` (INRIA
layout — the same a Brush export uses — so the existing web viewer renders it).

Usage:
    python3 gsplat_mcmc.py --images DIR --sparse DIR --output result.ply \
        [--masks DIR] [--iters 30000] [--cap-max 250000] [--max-res 1600]
"""

from __future__ import annotations

import argparse
import math
import os
import random
import struct
import sys
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image

from gsplat import rasterization
from gsplat.strategy import MCMCStrategy

# SH band-0 (DC) normalisation constant — identical to INRIA 3DGS / gsplat.
C0 = 0.28209479177387814

# COLMAP camera model_id → number of float64 params (cameras.bin layout).
CAMERA_MODEL_NUM_PARAMS = {0: 3, 1: 4, 2: 4, 3: 5, 4: 8, 5: 8, 6: 12, 7: 5, 8: 4, 9: 5, 10: 12}


def log(msg: str) -> None:
    print(msg, flush=True)


# -----------------------------------------------------------------------------
# COLMAP sparse-model binary readers (no pycolmap — the format is stable).
# -----------------------------------------------------------------------------


def _unpack(fh, fmt: str):
    size = struct.calcsize(fmt)
    data = fh.read(size)
    if len(data) != size:
        raise EOFError(f"unexpected EOF reading COLMAP model (wanted {size}B, got {len(data)}B)")
    return struct.unpack(fmt, data)


def read_cameras_bin(path: Path) -> dict:
    """camera_id -> (model_id, width, height, params)."""
    cams = {}
    with open(path, "rb") as fh:
        (num,) = _unpack(fh, "<Q")
        for _ in range(num):
            cam_id, model_id, width, height = _unpack(fh, "<iiQQ")
            k = CAMERA_MODEL_NUM_PARAMS.get(model_id)
            if k is None:
                raise ValueError(f"unknown COLMAP camera model_id={model_id}")
            params = _unpack(fh, "<" + "d" * k)
            cams[cam_id] = (model_id, width, height, params)
    return cams


def read_images_bin(path: Path) -> list:
    """list of (image_id, qvec[w,x,y,z], tvec, camera_id, name)."""
    out = []
    with open(path, "rb") as fh:
        (num,) = _unpack(fh, "<Q")
        for _ in range(num):
            props = _unpack(fh, "<idddddddi")  # id, qw,qx,qy,qz, tx,ty,tz, cam_id
            image_id = props[0]
            qvec = np.array(props[1:5], dtype=np.float64)  # (w, x, y, z)
            tvec = np.array(props[5:8], dtype=np.float64)
            cam_id = props[8]
            name = b""
            while True:
                c = fh.read(1)
                if c in (b"\x00", b""):
                    break
                name += c
            (num2d,) = _unpack(fh, "<Q")
            if num2d:
                fh.read(24 * num2d)  # skip x(d), y(d), point3D_id(q) per 2D obs
            out.append((image_id, qvec, tvec, cam_id, name.decode("utf-8", "replace")))
    return out


def read_points3d_bin(path: Path):
    """Return (xyz [P,3] float64, rgb [P,3] float64 in 0..255)."""
    xyz, rgb = [], []
    with open(path, "rb") as fh:
        (num,) = _unpack(fh, "<Q")
        for _ in range(num):
            props = _unpack(fh, "<QdddBBBd")  # id, x,y,z, r,g,b, error
            xyz.append(props[1:4])
            rgb.append(props[4:7])
            (track_len,) = _unpack(fh, "<Q")
            if track_len:
                fh.read(8 * track_len)  # skip (image_id, point2D_idx) per track elem
    return np.asarray(xyz, dtype=np.float64), np.asarray(rgb, dtype=np.float64)


def camera_fxfycxcy(model_id: int, params) -> tuple[float, float, float, float]:
    """Pull (fx, fy, cx, cy) from any COLMAP model. The dataset is undistorted
    (PINHOLE) so distortion coefficients are ignored."""
    if model_id == 1:        # PINHOLE: fx, fy, cx, cy
        return params[0], params[1], params[2], params[3]
    if model_id in (0, 2, 3):  # SIMPLE_PINHOLE / SIMPLE_RADIAL / RADIAL: f, cx, cy, ...
        return params[0], params[0], params[1], params[2]
    if model_id == 4:        # OPENCV: fx, fy, cx, cy, k1, k2, p1, p2
        return params[0], params[1], params[2], params[3]
    if len(params) >= 4:     # best effort
        return params[0], params[1], params[2], params[3]
    return params[0], params[0], params[1], params[2]


def qvec2rotmat(q) -> np.ndarray:
    """COLMAP quaternion (w, x, y, z) → 3x3 rotation (world-to-camera)."""
    w, x, y, z = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - w * z),     2 * (x * z + w * y)],
        [2 * (x * y + w * z),     1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
        [2 * (x * z - w * y),     2 * (y * z + w * x),     1 - 2 * (x * x + y * y)],
    ], dtype=np.float64)


# -----------------------------------------------------------------------------
# Dataset
# -----------------------------------------------------------------------------


def load_dataset(images_dir: Path, sparse_dir: Path, masks_dir: Path | None,
                 max_res: int, device: str):
    """Load cameras + undistorted images (+ optional masks), preloaded to CPU
    tensors. Returns (frames, points_xyz [P,3], points_rgb [P,3] in 0..1)."""
    cams = read_cameras_bin(sparse_dir / "cameras.bin")
    images = read_images_bin(sparse_dir / "images.bin")
    pts_xyz, pts_rgb = read_points3d_bin(sparse_dir / "points3D.bin")

    frames = []
    for _id, qvec, tvec, cam_id, name in images:
        img_path = images_dir / name
        if not img_path.exists():
            log(f"  ! image referenced by COLMAP missing on disk: {name}")
            continue
        model_id, w, h, params = cams[cam_id]
        fx, fy, cx, cy = camera_fxfycxcy(model_id, params)

        with Image.open(img_path) as im:
            im = im.convert("RGB")
            W0, H0 = im.size
            scale = min(1.0, float(max_res) / max(W0, H0)) if max_res > 0 else 1.0
            if scale < 1.0:
                W, H = max(1, round(W0 * scale)), max(1, round(H0 * scale))
                im = im.resize((W, H), Image.LANCZOS)
            else:
                W, H = W0, H0
            img_u8 = torch.from_numpy(np.asarray(im, dtype=np.uint8)).contiguous()  # [H,W,3]
        sx, sy = W / W0, H / H0
        K = torch.tensor([[fx * sx, 0.0, cx * sx],
                          [0.0, fy * sy, cy * sy],
                          [0.0, 0.0, 1.0]], dtype=torch.float32)

        R = qvec2rotmat(qvec)
        w2c = np.eye(4, dtype=np.float64)
        w2c[:3, :3] = R
        w2c[:3, 3] = tvec
        viewmat = torch.tensor(w2c, dtype=torch.float32)  # world-to-camera (OpenCV/COLMAP)

        mask_u8 = None
        if masks_dir is not None:
            mp = masks_dir / (Path(name).stem + ".png")
            if mp.exists():
                with Image.open(mp) as mim:
                    mim = mim.convert("L")
                    if mim.size != (W, H):
                        mim = mim.resize((W, H), Image.NEAREST)
                    mask_u8 = torch.from_numpy(np.asarray(mim, dtype=np.uint8) > 127).contiguous()  # [H,W] bool

        frames.append({"name": name, "img": img_u8, "mask": mask_u8,
                       "K": K, "viewmat": viewmat, "W": W, "H": H,
                       "c2w_t": np.linalg.inv(w2c)[:3, 3]})

    if not frames:
        raise RuntimeError("no frames loaded — COLMAP images.bin referenced no images on disk")
    if pts_xyz.shape[0] < 8:
        raise RuntimeError(f"COLMAP point cloud too small ({pts_xyz.shape[0]} points)")

    points = torch.from_numpy(pts_xyz).float().to(device)
    rgbs = torch.from_numpy(pts_rgb / 255.0).float().to(device)
    return frames, points, rgbs


# -----------------------------------------------------------------------------
# Gaussian init + helpers
# -----------------------------------------------------------------------------


def knn_dist2_avg(x: torch.Tensor, k: int = 4, chunk: int = 4096) -> torch.Tensor:
    """Mean squared distance to the (k-1) nearest neighbours of each point —
    chunked so memory is bounded (COLMAP figure clouds are small, but be safe)."""
    n = x.shape[0]
    out = torch.empty(n, device=x.device)
    kk = min(k, n)
    for i in range(0, n, chunk):
        d2 = torch.cdist(x[i:i + chunk], x).pow(2)        # [b, n]
        vals, _ = torch.topk(d2, kk, dim=1, largest=False)  # nearest incl. self (0)
        out[i:i + chunk] = vals[:, 1:].mean(dim=1) if kk > 1 else vals[:, 0]
    return out


def _gaussian_window(size: int, sigma: float, device) -> torch.Tensor:
    coords = torch.arange(size, device=device, dtype=torch.float32) - size // 2
    g = torch.exp(-(coords ** 2) / (2 * sigma ** 2))
    g = g / g.sum()
    return (g[:, None] @ g[None, :])  # [size, size]


def ssim(img1: torch.Tensor, img2: torch.Tensor, window_size: int = 11, sigma: float = 1.5) -> torch.Tensor:
    """Single-scale SSIM on [B, C, H, W] images in [0, 1]. Standard implementation."""
    c = img1.shape[1]
    win = _gaussian_window(window_size, sigma, img1.device).expand(c, 1, window_size, window_size)
    pad = window_size // 2
    mu1 = F.conv2d(img1, win, padding=pad, groups=c)
    mu2 = F.conv2d(img2, win, padding=pad, groups=c)
    mu1_sq, mu2_sq, mu1_mu2 = mu1 * mu1, mu2 * mu2, mu1 * mu2
    sigma1_sq = F.conv2d(img1 * img1, win, padding=pad, groups=c) - mu1_sq
    sigma2_sq = F.conv2d(img2 * img2, win, padding=pad, groups=c) - mu2_sq
    sigma12 = F.conv2d(img1 * img2, win, padding=pad, groups=c) - mu1_mu2
    c1, c2 = 0.01 ** 2, 0.03 ** 2
    ssim_map = ((2 * mu1_mu2 + c1) * (2 * sigma12 + c2)) / \
               ((mu1_sq + mu2_sq + c1) * (sigma1_sq + sigma2_sq + c2))
    return ssim_map.mean()


def build_splats(points: torch.Tensor, rgbs: torch.Tensor, sh_degree: int,
                 scene_scale: float, device: str):
    """Create the optimisable ParameterDict + per-parameter Adam optimisers,
    following gsplat 1.4.0's MCMC init (init_scale=0.1, init_opacity=0.5)."""
    n = points.shape[0]
    dist2 = knn_dist2_avg(points, 4)
    dist = torch.sqrt(torch.clamp(dist2, min=1e-12))
    scales = torch.log(dist * 0.1).unsqueeze(-1).repeat(1, 3)        # log-space [N,3]
    quats = torch.rand((n, 4), device=device)                       # normalised inside rasterization
    opacities = torch.logit(torch.full((n,), 0.5, device=device))   # logit-space [N]

    colors = torch.zeros((n, (sh_degree + 1) ** 2, 3), device=device)
    colors[:, 0, :] = (rgbs - 0.5) / C0                             # rgb → SH band-0

    means_lr = 1.6e-4 * max(scene_scale, 1e-3)
    spec = [
        ("means", torch.nn.Parameter(points), means_lr),
        ("scales", torch.nn.Parameter(scales), 5e-3),
        ("quats", torch.nn.Parameter(quats), 1e-3),
        ("opacities", torch.nn.Parameter(opacities), 5e-2),
        ("sh0", torch.nn.Parameter(colors[:, :1, :].contiguous()), 2.5e-3),
        ("shN", torch.nn.Parameter(colors[:, 1:, :].contiguous()), 2.5e-3 / 20),
    ]
    splats = torch.nn.ParameterDict({n_: p for n_, p, _ in spec}).to(device)
    optimizers = {
        n_: torch.optim.Adam([{"params": splats[n_], "lr": lr, "name": n_}],
                             eps=1e-15, betas=(0.9, 0.999))
        for n_, _, lr in spec
    }
    return splats, optimizers


# -----------------------------------------------------------------------------
# PLY export (INRIA 3DGS layout — matches a Brush export; the web viewer reads it)
# -----------------------------------------------------------------------------


def export_ply(path: Path, splats: torch.nn.ParameterDict) -> int:
    means = splats["means"].detach().cpu().numpy().astype(np.float32)          # [N,3]
    scales = splats["scales"].detach().cpu().numpy().astype(np.float32)        # [N,3] log
    quats = F.normalize(splats["quats"].detach(), dim=-1).cpu().numpy().astype(np.float32)  # [N,4] wxyz
    opac = splats["opacities"].detach().cpu().numpy().reshape(-1, 1).astype(np.float32)     # [N,1] logit
    sh0 = splats["sh0"].detach().cpu().numpy().astype(np.float32)              # [N,1,3]
    shn = splats["shN"].detach().cpu().numpy().astype(np.float32)             # [N,15,3]
    n = means.shape[0]

    # --- prune floaters before export ----------------------------------------
    # The masked loss never penalises gaussians in the (masked) background, so a
    # few drift there and render as floaters/haze "around the camera". Drop the
    # faint ones (low opacity) and the spatial outliers (far from the figure's
    # dense cluster), then recentre. Env-tunable; GSPLAT_CROP_MARGIN=0 disables
    # the spatial crop. Hard safety: never prune to (near-)nothing.
    min_opacity = float(os.environ.get("GSPLAT_MIN_OPACITY", "0.08"))
    crop_pctl = float(os.environ.get("GSPLAT_CROP_PCTL", "0.98"))
    crop_margin = float(os.environ.get("GSPLAT_CROP_MARGIN", "1.5"))
    keep = (1.0 / (1.0 + np.exp(-opac.reshape(-1)))) >= min_opacity   # sigmoid(logit) ≥ thr
    if keep.sum() >= 8:
        center = np.median(means[keep], axis=0)
        dist = np.linalg.norm(means - center, axis=1)
        if crop_margin > 0:
            r = float(np.percentile(dist[keep], crop_pctl * 100.0))
            keep = keep & (dist <= r * crop_margin)
    if keep.sum() < 8:
        keep = np.ones(n, dtype=bool)
    dropped = int(n - keep.sum())
    means, scales, quats = means[keep], scales[keep], quats[keep]
    opac, sh0, shn = opac[keep], sh0[keep], shn[keep]
    means = means - np.median(means, axis=0).astype(np.float32)  # recentre at origin
    n = means.shape[0]
    log(f"export: {n} gaussians (dropped {dropped}: opacity<{min_opacity} or "
        f"outside {crop_margin}x p{int(crop_pctl * 100)} radius)")

    # INRIA stores SH channel-major: f_dc=[r,g,b]; f_rest=[r·15, g·15, b·15].
    f_dc = np.transpose(sh0, (0, 2, 1)).reshape(n, -1)    # [N,3]
    f_rest = np.transpose(shn, (0, 2, 1)).reshape(n, -1)  # [N,45]
    normals = np.zeros((n, 3), dtype=np.float32)

    attrs = ["x", "y", "z", "nx", "ny", "nz"]
    attrs += [f"f_dc_{i}" for i in range(f_dc.shape[1])]
    attrs += [f"f_rest_{i}" for i in range(f_rest.shape[1])]
    attrs += ["opacity", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"]

    data = np.concatenate([means, normals, f_dc, f_rest, opac, scales, quats], axis=1).astype(np.float32)
    assert data.shape[1] == len(attrs), (data.shape[1], len(attrs))

    header = "ply\nformat binary_little_endian 1.0\n"
    header += f"element vertex {n}\n"
    header += "".join(f"property float {a}\n" for a in attrs)
    header += "end_header\n"
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(header.encode("ascii"))
        fh.write(np.ascontiguousarray(data).tobytes())
    return n


# -----------------------------------------------------------------------------
# Train
# -----------------------------------------------------------------------------


def train(args) -> None:
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is not available — this trainer requires an NVIDIA GPU")
    device = "cuda"
    torch.manual_seed(0)
    random.seed(0)

    import gsplat  # noqa: F401 — already imported for rasterization; surface its version
    log(f"gsplat {getattr(gsplat, '__version__', '?')} · torch {torch.__version__} · "
        f"device {torch.cuda.get_device_name(0)}")

    frames, points, rgbs = load_dataset(
        Path(args.images), Path(args.sparse),
        Path(args.masks) if args.masks else None, args.max_res, device,
    )
    n_masked = sum(1 for f in frames if f["mask"] is not None)
    log(f"dataset: {len(frames)} cameras · {points.shape[0]} init points · {n_masked} masks")

    # Scene scale = spread of camera centres (drives the means learning rate +
    # the MCMC noise magnitude). 1.1× to match gsplat's reference parser.
    centers = np.stack([f["c2w_t"] for f in frames])
    scene_scale = float(np.linalg.norm(centers - centers.mean(0), axis=1).max()) * 1.1
    scene_scale = max(scene_scale, 1e-3)

    sh_degree = 3
    splats, optimizers = build_splats(points, rgbs, sh_degree, scene_scale, device)
    del points, rgbs

    max_steps = args.iters
    means_sched = torch.optim.lr_scheduler.ExponentialLR(
        optimizers["means"], gamma=0.01 ** (1.0 / max_steps))
    sh_interval = max(1, max_steps // 30)

    strategy = MCMCStrategy(
        cap_max=args.cap_max,
        refine_start_iter=500,
        refine_stop_iter=int(max_steps * 0.8),
        refine_every=100,
        min_opacity=0.005,
        verbose=True,
    )
    strategy.check_sanity(splats, optimizers)
    strategy_state = strategy.initialize_state()

    opacity_reg, scale_reg, ssim_lambda = 0.01, 0.01, 0.2
    order: list[int] = []
    t0 = time.time()
    log(f"training MCMC · {max_steps} iters · cap_max={args.cap_max} · "
        f"max_res={args.max_res} · scene_scale={scene_scale:.3f}")

    for step in range(max_steps):
        if step % len(frames) == 0:
            order = list(range(len(frames)))
            random.shuffle(order)
        f = frames[order[step % len(frames)]]

        pixels = (f["img"].to(device, non_blocking=True).float() / 255.0).unsqueeze(0)  # [1,H,W,3]
        K = f["K"].to(device).unsqueeze(0)              # [1,3,3]
        viewmat = f["viewmat"].to(device).unsqueeze(0)  # [1,4,4] world-to-camera
        sh_deg_use = min(step // sh_interval, sh_degree)

        renders, _alphas, info = rasterization(
            means=splats["means"],
            quats=splats["quats"],
            scales=torch.exp(splats["scales"]),
            opacities=torch.sigmoid(splats["opacities"]),
            colors=torch.cat([splats["sh0"], splats["shN"]], dim=1),
            viewmats=viewmat,
            Ks=K,
            width=f["W"],
            height=f["H"],
            sh_degree=sh_deg_use,
            packed=False,
            absgrad=False,
            sparse_grad=False,
            rasterize_mode="classic",
            near_plane=0.01,
            far_plane=1e10,
            render_mode="RGB",
            camera_model="pinhole",
        )
        colors = renders[..., :3]  # [1,H,W,3]

        # Foreground loss mask: zero both render and target in the background so
        # only the figure drives the loss (the turntable backdrop is masked out).
        if f["mask"] is not None:
            m = f["mask"].to(device).view(1, f["H"], f["W"], 1).float()
            colors = colors * m
            pixels = pixels * m

        l1 = F.l1_loss(colors, pixels)
        ssim_val = ssim(colors.permute(0, 3, 1, 2), pixels.permute(0, 3, 1, 2))
        loss = l1 * (1.0 - ssim_lambda) + (1.0 - ssim_val) * ssim_lambda
        # MCMC regularisers: push opacities/scales down so dead Gaussians get
        # relocated (the haze fix) and scales stay compact.
        loss = loss + opacity_reg * torch.sigmoid(splats["opacities"]).abs().mean()
        loss = loss + scale_reg * torch.exp(splats["scales"]).abs().mean()

        loss.backward()
        for opt in optimizers.values():
            opt.step()
            opt.zero_grad(set_to_none=True)
        means_sched.step()

        # MCMC has no step_pre_backward (relocation is opacity-driven, not
        # gradient-driven); only the post-backward relocate/teleport + noise.
        strategy.step_post_backward(
            params=splats,
            optimizers=optimizers,
            state=strategy_state,
            step=step,
            info=info,
            lr=means_sched.get_last_lr()[0],
        )

        if step % 50 == 0 or step == max_steps - 1:
            log(f"{step + 1}/{max_steps} loss={loss.item():.4f} "
                f"gaussians={splats['means'].shape[0]} "
                f"sh={sh_deg_use} ({time.time() - t0:.0f}s)")

    n = export_ply(Path(args.output), splats)
    log(f"exported {n} gaussians → {args.output} ({Path(args.output).stat().st_size} bytes)")


def main() -> int:
    ap = argparse.ArgumentParser(description="CUDA gsplat MCMC trainer (undistorted COLMAP → .ply)")
    ap.add_argument("--images", required=True, help="undistorted images dir (COLMAP image_undistorter output)")
    ap.add_argument("--sparse", required=True, help="dir with cameras.bin / images.bin / points3D.bin (PINHOLE)")
    ap.add_argument("--output", required=True, help="output .ply path")
    ap.add_argument("--masks", default=None, help="optional foreground masks dir (<stem>.png, white = keep)")
    ap.add_argument("--iters", type=int, default=30000)
    ap.add_argument("--cap-max", type=int, default=250000, help="max number of Gaussians (MCMC cap; VRAM lever)")
    ap.add_argument("--max-res", type=int, default=1600, help="longest image side trained on (0 = full res)")
    args = ap.parse_args()
    train(args)
    return 0


if __name__ == "__main__":
    sys.exit(main())
