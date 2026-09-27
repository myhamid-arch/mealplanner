"use client";
// Drag to move a meal between days on the week plan (UX-4, WeekPlan "Drag to another day"; BLD-8
// R-58; leaf-1.4.8 ADR-1): pointer events, no library. Mouse and pen start a drag after the
// pointer moves 6 px with the button held (a shorter press stays a click); touch starts one after
// a 400 ms press without movement, so the day list still scrolls. The drop target is the element
// under the pointer carrying `data-drop="<date>|<slot type id>"`. Near the top or bottom edge of
// the window the page scrolls by itself (a touch drag cannot scroll the page otherwise; the phone
// tab bar covers the bottom). Escape cancels. The keyboard path is the meal sheet's "Move to…"
// menu (UX-6).
import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";

export interface DragSource {
  mealId: string;
  date: string;
  slotTypeId: string;
  /** What the ghost shows (the dish name). */
  label: string;
}

export interface DragState {
  source: DragSource;
  x: number;
  y: number;
  /** `date|slotTypeId` of the valid drop target under the pointer, if any. */
  over: string | null;
}

const MOUSE_SLOP_PX = 6;
const TOUCH_SLOP_PX = 8;
const TOUCH_HOLD_MS = 400;
/** Distance from the window's top or bottom edge that scrolls the page while dragging. */
const EDGE_PX = 96;
const EDGE_SPEED_PX = 12;

export const dropKey = (date: string, slotTypeId: string) => `${date}|${slotTypeId}`;

export function useMealDrag(opts: {
  canDrop: (source: DragSource, date: string, slotTypeId: string) => boolean;
  onDrop: (source: DragSource, date: string) => void;
}) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });
  const cleanup = useRef<(() => void) | null>(null);
  /** A drag just ended: the click that follows pointerup must not open the meal sheet. */
  const justDragged = useRef(false);

  useEffect(() => () => cleanup.current?.(), []);

  const targetAt = useCallback((x: number, y: number, source: DragSource): string | null => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drop]");
    const key = el?.dataset.drop;
    if (key === undefined) return null;
    const [date = "", slotTypeId = ""] = key.split("|");
    return optsRef.current.canDrop(source, date, slotTypeId) ? key : null;
  }, []);

  const start = useCallback(
    (e: PointerEvent<HTMLElement>, source: DragSource) => {
      if (e.button !== 0 || cleanup.current !== null) return;
      const touch = e.pointerType === "touch";
      const origin = { x: e.clientX, y: e.clientY };
      let active = false;
      let state: DragState | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let frame = 0;
      let last = origin;

      /** Edge auto-scroll: runs every frame while the drag is active. */
      const scroll = () => {
        if (!active) return;
        const h = window.innerHeight;
        const dy = last.y < EDGE_PX ? -EDGE_SPEED_PX : last.y > h - EDGE_PX ? EDGE_SPEED_PX : 0;
        if (dy !== 0) {
          const before = window.scrollY;
          window.scrollBy(0, dy);
          if (window.scrollY !== before) {
            state = { source, x: last.x, y: last.y, over: targetAt(last.x, last.y, source) };
            setDrag(state);
          }
        }
        frame = requestAnimationFrame(scroll);
      };
      const activate = (x: number, y: number) => {
        active = true;
        state = { source, x, y, over: targetAt(x, y, source) };
        setDrag(state);
        frame = requestAnimationFrame(scroll);
      };
      const end = (drop: boolean, released: boolean) => {
        const done = state;
        cleanup.current?.();
        if (!active) return;
        // Swallow the click the release produces: now if released, else on the coming release
        // (Escape cancels while the button is still held).
        justDragged.current = true;
        const clear = () =>
          setTimeout(() => {
            justDragged.current = false;
          }, 0);
        if (released) clear();
        else window.addEventListener("pointerup", clear, { once: true });
        setDrag(null);
        if (drop && done?.over != null) {
          const [date = ""] = done.over.split("|");
          optsRef.current.onDrop(source, date);
        }
      };
      const onMove = (ev: globalThis.PointerEvent) => {
        if (ev.pointerId !== e.pointerId) return;
        last = { x: ev.clientX, y: ev.clientY };
        const dist = Math.hypot(ev.clientX - origin.x, ev.clientY - origin.y);
        if (!active) {
          if (touch) {
            if (dist > TOUCH_SLOP_PX) cleanup.current?.();
          } else if (dist > MOUSE_SLOP_PX) activate(ev.clientX, ev.clientY);
          return;
        }
        state = {
          source,
          x: ev.clientX,
          y: ev.clientY,
          over: targetAt(ev.clientX, ev.clientY, source),
        };
        setDrag(state);
      };
      const onUp = (ev: globalThis.PointerEvent) => {
        if (ev.pointerId === e.pointerId) end(true, true);
      };
      const onCancel = (ev: globalThis.PointerEvent) => {
        if (ev.pointerId === e.pointerId) end(false, true);
      };
      const onKey = (ev: KeyboardEvent) => {
        if (ev.key === "Escape" && active) {
          ev.preventDefault();
          end(false, false);
        }
      };
      // Once a touch drag is active the page must not scroll under the finger.
      const onTouchMove = (ev: TouchEvent) => {
        if (active) ev.preventDefault();
      };
      if (touch)
        timer = setTimeout(() => {
          activate(origin.x, origin.y);
        }, TOUCH_HOLD_MS);
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      window.addEventListener("keydown", onKey);
      window.addEventListener("touchmove", onTouchMove, { passive: false });
      cleanup.current = () => {
        if (timer !== null) clearTimeout(timer);
        cancelAnimationFrame(frame);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        window.removeEventListener("keydown", onKey);
        window.removeEventListener("touchmove", onTouchMove);
        cleanup.current = null;
      };
    },
    [targetAt],
  );

  return {
    drag,
    start,
    /** True right after a drag ended: swallow the click it produces. */
    consumeClick: () => justDragged.current,
  };
}
