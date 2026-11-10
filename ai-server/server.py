"""
Saligue AI Studio — Saligue's own image AI server.

Runs open models on Saligue's own GPU machine (no third-party AI services):
  * Leffa (MIT, Meta 2025) — redraws a specific garment realistically on a person ("Wear this item").
  * Stable Diffusion XL Inpainting (OpenRAIL++) — redraws the clothing area from a text
    description ("Dress me as I describe"), keeping the face, hair, hands and background.

Body keypoints come from MediaPipe Pose (Apache-2.0) instead of OpenPose.

Endpoints (JSON in/out, images as data URLs):
  GET  /api/health                 what is loaded, how long the queue is, what has been learned
  POST /api/tryon  {person, garment, category, variant, quality}
  POST /api/dress  {person, prompt, negative, coverage, quality}
  POST /api/feedback {category, kept, engine, reason}   what the shopper did with a look

Quality: 'fast', 'high' (default) or 'ultra' choose the number of steps and how strongly the model follows the
garment/description. Every look is measured after it is drawn (how much of the clothing area really changed); a
look that barely changed is drawn once more with another seed and the better of the two is returned.

Learning: what shoppers keep is counted per part of the body in LEARN_FILE (studio-learning.json) and nudges the
guidance a little in the direction that produced kept looks. Nothing is trained; the counters are small and
readable, so a mistake can be corrected by editing one file.

Only Saligue's own server may call it: every request carries the secret key (header X-Saligue-Key), set with
SALIGUE_AI_KEY. A test page for the browser is served at /studio only when STUDIO_PAGE=1.
Install on a GPU server with install.sh.
"""

from __future__ import annotations

import base64
import io
import json
import os
import sys
import threading
import time
from contextlib import contextmanager
from pathlib import Path

import numpy as np
from fastapi import FastAPI, HTTPException
from PIL import Image, ImageFilter
from pydantic import BaseModel

VERSION = "2.0"
LEFFA_DIR = Path(os.environ.get("LEFFA_DIR", "./Leffa")).resolve()
CKPTS = Path(os.environ.get("LEFFA_CKPTS", LEFFA_DIR / "ckpts")).resolve()
SDXL_INPAINT = os.environ.get("SDXL_INPAINT", "diffusers/stable-diffusion-xl-1.0-inpainting-0.1")
STEPS = int(os.environ.get("STEPS", "32"))
API_KEY = os.environ.get("SALIGUE_AI_KEY", "")
# How long a request may wait for the GPU before it is told the AI is busy (seconds).
MAX_WAIT = int(os.environ.get("MAX_WAIT", "600"))
# How much of the clothing area must change before a look counts as "the garment really went on".
MIN_CHANGE = float(os.environ.get("MIN_CHANGE", "0.015"))
# Where what shoppers keep is counted (per part of the body); safe to delete to start learning again.
LEARN_FILE = Path(os.environ.get("LEARN_FILE", str(Path(__file__).resolve().parent / "studio-learning.json")))
sys.path.insert(0, str(LEFFA_DIR))

# How much work each quality setting asks for. 'high' is what the Fitting Room uses; 'ultra' is for a shopper who
# asked for the best; 'fast' is for a slow connection. Guidance = how strictly the model follows the garment/words.
QUALITY = {
    "fast": {"steps": 22, "guidance": 2.2, "dress_guidance": 6.0},
    "high": {"steps": STEPS, "guidance": 2.5, "dress_guidance": 7.0},
    "ultra": {"steps": 46, "guidance": 2.8, "dress_guidance": 7.6},
}

# Why a look is checked: the look that is tried on has the shoe box full of numbered weights, so keeping him
# in charge means the model never guesses how a garment hangs. This is the studio's own rule, not a learned one.
NEGATIVE_DEFAULT = (
    "deformed, extra limbs, extra fingers, bad hands, blurry, low quality, nude, underwear, text, watermark, logo, "
    "different person, changed face, duplicate person, cropped head, out of frame"
)
POSE_WORDS = "full body, head to toe, worn naturally, correct fit, realistic fabric, soft even light, sharp detail"


