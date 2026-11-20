export const EVENT_TABS = ['expenses', 'settlement', 'group'];

export const TAB_TRANSITION_TIMING = Object.freeze({
  enterSlideDurationMs: 600,
  exitSlideDurationMs: 460,
});

/**
 * Computes horizontal slide direction between two ordered tabs (-1, 0, or 1).
 * @param {readonly string[]} tabs
 * @param {string} currentTab
 * @param {string} nextTab
 * @returns {-1 | 0 | 1}
 */
export function getTabSlideDirection(tabs, currentTab, nextTab) {
  if (!Array.isArray(tabs)) return 0;
  const currentIndex = tabs.indexOf(currentTab);
  const nextIndex = tabs.indexOf(nextTab);
  if (currentIndex < 0 || nextIndex < 0) return 0;
  return Math.sign(nextIndex - currentIndex);
}
