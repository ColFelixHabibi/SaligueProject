'use client';

import { LM, type Point } from './pose';
import { alphaComponents, context2d, createCanvas, cropCanvas, garmentBodyWidth, trimTransparent } from './canvas';
import type { Category } from '@/lib/categories';
import { PART, averageColor, partMask, type Parsing } from './parse';

export type DressResult = {
  canvas: HTMLCanvasElement;
  // False when the item could not be placed on the body and is shown beside the person instead.
  fitted: boolean;
  note?: string;
};

const MIN_VISIBILITY = 0.35;

const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, visibility: Math.min(a.visibility, b.visibility) });
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const visible = (...points: Point[]) => points.every((p) => p.visibility >= MIN_VISIBILITY);

// Tilt of the line between two points, kept within ±90° so a person facing away isn't drawn upside down.
function tilt(from: Point, to: Point) {
  let angle = Math.atan2(to.y - from.y, to.x - from.x);
  if (angle > Math.PI / 2) angle -= Math.PI;
  if (angle < -Math.PI / 2) angle += Math.PI;
  return angle;
}

type Placement = {
  x: number; // anchor x
  y: number; // anchor y
  width: number;
  height?: number; // when set, overrides the height implied by the item's aspect ratio
  angle?: number;
  anchor: 'top' | 'center' | 'bottom';
  mirror?: boolean;
  // Draw this image instead of the whole item (e.g. one shoe of a pair).
  image?: HTMLCanvasElement;
  // Part of the person's photo to remove first (their own shoe), as a polygon in photo pixels.
  erase?: { x: number; y: number }[];
};

// Rotation that lines an upright garment up with the body axis running from `top` down to `bottom`.
function axisAngle(top: Point, bottom: Point) {
  return Math.atan2(-(bottom.x - top.x), bottom.y - top.y);
}

// For a side-on shoe photo, which way the toe points: the heel end is taller than the toe end.
function toePointsRight(shoe: HTMLCanvasElement) {
  const { width, height } = shoe;
  const alpha = context2d(shoe).getImageData(0, 0, width, height).data;
  const columnHeight = (x: number) => {
    let top = -1, bottom = -1;
    for (let y = 0; y < height; y++) {
      if (alpha[(y * width + x) * 4 + 3] > 64) {
        if (top < 0) top = y;
        bottom = y;
      }
    }
    return top < 0 ? 0 : bottom - top;
  };
  const sample = (from: number, to: number) => {
    let sum = 0;
    for (let x = Math.floor(from); x < to; x++) sum += columnHeight(x);
    return sum;
  };
  return sample(0, width * 0.25) > sample(width * 0.75, width);
}

function drawItem(ctx: CanvasRenderingContext2D, whole: HTMLCanvasElement, p: Placement) {
  const item = p.image ?? whole;
  const w = p.width;
  const h = p.height ?? (item.height / item.width) * w;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.angle ?? 0);
  if (p.mirror) ctx.scale(-1, 1);
  const top = p.anchor === 'top' ? 0 : p.anchor === 'center' ? -h / 2 : -h;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(item, -w / 2, top, w, h);
  ctx.restore();
}

