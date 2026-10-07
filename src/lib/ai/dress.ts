'use client';

import { LM, type Point } from './pose';
import { alphaComponents, context2d, createCanvas, cropCanvas, garmentBodyWidth, trimTransparent } from './canvas';
import type { Category } from '@/lib/categories';

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
        { heel: lm[LM.leftHeel], toe: lm[LM.leftFootIndex], ankle: lm[LM.leftAnkle], knee: lm[LM.leftKnee] },
        { heel: lm[LM.rightHeel], toe: lm[LM.rightFootIndex], ankle: lm[LM.rightAnkle], knee: lm[LM.rightKnee] },
      ];
      // Feet are often hidden or crossed; only dress the ones the detector is confident about.
      const confident = (f: (typeof feet)[number]) =>
        [f.heel, f.toe, f.ankle].every((p) => p.visibility >= 0.6) && f.ankle.y > f.knee.y;
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
    default:
      // Hats, glasses, bags and accessories are shown beside the person (see BESIDE).
      return 'This item is shown next to you.';
  }
}

// Fallback when the item can't be fitted: show it next to the person at a sensible size.
const BESIDE = new Set<Category>(['hat', 'eyewear', 'bag', 'accessory']);
// Item height beside the person, as a share of the person's height (roughly life-size).
const BESIDE_SIZE: Partial<Record<Category, number>> = { hat: 0.16, eyewear: 0.09, bag: 0.3, accessory: 0.14 };

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

function sideBySide(person: HTMLCanvasElement, item: HTMLCanvasElement, note?: string, share = 0.45): DressResult {
  const itemHeight = person.height * share;
  const itemWidth = (item.width / item.height) * itemHeight;
  const gap = person.width * 0.05;
  const canvas = createCanvas(person.width + gap + itemWidth, person.height);
  const ctx = context2d(canvas);
  ctx.drawImage(person, 0, 0);
  ctx.drawImage(item, person.width + gap, (person.height - itemHeight) / 2, itemWidth, itemHeight);
  return { canvas: trimTransparent(canvas, 12), fitted: !note, note };
}

/**
 * Puts a clothing item (transparent cut-out) on a person (transparent cut-out) using body landmarks.
 * The person's pixels are drawn unchanged; the item is layered on top.
 */
export function dressPerson(
  person: HTMLCanvasElement,
  landmarks: Point[] | null,
  item: HTMLCanvasElement,
  category: Category
): DressResult {
  const trimmedItem = trimTransparent(item, 0);
  // Bags, hats, glasses and other accessories are shown next to the person, never pasted onto them.
  if (BESIDE.has(category)) return sideBySide(person, trimmedItem, undefined, BESIDE_SIZE[category]);
  if (!landmarks) return sideBySide(person, trimmedItem, 'No body was detected in your photo.');

  const placements = placementsFor(category, landmarks, trimmedItem);
  if (typeof placements === 'string') return sideBySide(person, trimmedItem, placements);

  // Leave room around the person in case an item extends past the photo.
  const pad = Math.round(Math.max(person.width, person.height) * 0.15);
  const canvas = createCanvas(person.width + pad * 2, person.height + pad * 2);
  const ctx = context2d(canvas);
  ctx.drawImage(withErased(person, placements.flatMap((p) => (p.erase ? [p.erase] : []))), pad, pad);

  // The garment goes on its own layer so it can be fitted to the body before being added.
  const layer = createCanvas(canvas.width, canvas.height);
  const layerCtx = context2d(layer);
  for (const p of placements) drawItem(layerCtx, trimmedItem, { ...p, x: p.x + pad, y: p.y + pad });
  if (WORN.has(category)) wearOnBody(layer, person, pad);
  ctx.drawImage(layer, 0, 0);
  return { canvas: trimTransparent(canvas, 12), fitted: true };
}

// Clothes that cover the body: trimmed to the body outline and shaded with the photo's light.
const WORN = new Set<Category>(['top', 'outerwear', 'dress', 'bottom']);

/**
 * Makes a garment look worn rather than pasted on:
 * - keeps it within the person's outline (slightly widened, since clothes sit on top of the body);
 * - carries the photo's light and shadows (folds, body shading) onto the garment.
 */
function wearOnBody(layer: HTMLCanvasElement, person: HTMLCanvasElement, pad: number) {
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
    // Keep the garment wherever there is body (crisply), and drop parts sticking out past the person.
    const inside = Math.min(1, body[i + 3] / 24);
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
