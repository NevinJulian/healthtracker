import Card from '../Card';
import Row from '../Row';
import IconChip, { iconChipIconColor } from '../IconChip';
import Pill from '../Pill';
import ProgressBar from '../ProgressBar';
import Button from '../Button';
import ScreenHeader from '../ScreenHeader';

describe('Verdure UI-kit components', () => {
  it('Card is a valid React component', () => {
    expect(typeof Card).toBe('function');
  });

  it('Row is a valid React component', () => {
    expect(typeof Row).toBe('function');
  });

  it('IconChip is a valid React component', () => {
    expect(typeof IconChip).toBe('function');
  });

  it('iconChipIconColor returns a string for each accent family', () => {
    (['sage', 'clay', 'sky', 'gold'] as const).forEach((accent) => {
      expect(typeof iconChipIconColor(accent)).toBe('string');
    });
  });

  it('Pill is a valid React component', () => {
    expect(typeof Pill).toBe('function');
  });

  it('ProgressBar is a valid React component', () => {
    expect(typeof ProgressBar).toBe('function');
  });

  it('Button is a valid React component', () => {
    expect(typeof Button).toBe('function');
  });

  it('ScreenHeader is a valid React component', () => {
    expect(typeof ScreenHeader).toBe('function');
  });
});
