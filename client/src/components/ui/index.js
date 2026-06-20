// Barrel for the shared UI primitive library. New code imports from here:
//   import { Button, Input, FormField, Checkbox } from "@/components/ui";
// The pre-existing primitives are re-exported from their original paths so
// legacy `../components/Button.jsx` imports keep working unchanged too.
export { default as Button } from "../Button.jsx";
export { default as FormField } from "../FormField.jsx";
export { default as Select } from "../Select.jsx";
export { default as Icon } from "./Icon.jsx";
export { default as Spinner } from "./Spinner.jsx";
export { default as Input } from "./Input.jsx";
export { default as Textarea } from "./Textarea.jsx";
export { default as Checkbox } from "./Checkbox.jsx";
export { default as Switch } from "./Switch.jsx";
export { Radio, RadioGroup } from "./Radio.jsx";
export { default as IconButton } from "./IconButton.jsx";
export { default as Modal } from "./Modal.jsx";
export { default as Drawer } from "./Drawer.jsx";
export { default as Tooltip } from "./Tooltip.jsx";
export { default as DropdownMenu } from "./DropdownMenu.jsx";
export { ToastProvider, useToast } from "./Toast.jsx";
export { default as Badge } from "./Badge.jsx";
export { default as Chip } from "./Chip.jsx";
export { default as Tabs } from "./Tabs.jsx";
export { default as SegmentedControl } from "./SegmentedControl.jsx";
export { default as Pagination } from "./Pagination.jsx";
export { default as Breadcrumbs } from "./Breadcrumbs.jsx";
export { default as Avatar } from "./Avatar.jsx";
export { default as DataTable } from "./DataTable.jsx";
// Re-exports of pre-existing primitives so everything is one import away.
export { default as Card } from "../Card.jsx";
export { default as StatCard } from "../StatCard.jsx";
export { default as AccentTitle } from "../AccentTitle.jsx";
export { default as EmptyState } from "../EmptyState.jsx";
