import { syncRollingSchedule, getRollingWindow } from '../database';

describe('Database Rolling 7-Day Logic', () => {
  it('has a function to get the rolling window', () => {
    expect(typeof getRollingWindow).toBe('function');
  });

  it('has a function to sync the rolling schedule', () => {
    expect(typeof syncRollingSchedule).toBe('function');
  });
});
