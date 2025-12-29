import { useRequestHeaders } from "nuxt/app";

// Very naive check but good enough for most cases
const mobileRegex = /Mobile|Android|iP(hone|ad)/i;

export const useDevice = () => {
  let isMobile = false;

  if (import.meta.server) {
    const headers = useRequestHeaders(["sec-ch-ua-mobile", "user-agent"]);
    const secChUaMobile = headers["sec-ch-ua-mobile"];
    const userAgent = headers["user-agent"];
    if (secChUaMobile === "?1") {
      isMobile = true;
    } else {
      isMobile = mobileRegex.test(userAgent ?? "");
    }
  } else if ("navigator" in globalThis) {
    const nav = globalThis.navigator as { userAgentData?: { mobile: boolean } };
    const userAgent = globalThis.navigator.userAgent;
    if ("userAgentData" in nav && nav.userAgentData) {
      isMobile = nav.userAgentData.mobile;
    } else {
      isMobile = mobileRegex.test(userAgent);
    }
  }

  return { isMobile };
};
