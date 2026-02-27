/**
 * CSS Variable Constants
 *
 * Centralized CSS variable strings to avoid duplication across components.
 * These are used with inline styles for theme-aware styling.
 */

// =============================================================================
// Text Colors
// =============================================================================

/** Muted text color for less important content */
export const COLOR_TEXT_MUTED = 'var(--color-text-muted)';

/** Secondary text color for supporting content */
export const COLOR_TEXT_SECONDARY = 'var(--color-text-secondary)';

/** Primary text color */
export const COLOR_TEXT = 'var(--color-text)';

// =============================================================================
// Prose/Typography Colors (for markdown rendering)
// =============================================================================

/** Prose body text color */
export const PROSE_BODY = 'var(--prose-body)';

/** Prose heading color */
export const PROSE_HEADING = 'var(--prose-heading)';

/** Prose muted text color */
export const PROSE_MUTED = 'var(--prose-muted)';

/** Prose link color */
export const PROSE_LINK = 'var(--prose-link)';

/** Prose inline code background */
export const PROSE_CODE_BG = 'var(--prose-code-bg)';

/** Prose inline code text color */
export const PROSE_CODE_TEXT = 'var(--prose-code-text)';

/** Prose code block background */
export const PROSE_PRE_BG = 'var(--prose-pre-bg)';

/** Prose code block border */
export const PROSE_PRE_BORDER = 'var(--prose-pre-border)';

/** Prose blockquote border color */
export const PROSE_BLOCKQUOTE_BORDER = 'var(--prose-blockquote-border)';

/** Prose table border color */
export const PROSE_TABLE_BORDER = 'var(--prose-table-border)';

/** Prose table header background */
export const PROSE_TABLE_HEADER_BG = 'var(--prose-table-header-bg)';

// =============================================================================
// Surface Colors
// =============================================================================

/** Raised surface background */
export const COLOR_SURFACE_RAISED = 'var(--color-surface-raised)';

/** Overlay surface background */
export const COLOR_SURFACE_OVERLAY = 'var(--color-surface-overlay)';

/** Base surface background */
export const COLOR_SURFACE = 'var(--color-surface)';

// =============================================================================
// Border Colors
// =============================================================================

/** Standard border color */
export const COLOR_BORDER = 'var(--color-border)';

/** Subtle border color */
export const COLOR_BORDER_SUBTLE = 'var(--color-border-subtle)';

// =============================================================================
// Tool Item Colors (for expandable items in chat)
// =============================================================================

/** Tool item muted color */
export const TOOL_ITEM_MUTED = 'var(--tool-item-muted)';

// =============================================================================
// Code Block Colors
// =============================================================================

/** Code block background */
export const CODE_BG = 'var(--code-bg)';

/** Code block border */
export const CODE_BORDER = 'var(--code-border)';

/** Code block header background */
export const CODE_HEADER_BG = 'var(--code-header-bg)';

/** Code filename color */
export const CODE_FILENAME = 'var(--code-filename)';

/** Code line number color */
export const CODE_LINE_NUMBER = 'var(--code-line-number)';

// =============================================================================
// Diff Colors
// =============================================================================

/** Diff removed line background */
export const DIFF_REMOVED_BG = 'var(--diff-removed-bg)';

/** Diff removed line text color */
export const DIFF_REMOVED_TEXT = 'var(--diff-removed-text)';

/** Diff removed line border */
export const DIFF_REMOVED_BORDER = 'var(--diff-removed-border)';

/** Diff added line background */
export const DIFF_ADDED_BG = 'var(--diff-added-bg)';

/** Diff added line text color */
export const DIFF_ADDED_TEXT = 'var(--diff-added-text)';

/** Diff added line border */
export const DIFF_ADDED_BORDER = 'var(--diff-added-border)';

// =============================================================================
// Tool Call/Result Colors
// =============================================================================

/** Tool call background */
export const TOOL_CALL_BG = 'var(--tool-call-bg)';

/** Tool call border */
export const TOOL_CALL_BORDER = 'var(--tool-call-border)';

/** Tool call text color */
export const TOOL_CALL_TEXT = 'var(--tool-call-text)';

// =============================================================================
// Tag/Badge Colors
// =============================================================================

/** Tag background */
export const TAG_BG = 'var(--tag-bg)';

/** Tag text color */
export const TAG_TEXT = 'var(--tag-text)';

/** Tag border */
export const TAG_BORDER = 'var(--tag-border)';

// =============================================================================
// Worktree Badge Colors (hardcoded hex values)
// =============================================================================

/** Muted zinc badge background */
export const WORKTREE_BADGE_BG = 'rgba(161, 161, 170, 0.15)';

/** Muted zinc badge text color */
export const WORKTREE_BADGE_TEXT = '#a1a1aa';

// =============================================================================
// Card/Subagent Styling (theme-aware)
// =============================================================================

/** Card background */
export const CARD_BG = 'var(--card-bg)';

/** Card border color */
const CARD_BORDER = 'var(--card-border)';

/** Card border style */
export const CARD_BORDER_STYLE = `1px solid ${CARD_BORDER}`;

/** Card header background */
export const CARD_HEADER_BG = 'var(--card-header-bg)';

/** Card header hover background */
export const CARD_HEADER_HOVER = 'var(--card-header-hover)';

/** Card muted icon color */
export const CARD_ICON_MUTED = 'var(--card-icon-muted)';

/** Card light text */
export const CARD_TEXT_LIGHT = 'var(--card-text-light)';

/** Card lighter text */
export const CARD_TEXT_LIGHTER = 'var(--card-text-lighter)';

/** Card separator color */
export const CARD_SEPARATOR = 'var(--card-separator)';

// =============================================================================
// Step Type Colors (for colored borders and icons per step type)
// =============================================================================

/** Thinking step color (purple) */
export const STEP_THINKING_COLOR = 'var(--step-thinking-color)';

/** Output step color (blue) */
export const STEP_OUTPUT_COLOR = 'var(--step-output-color)';

/** Tool step color (amber) */
export const STEP_TOOL_COLOR = 'var(--step-tool-color)';

/** Success step color (green) */
export const STEP_SUCCESS_COLOR = 'var(--step-success-color)';

/** Error step color (red) */
export const STEP_ERROR_COLOR = 'var(--step-error-color)';

/** Slash command step color (violet) */
export const STEP_SLASH_COLOR = 'var(--step-slash-color)';

/** Subagent step color (cyan) */
export const STEP_SUBAGENT_COLOR = 'var(--step-subagent-color)';

// =============================================================================
// Form/Input Colors (Tailwind classes for select/input options)
// =============================================================================

/** Background for select options (theme-aware) */
export const SELECT_OPTION_BG = 'bg-surface';

// =============================================================================
// Form State Classes (Tailwind classes for form states)
// =============================================================================

/** Cursor pointer class */
const CURSOR_POINTER = 'cursor-pointer';

/** Cursor not allowed with opacity for disabled state */
const CURSOR_DISABLED = 'cursor-not-allowed opacity-50';

/**
 * Helper to get cursor class based on disabled state
 */
export const getCursorClass = (disabled: boolean): string =>
  disabled ? CURSOR_DISABLED : CURSOR_POINTER;

/**
 * Base className for select inputs in settings forms (theme-aware)
 */
export const SELECT_INPUT_BASE =
  'rounded border border-border bg-transparent px-2 py-1 text-sm text-text focus:border-transparent focus:outline-none focus:ring-1 focus:ring-indigo-500';
