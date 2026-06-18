# syntax=docker/dockerfile:1.7
#
# FigureCollector image + text embedding worker. Unlike the gsplat worker this
# needs no GPU/CUDA — DINOv2-small (image) and multilingual-e5-small (text), both
# q8, run on CPU via onnxruntime — so it's a small, plain python image that can
# run anywhere (a NAS, a spare box, or beside the server).

FROM python:3.12-slim AS runtime

WORKDIR /app

# onnxruntime's manylinux wheel needs libgomp; Pillow's wheel is self-contained.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Bake the models the worker needs (no network at runtime): image (Xenova/
# dinov2-small) + text (Xenova/multilingual-e5-small + tokenizer) — same q8
# weights as the browser; the "search by look" VISION tower (onnx-community/
# siglip2-base-patch16-224-ONNX — browser holds the matching text tower); and the
# appearance tagger (SmilingWolf/wd-vit-tagger-v3 + its tags csv — worker-only,
# its output enriches the e5 text, so there's no in-browser counterpart).
RUN python -c "import urllib.request, os; \
    os.makedirs('/models/dinov2-small', exist_ok=True); \
    os.makedirs('/models/e5-small', exist_ok=True); \
    os.makedirs('/models/siglip2', exist_ok=True); \
    os.makedirs('/models/wd-tagger-v3', exist_ok=True); \
    urllib.request.urlretrieve('https://huggingface.co/Xenova/dinov2-small/resolve/main/onnx/model_quantized.onnx', '/models/dinov2-small/model_quantized.onnx'); \
    urllib.request.urlretrieve('https://huggingface.co/Xenova/multilingual-e5-small/resolve/main/onnx/model_quantized.onnx', '/models/e5-small/model_quantized.onnx'); \
    urllib.request.urlretrieve('https://huggingface.co/Xenova/multilingual-e5-small/resolve/main/tokenizer.json', '/models/e5-small/tokenizer.json'); \
    urllib.request.urlretrieve('https://huggingface.co/onnx-community/siglip2-base-patch16-224-ONNX/resolve/main/onnx/vision_model_quantized.onnx', '/models/siglip2/vision_model_quantized.onnx'); \
    urllib.request.urlretrieve('https://huggingface.co/SmilingWolf/wd-vit-tagger-v3/resolve/main/model.onnx', '/models/wd-tagger-v3/model.onnx'); \
    urllib.request.urlretrieve('https://huggingface.co/SmilingWolf/wd-vit-tagger-v3/resolve/main/selected_tags.csv', '/models/wd-tagger-v3/selected_tags.csv')"

COPY embed_index.py worker.py ./

# Hardened: non-root uid 65532 (matches the project's container policy). Pair
# with read_only + tmpfs /tmp + cap_drop ALL + no-new-privileges at run time.
RUN useradd --uid 65532 --create-home --shell /usr/sbin/nologin worker \
    && chown -R 65532 /app /models
USER 65532

CMD ["python", "worker.py"]
