FROM python:3.11-slim

# gcc/g++ in case a dependency needs source builds on this Python version
RUN apt-get update && apt-get install -y --no-install-recommends gcc g++ \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv

WORKDIR /app

COPY pyproject.toml .
RUN uv pip install --system -r pyproject.toml

# GPU mode: build with ORT_GPU=1 (see docker-compose.gpu.yml). Installs the
# CUDA 12 build of onnxruntime-gpu (from the official ORT feed; the PyPI 1.29
# wheel targets CUDA 13) plus matching CUDA 12 runtime libs from PyPI.
ARG ORT_GPU=""
RUN if [ -n "$ORT_GPU" ]; then \
        uv pip install --system \
            --index-url https://aiinfra.pkgs.visualstudio.com/PublicPackages/_packaging/onnxruntime-cuda-12/pypi/simple/ \
            onnxruntime-gpu==1.29.0 \
        && uv pip install --system \
            nvidia-cuda-runtime-cu12 nvidia-cublas-cu12 nvidia-cudnn-cu12 \
            nvidia-cufft-cu12 nvidia-curand-cu12; \
    fi
# insightface depends on full opencv-python, which needs these runtime libs.
# (Separate layer after pip install to keep the big dependency layer cached.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Lets onnxruntime-gpu find the pip-installed CUDA libraries (no-op on CPU).
ENV LD_LIBRARY_PATH=/usr/local/lib/python3.11/site-packages/nvidia/cuda_runtime/lib:/usr/local/lib/python3.11/site-packages/nvidia/cublas/lib:/usr/local/lib/python3.11/site-packages/nvidia/cudnn/lib:/usr/local/lib/python3.11/site-packages/nvidia/cufft/lib:/usr/local/lib/python3.11/site-packages/nvidia/curand/lib

COPY ai_face ./ai_face
COPY main.py api.py reindex.py calibrate.py evaluate.py ./
COPY tests ./tests
COPY eval ./eval

# Model weights persist in a mounted volume; downloaded once on first start.
ENV FACE_MODELS_DIR=/models/face
RUN mkdir -p /models

CMD ["python", "main.py"]
