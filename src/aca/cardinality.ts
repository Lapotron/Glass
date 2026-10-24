/** HLL p=10: fixed 1 KiB registers, about 3.25% standard error, merged by max. */
export const cardinalitySize = 1024;
export function addCardinality(registers: number[], hash: string) {
  const high = parseInt(hash.slice(0, 8), 16) >>> 0,
    low = parseInt(hash.slice(8, 16), 16) >>> 0;
  const index = high >>> 22;
  const rest = ((high << 10) | (low >>> 22)) >>> 0;
  const rank = Math.min(33, Math.clz32(rest) + 1);
  registers[index] = Math.max(registers[index] || 0, rank);
}
export function mergeCardinality(sketches: number[][]) {
  const registers = Array<number>(cardinalitySize).fill(0);
  for (const sketch of sketches)
    sketch.forEach((v, i) => {
      if (i < cardinalitySize) registers[i] = Math.max(registers[i], v);
    });
  const sum = registers.reduce((total, value) => total + 2 ** -value, 0),
    zero = registers.filter((value) => value === 0).length;
  const raw = ((0.7213 / (1 + 1.079 / cardinalitySize)) * cardinalitySize ** 2) / sum;
  return Math.round(
    raw <= cardinalitySize * 2.5 && zero ? cardinalitySize * Math.log(cardinalitySize / zero) : raw,
  );
}
