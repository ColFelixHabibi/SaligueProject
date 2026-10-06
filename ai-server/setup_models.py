"""Downloads Leffa's code and the open model weights Saligue AI Studio needs."""

import os
import subprocess
from pathlib import Path

from huggingface_hub import snapshot_download

LEFFA_DIR = Path(os.environ.get("LEFFA_DIR", "./Leffa"))

if not LEFFA_DIR.exists():
    # Leffa's inference code (MIT). Large files are not needed from this repo.
    subprocess.run(
        ["git", "clone", "--depth", "1", "https://huggingface.co/spaces/franciszzj/Leffa", str(LEFFA_DIR)],
        check=True,
        env={**os.environ, "GIT_LFS_SKIP_SMUDGE": "1"},
    )

# Only what try-on needs: no OpenPose (we use MediaPipe) and no 20 GB pose-transfer model.
snapshot_download(
    repo_id="franciszzj/Leffa",
    local_dir=str(LEFFA_DIR / "ckpts"),
    allow_patterns=[
        "densepose/*",
        "humanparsing/*",
        "stable-diffusion-inpainting/*",
        "virtual_tryon.pth",
        "virtual_tryon_dc.pth",
    ],
)

# SDXL inpainting weights (fp16) for "Dress me as I describe".
snapshot_download(
    repo_id=os.environ.get("SDXL_INPAINT", "diffusers/stable-diffusion-xl-1.0-inpainting-0.1"),
    allow_patterns=["*.json", "*.txt", "*fp16.safetensors", "tokenizer*/*"],
)
print("Models ready.")
