export const copyToClipboard = async (getText: () => string | Promise<string>) => {
  let copied = false;
  if ("ClipboardItem" in globalThis) {
    try {
      const item = new ClipboardItem({ "text/plain": getText() });
      await navigator.clipboard.write([item]);
      copied = true;
    } catch {
      /**/
    }
  }
  if (!copied) {
    try {
      await navigator.clipboard.writeText(await getText());
      copied = true;
    } catch {
      /**/
    }
  }
  return copied;
};
