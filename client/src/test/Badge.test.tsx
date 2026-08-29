import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Badge from '../components/ui/Badge';

describe('Badge', () => {
  it('renders children text', () => {
    render(<Badge>Actif</Badge>);
    expect(screen.getByText('Actif')).toBeInTheDocument();
  });

  it('applies default variant classes', () => {
    render(<Badge>Default</Badge>);
    const badge = screen.getByText('Default');
    expect(badge).toHaveClass('bg-gray-100', 'text-gray-700');
  });

  it('applies success variant classes', () => {
    render(<Badge variant="success">OK</Badge>);
    const badge = screen.getByText('OK');
    expect(badge).toHaveClass('bg-green-100', 'text-green-700');
  });

  it('applies danger variant classes', () => {
    render(<Badge variant="danger">Erreur</Badge>);
    const badge = screen.getByText('Erreur');
    expect(badge).toHaveClass('bg-red-100', 'text-red-700');
  });

  it('applies small size classes', () => {
    render(<Badge size="sm">Small</Badge>);
    const badge = screen.getByText('Small');
    expect(badge).toHaveClass('text-xs');
  });

  it('applies custom className', () => {
    render(<Badge className="ml-2">Custom</Badge>);
    const badge = screen.getByText('Custom');
    expect(badge).toHaveClass('ml-2');
  });
});
