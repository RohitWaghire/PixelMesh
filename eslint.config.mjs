import { FlatCompat } from "@eslint/eslintrc";
import { fileURLToPath } from "node:url";
import path from "node:path";

const baseDirectory = path.dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory });

const configuration = [
  { ignores: [".next/**", "node_modules/**", "archive/**"] },
  ...compat.extends("next/core-web-vitals"),
  {
    files: ["components/landing/HeroSplitDemo.tsx", "components/studio/CanvasViewport.tsx"],
    rules: {
      // The Studio compares data URIs and remote sample images that Next Image cannot optimize.
      "@next/next/no-img-element": "off",
    },
  },
];

export default configuration;
