"""
Saligue AI Studio — Saligue's own image AI server.

Runs open models on Saligue's own GPU machine (no third-party AI services):
  * Leffa (MIT, Meta 2025) — redraws a specific garment realistically on a person ("Wear this item").
  * Stable Diffusion XL Inpainting (OpenRAIL++) — redraws the clothing area from a text
    description ("Dress me as I describe"), keeping the face, hair, hands and background.

Body keypoints come from MediaPipe Pose (Apache-2.0) instead of OpenPose.

Endpoints (JSON in/out, images as data URLs):
  GET  /api/health
  POST /api/tryon  {person, garment, category}
  POST /api/dress  {person, prompt, coverage}
A test page for the browser is served at /studio.
"""

from __future__ import annotations

import base64
import io
import os
import sys
import threading
import time
from pathlib import Path

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, ImageFilter
from pydantic import BaseModel

LEFFA_DIR = Path(os.environ.get("LEFFA_DIR", "./Leffa")).resolve()
CKPTS = Path(os.environ.get("LEFFA_CKPTS", LEFFA_DIR / "ckpts")).resolve()
SDXL_INPAINT = os.environ.get("SDXL_INPAINT", "diffusers/stable-diffusion-xl-1.0-inpainting-0.1")
STEPS = int(os.environ.get("STEPS", "30"))
sys.path.insert(0, str(LEFFA_DIR))

# One GPU: run one job at a time.
gpu_lock = threading.Lock()

# ---------------------------------------------------------------------------
# Image helpers
# ---------------------------------------------------------------------------


def decode_image(data_url: str) -> Image.Image:
    try:
        payload = data_url.split(",", 1)[1] if data_url.startswith("data:") else data_url
        image = Image.open(io.BytesIO(base64.b64decode(payload)))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Invalid image: {exc}") from exc
    if image.mode in ("RGBA", "LA", "P"):
        # Cut-outs from the app have transparent backgrounds; the models expect a plain studio-like one.
        rgba = image.convert("RGBA")
        background = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        image = Image.alpha_composite(background, rgba)
    return image.convert("RGB")


def encode_image(image: Image.Image) -> str:
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=92)
    return "data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode()


