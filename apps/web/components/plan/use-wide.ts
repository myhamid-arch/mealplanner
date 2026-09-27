"use client";
// The desktop breakpoint (lg, 1024 px): the screens render one layout, not both hidden by CSS,
// so each control exists once for assistive tech and tests.
import { useEffect, useState } from "react";

export function useWide(query = "(min-width: 1024px)"): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => {
      setWide(mq.matches);
    };
    update();
    mq.addEventListener("change", update);
    return () => {
      mq.removeEventListener("change", update);
    };
  }, [query]);
  return wide;
}
