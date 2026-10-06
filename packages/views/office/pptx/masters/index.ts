/**
 * B6ui (UNI-927) - the slide master view panel's public surface.
 *
 * Self-contained: the wire round imports from here, mounts `MastersPanel`
 * behind View > Slide Master, maps `MasterPanelEdit` 1:1 onto the engine's
 * master edit kinds and merges `./masters-i18n` into the shared locale files.
 *
 *   <MastersPanel
 *     parts={...} activePart={...} onSelectPart={...}
 *     elements={...} selectedElementId={...} onSelectElement={...}
 *     onEdit={(edit) => handle.edit([edit])}
 *     onClose={...} status={...} pending={...}
 *   />
 */
export { MastersPanel } from "./masters-panel";
export type {
  MasterBox,
  MasterElementView,
  MasterPanelEdit,
  MasterPanelProps,
  MasterPanelStatus,
  MasterPartView,
} from "./masters-model";
