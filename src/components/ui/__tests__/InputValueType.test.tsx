import { render, screen } from '@testing-library/react';
import { CHOICE_TILE_LABEL, INPUT_TEXT, INPUT_TEXT_CHAT } from '../inputStyles';
import { TextField } from '../TextField';
import { TextArea } from '../TextArea';
import { Select } from '../Select';
import { DateField } from '../DateField';
import { TimeField } from '../TimeField';

// Owner 2026-11-07: every VALUE (typed, picked, tile label) shares one size + weight: the tile label's
// text-base (18) at font-medium (500). Placeholders match, only their colour is muted. Mobile twin: inputStyles.
const TILE = CHOICE_TILE_LABEL.split(' ');
const sizeOf = (c: string) => c.split(' ').filter((x) => /^text-(xs|sm|md|base|lg|xl)$/.test(x));

describe('shared input value type matches the choice tile', () => {
  it('INPUT_TEXT uses the tile size and weight, not 16/400', () => {
    expect(sizeOf(INPUT_TEXT)).toEqual(sizeOf(CHOICE_TILE_LABEL));
    expect(INPUT_TEXT).toContain('text-base');
    expect(INPUT_TEXT).not.toContain('text-md');
    expect(TILE).toContain('font-medium');
    expect(INPUT_TEXT.split(' ')).toContain('font-medium');
  });

  it('placeholder keeps the muted colour and the same weight', () => {
    expect(INPUT_TEXT).toContain('placeholder:text-placeholder');
    expect(INPUT_TEXT).toContain('placeholder:font-medium');
  });

  it('every rendered control carries it', () => {
    render(
      <>
        <TextField id="a" label="A" value="" onChange={() => {}} />
        <TextArea id="b" label="B" value="" onChange={() => {}} />
        <Select id="c" label="C" value="1" onChange={() => {}} options={[{ value: '1', label: 'One' }]} />
        <DateField id="d" label="D" value="2026-11-07" onChange={() => {}} />
        <TimeField id="e" label="E" value="08:00" onChange={() => {}} />
      </>
    );
    for (const name of ['A', 'B', 'C', 'D', 'E']) {
      const el = screen.getByLabelText(name);
      expect(el).toHaveClass('text-base', 'font-medium', 'placeholder:font-medium');
      expect(el).not.toHaveClass('text-md');
    }
  });

  it('chat-style surfaces opt back to 16/400', () => {
    expect(INPUT_TEXT_CHAT).toContain('text-md!');
    expect(INPUT_TEXT_CHAT).toContain('font-normal!');
  });
});
