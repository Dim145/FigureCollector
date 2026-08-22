import useRailScroll from "../hooks/useRailScroll.js";

/**
 * A horizontal rail that centres its active item and shows that it scrolls.
 *
 * Every rail in the app used to be a bare `overflow-x-auto` with a hidden
 * scrollbar, so on a phone the current tab could sit off-screen with nothing
 * hinting it existed. Wrap the items here instead and pass the active key;
 * children opt in by carrying `data-rail-item="<key>"`.
 */
export default function ScrollRail({
  activeKey,
  as: As = "div",
  className = "",
  children,
  ...rest
}) {
  const { ref, edges } = useRailScroll(activeKey);
  return (
    <As
      ref={ref}
      data-rail=""
      data-edge-start={String(edges.start)}
      data-edge-end={String(edges.end)}
      className={className}
      {...rest}
    >
      {children}
    </As>
  );
}
