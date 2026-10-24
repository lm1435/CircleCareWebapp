import type { ReactElement, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { classifyHelpLink, parseMarkdown, type InlineNode } from '@/help/markdown';
import type { HelpArticleSource } from '@/help/types';

// Never terracotta as text (web ADA): coral-deep is the link ink used elsewhere.
const LINK_CLASS = 'text-coral-deep underline underline-offset-4';

function renderInline(nodes: InlineNode[], keyPrefix: string): ReactNode[] {
  return nodes.map((node, i) => {
    const key = `${keyPrefix}-${i}`;
    if (node.type === 'text') return node.text;
    if (node.type === 'bold') {
      return <strong key={key}>{renderInline(node.children, key)}</strong>;
    }
    const target = classifyHelpLink(node.href);
    const children = renderInline(node.children, key);
    if (target.kind === 'internal') {
      return (
        <Link
          key={key}
          to={`/help/${target.slug}`}
          state={{ helpSource: 'related' satisfies HelpArticleSource }}
          className={LINK_CLASS}
        >
          {children}
        </Link>
      );
    }
    if (target.kind === 'external') {
      return (
        <a key={key} href={target.href} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
          {children}
        </a>
      );
    }
    return <span key={key}>{children}</span>;
  });
}

export interface HelpMarkdownProps {
  source: string;
}

export function HelpMarkdown({ source }: HelpMarkdownProps): ReactElement {
  const blocks = parseMarkdown(source);
  return (
    <div className="flex flex-col gap-3 text-base leading-relaxed text-ink-2">
      {blocks.map((block, i) => {
        const key = `b${i}`;
        switch (block.type) {
          case 'heading': {
            const Tag = block.level === 2 ? 'h2' : 'h3';
            return (
              <Tag key={key} className="m-0 mt-3 text-lg font-semibold leading-tight text-ink">
                {renderInline(block.children, key)}
              </Tag>
            );
          }
          case 'paragraph':
            return (
              <p key={key} className="m-0">
                {renderInline(block.children, key)}
              </p>
            );
          case 'ul':
          case 'ol': {
            const Tag = block.type;
            return (
              <Tag
                key={key}
                className={`m-0 flex flex-col gap-1.5 pl-6 ${block.type === 'ul' ? 'list-disc' : 'list-decimal'}`}
              >
                {block.items.map((item, j) => (
                  <li key={`${key}-${j}`}>{renderInline(item, `${key}-${j}`)}</li>
                ))}
              </Tag>
            );
          }
        }
      })}
    </div>
  );
}
