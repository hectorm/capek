export const longestStall = async (callback: () => Promise<unknown>): Promise<number> => {
  let longest = 0;
  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    longest = Math.max(longest, now - last);
    last = now;
  }, 10);
  try {
    await callback();
  } finally {
    clearInterval(timer);
  }
  return longest;
};
