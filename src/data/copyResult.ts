export interface CopyResult {
  copied: number;
  skipped: number;
}

export function copyResultMessage({ copied, skipped }: CopyResult): { title: string; message: string } {
  if (copied > 0) {
    const done = `Copied ${copied} ${copied === 1 ? 'meal' : 'meals'}.`;
    return { title: 'Copied', message: skipped > 0 ? `${done} Skipped ${skipped} already planned.` : done };
  }
  if (skipped === 0) return { title: 'Nothing copied', message: 'Nothing to copy.' };
  return {
    title: 'Nothing copied',
    message:
      skipped === 1
        ? 'Nothing copied: that slot is already planned.'
        : `Nothing copied: all ${skipped} slots are already planned.`,
  };
}
