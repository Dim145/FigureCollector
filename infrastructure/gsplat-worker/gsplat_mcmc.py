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


def _envflag(name: str, default: bool) -> bool:
    return os.environ.get(name, "true" if default else "false").lower() in ("1", "true", "yes")


def rotation_6d_to_matrix(d6: torch.Tensor) -> torch.Tensor:
    """6D rotation representation -> 3x3 matrix (Gram-Schmidt; Zhou et al. 2019),
    matching gsplat's CameraOptModule so the pose deltas compose identically."""
    a1, a2 = d6[..., :3], d6[..., 3:]
    b1 = F.normalize(a1, dim=-1)
    b2 = F.normalize(a2 - (b1 * a2).sum(-1, keepdim=True) * b1, dim=-1)
    b3 = torch.cross(b1, b2, dim=-1)
    return torch.stack((b1, b2, b3), dim=-2)


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

    # Crop-to-figure: crop each frame to its mask bounding box (+ pad) so the
    # max_res budget AND the gaussian cap go to the figure, not the backdrop —
    # more effective resolution at the same VRAM. Needs masks. Opt-in.
    crop_to_figure = _envflag("GSPLAT_CROP_TO_FIGURE", False)
    crop_pad = float(os.environ.get("GSPLAT_CROP_PAD", "0.15"))
    n_cropped = 0

    frames = []
    for _id, qvec, tvec, cam_id, name in images:
        img_path = images_dir / name
        if not img_path.exists():
            log(f"  ! image referenced by COLMAP missing on disk: {name}")
            continue
        model_id, w, h, params = cams[cam_id]
        fx, fy, cx, cy = camera_fxfycxcy(model_id, params)

        # Load the image + the FULL-res mask (mask first so crop-to-figure can use
        # its bbox before downscaling).
        im = Image.open(img_path).convert("RGB")
        W0, H0 = im.size
        mask_arr = None  # [H0,W0] bool at the (possibly cropped) full res
        if masks_dir is not None:
            mp = masks_dir / (Path(name).stem + ".png")
            if mp.exists():
                with Image.open(mp) as mim:
                    mim = mim.convert("L")
                    if mim.size != (W0, H0):
                        mim = mim.resize((W0, H0), Image.NEAREST)
                    mask_arr = np.asarray(mim, dtype=np.uint8) > 127

        # Crop to the figure's mask bbox (+ pad) and shift the principal point into
        # the crop; fx/fy are unchanged by a crop. Then the max_res downscale below
        # fills the budget with the figure.
        pcx, pcy = cx, cy
        if crop_to_figure and mask_arr is not None and mask_arr.any():
            ys, xs = np.where(mask_arr)
            x0, y0, x1, y1 = int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1
            px, py = int((x1 - x0) * crop_pad), int((y1 - y0) * crop_pad)
            x0, y0 = max(0, x0 - px), max(0, y0 - py)
            x1, y1 = min(W0, x1 + px), min(H0, y1 + py)
            im = im.crop((x0, y0, x1, y1))
            mask_arr = mask_arr[y0:y1, x0:x1]
            pcx, pcy = cx - x0, cy - y0
            W0, H0 = im.size
            n_cropped += 1

        scale = min(1.0, float(max_res) / max(W0, H0)) if max_res > 0 else 1.0
        if scale < 1.0:
            W, H = max(1, round(W0 * scale)), max(1, round(H0 * scale))
            im = im.resize((W, H), Image.LANCZOS)
        else:
            W, H = W0, H0
        img_u8 = torch.from_numpy(np.asarray(im, dtype=np.uint8)).contiguous()  # [H,W,3]
        im.close()
        sx, sy = W / W0, H / H0
        K = torch.tensor([[fx * sx, 0.0, pcx * sx],
                          [0.0, fy * sy, pcy * sy],
                          [0.0, 0.0, 1.0]], dtype=torch.float32)

        R = qvec2rotmat(qvec)
        w2c = np.eye(4, dtype=np.float64)
        w2c[:3, :3] = R
        w2c[:3, 3] = tvec
        viewmat = torch.tensor(w2c, dtype=torch.float32)  # world-to-camera (OpenCV/COLMAP)

        mask_u8 = None
        if mask_arr is not None:
            m = Image.fromarray(mask_arr.astype(np.uint8) * 255)
            if m.size != (W, H):
                m = m.resize((W, H), Image.NEAREST)
            mask_u8 = torch.from_numpy(np.asarray(m, dtype=np.uint8) > 127).contiguous()  # [H,W] bool

        frames.append({"name": name, "img": img_u8, "mask": mask_u8,
                       "K": K, "viewmat": viewmat, "W": W, "H": H,
                       "c2w_t": np.linalg.inv(w2c)[:3, 3]})

    if not frames:
        raise RuntimeError("no frames loaded — COLMAP images.bin referenced no images on disk")
    if pts_xyz.shape[0] < 8:
        raise RuntimeError(f"COLMAP point cloud too small ({pts_xyz.shape[0]} points)")

    if crop_to_figure:
        log(f"crop-to-figure: {n_cropped}/{len(frames)} frames cropped to the mask bbox")
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