// Where (and how big) each kind of item goes on the body. Returns null when the needed body parts aren't visible.
function placementsFor(category: Category, lm: Point[], item: HTMLCanvasElement): Placement[] | string {
  const ls = lm[LM.leftShoulder], rs = lm[LM.rightShoulder];
  const lh = lm[LM.leftHip], rh = lm[LM.rightHip];
  const shoulders = mid(ls, rs), hips = mid(lh, rh);
  const shoulderW = dist(ls, rs);
  const hipW = dist(lh, rh);
  const torso = dist(shoulders, hips);
  const aspect = item.height / item.width;

  switch (category) {
    case 'top':
    case 'outerwear':
    case 'dress': {
      if (!visible(ls, rs)) return 'Your shoulders need to be visible in the photo.';
      // Match the garment's body (not its sleeves) to the chest. Turned sideways the shoulders look
      // narrow, so the torso length sets a minimum size.
      const loose = category === 'outerwear' ? 1.12 : 1;
      const chest = Math.max(shoulderW * 1.15, torso * 0.62) * loose;
      const scale = chest / garmentBodyWidth(item);
      return [{
        x: shoulders.x,
        y: shoulders.y - torso * (category === 'outerwear' ? 0.16 : 0.12),
        width: item.width * scale,
        angle: visible(lh, rh) ? axisAngle(shoulders, hips) : tilt(rs, ls),
        anchor: 'top',
      }];
    }
    case 'bottom': {
      if (!visible(lh, rh)) return 'Your hips need to be visible in the photo.';
      const top = hips.y - torso * 0.14;
      const la = lm[LM.leftAnkle], ra = lm[LM.rightAnkle];
      const isLong = aspect > 1.4;
      if (isLong && visible(la, ra)) {
        // Trousers: stretch from waist to just below the ankles.
        const length = mid(la, ra).y - top + torso * 0.08;
        return [{ x: hips.x, y: top, width: length / aspect, anchor: 'top', angle: tilt(rh, lh) }];
      }
      return [{ x: hips.x, y: top, width: Math.max(hipW * 2.4, shoulderW * 1.2), anchor: 'top', angle: tilt(rh, lh) }];
    }
    case 'shoes': {
      const feet = [
        footOf(lm[LM.leftHeel], lm[LM.leftFootIndex], lm[LM.leftAnkle], lm[LM.leftKnee], hips.x),
        footOf(lm[LM.rightHeel], lm[LM.rightFootIndex], lm[LM.rightAnkle], lm[LM.rightKnee], hips.x),
      ];
      // Feet are often hidden or crossed; only dress the ones whose ankle the detector found.
      const confident = (f: (typeof feet)[number]) => f.ankle.visibility >= 0.5 && f.ankle.y > f.knee.y;
      if (!feet.some(confident)) return 'Your feet need to be visible in the photo.';

      // A pair photographed side by side splits into two shoes; otherwise use the photo for each foot.
      const pieces = alphaComponents(item);
      const shoes =
        pieces.length >= 2 && pieces[1].area > pieces[0].area * 0.4
          ? [cropCanvas(item, pieces[0]), cropCanvas(item, pieces[1])]
          : [item, item];

      return feet.flatMap((f, i) => {
        if (!confident(f)) return [];
        const shoe = shoes[i];
        // Foot length from the landmarks, but at least ~half the shin (feet facing the camera look short).
        const shin = dist(f.knee, f.ankle);
        const footLen = Math.max(dist(f.heel, f.toe) * 1.3, shin * 0.5, torso * 0.2);
        const pointsRight = f.toe.x >= f.heel.x;
        // Tilt the shoe along the foot (heel → toe), measured in the direction the foot points.
        const along = pointsRight ? Math.atan2(f.toe.y - f.heel.y, f.toe.x - f.heel.x) : Math.atan2(f.heel.y - f.toe.y, f.heel.x - f.toe.x);
        const angle = Math.max(-0.6, Math.min(0.6, along));
        const ground = Math.max(f.heel.y, f.toe.y) + footLen * 0.06;
        // The old shoe: everything around the foot below the trouser hem.
        const m = footLen * 0.32;
        const top = f.ankle.y - footLen * 0.05;
        const left = Math.min(f.heel.x, f.toe.x, f.ankle.x) - m;
        const right = Math.max(f.heel.x, f.toe.x, f.ankle.x) + m;
        return [{
          image: shoe,
          x: (f.heel.x + f.toe.x) / 2,
          y: ground,
          width: footLen,
          angle,
          anchor: 'bottom' as const,
          // Turn the shoe so its toe points the same way as the foot.
          mirror: toePointsRight(shoe) !== pointsRight,
          erase: [
            { x: left, y: top },
            { x: right, y: top },
            { x: right, y: ground + m * 0.5 },
            { x: left, y: ground + m * 0.5 },
          ],
        }];
      });
    }
    case 'hat': {
      const head = headOf(lm, shoulderW);
      if (!head) return 'Your face needs to be visible in the photo.';
      // The brim is a little wider than the head; it sits on the forehead, above the eyebrows.
      return [{ x: head.center.x, y: head.eyes.y - head.width * 0.28, width: head.width * 1.3, angle: head.angle, anchor: 'bottom' }];
    }
    case 'eyewear': {
      const head = headOf(lm, shoulderW);
      if (!head) return 'Your face needs to be visible in the photo.';
      return [{ x: head.eyes.x, y: head.eyes.y + head.width * 0.03, width: head.width * 0.98, angle: head.angle, anchor: 'center' }];
    }
    case 'bag': {
      // Carried in the hand that hangs lowest (most likely relaxed at the side).
      const hands = [lm[LM.leftWrist], lm[LM.rightWrist]].filter((w) => w.visibility >= 0.5);
      if (!hands.length) return 'Your hands need to be visible in the photo.';
      const hand = hands.reduce((a, b) => (b.y > a.y ? b : a));
      // About half the torso tall (handbag size), keeping the bag's own proportions.
      const height = torso * 0.55;
      const width = Math.min(height / aspect, shoulderW * 1.1);
      const outward = hand.x < shoulders.x ? -1 : 1;
      return [{ x: hand.x + outward * width * 0.15, y: hand.y - torso * 0.04, width, anchor: 'top' }];
    }
    default:
      // Watches, belts, jewellery and other small accessories are shown beside the person.
      return 'This item is shown next to you.';
  }
}

