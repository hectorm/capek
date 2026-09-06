import { defineNitroPlugin } from "nitropack/runtime/plugin";

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook("render:html", (html, { event }) => {
    const nonce = event.context.nonce;
    if (!nonce) return;

    const stamp = (fragments: string[]): void => {
      fragments.forEach((fragment, i) => {
        fragments[i] = fragment.replace(/<script(?![^>]*\snonce=)/gi, `$& nonce="${nonce}"`);
      });
    };

    stamp(html.head);
    stamp(html.bodyPrepend);
    stamp(html.body);
    stamp(html.bodyAppend);
  });
});
