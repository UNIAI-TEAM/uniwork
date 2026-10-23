/**
 * Each option's share of the votes, rounded to a whole percent on its own
 * (canvas: 5/4/2 of 11 reads 45 / 36 / 18). The shares may add up to 99 or
 * 101; each bar shows its own option's share, not a slice of a pie.
 * No votes at all → every option 0.
 */
export function pollOptionPercents(votes: readonly number[]): number[] {
  const total = votes.reduce((sum, count) => sum + count, 0);
  if (total <= 0) return votes.map(() => 0);
  return votes.map((count) => Math.round((count / total) * 100));
}