def fit_to_canvas(image: Image.Image, width: int, height: int) -> Image.Image:
    """Scale to fit inside width x height and center on white (keeps proportions, no cropping)."""
    scale = min(width / image.width, height / image.height)
    resized = image.resize((max(1, round(image.width * scale)), max(1, round(image.height * scale))), Image.LANCZOS)
    canvas = Image.new("RGB", (width, height), (255, 255, 255))
    canvas.paste(resized, ((width - resized.width) // 2, (height - resized.height) // 2))
    return canvas


# ---------------------------------------------------------------------------
# Body keypoints (MediaPipe → OpenPose-18 layout expected by Leffa's mask code)
# ---------------------------------------------------------------------------

_pose = None

# OpenPose BODY_18 order: nose, neck, r-shoulder, r-elbow, r-wrist, l-shoulder, l-elbow, l-wrist,
# r-hip, r-knee, r-ankle, l-hip, l-knee, l-ankle, r-eye, l-eye, r-ear, l-ear
_MP_FOR_OPENPOSE = [0, None, 12, 14, 16, 11, 13, 15, 24, 26, 28, 23, 25, 27, 5, 2, 8, 7]


def openpose_keypoints(image: Image.Image) -> dict:
    global _pose
    import mediapipe as mp

    if _pose is None:
        _pose = mp.solutions.pose.Pose(static_image_mode=True, model_complexity=2)
    result = _pose.process(np.array(image))
    if not result.pose_landmarks:
        raise HTTPException(status_code=422, detail="No person found in the photo.")
    lm = result.pose_landmarks.landmark
    w, h = image.size
    points = []
    for index in _MP_FOR_OPENPOSE:
        if index is None:  # neck = midpoint of the shoulders
            points.append([(lm[11].x + lm[12].x) / 2 * w, (lm[11].y + lm[12].y) / 2 * h])
        else:
            points.append([lm[index].x * w, lm[index].y * h])
    return {"pose_keypoints_2d": points}


# ---------------------------------------------------------------------------
# Leffa virtual try-on
# ---------------------------------------------------------------------------

_leffa = {}


def leffa():
    """Loads Leffa's models once (VITON-HD for tops, DressCode for bottoms and dresses)."""
    if _leffa:
        return _leffa
    from leffa.inference import LeffaInference
    from leffa.model import LeffaModel
    from leffa.transform import LeffaTransform
    from leffa_utils.densepose_predictor import DensePosePredictor
    from leffa_utils.utils import get_agnostic_mask_dc, get_agnostic_mask_hd
    from preprocess.humanparsing.run_parsing import Parsing

    _leffa["parsing"] = Parsing(
        atr_path=str(CKPTS / "humanparsing/parsing_atr.onnx"),
        lip_path=str(CKPTS / "humanparsing/parsing_lip.onnx"),
    )
    _leffa["densepose"] = DensePosePredictor(
        config_path=str(CKPTS / "densepose/densepose_rcnn_R_50_FPN_s1x.yaml"),
        weights_path=str(CKPTS / "densepose/model_final_162be9.pkl"),
    )
    for name, weights in (("hd", "virtual_tryon.pth"), ("dc", "virtual_tryon_dc.pth")):
        model = LeffaModel(
            pretrained_model_name_or_path=str(CKPTS / "stable-diffusion-inpainting"),
            pretrained_model=str(CKPTS / weights),
            dtype="float16",
        )
        _leffa[name] = LeffaInference(model=model)
    _leffa["transform"] = LeffaTransform()
    _leffa["mask_hd"] = get_agnostic_mask_hd
    _leffa["mask_dc"] = get_agnostic_mask_dc
    return _leffa


# Saligue categories → Leffa garment types. Others (shoes, hats, bags…) stay on-device.
GARMENT_TYPES = {"top": "upper_body", "outerwear": "upper_body", "dress": "dresses", "bottom": "lower_body"}


def try_on(person: Image.Image, garment: Image.Image, category: str, steps: int) -> Image.Image:
    garment_type = GARMENT_TYPES.get(category)
    if not garment_type:
        raise HTTPException(status_code=422, detail=f"Realistic try-on supports tops, jackets, dresses and trousers, not '{category}'.")
    m = leffa()
    src = fit_to_canvas(person, 768, 1024)
    ref = fit_to_canvas(garment, 768, 1024)

    small = src.resize((384, 512))
    parse, _ = m["parsing"](small)
    keypoints = openpose_keypoints(small)
    use_hd = garment_type == "upper_body"
    mask = (m["mask_hd"] if use_hd else m["mask_dc"])(parse, keypoints, garment_type).resize((768, 1024))

    src_array = np.array(src)
    if use_hd:
        densepose = Image.fromarray(m["densepose"].predict_seg(src_array)[:, :, ::-1])
    else:
        iuv = m["densepose"].predict_iuv(src_array)
        densepose = Image.fromarray(np.concatenate([iuv[:, :, 0:1]] * 3, axis=-1))

    data = m["transform"]({"src_image": [src], "ref_image": [ref], "mask": [mask], "densepose": [densepose]})
    output = m["hd" if use_hd else "dc"](data, ref_acceleration=False, num_inference_steps=steps, guidance_scale=2.5, seed=42, repaint=False)
    return output["generated_image"][0]


# ---------------------------------------------------------------------------
# SDXL inpainting: dress from a description
# ---------------------------------------------------------------------------

_sdxl = None

# Human-parsing (ATR) labels: 0 bg, 1 hat, 2 hair, 3 sunglasses, 4 upper-clothes, 5 skirt, 6 pants, 7 dress,
# 8 belt, 9 left-shoe, 10 right-shoe, 11 face, 12 left-leg, 13 right-leg, 14 left-arm, 15 right-arm, 16 bag, 17 scarf
CLOTHES = [4, 5, 6, 7, 8, 9, 10, 16, 17]
LIMBS = [12, 13, 14, 15]
HEAD = [1, 2, 3, 11]


def sdxl():
    global _sdxl
    if _sdxl is None:
        import torch
        from diffusers import AutoPipelineForInpainting

        _sdxl = AutoPipelineForInpainting.from_pretrained(SDXL_INPAINT, torch_dtype=torch.float16, variant="fp16")
        # Shares the GPU with Leffa: keep only the active part of SDXL in GPU memory.
        _sdxl.enable_model_cpu_offload()
    return _sdxl


def clothing_mask(person: Image.Image, coverage: str) -> Image.Image:
    """White where clothes may be redrawn. 'full' also allows sleeves/trousers over arms and legs."""
    parse, _ = leffa()["parsing"](person.resize((384, 512)))
    labels = np.array(parse)
    allowed = CLOTHES + (LIMBS if coverage == "full" else [])
    region = np.isin(labels, allowed)
    mask = Image.fromarray((region * 255).astype(np.uint8)).resize(person.size, Image.NEAREST)
    # Grow slightly so new clothes can have a different outline, but never cover the face or hair.
    mask = mask.filter(ImageFilter.MaxFilter(15))
    head = Image.fromarray((np.isin(labels, HEAD) * 255).astype(np.uint8)).resize(person.size, Image.NEAREST)
    head = head.filter(ImageFilter.MaxFilter(5))
    return Image.fromarray(np.where(np.array(head) > 0, 0, np.array(mask)).astype(np.uint8))


def dress(person: Image.Image, prompt: str, coverage: str, steps: int) -> Image.Image:
    src = fit_to_canvas(person, 768, 1024)
    mask = clothing_mask(src, coverage)
    pipe = sdxl()
    import torch

    generator = torch.Generator(device="cpu").manual_seed(42)
    image = pipe(
        prompt=f"full body photo of a person wearing {prompt}, realistic fabric, natural fit, studio fashion photography, high detail",
        negative_prompt="deformed, extra limbs, bad hands, blurry, low quality, nude, text, watermark",
        image=src,
        mask_image=mask,
        width=768,
        height=1024,
        strength=0.99,
        guidance_scale=7.0,
        num_inference_steps=steps,
        generator=generator,
    ).images[0]
    # Paste back everything outside the mask so the face, body and background stay exactly as photographed.
    soft = mask.filter(ImageFilter.GaussianBlur(4))
    return Image.composite(image, src, soft)


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------

app = FastAPI(title="Saligue AI Studio")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


class TryOnRequest(BaseModel):
    person: str
    garment: str
    category: str = "top"
    steps: int | None = None


class DressRequest(BaseModel):
    person: str
    prompt: str
    coverage: str = "full"  # "full" (may cover arms/legs) or "clothes" (only where clothes already are)
    steps: int | None = None


@app.get("/api/health")
def health():
    import torch

    return {"ok": True, "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None, "busy": gpu_lock.locked()}


@app.post("/api/tryon")
def api_tryon(request: TryOnRequest):
    person, garment = decode_image(request.person), decode_image(request.garment)
    with gpu_lock:
        start = time.time()
        result = try_on(person, garment, request.category, request.steps or STEPS)
    return {"image": encode_image(result), "seconds": round(time.time() - start, 1)}


@app.post("/api/dress")
def api_dress(request: DressRequest):
    if not request.prompt.strip():
        raise HTTPException(status_code=400, detail="Describe the outfit you want.")
    person = decode_image(request.person)
    with gpu_lock:
        start = time.time()
        result = dress(person, request.prompt.strip()[:300], request.coverage, request.steps or STEPS)
    return {"image": encode_image(result), "seconds": round(time.time() - start, 1)}


def build_studio_page():
    """Simple browser page to test the AI directly at /studio."""
    import gradio as gr

    def ui_tryon(person, garment, category):
        with gpu_lock:
            return try_on(Image.fromarray(person).convert("RGB"), Image.fromarray(garment).convert("RGB"), category, STEPS)

    def ui_dress(person, prompt, coverage):
        with gpu_lock:
            return dress(Image.fromarray(person).convert("RGB"), prompt, coverage, STEPS)

    theme = gr.themes.Default(primary_hue=gr.themes.colors.pink, secondary_hue=gr.themes.colors.red)
    with gr.Blocks(title="Saligue AI Studio", theme=theme) as demo:
        gr.Markdown("# Saligue AI Studio\nSaligue by INDECIANA — realistic outfits with Saligue's own AI.")
        with gr.Tab("Wear this item"):
            with gr.Row():
                person = gr.Image(label="Your photo")
                garment = gr.Image(label="Item photo")
                output = gr.Image(label="Result")
            category = gr.Radio(["top", "outerwear", "dress", "bottom"], value="top", label="Item type")
            gr.Button("Try it on", variant="primary").click(ui_tryon, [person, garment, category], output)
        with gr.Tab("Dress me as I describe"):
            with gr.Row():
                person2 = gr.Image(label="Your photo")
                output2 = gr.Image(label="Result")
            prompt = gr.Textbox(label="Describe the outfit", placeholder="e.g. a navy blue suit with a white shirt and brown leather shoes")
            coverage = gr.Radio([("Whole outfit (may cover arms and legs)", "full"), ("Only current clothes", "clothes")], value="full", label="Coverage")
            gr.Button("Dress me", variant="primary").click(ui_dress, [person2, prompt, coverage], output2)
    return demo


if os.environ.get("STUDIO_PAGE", "1") == "1":
    import gradio as gr

    app = gr.mount_gradio_app(app, build_studio_page(), path="/studio")


if __name__ == "__main__":
    import uvicorn

    if os.environ.get("PRELOAD", "1") == "1":
        print("Loading Leffa…", flush=True)
        leffa()
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "7860")))
