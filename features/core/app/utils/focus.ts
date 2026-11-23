// Overlays that a navigation closes leave the focus in the new page
export const keepMovedFocus = (event: Event): void => {
  if (!(event.target as Element).contains(document.activeElement)) {
    event.preventDefault();
  }
};

// A closing menu takes the focus back when the pointer leaves one of its items
export const ignoreClosingMenu = (event: PointerEvent): void => {
  if (event.target instanceof Element && event.target.closest('[role="menu"][data-state="closed"]')) {
    event.stopPropagation();
  }
};
