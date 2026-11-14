import { useAsyncData } from "nuxt/app";

// Loads data on the server, which passes it on to the browser with the page
export const usePayloadData = async <T>(key: string, load: () => Promise<T>): Promise<T | undefined> => {
  let failure: unknown;
  // Named, as the build moves inline handlers out of the scope of their variables
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
    // Thrown without the wrapper of Nuxt, whose message and data are shown to the browser
    throw failure instanceof Error ? failure : error.value;
  }
  // There is no data when the page is left while loading it
  return data.value;
};
