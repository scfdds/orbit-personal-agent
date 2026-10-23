import {
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import {
  X,
  Check,
  LoaderCircle,
  Circle,
  Clock3,
  Pause,
  AlertCircle,
} from "lucide-react";
import type { ExecutionStatus } from "../shared/types.ts";

export function OrbitMark({ size = 25 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="20" cy="20" r="9.3" stroke="currentColor" strokeWidth="1.6" />
      <ellipse
        cx="20"
        cy="20"
        rx="17"
        ry="6.5"
        transform="rotate(-35 20 20)"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  );
}
export function IconButton({
  label,
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`icon-button ${className}`}
      title={label}
      aria-label={label}
      {...props}
    >
      {children}
    </button>
  );
}
export const statusNames: Record<ExecutionStatus, string> = {
  idle: "待开始",
  running: "正在进行",
  waiting: "等待新变化",
  needs_input: "需要你处理",
  paused: "已暂停",
  completed: "已完成",
  failed: "遇到问题",
};
export function Status({
  status,
  compact = false,
}: {
  status: ExecutionStatus;
  compact?: boolean;
}) {
  const Icon =
    status === "running"
      ? LoaderCircle
      : status === "waiting"
        ? Clock3
        : status === "completed"
          ? Check
          : status === "paused"
            ? Pause
            : status === "failed" || status === "needs_input"
              ? AlertCircle
              : Circle;
  return (
    <span className={`status status-${status}`} title={statusNames[status]}>
      <Icon
        size={compact ? 13 : 14}
        className={status === "running" ? "spin" : ""}
      />
      {!compact && statusNames[status]}
    </span>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>(
      'button, input, textarea, select, [tabindex="0"]',
    );
    first?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const elements = [
          ...(ref.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input, textarea, select, [tabindex="0"]',
          ) ?? []),
        ];
        const start = elements[0],
          end = elements.at(-1);
        if (e.shiftKey && document.activeElement === start) {
          e.preventDefault();
          end?.focus();
        } else if (!e.shiftKey && document.activeElement === end) {
          e.preventDefault();
          start?.focus();
        }
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={`modal ${wide ? "modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-header">
          <h2>{title}</h2>
          <IconButton label="关闭" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}
export function timeLabel(value?: string) {
  if (!value) return "—";
  return new Date(value).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
