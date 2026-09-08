import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CollapsibleSection } from '../CollapsibleSection';

describe('CollapsibleSection', () => {
  it('renders title and children', () => {
    render(
      <CollapsibleSection title="General Settings" defaultOpen>
        <p>Child content</p>
      </CollapsibleSection>,
    );
    expect(screen.getByText('General Settings')).toBeInTheDocument();
    expect(screen.getByText('Child content')).toBeInTheDocument();
  });

  it('starts open when defaultOpen=true', () => {
    render(
      <CollapsibleSection title="Open Section" defaultOpen>
        <p>Visible content</p>
      </CollapsibleSection>,
    );
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });

  it('starts closed when defaultOpen=false (default)', () => {
    render(
      <CollapsibleSection title="Closed Section">
        <p>Hidden content</p>
      </CollapsibleSection>,
    );
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('toggles open/closed on click', () => {
    render(
      <CollapsibleSection title="Toggle Section">
        <p>Toggle content</p>
      </CollapsibleSection>,
    );
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows field count badge when fieldCount is provided', () => {
    render(
      <CollapsibleSection title="Fields Section" fieldCount={5}>
        <p>Content</p>
      </CollapsibleSection>,
    );
    expect(screen.getByText('5 fields')).toBeInTheDocument();
  });

  it('shows singular "field" label for fieldCount=1', () => {
    render(
      <CollapsibleSection title="Single Field" fieldCount={1}>
        <p>Content</p>
      </CollapsibleSection>,
    );
    expect(screen.getByText('1 field')).toBeInTheDocument();
  });

  it('does not render field count badge when fieldCount is not provided', () => {
    render(
      <CollapsibleSection title="No Badge">
        <p>Content</p>
      </CollapsibleSection>,
    );
    expect(screen.queryByText(/field/)).not.toBeInTheDocument();
  });

  it('toggles on Enter key', () => {
    render(
      <CollapsibleSection title="Keyboard Section">
        <p>Keyboard content</p>
      </CollapsibleSection>,
    );
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-expanded', 'false');

    fireEvent.keyDown(button, { key: 'Enter' });
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });

  it('toggles on Space key', () => {
    render(
      <CollapsibleSection title="Space Key Section">
        <p>Space content</p>
      </CollapsibleSection>,
    );
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-expanded', 'false');

    fireEvent.keyDown(button, { key: ' ' });
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });

  it('has correct ARIA attributes', () => {
    render(
      <CollapsibleSection title="ARIA Section">
        <p>ARIA content</p>
      </CollapsibleSection>,
    );
    const button = screen.getByRole('button');
    const contentId = button.getAttribute('aria-controls');

    expect(contentId).toBeTruthy();
    expect(button).toHaveAttribute('aria-expanded');

    const contentRegion = document.getElementById(contentId!);
    expect(contentRegion).not.toBeNull();
    expect(contentRegion).toHaveAttribute('role', 'region');
    expect(contentRegion).toHaveAttribute('aria-labelledby', button.id);
  });
});