# ---------------------------------------------------------------------------
# One GPU, one job at a time
# ---------------------------------------------------------------------------


class GpuQueue:
    """Hands the GPU to one job at a time and says how many are waiting, so a busy studio is visible and capped."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._count = threading.Lock()
        self._waiting = 0
        self._job: str | None = None
        self._started = 0.0

    @contextmanager
    def run(self, job: str):
        with self._count:
            self._waiting += 1
        try:
            acquired = self._lock.acquire(timeout=MAX_WAIT)
        finally:
            with self._count:
                self._waiting -= 1
        if not acquired:
            raise HTTPException(status_code=503, detail="The AI is busy with other looks. Try again in a minute.")
        with self._count:
            self._job = job
            self._started = time.time()
        try:
            yield
        finally:
            with self._count:
                self._job = None
            self._lock.release()
            empty_cache()

    def status(self) -> dict:
        with self._count:
            busy = self._lock.locked()
            return {
                "busy": busy,
                "waiting": self._waiting,
                "job": self._job,
                "seconds": round(time.time() - self._started, 1) if busy else 0,
            }


gpu = GpuQueue()


def empty_cache() -> None:
    """After each job: give the GPU memory back, so Leffa and SDXL can take turns on one card."""
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:  # noqa: BLE001 - never fail a finished look because of housekeeping
        pass


# ---------------------------------------------------------------------------
# What shoppers keep (the studio's own small, readable learning file)
# ---------------------------------------------------------------------------

_learn_lock = threading.Lock()
_learn: dict | None = None


def learning() -> dict:
    """The counters file, read once and kept in memory. A corrupt file means "nothing learned yet", never a crash."""
    global _learn
    if _learn is None:
        try:
            _learn = json.loads(LEARN_FILE.read_text("utf-8")) if LEARN_FILE.exists() else {}
        except Exception as exc:  # noqa: BLE001
            print(f"studio-learning.json could not be read ({exc}); starting fresh.", flush=True)
            _learn = {}
        if not isinstance(_learn, dict):
            _learn = {}
    return _learn


def save_learning() -> None:
    """Write the counters atomically, so a power cut cannot leave half a file behind."""
    try:
        tmp = LEARN_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(learning(), indent=2, sort_keys=True), "utf-8")
        tmp.replace(LEARN_FILE)
    except Exception as exc:  # noqa: BLE001 - learning is a bonus, never a reason to fail a look
        print(f"studio-learning.json could not be written: {exc}", flush=True)


def learn(category: str, kept: bool) -> dict:
    """A shopper kept or threw away a look for this part of the body."""
    with _learn_lock:
        row = learning().setdefault(category, {"kept": 0, "rejected": 0})
        key = "kept" if kept else "rejected"
        row[key] = int(row.get(key, 0)) + 1
        save_learning()
        return {"kept": int(row.get("kept", 0)), "rejected": int(row.get("rejected", 0))}


def tuning(category: str) -> float:
    """
    How much extra push this part of the body needs, learned from kept looks: 0.9–1.1 around the preset.

    Looks that are kept mean the settings are right (1.0). Looks that are thrown away more often than kept push
    the guidance a little harder towards the garment/description, but never far: a wrong guess must not snowball.
    """
    with _learn_lock:
        row = learning().get(category)
    if not isinstance(row, dict):
        return 1.0
    kept, rejected = int(row.get("kept", 0)), int(row.get("rejected", 0))
    seen = kept + rejected
    if seen < 4:
        return 1.0
    keep_rate = kept / seen
    return round(max(0.9, min(1.1, 1.0 + (0.5 - keep_rate) * 0.2)), 3)


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


def encode_image(image: Image.Image, quality: int = 94) -> str:
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=quality, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode()


def fit_to_canvas(image: Image.Image, width: int, height: int) -> Image.Image:
    """Scale to fit inside width x height and center on white (keeps proportions, no cropping)."""
    scale = min(width / image.width, height / image.height)
    resized = image.resize((max(1, round(image.width * scale)), max(1, round(image.height * scale))), Image.LANCZOS)
    canvas = Image.new("RGB", (width, height), (255, 255, 255))
    canvas.paste(resized, ((width - resized.width) // 2, (height - resized.height) // 2))
    return canvas


def garment_change(before: Image.Image, after: Image.Image, mask: Image.Image) -> float:
    """
    How much of the clothing area really changed, 0–1 (mean difference inside the mask).

    This is the studio's own check that a garment was actually put on: the free models and a bad sampler run
    sometimes hand back the shopper's photo almost untouched, which is worse than an honest error.
    """
    width, height = 192, 256
    a = np.asarray(before.convert("RGB").resize((width, height)), dtype=np.float32)
    b = np.asarray(after.convert("RGB").resize((width, height)), dtype=np.float32)
    area = np.asarray(mask.convert("L").resize((width, height)), dtype=np.float32) > 127
    if area.sum() < 32:
        return 1.0  # Nothing to compare: never call a look broken because the mask came out empty.
    return float(np.abs(a - b).mean(axis=2)[area].mean() / 255.0)


def preset(quality: str | None, steps: int | None) -> dict:
    """The settings for this look: the preset the app asked for, with an explicit step count winning if given."""
    chosen = dict(QUALITY.get((quality or "high").lower(), QUALITY["high"]))
    if steps:
        chosen["steps"] = max(8, min(80, int(steps)))
    return chosen


# ---------------------------------------------------------------------------
# Body keypoints (MediaPipe → OpenPose-18 layout expected by Leffa's mask code)
# ---------------------------------------------------------------------------

_pose = None
_pose_lock = threading.Lock()

# OpenPose BODY_18 order: nose, neck, r-shoulder, r-elbow, r-wrist, l-shoulder, l-elbow, l-wrist,
# r-hip, r-knee, r-ankle, l-hip, l-knee, l-ankle, r-eye, l-eye, r-ear, l-ear
_MP_FOR_OPENPOSE = [0, None, 12, 14, 16, 11, 13, 15, 24, 26, 28, 23, 25, 27, 5, 2, 8, 7]


def openpose_keypoints(image: Image.Image) -> dict:
    global _pose
    import mediapipe as mp

    if _pose is None:
        with _pose_lock:
            if _pose is None:
                _pose = mp.solutions.pose.Pose(static_image_mode=True, model_complexity=2)
    result = _pose.process(np.array(image))
    if not result.pose_landmarks:
        raise HTTPException(status_code=422, detail="No person found in the photo. Use a photo from head to feet.")
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
# Human parsing (shared by Leffa's masks and the dressing mask)
# ---------------------------------------------------------------------------

_parsing = None
_parse_lock = threading.Lock()


def parsing():
    """Leffa's human-parsing models, loaded once. Shared, so 'dress me' never loads a diffusion model to parse."""
    global _parsing
    if _parsing is None:
        with _parse_lock:
            if _parsing is None:
                from preprocess.humanparsing.run_parsing import Parsing

                _parsing = Parsing(
                    atr_path=str(CKPTS / "humanparsing/parsing_atr.onnx"),
                    lip_path=str(CKPTS / "humanparsing/parsing_lip.onnx"),
                )
    return _parsing