type Foot = { heel: Point; toe: Point; ankle: Point; knee: Point };

// When heel or toe are hidden (long trousers, facing the camera), estimate them from the ankle and shin,
// with the toe turned slightly outward (away from the body's centre line at `centerX`).
function footOf(heel: Point, toe: Point, ankle: Point, knee: Point, centerX: number): Foot {
  if (heel.visibility >= 0.5 && toe.visibility >= 0.5) return { heel, toe, ankle, knee };
  const shin = dist(knee, ankle);
  const ground = ankle.y + shin * 0.12;
  const out = ankle.x >= centerX ? 1 : -1;
  return {
    heel: { x: ankle.x - out * shin * 0.06, y: ground, visibility: ankle.visibility },
    toe: { x: ankle.x + out * shin * 0.06, y: ground, visibility: ankle.visibility },
    ankle,
    knee,
  };
}

// Head size, eye line and tilt from the face landmarks; falls back to shoulder width for the size.
function headOf(lm: Point[], shoulderW: number) {
  const le = lm[LM.leftEye], re = lm[LM.rightEye], lear = lm[LM.leftEar], rear = lm[LM.rightEar];
  if (!visible(le, re)) return null;
  const eyes = mid(le, re);
  const earsSeen = visible(lear, rear);
  const width = Math.max(earsSeen ? dist(lear, rear) * 1.15 : 0, dist(le, re) * 2.6, shoulderW * 0.42);
  return {
    eyes,
    center: earsSeen ? mid(lear, rear) : eyes,
    width,
    angle: earsSeen ? tilt(rear, lear) : tilt(re, le),
  };
}

// Small accessories (watches, belts, jewellery) are shown next to the person at a life-like size.
const BESIDE = new Set<Category>(['accessory']);
// Item height beside the person, as a share of the person's height (roughly life-size).
const BESIDE_SIZE: Partial<Record<Category, number>> = {
  top: 0.3, outerwear: 0.32, dress: 0.5, bottom: 0.42, shoes: 0.12, hat: 0.16, eyewear: 0.09, bag: 0.3, accessory: 0.14,
};

/** A copy of the person with some areas removed (e.g. their own shoes), with soft edges. */
function withErased(person: HTMLCanvasElement, areas: { x: number; y: number }[][]) {
  if (!areas.length) return person;
  const copy = createCanvas(person.width, person.height);
  const ctx = context2d(copy);
  ctx.drawImage(person, 0, 0);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.filter = `blur(${Math.max(2, Math.round(person.height * 0.004))}px)`;
  ctx.fillStyle = '#000';
  for (const area of areas) {
    ctx.beginPath();
    area.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.fill();
  }
  return copy;
}

