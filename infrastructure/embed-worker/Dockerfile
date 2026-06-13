# syntax=docker/dockerfile:1.7
#
# FigureCollector image-embedding worker. Unlike the gsplat worker this needs no
# GPU/CUDA — DINOv2-small (q8) runs on CPU via onnxruntime — so it's a small,
# plain python image that can run anywhere (a NAS, a spare box, or beside the
# server).

FROM python:3.12-slim AS runtime

WORKDIR /app

# onnxruntime's manylinux wheel needs libgomp; Pillow's wheel is self-contained.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Bake the SAME q8 ONNX the browser loads (Xenova/dinov2-small) so the index and
# the in-browser query vectors come from identical weights — and so the runtime
# container needs no network for the model.
RUN python -c "import urllib.request, os; \
    os.makedirs('/models/dinov2-small', exist_ok=True); \
    urllib.request.urlretrieve('https://huggingface.co/Xenova/dinov2-small/resolve/main/onnx/model_quantized.onnx', '/models/dinov2-small/model_quantized.onnx')"

COPY worker.py ./

# Hardened: non-root uid 65532 (matches the project's container policy). Pair
# with read_only + tmpfs /tmp + cap_drop ALL + no-new-privileges at run time.
RUN useradd --uid 65532 --create-home --shell /usr/sbin/nologin worker \
    && chown -R 65532 /app /models
USER 65532

CMD ["python", "worker.py"]
