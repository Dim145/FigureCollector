/**
 * Consistent wrapper around a lucide-react icon. Pass the icon COMPONENT:
 *   import { Search } from "lucide-react";
 *   <Icon icon={Search} size="md" label="Rechercher" />
 *
 * Decorative by default (aria-hidden); give `label` to expose it as an image
 * to assistive tech. Sizes are tokenised so icons stay rhythmic; strokeWidth
 * defaults to 1.75 for the hairline Direction-A feel. Inherits `currentColor`.
 */
const SIZES = { xs: 14, sm: 16, md: 20, lg: 24, xl: 28 };

export default function Icon({
  icon: IconCmp,
  size = "md",
  strokeWidth = 1.75,
  label,
  className = "",
  ...props
}) {
  if (!IconCmp) return null;
  const px = typeof size === "number" ? size : (SIZES[size] ?? SIZES.md);
  return (
    <IconCmp
      width={px}
      height={px}
      strokeWidth={strokeWidth}
      className={className}
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label || undefined}
      {...props}
    />
  );
}
