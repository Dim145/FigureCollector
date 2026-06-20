/**
 * Loading spinner. `label` flips it into an announced status region
 * (role=status + sr-only text); otherwise it's decorative (aria-hidden).
 */
export default function Spinner({ size = 16, className = "", label }) {
  return (
    <span
      role={label ? "status" : undefined}
      className={`inline-flex items-center justify-center ${className}`}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden
        className="animate-spin"
      >
        <circle cx="12" cy="12" r="9" opacity="0.25" />
        <path d="M21 12a9 9 0 0 0-9-9" />
      </svg>
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}
