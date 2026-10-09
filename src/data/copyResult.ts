export interface CopyResult {
  copied: number;
  skipped: number;
}

export function copyResultMessage(result: CopyResult): { title: string; message: string } {
  return { title: '', message: '' };
}