# ---------------------------------------------------------------------------
# Leffa virtual try-on
# ---------------------------------------------------------------------------

_leffa: dict = {}
_leffa_lock = threading.Lock()


def leffa() -> dict:
    """Loads Leffa's models once (VITON-HD for tops, DressCode for bottoms and dresses)."""
    if _leffa:
        return _leffa
    with _leffa_lock:
        if _leffa:
            return _leffa
        from leffa.inference import LeffaInference
        from leffa.model import LeffaModel
        from leffa.transform import LeffaTransform
        from leffa_utils.densepose_predictor import DensePosePredictor
        from leffa_utils.utils import get_agnostic_mask_dc, get_agnostic_mask_hd

        _leffa["parsing"] = parsing()
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
GARMENT_WORDS = {
    "top": "top",
    "outerwear": "jacket or coat",
    "dress": "dress",
    "bottom": "trousers or skirt",
}


def try_on(person: Image.Image, garment: Image.Image, category: str, steps: int, variant: int = 0, guidance: float = 2.5) -> tuple[Image.Image, Image.Image]:
    """Draws the garment on the person and returns the picture with the mask it was allowed to change."""
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
    output = m["hd" if use_hd else "dc"](
        data,
        ref_acceleration=False,
        num_inference_steps=steps,
        guidance_scale=guidance,
        seed=42 + variant * 1009,
        repaint=False,
    )
    return output["generated_image"][0], mask


