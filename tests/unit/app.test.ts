import { describe, expect, it } from 'vitest';
import { APP_NAME } from '../../src/shared/app';

describe('app', () => {
  it('has a name', () => expect(APP_NAME).toBe('spend-spend-spend'));
});
