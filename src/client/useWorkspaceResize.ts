import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

const storageKey = "orbit.workspaceWidth";
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export function useWorkspaceResize(
  expanded: boolean,
  sidebarCollapsed: boolean,
  onResize: () => void,
) {
  const panelRef = useRef<HTMLElement>(null);
  const drag = useRef<{ pointerId: number; x: number; width: number } | null>(
    null,
  );
  const [dragging, setDragging] = useState(false);
  const [preferredWidth, setPreferredWidth] = useState<number | undefined>(
    () => {
      try {
        const saved = Number(localStorage.getItem(storageKey));
        return Number.isFinite(saved) && saved > 0 ? saved : undefined;
      } catch {
        return undefined;
      }
    },
  );
  const [bounds, setBounds] = useState({
    min: 320,
    max: 800,
    defaultWidth: 440,
  });

  useLayoutEffect(() => {
    const root = panelRef.current?.parentElement;
    if (!root) return;
    const sidebar = root.querySelector<HTMLElement>(".sidebar");
    const measure = () => {
      const viewport = root.getBoundingClientRect().width;
      const available =
        viewport - (sidebar?.getBoundingClientRect().width ?? 0);
      // Narrow windows use an overlay; phones keep their full-width panel.
      const max =
        viewport <= 650
          ? viewport
          : viewport <= 960
            ? viewport * 0.8
            : Math.max(320, available - 360);
      const min = viewport <= 650 ? max : Math.min(320, max);
      const defaultWidth =
        viewport <= 650
          ? viewport
          : viewport <= 960
            ? 410
            : viewport >= 1600
              ? 500
              : viewport <= 1190
                ? 385
                : 440;
      setBounds((previous) =>
        previous.min === min &&
        previous.max === max &&
        previous.defaultWidth === defaultWidth
          ? previous
          : { min, max, defaultWidth },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    if (sidebar) observer.observe(sidebar);
    return () => observer.disconnect();
  }, [sidebarCollapsed]);

  useEffect(() => {
    try {
      if (preferredWidth === undefined) localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, String(Math.round(preferredWidth)));
    } catch {
      // Resizing still works when browser storage is unavailable.
    }
  }, [preferredWidth]);

  useEffect(() => {
    if (!dragging) return;
    document.body.classList.add("workspace-resizing");
    return () => document.body.classList.remove("workspace-resizing");
  }, [dragging]);

  const width = clamp(
    expanded ? bounds.max : (preferredWidth ?? bounds.defaultWidth),
    bounds.min,
    bounds.max,
  );
  const resizeTo = (value: number) => {
    setPreferredWidth(clamp(value, bounds.min, bounds.max));
    onResize();
  };
  const reset = () => {
    setPreferredWidth(undefined);
    onResize();
  };
  const finish = () => {
    drag.current = null;
    setDragging(false);
  };

  return {
    panelRef,
    panelStyle: { "--workspace-width": `${width}px` } as CSSProperties,
    separatorProps: {
      role: "separator" as const,
      "aria-label": "调整对话与工作区宽度",
      "aria-orientation": "vertical" as const,
      "aria-controls": "orbit-workspace",
      "aria-valuemin": Math.round(bounds.min),
      "aria-valuemax": Math.round(bounds.max),
      "aria-valuenow": Math.round(width),
      "aria-valuetext": `右侧工作区 ${Math.round(width)} 像素`,
      tabIndex: 0,
      title: "左右拖动调整宽度，双击恢复默认",
      className: `workspace-divider${dragging ? " dragging" : ""}`,
      onDoubleClick: reset,
      onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 || !event.isPrimary) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointerId: event.pointerId, x: event.clientX, width };
        setDragging(true);
      },
      onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
        const start = drag.current;
        if (start?.pointerId === event.pointerId)
          resizeTo(start.width + start.x - event.clientX);
      },
      onPointerUp: (event: PointerEvent<HTMLDivElement>) => {
        if (drag.current?.pointerId !== event.pointerId) return;
        finish();
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      },
      onPointerCancel: finish,
      onLostPointerCapture: finish,
      onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
        const step = event.shiftKey ? 64 : 24;
        if (event.key === "ArrowLeft") resizeTo(width + step);
        else if (event.key === "ArrowRight") resizeTo(width - step);
        else if (event.key === "Home") resizeTo(bounds.min);
        else if (event.key === "End") resizeTo(bounds.max);
        else if (event.key === "Enter") reset();
        else return;
        event.preventDefault();
      },
    },
  };
}
