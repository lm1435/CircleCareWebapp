/**
 * Markdown SUBSET used by help article bodies: `##`/`###` headings, `- ` lists,
 * `1. ` lists, paragraphs, `**bold**` and `[text](url)`. Parsed to a small AST
 * (rendered by components/help/HelpMarkdown.tsx) so nothing is ever injected as
 * HTML.
 */
export type InlineNode =
  | { type: 'text'; text: string }
  | { type: 'bold'; children: InlineNode[] }
  | { type: 'link'; href: string; children: InlineNode[] };

export type BlockNode =
  | { type: 'heading'; level: 2 | 3; children: InlineNode[] }
  | { type: 'paragraph'; children: InlineNode[] }
  | { type: 'ul'; items: InlineNode[][] }
  | { type: 'ol'; items: InlineNode[][] };

const TOKEN = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\))/;

export function parseInline(text: string, inLink = false): InlineNode[] {
  const nodes: InlineNode[] = [];
  for (const part of text.split(TOKEN)) {
    if (!part) continue;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      nodes.push({ type: 'bold', children: parseInline(part.slice(2, -2), inLink) });
      continue;
    }
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (link && !inLink) {
      nodes.push({ type: 'link', href: link[2], children: parseInline(link[1], true) });
      continue;
    }
    nodes.push({ type: 'text', text: part });
  }
  return nodes;
}

export function parseMarkdown(source: string): BlockNode[] {
  const blocks: BlockNode[] = [];
  let paragraph: string[] = [];
  let list: { type: 'ul' | 'ol'; items: InlineNode[][] } | null = null;

  const flushParagraph = (): void => {
    if (paragraph.length > 0) {
      blocks.push({ type: 'paragraph', children: parseInline(paragraph.join(' ')) });
      paragraph = [];
    }
  };
  const flushList = (): void => {
    if (list) {
      blocks.push(list);
      list = null;
    }
  };

  for (const raw of source.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (line === '') {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = /^(#{2,3})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({
        type: 'heading',
        level: heading[1].length === 2 ? 2 : 3,
        children: parseInline(heading[2]),
      });
      continue;
    }
    const bullet = /^[-*]\s+(.+)$/.exec(line);
    const numbered = /^\d+\.\s+(.+)$/.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const type = bullet ? 'ul' : 'ol';
      if (list && list.type !== type) flushList();
      if (!list) list = { type, items: [] };
      list.items.push(parseInline((bullet ?? numbered)![1]));
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return blocks;
}

export type LinkTarget =
  | { kind: 'internal'; slug: string }
  | { kind: 'external'; href: string }
  | { kind: 'none' };

/** `/help/<slug>/` opens in-app; http(s)/mailto open outside; anything else is dropped. */
export function classifyHelpLink(href: string): LinkTarget {
  const internal = /^\/help\/([a-z0-9][a-z0-9-]*)\/?(?:[#?].*)?$/i.exec(href);
  if (internal) return { kind: 'internal', slug: internal[1] };
  if (/^(https?:\/\/|mailto:)/i.test(href)) return { kind: 'external', href };
  return { kind: 'none' };
}
