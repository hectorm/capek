export const copyToClipboard = async (getText: () => string | Promise<string>) => {
  let copied = false;
  if ("ClipboardItem" in globalThis) {
    try {
      const item = new ClipboardItem({ "text/plain": getText() });
      await navigator.clipboard.write([item]);
      copied = true;
    } catch {
      // A failed ClipboardItem write falls back to writeText
    }
  }
  if (!copied) {
    try {
      await navigator.clipboard.writeText(await getText());
      copied = true;
    } catch {
      // Clipboard errors are reported through the return value
    }
  }
  return copied;
};