// Items that could not be put on the body are shown in a column next to the person, at a life-like size.
function besideItems(dressed: HTMLCanvasElement, personHeight: number, items: { canvas: HTMLCanvasElement; category: Category }[]) {
  if (!items.length) return dressed;
  const sized = items.map(({ canvas, category }) => {
    const height = personHeight * (BESIDE_SIZE[category] ?? 0.45) * (items.length > 1 ? 0.8 : 1);
    return { canvas, height, width: (canvas.width / canvas.height) * height };
  });
  const gap = personHeight * 0.03;
  const columnWidth = Math.max(...sized.map((s) => s.width));
  const columnHeight = sized.reduce((sum, s) => sum + s.height, 0) + gap * (sized.length - 1);
  const height = Math.max(dressed.height, columnHeight);
  const canvas = createCanvas(dressed.width + gap * 2 + columnWidth, height);
  const ctx = context2d(canvas);
  ctx.drawImage(dressed, 0, (height - dressed.height) / 2);
  let y = (height - columnHeight) / 2;
  for (const s of sized) {
    ctx.drawImage(s.canvas, dressed.width + gap * 2 + (columnWidth - s.width) / 2, y, s.width, s.height);
    y += s.height + gap;
  }
  return canvas;
}

// Order in which a full outfit is put on: shoes first, trousers over them, then tops and jackets,
// and finally what is carried or sits on the head.
const LAYER_ORDER: Category[] = ['shoes', 'bottom', 'dress', 'top', 'outerwear', 'bag', 'eyewear', 'hat', 'accessory'];

// What the shopper is already wearing that a new item takes the place of. A jacket goes over the shirt,
// so it replaces nothing; a dress replaces both the top and the trousers.
const REPLACED_PARTS: Partial<Record<Category, number[]>> = {
  top: [PART.upperClothes],
  dress: [PART.upperClothes, PART.dress, PART.skirt, PART.pants],
  bottom: [PART.skirt, PART.pants],
  shoes: [PART.leftShoe, PART.rightShoe],
  hat: [PART.hat],
  eyewear: [PART.sunglasses],
};
// Parts of the body a new garment must not cover: the face and hair, and for trousers the hands and arms in front of them.
const KEEP_IN_FRONT: Partial<Record<Category, number[]>> = {
  top: [PART.face, PART.hair],
  outerwear: [PART.face, PART.hair],
  dress: [PART.face, PART.hair],
  bottom: [PART.leftArm, PART.rightArm],
};
const SKIN = [PART.face, PART.leftArm, PART.rightArm, PART.leftLeg, PART.rightLeg];

export type OutfitPiece = { canvas: HTMLCanvasElement; category: Category };
export type DressOptions = {
  // What the shopper is wearing in the photo (see parseClothes). With it, old clothes are taken off first.
  parsing?: Parsing | null;
  // Show items that can't be worn (body part not in the photo) next to the person. Default true.
  showMissing?: boolean;
};
export type OutfitResult = DressResult & {
  // Items not worn because that part of the body is not in the photo.
  missing: Category[];
};

// Landmarks outside the photo are guesses; treat them as not visible.
function inFrame(landmarks: Point[], width: number, height: number): Point[] {
  return landmarks.map((p) =>
    p.x < -0.02 * width || p.x > 1.02 * width || p.y < -0.02 * height || p.y > 1.02 * height ? { ...p, visibility: 0 } : p
  );
}

/**
 * Takes off what the new outfit replaces: the old shirt, trousers, hat or glasses become skin
 * (or hair, under a hat), lit like the rest of the photo; old shoes are removed.
 */
