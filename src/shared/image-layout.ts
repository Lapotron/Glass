export type ImageLayout = {
  width?: string;
  maxHeight?: string;
  align?: 'left' | 'center' | 'right';
};
/** Deliberately bounded metadata, never arbitrary author CSS. */
export function imageLayout(attributes: Record<string, unknown>): ImageLayout {
  const result: ImageLayout = {};
  if (attributes.width !== undefined && attributes.width !== '') {
    const match = /^(\d+)(px|%)?$/.exec(String(attributes.width).trim());
    const value = Number(match?.[1]),
      percent = match?.[2] === '%';
    if (!match || value < (percent ? 10 : 64) || value > (percent ? 100 : 2400))
      throw new Error('Image width must be 64–2400 pixels or 10–100%.');
    result.width = `${value}${percent ? '%' : 'px'}`;
  }
  if (attributes['max-height'] !== undefined && attributes['max-height'] !== '') {
    const match = /^(\d+)(?:px)?$/.exec(String(attributes['max-height']).trim());
    const value = Number(match?.[1]);
    if (!match || value < 64 || value > 2400)
      throw new Error('Image maximum height must be 64–2400 pixels.');
    result.maxHeight = `${value}px`;
  }
  if (attributes.align !== undefined && attributes.align !== '') {
    if (!['left', 'center', 'right'].includes(String(attributes.align)))
      throw new Error('Image alignment must be left, center or right.');
    result.align = attributes.align as ImageLayout['align'];
  }
  return result;
}
