# Saligue — Mirror My-Self

A fashion marketplace where shoppers add a photo of themselves, search for clothes, shoes or accessories, and see themselves wearing each item, with the item's owner and contact details.

All AI runs **on the user's device** (browser / installed app). There are no AI API keys and photos of shoppers are never uploaded.

## How it works

| Step | Model (license) | Code |
|---|---|---|
| Remove the background from the shopper's photo, keeping their pixels unchanged | [MODNet](https://huggingface.co/Xenova/modnet) (Apache-2.0) | `src/lib/ai/segment.ts` |
| Cut out a seller's item photo | [U-2-Netp](https://huggingface.co/BritishWerewolf/U-2-Netp) (Apache-2.0) | `src/lib/ai/segment.ts` |
| Find shoulders, hips, feet, head | [MediaPipe Pose Landmarker lite](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker) (Apache-2.0) | `src/lib/ai/pose.ts` |
| Place the item on the body | Geometry from the landmarks | `src/lib/ai/dress.ts` |
| Search by text or by photo | [MobileCLIP-S0](https://huggingface.co/Xenova/mobileclip_s0) (Apple sample code license) via Transformers.js | `src/lib/ai/embed.ts`, `src/lib/search.ts` |

Models are downloaded on first use and cached by the browser.

When a seller lists an item, the app stores the original photo, the background-free cut-out and a 512-number MobileCLIP embedding with the product, so shoppers' devices only run the models for their own photo and search query.

Data (accounts, products, carts, wishlists, support requests) is in Firebase Auth + Cloud Firestore. Access rules are in `firestore.rules`.

## Develop

```bash
npm install
npm run dev        # http://localhost:9002
```

Create `.env.local` with the Firebase web config (`NEXT_PUBLIC_FIREBASE_API_KEY`, `..._AUTH_DOMAIN`, `..._PROJECT_ID`, `..._STORAGE_BUCKET`, `..._MESSAGING_SENDER_ID`, `..._APP_ID`).

## Publish

The site is a static export (`output: 'export'`). Every push to `main` builds it and publishes it to GitHub Pages via `.github/workflows/pages.yml`. To preview a production build locally:

```bash
npm run build && npm run preview   # http://localhost:9003
```

Deploy security rules with `firebase deploy --only firestore:rules`.

## Android and iOS

The site is an installable web app (manifest + service worker): open the link on a phone and choose **Add to Home Screen** (iPhone: Share → Add to Home Screen; Android: menu → Install app). It opens full-screen with its own icon.