def _sor_keep(xyz: np.ndarray, k: int = 20, std_ratio: float = 2.0) -> np.ndarray:
    """Statistical Outlier Removal (Open3D-equivalent): keep points whose mean
    distance to their k nearest neighbours is within mean + std_ratio·std of the
    global mean. Torch + chunked (GPU if available) so no scipy dependency. Used
    at export to drop isolated floater stragglers a global radius crop keeps."""
    n = xyz.shape[0]
    if n <= k + 1:
        return np.ones(n, dtype=bool)
    t = torch.from_numpy(xyz).float()
    if torch.cuda.is_available():
        t = t.cuda()
    mean_d = torch.empty(n, device=t.device)
    chunk = 2048
    kk = min(k + 1, n)
    for i in range(0, n, chunk):
        d = torch.cdist(t[i:i + chunk], t)               # [b, n]
        vals, _ = torch.topk(d, kk, dim=1, largest=False)
        mean_d[i:i + chunk] = vals[:, 1:].mean(dim=1)     # exclude self (dist 0)
    md = mean_d.cpu().numpy()
    thr = float(md.mean() + std_ratio * md.std())
    return md <= thr


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


# -----------------------------------------------------------------------------
# Bilateral grid (per-image colour/exposure correction) — gsplat's lib_bilagrid,
# DENSE variant only (pure torch, no tensorly). A learned per-frame 3D affine
# colour transform that absorbs the shifting glossy sheen of a fixed-light
# turntable, so the SH/geometry sharpen instead of averaging it into blur. Used
# only in training; dropped at export (the .ply keeps the corrected SH), so the
# viewer contract is unchanged. Opt-in via GSPLAT_BILGRID.
# Source: nerfstudio-project/gsplat examples/lib_bilagrid.py (v1.5.3).
# -----------------------------------------------------------------------------


def _num_tensor_elems(t: torch.Tensor) -> float:
    return max(torch.prod(torch.tensor(t.size()[1:]).float()).item(), 1.0)


def total_variation_loss(x: torch.Tensor) -> torch.Tensor:
    """Smoothness prior over the bilateral grids (keeps the colour field gentle)."""
    batch_size = x.shape[0]
    tv = 0.0
    for i in range(2, len(x.shape)):
        n_res = x.shape[i]
        idx1 = torch.arange(1, n_res, device=x.device)
        idx2 = torch.arange(0, n_res - 1, device=x.device)
        x1 = x.index_select(i, idx1)
        x2 = x.index_select(i, idx2)
        tv += torch.pow((x1 - x2), 2).sum() / _num_tensor_elems(x1)
    return tv / batch_size


def _color_affine_transform(affine_mats: torch.Tensor, rgb: torch.Tensor) -> torch.Tensor:
    return torch.matmul(affine_mats[..., :3], rgb.unsqueeze(-1)).squeeze(-1) + affine_mats[..., 3]


def bilgrid_slice(bil_grids, xy, rgb, grid_idx):
    """Slice one image's bilateral grid at pixel xy + rgb-guidance → corrected rgb.
    Assumes a single grid index per call (one frame), as the trainer uses it."""
    sh_ = rgb.shape
    grid_idx_unique = torch.unique(grid_idx)
    if len(grid_idx_unique) != 1:
        raise ValueError("bilgrid_slice expects a single grid index per call")
    grid_idx = grid_idx_unique
    xy = xy.unsqueeze(0)
    rgb = rgb.unsqueeze(0)
    affine_mats = bil_grids(xy, rgb, grid_idx)
    rgb = _color_affine_transform(affine_mats, rgb)
    return {"rgb": rgb.reshape(*sh_)}


