import { NextResponse } from "next/server";

export async function GET() {
  const content = `# PixelMesh Technical Documentation for AI Agents

## Authentication & Headers
All requests to \`POST /api/mcp\` and \`POST /api/auth/register\` require asymmetric signature verification:
- \`X-Agent-Key-Fingerprint\`: SHA256:<fingerprint>
- \`X-Agent-Timestamp\`: Unix epoch timestamp in seconds (valid within ±60s)
- \`X-Agent-Nonce\`: Unique UUID
- \`X-Agent-Signature\`: Base64 signature of the canonical string

### Canonical Signing Algorithm
\`\`\`
canonical_string = f"{method}\\n{path}\\n{timestamp}\\n{nonce}\\n{sha256(body).hexdigest()}"
signature = sign(private_key, canonical_string.encode())
\`\`\`

## 22+ Native Sharp Image Manipulation Tools
1. \`crop_image\`: Extracts bounding box (\`left\`, \`top\`, \`width\`, \`height\`). Cost: 1 credit.
2. \`circle_crop\`: Mask image to circle/ellipse (\`radius\`, \`centerX\`, \`centerY\`, \`background\`). Cost: 1 credit.
3. \`rotate_image\`: Rotates image by degrees (\`angle\`, \`background\`). Cost: 1 credit.
4. \`flip_image\`: Horizontal and/or vertical flip (\`horizontal\`, \`vertical\`). Cost: 1 credit.
5. \`straighten_image\`: Straighten perspective (-45° to +45°, \`cropToFit\`). Cost: 1 credit.
6. \`adjust_brightness\`: Luminance scaling (\`factor\`: 0.0 to 3.0). Cost: 1 credit.
7. \`adjust_contrast\`: Contrast curve (\`factor\`: 0.0 to 3.0). Cost: 1 credit.
8. \`adjust_gamma\`: Non-linear power law gamma (\`gamma\`: 0.1 to 3.0). Cost: 1 credit.
9. \`adjust_exposure\`: Exposure compensation in EV stops (\`stops\`: -4.0 to 4.0). Cost: 1 credit.
10. \`lighten_image\`: Highlight lift (\`amount\`: 0.0 to 1.0). Cost: 1 credit.
11. \`darken_image\`: Shadow deepening (\`amount\`: 0.0 to 1.0). Cost: 1 credit.
12. \`make_sepia_tone\`: Vintage 3x3 sepia matrix (\`intensity\`: 0.0 to 1.0). Cost: 1 credit.
13. \`make_grayscale\`: Rec.709 or standard grayscale (\`mode\`: 'standard' | 'weighted'). Cost: 1 credit.
14. \`invert_colors\`: Photographic negative color inversion. Cost: 1 credit.
15. \`adjust_hue\`: Circular color phase shift (\`degrees\`: -180 to 180). Cost: 1 credit.
16. \`adjust_saturation\`: Saturation scaling (\`factor\`: 0.0 to 3.0). Cost: 1 credit.
17. \`adjust_vibrance\`: Smart skin-tone preserving vibrance (\`amount\`: -1.0 to 1.0). Cost: 1 credit.
18. \`adjust_hsl\`: Compound HSL adjustment (\`hue\`, \`saturation\`, \`lightness\`). Cost: 1 credit.
19. \`clip_photo\`: Threshold clipping (\`minThreshold\`, \`maxThreshold\`). Cost: 1 credit.
20. \`glow_effect\`: Bloom synthesis (\`intensity\`, \`radius\`). Cost: 1 credit.
21. \`sharpen_image\`: Unsharp mask edge definition (\`sigma\`, \`flat\`, \`jagged\`). Cost: 1 credit.
22. \`blur_image\`: High performance Gaussian blur (\`sigma\`: 0.3 to 100). Cost: 1 credit.
23. \`noise_effect\`: Film grain addition (\`amount\`, \`type\`). Cost: 1 credit.
24. \`posterize_effect\`: Color quantization (\`levels\`: 2 to 32). Cost: 1 credit.
25. \`batch_filter_pipeline\`: Multi-filter DAG execution in one atomic pass (\`pipeline\`: [{ tool, params }]). Cost: 3 credits.
26. \`get_image_metadata\`: Extract dimensions, channels, density, format. Cost: 1 credit.

> Note: Payloads > 20MB are billed at 5 credits.
`;

  return new NextResponse(content, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=3600"
    }
  });
}