function undress(person: HTMLCanvasElement, parsing: Parsing, categories: Category[]) {
  const { width, height } = person;
  const replaced = [...new Set(categories.flatMap((c) => REPLACED_PARTS[c] ?? []))];
  if (!replaced.length) return person;
  const copy = createCanvas(width, height);
  const ctx = context2d(copy);
  ctx.drawImage(person, 0, 0);

  const shoes = replaced.filter((p) => p === PART.leftShoe || p === PART.rightShoe);
  if (shoes.length) {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(partMask(parsing, shoes, width, height), 0, 0);
    ctx.globalCompositeOperation = 'source-over';
  }

  const toSkin = replaced.filter((p) => p !== PART.leftShoe && p !== PART.rightShoe && p !== PART.hat);
  const toHair = replaced.filter((p) => p === PART.hat);
  const skin = averageColor(person, parsing, SKIN) ?? [176, 128, 98];
  const hair = averageColor(person, parsing, [PART.hair]) ?? [40, 30, 26];
  const fills: [number[], [number, number, number]][] = [[toSkin, skin], [toHair, hair]];

  // Broad light and shadow of the photo, so the new skin isn't flat.
  const grow = Math.max(2, Math.round(Math.max(width, height) * 0.012));
  const light = createCanvas(width, height);
  const lightCtx = context2d(light);
  lightCtx.filter = `grayscale(1) blur(${grow * 3}px)`;
  lightCtx.drawImage(person, 0, 0);
  const shade = lightCtx.getImageData(0, 0, width, height).data;

  const image = ctx.getImageData(0, 0, width, height);
  const px = image.data;
  for (const [parts, color] of fills) {
    if (!parts.length) continue;
    const mask = context2d(partMask(parsing, parts, width, height)).getImageData(0, 0, width, height).data;
    let sum = 0, count = 0;
    for (let i = 3; i < mask.length; i += 4) {
      if (mask[i] > 128) {
        sum += shade[i - 3];
        count++;
      }
    }
    const mean = count ? sum / count : 128;
    for (let i = 0; i < px.length; i += 4) {
      const m = mask[i + 3] / 255;
      if (!m || !px[i + 3]) continue;
      const f = Math.min(1.15, Math.max(0.75, Math.pow(Math.max(shade[i], 1) / mean, 0.6)));
      for (let c = 0; c < 3; c++) px[i + c] = px[i + c] * (1 - m) + Math.min(255, color[c] * f) * m;
    }
  }
  ctx.putImageData(image, 0, 0);
  return copy;
}

/**
 * Dresses a person (transparent cut-out) in a whole outfit (transparent cut-outs) using body landmarks:
 * what they wore is taken off, then clothes go on the body, shoes on the feet, hats on the head,
 * glasses on the eyes and bags in the hand, in the order people get dressed.
 */
export function dressOutfit(person: HTMLCanvasElement, landmarks: Point[] | null, pieces: OutfitPiece[], options: DressOptions = {}): OutfitResult {
  const { parsing = null, showMissing = true } = options;
  const lm = landmarks ? inFrame(landmarks, person.width, person.height) : null;
  const ordered = pieces
    .map((p) => ({ canvas: trimTransparent(p.canvas, 0), category: p.category }))
    .sort((a, b) => LAYER_ORDER.indexOf(a.category) - LAYER_ORDER.indexOf(b.category));

  const worn: { item: HTMLCanvasElement; category: Category; placements: Placement[] }[] = [];
  const beside: OutfitPiece[] = [];
  const missing: Category[] = [];
  const notes: string[] = [];
  for (const piece of ordered) {
    if (BESIDE.has(piece.category)) {
      beside.push(piece);
      continue;
    }
    const placements = lm ? placementsFor(piece.category, lm, piece.canvas) : 'No body was detected in your photo.';
    if (typeof placements === 'string') {
      missing.push(piece.category);
      if (showMissing) beside.push(piece);
      if (!notes.includes(placements)) notes.push(placements);
    } else {
      worn.push({ item: piece.canvas, category: piece.category, placements });
    }
  }
  const note = notes.join(' ') || undefined;

  // Leave room around the person in case an item extends past the photo.
  const pad = Math.round(Math.max(person.width, person.height) * 0.15);
  const canvas = createCanvas(person.width + pad * 2, person.height + pad * 2);
  const ctx = context2d(canvas);
  const base = parsing
    ? undress(person, parsing, worn.map((w) => w.category))
    : withErased(person, worn.flatMap((w) => w.placements.flatMap((p) => (p.erase ? [p.erase] : []))));
  ctx.drawImage(base, pad, pad);

  // Each item goes on its own layer so it can be fitted to the body before being added.
  for (const { item, category, placements } of worn) {
    const layer = createCanvas(canvas.width, canvas.height);
    const layerCtx = context2d(layer);
    for (const p of placements) drawItem(layerCtx, item, { ...p, x: p.x + pad, y: p.y + pad });
    if (WORN.has(category)) {
      const front = KEEP_IN_FRONT[category];
      wearOnBody(layer, person, pad, parsing && front ? partMask(parsing, front, person.width, person.height) : null);
    }
    ctx.drawImage(layer, 0, 0);
  }

  const dressed = trimTransparent(canvas, 12);
  return { canvas: trimTransparent(besideItems(dressed, person.height, beside), 12), fitted: !note, note, missing };
}

