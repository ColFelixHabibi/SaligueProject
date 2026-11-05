// TypeScript cannot load a stylesheet on its own — Next.js can (its build handles the CSS). Without this, the type
// checker (npm run typecheck, which is plain tsc --noEmit) reports TS2882 on `import './globals.css'` even though the
// site builds and runs. Declaring the side-effect import is the standard fix and changes nothing at runtime.
declare module '*.css';