def try_on_checked(person: Image.Image, garment: Image.Image, category: str, steps: int, variant: int = 0, guidance: float = 2.5) -> tuple[Image.Image, dict]:
    """
    One try-on, checked: if the clothing area barely changed, try one other seed and keep the better picture.

    A photo that comes back almost untouched is the failure people notice most ("it did nothing"), so it is
    worth a second, different variation before anything is shown.
    """
    image, mask = try_on(person, garment, category, steps, variant, guidance)
    changed = garment_change(person, image, mask)
    attempts = 1
    if changed < MIN_CHANGE:
        attempts = 2
        again, mask2 = try_on(person, garment, category, steps, variant + 1, guidance)
        changed_again = garment_change(person, again, mask2)
        if changed_again > changed:
            image, changed = again, changed_again
    return image, {"changed": round(changed, 3), "attempts": attempts}


# ---------------------------------------------------------------------------
# SDXL inpainting: dress from a description
# ---------------------------------------------------------------------------

_sdxl = None
_sdxl_lock = threading.Lock()

# Human-parsing (ATR) labels: 0 bg, 1 hat, 2 hair, 3 sunglasses, 4 upper-clothes, 5 skirt, 6 pants, 7 dress,
# 8 belt, 9 left-shoe, 10 right-shoe, 11 face, 12 left-leg, 13 right-leg, 14 left-arm, 15 right-arm, 16 bag, 17 scarf
CLOTHES = [4, 5, 6, 7, 8, 9, 10, 16, 17]
LIMBS = [12, 13, 14, 15]
HEAD = [1, 2, 3, 11]


def sdxl():
    global _sdxl
    if _sdxl is None:
        with _sdxl_lock:
            if _sdxl is None:
                import torch
                from diffusers import AutoPipelineForInpainting

                pipeline = AutoPipelineForInpainting.from_pretrained(
                    SDXL_INPAINT,
                    torch_dtype=torch.float16,
                    variant="fp16",
                    use_safetensors=True,
                )
                # Shares the GPU with Leffa: keep only the active part of SDXL in GPU memory.
                pipeline.enable_model_cpu_offload()
                pipeline.enable_vae_slicing()
                pipeline.set_progress_bar_config(disable=True)
                if torch.cuda.is_available():
                    # Tensor cores for the attention work, which is most of a step's cost on a modern card.
                    torch.backends.cuda.matmul.allow_tf32 = True
                    torch.backends.cudnn.allow_tf32 = True
                _sdxl = pipeline
    return _sdxl


def clothing_mask(person: Image.Image, coverage: str) -> Image.Image:
    """White where clothes may be redrawn. 'full' also allows sleeves/trousers over arms and legs."""
    parse, _ = parsing()(person.resize((384, 512)))
    labels = np.array(parse)
    allowed = CLOTHES + (LIMBS if coverage == "full" else [])
    region = np.isin(labels, allowed)
    mask = Image.fromarray((region * 255).astype(np.uint8)).resize(person.size, Image.NEAREST)
    # Grow slightly so new clothes can have a different outline, but never cover the face or hair.
    mask = mask.filter(ImageFilter.MaxFilter(15))
    head = Image.fromarray((np.isin(labels, HEAD) * 255).astype(np.uint8)).resize(person.size, Image.NEAREST)
    head = head.filter(ImageFilter.MaxFilter(5))
    return Image.fromarray(np.where(np.array(head) > 0, 0, np.array(mask)).astype(np.uint8))


