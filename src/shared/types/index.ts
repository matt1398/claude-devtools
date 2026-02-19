/**
 * Shared type definitions - re-exports types from main process for use in renderer.
 *
 * This module provides a stable import path (@shared/types) for types that
 * are shared between main and renderer processes, allowing proper boundary
 * separation while maintaining type safety.
 *
 * Usage:
 *   import type { Session, Chunk, ParsedMessage } from '@shared/types';
 */

// Re-export all types from main process types
export * from '@main/types';

// Re-export notification and config types
export * from './notifications';

// Re-export data root types
export type * from './roots';

// Re-export visualization types (WaterfallData, WaterfallItem)
export type * from './visualization';

// Re-export API types (ElectronAPI, ConfigAPI, etc.)
export type * from './api';
