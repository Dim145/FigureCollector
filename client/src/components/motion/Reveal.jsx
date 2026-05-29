import { motion, useReducedMotion } from "motion/react";

/**
 * Scroll-triggered reveal. Fades + rises into view once, GPU-only
 * (opacity/transform) so it stays smooth on mobile. Honours
 * prefers-reduced-motion by rendering a plain element with no animation.
 *
 * Usage:
 *   <Reveal as="li" delay={0.05} className="...">…</Reveal>
 *   <Reveal y={28} amount={0.4}>…</Reveal>
 */
export default function Reveal({
  as = "div",
  children,
  className,
  delay = 0,
  y = 18,
  amount = 0.2,
  once = true,
  style,
  ...rest
}) {
  const reduce = useReducedMotion();
  const Tag = motion[as] ?? motion.div;

  if (reduce) {
    const Plain = as;
    return (
      <Plain className={className} style={style} {...rest}>
        {children}
      </Plain>
    );
  }

  return (
    <Tag
      className={className}
      style={style}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once, amount }}
      transition={{ duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] }}
      {...rest}
    >
      {children}
    </Tag>
  );
}
