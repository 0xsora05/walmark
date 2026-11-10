/**
 * Plain text has no pages, so we make them. A form feed (\f) always starts a new page;
 * otherwise paragraphs are packed into pages of roughly `target` characters.
 * Page numbers shown on recall for text documents refer to these pages.
 */
export function paginate(input: string, target = 1600): string[] {
  const text = input.replace(/\r\n?/g, '\n').trim();
  if (!text) return [''];
  if (text.includes('\f')) {
    const pages = text.split('\f').map((p) => p.trim()).filter(Boolean);
    return pages.length ? pages : [''];
  }

  const pages: string[] = [];
  let cur = '';
  const flush = () => {
    if (cur.trim()) pages.push(cur.trim());
    cur = '';
  };

  for (const para of text.split(/\n{2,}/)) {
    if (para.length > target) {
      for (const sentence of para.match(/[^.!?।]+[.!?।]*\s*/g) ?? [para]) {
        if (cur && cur.length + sentence.length > target) flush();
        cur += sentence;
      }
      cur += '\n\n';
      continue;
    }
    if (cur && cur.length + para.length > target) flush();
    cur += para + '\n\n';
  }
  flush();
  return pages.length ? pages : [''];
}
