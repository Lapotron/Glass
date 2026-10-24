/** Keep archive, article footer and private Studio estimates on the same formula. */
export const countReadingWords = (source: string) =>
  source.match(/[\p{L}\p{N}]+|[\p{Script=Han}]/gu)?.length || 0;
export function articleReadingStats(source: string, words = countReadingWords(source)) {
  const chinese = source.match(/[\p{Script=Han}]/gu)?.length || 0;
  return { words, minutes: Math.max(1, Math.ceil((words + chinese / 2) / 220)) };
}
