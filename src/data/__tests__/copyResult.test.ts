import { copyResultMessage } from '../copyResult';

describe('copyResultMessage', () => {
  it.each([
    [{ copied: 2, skipped: 0 }, 'Copied', 'Copied 2 meals.'],
    [{ copied: 1, skipped: 0 }, 'Copied', 'Copied 1 meal.'],
    [{ copied: 2, skipped: 1 }, 'Copied', 'Copied 2 meals. Skipped 1 already planned.'],
    [{ copied: 1, skipped: 3 }, 'Copied', 'Copied 1 meal. Skipped 3 already planned.'],
    [{ copied: 0, skipped: 1 }, 'Nothing copied', 'Nothing copied: that slot is already planned.'],
    [{ copied: 0, skipped: 3 }, 'Nothing copied', 'Nothing copied: all 3 slots are already planned.'],
    [{ copied: 0, skipped: 0 }, 'Nothing copied', 'Nothing to copy.'],
  ])('%j', (result, title, message) => {
    expect(copyResultMessage(result)).toEqual({ title, message });
  });
});
