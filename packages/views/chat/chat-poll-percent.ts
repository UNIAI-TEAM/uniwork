/**
 * Each option's share of the votes in whole percents that add up to 100
 * (largest remainder: the leftover points go to the options rounding lost
 * most on, the earlier option on a tie), so three equal options read
 * 34 / 33 / 33, never 33 / 33 / 33. No votes at all → every option 0.
 */
export function pollOptionPercents(votes: readonly number[]): number[] {
  const total = votes.reduce((sum, count) => sum + count, 0);
  if (total <= 0) return votes.map(() => 0);
  const exact = votes.map((count) => (count / total) * 100);
  const percents = exact.map(Math.floor);
  let left = 100 - percents.reduce((sum, value) => sum + value, 0);
  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder);
  for (const { index } of byRemainder) {
    if (left <= 0) break;
    percents[index] = (percents[index] ?? 0) + 1;
    left -= 1;
  }
  return percents;
}
