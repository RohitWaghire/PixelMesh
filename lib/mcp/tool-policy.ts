const GEOMETRY_TOOLS = new Set([
  "crop_image",
  "circle_crop",
  "flip_image",
  "rotate_image",
  "straighten_photo",
]);

const HIGH_RESOLUTION_BYTES = 20 * 1024 * 1024;

export function canCallTool(scopes: readonly string[] | null | undefined, toolName: string): boolean {
  const allowedScopes = scopes?.length ? scopes : ["all-tools"];

  return (
    allowedScopes.includes("all-tools") ||
    allowedScopes.includes(toolName) ||
    (allowedScopes.includes("filters;*") && toolName !== "export_image") ||
    (allowedScopes.includes("geometry:*") && GEOMETRY_TOOLS.has(toolName))
  );
}

export function hasImageInput(argumentsObject: Record<string, unknown>): boolean {
  return Boolean(
    argumentsObject.image_base64 ||
      argumentsObject.image_key ||
      argumentsObject.image_url,
  );
}

export function toolCost(toolName: string, inputBytes: number): number {
  if (toolName === "get_image_metadata") {
    return 0;
  }

  if (inputBytes > HIGH_RESOLUTION_BYTES) {
    return 5;
  }

  return toolName === "batch_filter_pipeline" ? 3 : 1;
}

export function declaredInputBytes(argumentsObject: Record<string, unknown>): number {
  const declaredSize = argumentsObject.size_bytes;
  if (typeof declaredSize === "number") {
    return declaredSize;
  }

  const imageBase64 = argumentsObject.image_base64;
  return typeof imageBase64 === "string" ? imageBase64.length : 0;
}
