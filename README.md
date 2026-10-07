# Saligue — Mirror My-Self

A fashion marketplace where shoppers can search for clothes, shoes, or accessories and preview items on a photo of themselves. Sellers list products, manage orders, and share shop contact details.

AI features run on the user's device (browser or installed app). Shopper photos are not uploaded by the try-on flow.

## AI features

| Step | Model | Code |
|---|---|---|
| Remove the background from a shopper photo | MODNet | `src/lib/ai/segment.ts` |
| Cut out a seller's item photo | U-2-Netp | `src/lib/ai/segment.ts` |
| Detect body landmarks | MediaPipe Pose Landmarker lite | `src/lib/ai/pose.ts` |
| Place garments on the body | Landmark geometry | `src/lib/ai/dress.ts` |
| Search by text or photo | MobileCLIP-S0 / Transformers.js | `src/lib/ai/embed.ts`, `src/lib/search.ts` |

Models are downloaded on first use and cached by the browser. Product photos and their cut-outs are stored with the product in Supabase; try-on photos remain on the shopper's device.

## Supabase setup

1. Create a Supabase project and run [`supabase/schema.sql`](supabase/schema.sql) in its SQL Editor.
2. In **Authentication → Providers**, enable Anonymous, Email, and Google sign-in. Enable identity linking so guest accounts can be upgraded to Google accounts.
3. Add `http://localhost:9002/**` and the deployed site URL to **Authentication → URL Configuration → Redirect URLs**. Configure Google OAuth in the provider settings and add the Supabase callback URL shown there (`https://<project-ref>.supabase.co/auth/v1/callback`) as an authorized redirect URI in Google Cloud.
4. Copy `.env.example` to `.env.local` and set the project's URL and anon key.

For GitHub Pages, add repository secrets named `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` so the workflow can include them in the static build.

## Develop

```bash
npm install
npm run dev        # http://localhost:9002
```

## Publish

The site is a static export (`output: 'export'`). Pushes to `main` build and publish it to GitHub Pages. To preview a production build locally:

```bash
npm run build && npm run preview   # http://localhost:9003
```

## Android and iOS

The site is installable as a web app. Open the published link on a phone and choose **Add to Home Screen** (iPhone: Share → Add to Home Screen; Android: menu → Install app). It opens full-screen with its own icon.
