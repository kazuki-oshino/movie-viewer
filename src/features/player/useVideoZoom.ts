import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

export function zoomLimits(width: number, height: number, aspect: number, zoom: number) {
  const contentWidth = Math.min(width, height * aspect);
  const contentHeight = Math.min(height, width / aspect);
  return {
    x: Math.max(0, (contentWidth * zoom - width) / 2),
    y: Math.max(0, (contentHeight * zoom - height) / 2),
  };
}
const clamp = (value: number) => Math.max(-1, Math.min(1, value));

export function useVideoZoom(aspect: number) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    panX: number;
    panY: number;
  } | null>(null);
  useEffect(() => {
    const node = stageRef.current;
    if (!node) return;
    const measure = () => setSize({ width: node.clientWidth, height: node.clientHeight });
    measure();
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(node);
    return () => observer?.disconnect();
  }, []);
  const limits = zoomLimits(size.width, size.height, aspect || 16 / 9, zoom);
  const stop = () => {
    drag.current = null;
    setDragging(false);
  };
  return {
    stageRef,
    zoom,
    dragging,
    transform: `translate(${pan.x * limits.x}px, ${pan.y * limits.y}px) scale(${zoom})`,
    setZoom(value: number) {
      setZoom(Math.max(1, Math.min(4, value)));
      if (value <= 1) setPan({ x: 0, y: 0 });
    },
    center() {
      setPan({ x: 0, y: 0 });
    },
    move(x: number, y: number) {
      setPan((old) => ({ x: clamp(old.x + x), y: clamp(old.y + y) }));
    },
    handlers: {
      onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
        if (
          zoom <= 1 ||
          event.button !== 0 ||
          (event.target as HTMLElement).closest('button,input,select')
        )
          return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          panX: pan.x * limits.x,
          panY: pan.y * limits.y,
        };
        setDragging(true);
      },
      onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
        const start = drag.current;
        if (!start || start.id !== event.pointerId) return;
        setPan({
          x: limits.x ? clamp((start.panX + event.clientX - start.x) / limits.x) : 0,
          y: limits.y ? clamp((start.panY + event.clientY - start.y) / limits.y) : 0,
        });
      },
      onPointerUp: stop,
      onPointerCancel: stop,
      onLostPointerCapture: stop,
    },
  };
}
