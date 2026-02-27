/**
 * Step variant styles for color-coded borders and icons per step type.
 */

export type StepVariant =
  | 'thinking'
  | 'output'
  | 'tool'
  | 'tool-error'
  | 'slash'
  | 'subagent'
  | 'default';

interface StepVariantStyle {
  borderColor: string;
  iconColor: string;
}

const VARIANT_STYLES: Record<StepVariant, StepVariantStyle> = {
  thinking: {
    borderColor: 'var(--step-thinking-color)',
    iconColor: 'var(--step-thinking-color)',
  },
  output: {
    borderColor: 'var(--step-output-color)',
    iconColor: 'var(--step-output-color)',
  },
  tool: {
    borderColor: 'var(--step-tool-color)',
    iconColor: 'var(--step-tool-color)',
  },
  'tool-error': {
    borderColor: 'var(--step-error-color)',
    iconColor: 'var(--step-error-color)',
  },
  slash: {
    borderColor: 'var(--step-slash-color)',
    iconColor: 'var(--step-slash-color)',
  },
  subagent: {
    borderColor: 'var(--step-subagent-color)',
    iconColor: 'var(--step-subagent-color)',
  },
  default: {
    borderColor: 'var(--color-border)',
    iconColor: 'var(--tool-item-muted)',
  },
};

export function getStepVariantStyle(variant: StepVariant = 'default'): StepVariantStyle {
  return VARIANT_STYLES[variant];
}
