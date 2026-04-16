import { render, screen } from '@testing-library/react';
import App from './App';

jest.mock('react-router-dom', () => {
  const React = require('react');

  return {
    Routes: ({ children }) => {
      const routes = React.Children.toArray(children);
      return routes[0]?.props.element || null;
    },
    Route: () => null,
    useNavigate: () => jest.fn()
  };
}, { virtual: true });

test('renders login page', () => {
  render(<App />);

  expect(screen.getByRole('heading', { name: /Login/i })).toBeInTheDocument();
});