def dress(person: Image.Image, prompt: str, coverage: str, steps: int, guidance: float = 7.0, negative: str | None = None) -> tuple[Image.Image, dict]:
    """Redraws the clothes from the description and returns the picture with how much really changed."""
    src = fit_to_canvas(person, 768, 1024)
    mask = clothing_mask(src, coverage)
    pipe = sdxl()
    import torch

    generator = torch.Generator(device="cpu").manual_seed(42)
    image = pipe(
        prompt=(
            f"full body photograph of a person wearing {prompt}, {POSE_WORDS}, "
            "the same person, the same pose, photorealistic"
        ),
        negative_prompt=negative or NEGATIVE_DEFAULT,
        image=src,
        mask_image=mask,
        width=768,
        height=1024,
        strength=0.99,
        guidance_scale=guidance,
        num_inference_steps=steps,
        generator=generator,
    ).images[0]
    # Paste back everything outside the mask so the face, body and background stay exactly as photographed.
    soft = mask.filter(ImageFilter.GaussianBlur(4))
    finished = Image.composite(image, src, soft)
    return finished, {"changed": round(garment_change(src, finished, mask), 3)}


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------

app = FastAPI(title="Saligue AI Studio")


@app.middleware("http")
async def require_key(request, call_next):
    """Only Saligue's server (which knows the key) may use the AI; the health check stays open for monitoring."""
    import hmac

    from fastapi.responses import JSONResponse

    if request.url.path.startswith("/api/") and request.url.path != "/api/health":
        given = request.headers.get("x-saligue-key", "")
        if not API_KEY or not hmac.compare_digest(given, API_KEY):
            return JSONResponse({"detail": "Forbidden"}, status_code=403)
    return await call_next(request)


class TryOnRequest(BaseModel):
    person: str
    garment: str
    category: str = "top"
    steps: int | None = None
    # Another attempt asks for a different variation (Saligue retries when a look changed more than the garment).
    variant: int = 0
    # 'fast', 'high' (default) or 'ultra'.
    quality: str = "high"
    # The item's own words ("black denim jacket"), used only for logging and future prompts.
    description: str = ""


class DressRequest(BaseModel):
    person: str
    prompt: str
    coverage: str = "full"  # "full" (may cover arms/legs) or "clothes" (only where clothes already are)
    steps: int | None = None
    quality: str = "high"
    # Extra things to keep out of the picture (the app sends its own when it has them).
    negative: str | None = None


class FeedbackRequest(BaseModel):
    category: str = "top"
    kept: bool = True
    engine: str = "own"
    reason: str | None = None


@app.get("/api/health")
def health():
    import torch

    gpu_name = torch.cuda.get_device_name(0) if torch.cuda.is_available() else None
    memory = round(torch.cuda.get_device_properties(0).total_memory / 2**30) if gpu_name else None
    queue = gpu.status()
    return {
        "ok": True,
        "version": VERSION,
        "gpu": gpu_name,
        "memoryGb": memory,
        # `busy` stays at the top level because Saligue's server reads it to know when not to queue a look.
        "busy": queue["busy"],
        "queue": queue,
        "ready": bool(_leffa),
        "sdxlReady": _sdxl is not None,
        "keyed": bool(API_KEY),
        "presets": {name: values["steps"] for name, values in QUALITY.items()},
        "learning": {category: {"kept": int(row.get("kept", 0)), "rejected": int(row.get("rejected", 0))}
                     for category, row in learning().items() if isinstance(row, dict)},
    }


@app.post("/api/tryon")
def api_tryon(request: TryOnRequest):
    person, garment = decode_image(request.person), decode_image(request.garment)
    settings = preset(request.quality, request.steps)
    category = request.category if request.category in GARMENT_TYPES else "top"
    pull = tuning(category)
    with gpu.run("try-on"):
        start = time.time()
        result, quality = try_on_checked(
            person,
            garment,
            category,
            settings["steps"],
            max(0, min(request.variant, 5)),
            settings["guidance"] * pull,
        )
    return {
        "image": encode_image(result),
        "seconds": round(time.time() - start, 1),
        "quality": quality,
        "category": category,
        "engine": "saligue-studio",
    }