/** Puts a single item on the person (see dressOutfit). */
export function dressPerson(person: HTMLCanvasElement, landmarks: Point[] | null, item: HTMLCanvasElement, category: Category, parsing?: Parsing | null): OutfitResult {
  return dressOutfit(person, landmarks, [{ canvas: item, category }], { parsing });
}

// Clothes that cover the body: trimmed to the body outline and shaded with the photo's light.
const WORN = new Set<Category>(['top', 'outerwear', 'dress', 'bottom']);

/**
 * Makes a garment look worn rather than pasted on:
 * - keeps it within the person's outline (slightly widened, since clothes sit on top of the body),
 *   and behind the parts in `keep` (face, hair, or arms in front of trousers);
 * - carries the photo's light and shadows (folds, body shading) onto the garment.
 */
function wearOnBody(layer: HTMLCanvasElement, person: HTMLCanvasElement, pad: number, keep: HTMLCanvasElement | null) {
  const { width, height } = layer;
  const grow = Math.max(2, Math.round(Math.max(person.width, person.height) * 0.012));

  // Body outline, slightly widened, in layer coordinates.
  const outline = createCanvas(width, height);
  const outlineCtx = context2d(outline);
  // Widen the outline by drawing the person several times, blurred: any trace of body counts as inside.
  for (const radius of [grow, grow * 2, grow * 4]) {
    outlineCtx.filter = `blur(${radius}px)`;
    outlineCtx.drawImage(person, pad, pad);
  }
  outlineCtx.filter = 'none';

  // Light and shadow of the photo, softened so only broad shading (not the old clothes' details) carries over.
  const light = createCanvas(width, height);
  const lightCtx = context2d(light);
  lightCtx.filter = `grayscale(1) blur(${grow * 3}px)`;
  lightCtx.drawImage(person, pad, pad);
  lightCtx.filter = 'none';

  let front: Uint8ClampedArray | null = null;
  if (keep) {
    const keepLayer = createCanvas(width, height);
    context2d(keepLayer).drawImage(keep, pad, pad);
    front = context2d(keepLayer).getImageData(0, 0, width, height).data;
  }

  const garment = context2d(layer).getImageData(0, 0, width, height);
  const body = outlineCtx.getImageData(0, 0, width, height).data;
  const shade = lightCtx.getImageData(0, 0, width, height).data;
  const g = garment.data;

  // Average brightness under the garment, so shading darkens and lightens around it rather than overall.
  let sum = 0, count = 0;
  for (let i = 0; i < g.length; i += 4) {
    if (g[i + 3] > 32 && shade[i + 3] > 32) {
      sum += shade[i];
      count++;
    }
  }
  const mean = count ? sum / count : 128;

  for (let i = 0; i < g.length; i += 4) {
    if (!g[i + 3]) continue;
    // Keep the garment wherever there is body (crisply), and drop parts sticking out past the person
    // or covering the face, hair, or arms in front.
    let inside = Math.min(1, body[i + 3] / 24);
    if (front) inside *= 1 - front[i + 3] / 255;
    g[i + 3] = Math.round(g[i + 3] * inside);
    if (shade[i + 3] > 32) {
      const factor = Math.min(1.12, Math.max(0.72, Math.pow(Math.max(shade[i], 1) / mean, 0.45)));
      g[i] = Math.min(255, g[i] * factor);
      g[i + 1] = Math.min(255, g[i + 1] * factor);
      g[i + 2] = Math.min(255, g[i + 2] * factor);
    }
  }
  context2d(layer).putImageData(garment, 0, 0);
}