class BilateralGrid(torch.nn.Module):
    """N per-image 3D bilateral grids (identity-initialised affine colour maps)."""

    def __init__(self, num: int, grid_X: int = 16, grid_Y: int = 16, grid_W: int = 8):
        super().__init__()
        self.grid_width, self.grid_height, self.grid_guidance = grid_X, grid_Y, grid_W
        grid = self._init_identity_grid()
        self.grids = torch.nn.Parameter(grid.tile(num, 1, 1, 1, 1))
        self.register_buffer("rgb2gray_weight", torch.Tensor([[0.299, 0.587, 0.114]]))
        self.rgb2gray = lambda rgb: (rgb @ self.rgb2gray_weight.T) * 2.0 - 1.0

    def _init_identity_grid(self) -> torch.Tensor:
        grid = torch.tensor([1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 1.0, 0]).float()
        grid = grid.repeat([self.grid_guidance * self.grid_height * self.grid_width, 1])
        grid = grid.reshape(1, self.grid_guidance, self.grid_height, self.grid_width, -1)
        return grid.permute(0, 4, 1, 2, 3)

    def tv_loss(self) -> torch.Tensor:
        return total_variation_loss(self.grids)

    def forward(self, grid_xy, rgb, idx=None):
        input_ndims = len(grid_xy.shape)
        assert len(rgb.shape) == input_ndims
        if 1 < input_ndims < 5:
            for _ in range(5 - input_ndims):
                grid_xy = grid_xy.unsqueeze(1)
                rgb = rgb.unsqueeze(1)
            assert idx is not None
        elif input_ndims != 5:
            raise ValueError("bilateral grid slicing takes 2D–5D inputs")
        grids = self.grids[idx] if idx is not None else self.grids
        assert grids.shape[0] == grid_xy.shape[0]
        grid_xy = (grid_xy - 0.5) * 2
        grid_xyz = torch.cat([grid_xy, self.rgb2gray(rgb)], dim=-1)
        affine_mats = F.grid_sample(grids, grid_xyz, mode="bilinear",
                                    align_corners=True, padding_mode="border")
        affine_mats = affine_mats.permute(0, 2, 3, 4, 1)
        affine_mats = affine_mats.reshape(*affine_mats.shape[:-1], 3, 4)
        for _ in range(5 - input_ndims):
            affine_mats = affine_mats.squeeze(1)
        return affine_mats


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
    # MCMC prunes by opacity but NEVER by scale, so big thin "sheet" gaussians
    # survive as the haze canopy/ground; the masked loss also lets faint background
    # gaussians linger. Layer cheap, env-tunable filters on the final cloud, then
    # recentre. Hard safety: never prune to (near-)nothing. Set any threshold to 0
    # to disable that filter.
    min_opacity = float(os.environ.get("GSPLAT_MIN_OPACITY", "0.08"))
    crop_pctl = float(os.environ.get("GSPLAT_CROP_PCTL", "0.98"))
    crop_margin = float(os.environ.get("GSPLAT_CROP_MARGIN", "1.5"))
    scale_cap_frac = float(os.environ.get("GSPLAT_SCALE_CAP_FRAC", "0"))    # OFF by default; drop axis > frac × figure radius
    scale_pctl = float(os.environ.get("GSPLAT_SCALE_PCTL", "99.5"))         # drop the size tail
    aniso_cap = float(os.environ.get("GSPLAT_ANISO_CAP", "12.0"))           # drop needles
    contrib_pctl = float(os.environ.get("GSPLAT_CONTRIB_PCTL", "1.0"))      # drop low opacity·area
    sor_k = int(os.environ.get("GSPLAT_SOR_K", "20"))
    sor_std = float(os.environ.get("GSPLAT_SOR_STD", "2.0"))
    # Per-filter drop logging (off by default) — to see which filter is too aggressive
    # instead of guessing. GSPLAT_PRUNE_DEBUG=true logs each filter's incremental drop.
    prune_debug = _envflag("GSPLAT_PRUNE_DEBUG", False)

    op = 1.0 / (1.0 + np.exp(-opac.reshape(-1)))           # sigmoid(logit) → [N]
    ws = np.exp(scales)                                    # log → world-space [N,3]
    max_axis = ws.max(axis=1)
    ratio = max_axis / np.clip(ws.min(axis=1), 1e-8, None)
    keep = op >= min_opacity
    if prune_debug:
        log(f"prune-debug: {n} start · opacity<{min_opacity}: -{n - int(keep.sum())} → {int(keep.sum())} kept")
    if keep.sum() >= 8:
        base = keep.copy()                                 # opacity-kept set → thresholds
        center = np.median(means[base], axis=0)
        dist = np.linalg.norm(means - center, axis=1)
        r = float(np.percentile(dist[base], crop_pctl * 100.0))
        _prev = [int(keep.sum())]

        def _dbg(label: str) -> None:                      # log a filter's incremental drop
            if prune_debug:
                now = int(keep.sum())
                log(f"prune-debug: {label}: -{_prev[0] - now} → {now} kept")
                _prev[0] = now

        if scale_cap_frac > 0:                             # drop "sheets" bigger than the figure (× p98 radius)
            keep &= max_axis <= scale_cap_frac * r
        _dbg(f"scale_cap {scale_cap_frac}×r (r={r:.3f})")
        if 0 < scale_pctl < 100:
            keep &= max_axis <= np.percentile(max_axis[base], scale_pctl)
        _dbg(f"scale_pctl {scale_pctl}")
        if aniso_cap > 0:                                  # spiky needles
            keep &= ratio <= aniso_cap
        _dbg(f"aniso>{aniso_cap}")
        if contrib_pctl > 0:                               # faint + large = low contribution
            contrib = op * (max_axis ** 2)
            keep &= contrib >= np.percentile(contrib[base], contrib_pctl)
        _dbg(f"contrib<{contrib_pctl}%")
        if crop_margin > 0:                                # far spatial outliers
            keep &= dist <= r * crop_margin
        _dbg(f"crop {crop_margin}×r")
        if sor_k > 0 and int(keep.sum()) > sor_k + 1:      # isolated stragglers
            sub = np.where(keep)[0]
            keep[sub[~_sor_keep(means[sub], sor_k, sor_std)]] = False
        _dbg(f"SOR k{sor_k}/std{sor_std}")
    if keep.sum() < 8:
        keep = np.ones(n, dtype=bool)
    dropped = int(n - keep.sum())
    means, scales, quats = means[keep], scales[keep], quats[keep]
    opac, sh0, shn = opac[keep], sh0[keep], shn[keep]
    means = means - np.median(means, axis=0).astype(np.float32)  # recentre at origin
    n = means.shape[0]
    log(f"export: {n} gaussians (dropped {dropped} via opacity/scale/aniso/"
        f"contribution/crop/SOR)")

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

    # SH degree 3 (default) chases view-dependent colour; on a glossy fixed-light
    # turntable that smears specular into blur. GSPLAT_SH_DEGREE=2 trims that (and
    # shrinks shN → frees VRAM). Clamp 0..3.
    sh_degree = max(0, min(3, int(os.environ.get("GSPLAT_SH_DEGREE", "3"))))
    splats, optimizers = build_splats(points, rgbs, sh_degree, scene_scale, device)
    del points, rgbs

    max_steps = args.iters
    means_sched = torch.optim.lr_scheduler.ExponentialLR(
        optimizers["means"], gamma=0.01 ** (1.0 / max_steps))
    sh_interval = max(1, max_steps // 30)

    strategy = MCMCStrategy(
        cap_max=args.cap_max,
        # Langevin relocation noise. gsplat's default 5e5 was tuned for room-scale
        # scenes; on a single small object it over-agitates fine detail → blur.
        # Lower (1e5–2e5) lets the figure "set" sharper. GSPLAT_NOISE_LR overrides.
        noise_lr=float(os.environ.get("GSPLAT_NOISE_LR", "2e5")),
        refine_start_iter=500,
        refine_stop_iter=int(max_steps * 0.8),
        refine_every=100,
        min_opacity=0.005,
        verbose=True,
    )
    strategy.check_sanity(splats, optimizers)
    strategy_state = strategy.initialize_state()

    opacity_reg = float(os.environ.get("GSPLAT_OPACITY_REG", "0.01"))
    scale_reg = float(os.environ.get("GSPLAT_SCALE_REG", "0.01"))
    # Penalise needle-like gaussians (longest axis > aniso_max x shortest) — the
    # radiating "spike" artifacts. GSPLAT_ANISO_REG=0 disables it.
    aniso_reg = float(os.environ.get("GSPLAT_ANISO_REG", "0.01"))
    aniso_max = float(os.environ.get("GSPLAT_ANISO_MAX", "10.0"))
    ssim_lambda = 0.2
    # Alpha/mask loss: drive the rendered alpha to the foreground mask so the
    # masked-out background can't accrete floaters for free. OFF by default — it
    # only helps with CLEAN masks; with imperfect rembg masks (complex poses) it
    # warps the silhouette. Re-enable at 0.1–0.3 once masks are good (e.g. BiRefNet).
    mask_lambda = float(os.environ.get("GSPLAT_MASK_LAMBDA", "0"))
    # Random-background compositing — discourages SEMI-TRANSPARENT floaters (they
    # visibly corrupt a randomised bg each step, so MCMC drives their opacity to 0).
    # Pairs with the mask loss; opt-in (changes the loss target).
    random_bkgd = _envflag("GSPLAT_RANDOM_BKGD", False)
    # Depth planes: a bounded far-plane (from the scene scale) sharpens depth
    # precision on the figure vs the default 1e10. Env-overridable.
    near_plane = float(os.environ.get("GSPLAT_NEAR", "0.01"))
    far_plane = float(os.environ.get("GSPLAT_FAR", str(max(scene_scale * 10.0, 100.0))))
    # Antialiased rasterisation (Mip-Splatting): sharper, fewer aliasing speckles.
    rasterize_mode = "antialiased" if _envflag("GSPLAT_ANTIALIAS", True) else "classic"
    # Joint camera-pose refinement — a learnable per-frame pose delta (gsplat's
    # CameraOptModule scheme) that corrects residual COLMAP pose error → less
    # blur. Cheap in VRAM. GSPLAT_POSE_OPT=false disables it.
    pose_opt = _envflag("GSPLAT_POSE_OPT", True)
    pose_identity = torch.tensor([1.0, 0.0, 0.0, 0.0, 1.0, 0.0], device=device)
    pose_embeds = None
    pose_optimizer = None
    if pose_opt:
        pose_embeds = torch.nn.Embedding(len(frames), 9).to(device)
        torch.nn.init.zeros_(pose_embeds.weight)
        pose_optimizer = torch.optim.Adam(
            pose_embeds.parameters(), lr=1e-5, weight_decay=1e-6
        )
    # Bilateral grid (opt-in) — per-frame colour correction for glossy sheen.
    use_bilgrid = _envflag("GSPLAT_BILGRID", False)
    bil_grids = bil_grid_opt = bil_sched = None
    if use_bilgrid:
        bil_grids = BilateralGrid(len(frames)).to(device)
        bil_grid_opt = torch.optim.Adam(bil_grids.parameters(), lr=2e-3, eps=1e-15)
        bil_sched = torch.optim.lr_scheduler.ChainedScheduler([
            torch.optim.lr_scheduler.LinearLR(
                bil_grid_opt, start_factor=0.01, total_iters=min(1000, max_steps)),
            torch.optim.lr_scheduler.ExponentialLR(
                bil_grid_opt, gamma=0.01 ** (1.0 / max_steps)),
        ])
    log(f"opts · antialias={rasterize_mode == 'antialiased'} · pose_opt={pose_opt} · "
        f"scale_reg={scale_reg} · aniso_reg={aniso_reg}/{aniso_max} · sh={sh_degree} · "
        f"mask_lambda={mask_lambda} · random_bkgd={random_bkgd} · far={far_plane:.1f}")
    order: list[int] = []
    t0 = time.time()
    log(f"training MCMC · {max_steps} iters · cap_max={args.cap_max} · "
        f"max_res={args.max_res} · scene_scale={scene_scale:.3f}")

    for step in range(max_steps):
        if step % len(frames) == 0:
            order = list(range(len(frames)))
            random.shuffle(order)
        idx = order[step % len(frames)]
        f = frames[idx]

        pixels = (f["img"].to(device, non_blocking=True).float() / 255.0).unsqueeze(0)  # [1,H,W,3]
        K = f["K"].to(device).unsqueeze(0)              # [1,3,3]
        viewmat = f["viewmat"].to(device)               # [4,4] world-to-camera
        if pose_opt:
            d = pose_embeds(torch.tensor([idx], device=device))[0]  # [9]: 3 trans + 6D rot
            transform = torch.eye(4, device=device)
            transform[:3, :3] = rotation_6d_to_matrix(d[3:] + pose_identity)
            transform[:3, 3] = d[:3]
            # camtoworld @ delta, then back to world-to-camera (gsplat's scheme).
            viewmat = torch.linalg.inv(torch.linalg.inv(viewmat) @ transform)
        viewmat = viewmat.unsqueeze(0)                  # [1,4,4]
        sh_deg_use = min(step // sh_interval, sh_degree)

        renders, alphas, info = rasterization(
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
            rasterize_mode=rasterize_mode,
            near_plane=near_plane,
            far_plane=far_plane,
            render_mode="RGB",
            camera_model="pinhole",
        )
        colors = renders[..., :3]  # [1,H,W,3]
        if use_bilgrid:  # per-frame colour correction before the loss
            gy, gx = torch.meshgrid(
                (torch.arange(f["H"], device=device) + 0.5) / f["H"],
                (torch.arange(f["W"], device=device) + 0.5) / f["W"],
                indexing="ij",
            )
            grid_xy = torch.stack([gx, gy], dim=-1).unsqueeze(0)   # [1,H,W,2]
            colors = bilgrid_slice(bil_grids, grid_xy, colors,
                                   torch.tensor([idx], device=device))["rgb"]

        # Foreground handling. No mask → train on the full frame. With a mask:
        #  * random_bkgd: composite render + target over the SAME random colour, so
        #    a translucent background gaussian visibly corrupts the image and gets
        #    its opacity driven down (kills semi-transparent floaters).
        #  * else (default): zero render+target in the background (figure-only loss).
        # Either way an alpha→mask L1 (mask_lambda) penalises opacity OUTSIDE the
        # figure — the background floaters the masked RGB loss never sees.
        mask_loss = None
        if f["mask"] is not None:
            m = f["mask"].to(device).view(1, f["H"], f["W"], 1).float()
            if random_bkgd:
                bg = torch.rand(1, 1, 1, 3, device=device)
                colors = colors + (1.0 - alphas) * bg   # render is over black → premultiplied
                pixels = pixels * m + bg * (1.0 - m)     # figure on the same random bg
            else:
                colors = colors * m
                pixels = pixels * m
            if mask_lambda > 0.0:
                mask_loss = F.l1_loss(alphas, m)

        l1 = F.l1_loss(colors, pixels)
        ssim_val = ssim(colors.permute(0, 3, 1, 2), pixels.permute(0, 3, 1, 2))
        loss = l1 * (1.0 - ssim_lambda) + (1.0 - ssim_val) * ssim_lambda
        if mask_loss is not None:
            loss = loss + mask_lambda * mask_loss
        # MCMC regularisers: push opacities/scales down so dead Gaussians get
        # relocated (the haze fix) and scales stay compact.
        sc = torch.exp(splats["scales"])
        loss = loss + opacity_reg * torch.sigmoid(splats["opacities"]).abs().mean()
        loss = loss + scale_reg * sc.abs().mean()
        if aniso_reg > 0.0:  # discourage needle-like (spiky) gaussians
            ratio = sc.amax(dim=-1) / sc.amin(dim=-1).clamp(min=1e-6)
            loss = loss + aniso_reg * (ratio - aniso_max).clamp(min=0.0).mean()
        if use_bilgrid:
            loss = loss + 10.0 * bil_grids.tv_loss()

        loss.backward()
        for opt in optimizers.values():
            opt.step()
            opt.zero_grad(set_to_none=True)
        if pose_optimizer is not None:
            pose_optimizer.step()
            pose_optimizer.zero_grad(set_to_none=True)
        if bil_grid_opt is not None:
            bil_grid_opt.step()
            bil_grid_opt.zero_grad(set_to_none=True)
            bil_sched.step()
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
