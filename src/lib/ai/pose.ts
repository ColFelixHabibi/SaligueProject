'use client';

import { MODELS, fetchModel, type Progress } from './models';
import type { ImageSource } from './canvas';

export type Point = { x: number; y: number; visibility: number };

// MediaPipe Pose landmark indices used for dressing.
export const LM = {
  nose: 0,
  leftEye: 2,
  rightEye: 5,
  leftEar: 7,
  rightEar: 8,
  leftShoulder: 11,
  rightShoulder: 12,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
  leftFootIndex: 31,
  rightFootIndex: 32,
} as const;

type Landmarker = import('@mediapipe/tasks-vision').PoseLandmarker;
let landmarkerPromise: Promise<Landmarker> | null = null;

function loadLandmarker(onProgress?: Progress) {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const [{ FilesetResolver, PoseLandmarker }, model] = await Promise.all([
        import('@mediapipe/tasks-vision'),
        fetchModel(MODELS.pose, onProgress),
      ]);
      const fileset = await FilesetResolver.forVisionTasks(MODELS.poseWasm);
      return PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetBuffer: new Uint8Array(model), delegate: 'CPU' },
        runningMode: 'IMAGE',
        numPoses: 1,
      });
    })();
    landmarkerPromise.catch(() => (landmarkerPromise = null));
  }
  return landmarkerPromise;
}

/** Detects body landmarks in pixel coordinates of the given image, or null if no person is found. */
export async function detectPose(source: ImageSource, onProgress?: Progress): Promise<Point[] | null> {
  const landmarker = await loadLandmarker(onProgress);
  onProgress?.('Finding your shoulders, hips and feet…');
  const width = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
  const height = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
  const result = landmarker.detect(source);
  const landmarks = result.landmarks?.[0];
  if (!landmarks) return null;
  return landmarks.map((p) => ({ x: p.x * width, y: p.y * height, visibility: p.visibility ?? 1 }));
}
