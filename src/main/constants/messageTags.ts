/**
 * Message Tag Constants
 *
 * Centralized XML tag string literals used in message parsing and filtering.
 */

// =============================================================================
// System Output Tags
// =============================================================================

/** Local command stdout wrapper tag */
export const LOCAL_COMMAND_STDOUT_TAG = '<local-command-stdout>';

/** Local command stderr wrapper tag */
export const LOCAL_COMMAND_STDERR_TAG = '<local-command-stderr>';

/** Local command caveat wrapper tag */
const LOCAL_COMMAND_CAVEAT_TAG = '<local-command-caveat>';

/** System reminder wrapper tag */
const SYSTEM_REMINDER_TAG = '<system-reminder>';

/**
 * Task-notification wrapper tag. Auto-injected background-task / agent-completion
 * events arrive as `type: "user"` entries whose STRING content starts with this
 * tag. They are NOT genuine user input and must not render as "You" bubbles.
 */
export const TASK_NOTIFICATION_TAG = '<task-notification>';

/**
 * Interactive `!` shell-command tags. When the user runs a `!` command in Claude
 * Code, the command is recorded as a `type: "user"` entry whose STRING content is
 * wrapped in `<bash-input>…</bash-input>`, and the output arrives as a following
 * `type: "user"` entry wrapped in `<bash-stdout>…</bash-stdout>` (and/or
 * `<bash-stderr>…</bash-stderr>`). These are shell commands, NOT genuine user
 * input, and must not render as "You" bubbles. They are a SEPARATE case from the
 * `<local-command-*>` slash-command output tags above.
 */
export const BASH_INPUT_TAG = '<bash-input>';
export const BASH_STDOUT_TAG = '<bash-stdout>';
export const BASH_STDERR_TAG = '<bash-stderr>';

// =============================================================================
// Empty Output Tags
// =============================================================================

/** Empty stdout output */
export const EMPTY_STDOUT = '<local-command-stdout></local-command-stdout>';

/** Empty stderr output */
export const EMPTY_STDERR = '<local-command-stderr></local-command-stderr>';

// =============================================================================
// Tag Arrays for Filtering
// =============================================================================

/** Tags that indicate system output (excludes from User chunks) */
export const SYSTEM_OUTPUT_TAGS = [
  LOCAL_COMMAND_STDERR_TAG,
  LOCAL_COMMAND_STDOUT_TAG,
  LOCAL_COMMAND_CAVEAT_TAG,
  SYSTEM_REMINDER_TAG,
] as const;

/** Tags that indicate hard noise (messages filtered completely) */
export const HARD_NOISE_TAGS = [LOCAL_COMMAND_CAVEAT_TAG, SYSTEM_REMINDER_TAG] as const;
