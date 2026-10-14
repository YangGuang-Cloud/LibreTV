/** 去除源里的纯集数标签，保留真正的标题或节目段落名称。 */
export function meaningfulEpisodeTitle(value: unknown): string {
  if (typeof value !== 'string') return '';
  const title = value.replace(/<[^>]*>/g, '').trim().slice(0, 300);
  if (/^第?[0-9０-９零〇一二两三四五六七八九十百千]+(?:集|话|期|章|回)?$/.test(title.replace(/\s+/g, ''))) return '';
  return title.replace(/^第[0-9０-９零〇一二两三四五六七八九十百千]+(?:集|话|期|章|回)\s*[:：、.\-—]?\s*/, '').trim();
}

export function formatEpisodeLabel(index: number, title?: string): string {
  const name = meaningfulEpisodeTitle(title);
  return `第 ${index + 1} 集${name ? `：${name}` : ''}`;
}
