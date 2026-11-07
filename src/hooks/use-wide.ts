import { useEffect, useState } from 'react';

/**
 * True from `minWidth` up (computers and big tablets). For a panel that sits beside a full-screen feed: below
 * that width it is not rendered at all, so a phone never fetches what it cannot show.
 */
export function useWide(minWidth = 1024) {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${minWidth}px)`);
    const update = () => setWide(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [minWidth]);
  return wide;
}
