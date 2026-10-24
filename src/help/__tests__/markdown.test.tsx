import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { HelpMarkdown } from '@/components/help/HelpMarkdown';
import { classifyHelpLink, parseMarkdown } from '../markdown';

describe('parseMarkdown', () => {
  it('parses headings, lists, paragraphs', () => {
    const blocks = parseMarkdown('## Title\n\nLine one\nline two\n\n- a\n- b\n\n1. x\n2. y');
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'ul', 'ol']);
    expect(blocks[1]).toMatchObject({ type: 'paragraph' });
  });
  it('keeps an unclosed ** as text', () => {
    expect(parseMarkdown('a ** b')[0]).toMatchObject({
      children: [{ type: 'text', text: 'a ** b' }],
    });
  });
});

describe('classifyHelpLink', () => {
  it('routes /help/<slug>/ in-app and http(s)/mailto out, drops the rest', () => {
    expect(classifyHelpLink('/help/vitals/')).toEqual({ kind: 'internal', slug: 'vitals' });
    expect(classifyHelpLink('/help/vitals')).toEqual({ kind: 'internal', slug: 'vitals' });
    expect(classifyHelpLink('https://x.test/a')).toEqual({ kind: 'external', href: 'https://x.test/a' });
    expect(classifyHelpLink('javascript:alert(1)')).toEqual({ kind: 'none' });
    expect(classifyHelpLink('/profile')).toEqual({ kind: 'none' });
  });
});

describe('HelpMarkdown', () => {
  it('renders structure, bold, internal link in-app and external link in a new tab', () => {
    render(
      <MemoryRouter>
        <HelpMarkdown
          source={
            '## Heads up\n\n- one **bold** item\n\n1. first\n\n[In app](/help/invite-family/) and [Out](https://circlecare.app/x) [Bad](javascript:alert(1))'
          }
        />
      </MemoryRouter>
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Heads up' })).toBeInTheDocument();
    expect(screen.getAllByRole('list')).toHaveLength(2);
    expect(screen.getByText('bold').tagName).toBe('STRONG');
    const internal = screen.getByRole('link', { name: 'In app' });
    expect(internal).toHaveAttribute('href', '/help/invite-family');
    expect(internal).not.toHaveAttribute('target');
    const external = screen.getByRole('link', { name: 'Out' });
    expect(external).toHaveAttribute('href', 'https://circlecare.app/x');
    expect(external).toHaveAttribute('target', '_blank');
    expect(external.getAttribute('rel')).toContain('noopener');
    expect(screen.queryByRole('link', { name: 'Bad' })).toBeNull();
    expect(screen.getByText('Bad')).toBeInTheDocument();
  });
});
