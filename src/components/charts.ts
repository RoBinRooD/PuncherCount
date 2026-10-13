import {
  BarElement,
  CategoryScale,
  Chart,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from 'chart.js'
import { INK } from '../lib/colors'

Chart.register(BarElement, CategoryScale, LinearScale, LineElement, PointElement, Tooltip, Legend)

Chart.defaults.color = INK.secondary
Chart.defaults.font.family = '"Noto Sans Thai", system-ui, sans-serif'
Chart.defaults.borderColor = INK.grid
Chart.defaults.maintainAspectRatio = false
Chart.defaults.plugins.legend.labels.usePointStyle = true
Chart.defaults.plugins.legend.labels.boxWidth = 8
Chart.defaults.plugins.tooltip.backgroundColor = '#252523'
Chart.defaults.plugins.tooltip.titleColor = INK.primary
Chart.defaults.plugins.tooltip.bodyColor = INK.secondary
Chart.defaults.plugins.tooltip.padding = 10
Chart.defaults.plugins.tooltip.boxPadding = 4

/** Bars with rounded data-ends and a 2px surface gap between stacked segments. */
export const barStyle = {
  borderRadius: 4,
  borderSkipped: 'start' as const,
  borderWidth: { top: 2, left: 0, right: 0, bottom: 0 },
  borderColor: INK.surface,
  maxBarThickness: 36,
}

export const stackedScales = {
  x: { stacked: true, grid: { display: false } },
  y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } },
}
