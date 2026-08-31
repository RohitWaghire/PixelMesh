/**
 * PixelMesh WebMCP (Web Model Context Protocol) Engine
 * 
 * Standard W3C WebMCP draft specification & Google Chrome 149+ Origin Trial
 * client tool registration and in-browser AI agent execution engine.
 * 
 * @module lib/webmcp
 */

// Export all type definitions, error classes, constants, and event interfaces
export * from "./types";

// Export polyfill engine, validation helpers, debug harness, and installers
export * from "./polyfill";

// Export Studio canvas adapter, 8 client WebMCP tools, and registration functions
export * from "./tools";

// Export React lifecycle hook, active call types, and options
export * from "./use-webmcp";