@app.post("/api/dress")
def api_dress(request: DressRequest):
    prompt = (request.prompt or "").strip()[:300]
    if not prompt:
        raise HTTPException(status_code=400, detail="Describe the outfit you want.")
    person = decode_image(request.person)
    settings = preset(request.quality, request.steps)
    negative = (request.negative or "").strip()[:400] or None
    with gpu.run("dress"):
        start = time.time()
        result, quality = dress(person, prompt, request.coverage, settings["steps"], settings["dress_guidance"], negative)
    return {"image": encode_image(result), "seconds": round(time.time() - start, 1), "quality": quality}


@app.post("/api/feedback")
def api_feedback(request: FeedbackRequest):
    """A shopper kept or threw a look away: counted per part of the body, and the tuning is nudged next time."""
    category = request.category if request.category in GARMENT_TYPES else "top"
    stats = learn(category, bool(request.kept))
    return {"ok": True, "category": category, "stats": stats, "tuning": tuning(category)}


def build_studio_page():
    """Simple browser page to test the AI directly at /studio."""
    import gradio as gr

    qualities = [("Fast", "fast"), ("High (recommended)", "high"), ("Best", "ultra")]

    def ui_tryon(person, garment, category, quality):
        with gpu.run("studio: try-on"):
            image, _ = try_on_checked(Image.fromarray(person).convert("RGB"), Image.fromarray(garment).convert("RGB"), category, preset(quality, None)["steps"])
            return image

    def ui_dress(person, prompt, coverage, quality, negative):
        with gpu.run("studio: dress"):
            settings = preset(quality, None)
            image, _ = dress(Image.fromarray(person).convert("RGB"), prompt, coverage, settings["steps"], settings["dress_guidance"], negative or None)
            return image

    theme = gr.themes.Default(primary_hue=gr.themes.colors.pink, secondary_hue=gr.themes.colors.red)
    with gr.Blocks(title="Saligue AI Studio", theme=theme) as demo:
        gr.Markdown("# Saligue AI Studio\nSaligue by INDECIANA — realistic outfits with Saligue's own AI.")
        with gr.Tab("Wear this item"):
            with gr.Row():
                person = gr.Image(label="Your photo")
                garment = gr.Image(label="Item photo")
                output = gr.Image(label="Result")
            category = gr.Radio(["top", "outerwear", "dress", "bottom"], value="top", label="Item type")
            quality = gr.Radio(qualities, value="high", label="Quality")
            gr.Button("Try it on", variant="primary").click(ui_tryon, [person, garment, category, quality], output)
        with gr.Tab("Dress me as I describe"):
            with gr.Row():
                person2 = gr.Image(label="Your photo")
                output2 = gr.Image(label="Result")
            prompt = gr.Textbox(label="Describe the outfit", placeholder="e.g. a navy blue suit with a white shirt and brown leather shoes")
            coverage = gr.Radio([("Whole outfit (may cover arms and legs)", "full"), ("Only current clothes", "clothes")], value="full", label="Coverage")
            quality2 = gr.Radio(qualities, value="high", label="Quality")
            negative2 = gr.Textbox(label="Keep out of the picture (optional)", placeholder="deformed, extra limbs, watermark")
            gr.Button("Dress me", variant="primary").click(ui_dress, [person2, prompt, coverage, quality2, negative2], output2)
    return demo


# The test page has no key check, so it is off unless asked for (e.g. while setting up).
if os.environ.get("STUDIO_PAGE", "0") == "1":
    import gradio as gr

    app = gr.mount_gradio_app(app, build_studio_page(), path="/studio")


if __name__ == "__main__":
    import uvicorn

    if os.environ.get("PRELOAD", "1") == "1":
        print("Loading Leffa…", flush=True)
        leffa()
    if os.environ.get("PRELOAD_SDXL", "0") == "1":
        print("Loading SDXL inpainting…", flush=True)
        sdxl()
    # Behind Caddy (HTTPS) on the same machine; not reachable directly from the internet.
    uvicorn.run(app, host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", "7860")))
