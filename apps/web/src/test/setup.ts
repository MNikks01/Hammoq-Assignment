import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
  document.cookie.split(';').forEach((c) => {
    document.cookie = `${c.split('=')[0]?.trim()}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  });
});
