import { createContext, useContext } from 'react';

import type { ToolFieldKey } from '@renderer/utils/conversationExtractor';

export interface ExportSelectionContextValue {
  isActive: boolean;
  /** True if item is selected (for non-tool items: in selectedExportIds; for tools: any field enabled) */
  isSelected: (id: string) => boolean;
  /** Toggle for non-tool items (user, ai-text, thinking, compact) */
  toggle: (id: string) => void;
  /** Returns the set of enabled fields for a tool item */
  getToolFields: (id: string) => Set<ToolFieldKey>;
  /** Toggle a single field for a tool item; auto-syncs item selection */
  toggleToolItemField: (id: string, field: ToolFieldKey) => void;
  /** Set all 4 fields on (enabled=true) or off (enabled=false); auto-syncs item selection */
  setToolItemFieldsAll: (id: string, enabled: boolean) => void;
}

const ALL_FIELDS = new Set<ToolFieldKey>(['name', 'summary', 'input', 'output']);

export const ExportSelectionContext = createContext<ExportSelectionContextValue>({
  isActive: false,
  isSelected: () => false,
  toggle: () => {},
  getToolFields: () => ALL_FIELDS,
  toggleToolItemField: () => {},
  setToolItemFieldsAll: () => {},
});

export const useExportSelection = (): ExportSelectionContextValue =>
  useContext(ExportSelectionContext);
