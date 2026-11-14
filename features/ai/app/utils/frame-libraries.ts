const sources = new Map<string, Promise<string>>();

export const loadFrameLibrary = (name: string): Promise<string> => {
  let source = sources.get(name);
  if (!source) {
    source = fetch(`/api/ai/frame-libraries/${name}`)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Library request failed with status ${String(response.status)}`);
        }
        return response.text();
      })
      .catch((error: unknown) => {
        sources.delete(name);
        throw error;
      });
    sources.set(name, source);
  }
  return source;
};
