import { useAsyncData } from "nuxt/app";

// The server sends the initial result with the page
export const usePayloadData = async <T>(key: string, load: () => Promise<T>): Promise<T | undefined> => {
  let failure: unknown;
  // A named handler keeps its closure when Nuxt extracts inline handlers at build time
  const handler = async (): Promise<T> => {
    try {
      return await load();
    } catch (cause) {
      failure = cause;
      throw cause;
    }
  };

  const { data, error } = await useAsyncData(key, handler);
  if (error.value) {
    // Nuxt exposes its error wrapper's message and data to the browser
    throw failure instanceof Error ? failure : error.value;
  }
  // Leaving the page before the load completes can leave data undefined
  return data.value;
};
