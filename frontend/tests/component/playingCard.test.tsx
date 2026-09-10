import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PlayingCard } from '../../src/components/PlayingCard';

describe('PlayingCard', () => {
  it('renders an SVG face with an accessible label and no bare rank text node', () => {
    const { container } = render(<PlayingCard card={{ rank: 14, suit: 'spades' }} />);
    expect(screen.getByRole('img', { name: 'Ace of spades' })).toBeInTheDocument();
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelectorAll('svg [data-pip]').length).toBe(1);
  });
  it('renders seven pips for a seven', () => {
    const { container } = render(<PlayingCard card={{ rank: 7, suit: 'clubs' }} />);
    expect(container.querySelectorAll('svg [data-pip]').length).toBe(7);
  });
  it('renders a back with a hidden label', () => {
    render(<PlayingCard back />);
    expect(screen.getByRole('img', { name: 'Face-down card' })).toBeInTheDocument();
  });
  it('uses the red token for hearts', () => {
    const { container } = render(<PlayingCard card={{ rank: 4, suit: 'hearts' }} />);
    expect(container.querySelector('svg')?.getAttribute('data-color')).toBe('red');
  });
});
