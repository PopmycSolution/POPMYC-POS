import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../src/App';
import { APP_NAME } from '../src/utils/constants';

describe('App', () => {
  it('renders POPMYC brand text on login page when unauthenticated', () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <App />
      </MemoryRouter>
    );

    const popmycElements = screen.getAllByText(/POPMYC/i);
    expect(popmycElements.length).toBeGreaterThan(0);

    const appNameRegex = new RegExp(APP_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const matchingElements = screen.getAllByText(appNameRegex);
    expect(matchingElements.length).toBeGreaterThan(0);
  });
});
