// Overlays that a navigation closes leave the focus in the new page
export const keepMovedFocus = (event: Event): void => {
  if (!(event.target as Element).contains(document.activeElement)) {
    event.preventDefault();
  }
};
