import { translate } from '@/i18n/i18n'
import {
  getDisplayedUsagePercentage,
  type UsagePercentageDisplay
} from '../../../../shared/usage-percentage-display'

export function formatUsagePercentageLabel(
  usedPercent: number,
  display: UsagePercentageDisplay
): string {
  const percentage = getDisplayedUsagePercentage(usedPercent, display)
  return display === 'used'
    ? translate('auto.components.status.bar.usagePercentageLabel.used', '{{value0}}% used', {
        value0: String(percentage)
      })
    : translate('auto.components.status.bar.usagePercentageLabel.remaining', '{{value0}}% left', {
        value0: String(percentage)
      })
}

const usageAmountFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })

/** "3,627.1 / 6,726" — the raw amounts behind a window's percentage (Copilot credits). */
export function formatUsageAmountLabel(amount: { used: number; total: number }): string {
  return translate('auto.components.status.bar.usageAmountLabel', '{{value0}} / {{value1}}', {
    value0: usageAmountFormatter.format(amount.used),
    value1: usageAmountFormatter.format(amount.total)
  })
}
