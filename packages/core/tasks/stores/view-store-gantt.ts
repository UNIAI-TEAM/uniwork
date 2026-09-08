"use client";

import type { StoreApi } from "zustand/vanilla";
import type { TaskStatusCategory } from "../../types/task";
import type {
  CardProperties,
  GanttZoom,
  SwimlaneGrouping,
  TableCalculation,
  TableColumnConfig,
  TableColumnKey,
  TableGrouping,
} from "./view-store-types";
import { DEFAULT_TABLE_COLUMNS } from "./view-store-types";

/** Gantt, swimlane, list-collapse, card, and table chrome (not query filters). */
export interface ViewDisplayFields {
  cardProperties: CardProperties;
  cardPropertyIds: string[];
  showSubTasks: boolean;
  listCollapsedStatuses: TaskStatusCategory[];
  ganttZoom: GanttZoom;
  ganttShowCompleted: boolean;
  swimlaneGrouping: SwimlaneGrouping;
  swimlaneOrders: Record<SwimlaneGrouping, string[]>;
  collapsedSwimlanes: Record<SwimlaneGrouping, string[]>;
  tableColumns: TableColumnConfig[];
  tableGrouping: TableGrouping;
  tableCollapsedGroups: string[];
  tableCollapsedParents: string[];
  tableHierarchy: boolean;
  tableCalculation: TableCalculation;
  setGanttZoom: (zoom: GanttZoom) => void;
  toggleGanttShowCompleted: () => void;
  toggleCardProperty: (key: keyof CardProperties) => void;
  toggleCardPropertyId: (propertyId: string) => void;
  toggleShowSubTasks: () => void;
  toggleListCollapsed: (category: TaskStatusCategory) => void;
  setSwimlaneGrouping: (grouping: SwimlaneGrouping) => void;
  setSwimlaneOrder: (order: string[]) => void;
  toggleSwimlaneCollapsed: (key: string) => void;
  toggleTableColumn: (key: TableColumnKey) => void;
  reorderTableColumn: (active: TableColumnKey, over: TableColumnKey) => void;
  setTableColumnWidth: (key: TableColumnKey, width?: number) => void;
  setTableGrouping: (grouping: TableGrouping) => void;
  toggleTableGroupCollapsed: (key: string) => void;
  toggleTableParentCollapsed: (taskId: string) => void;
  toggleTableHierarchy: () => void;
  setTableCalculation: (calculation: TableCalculation) => void;
}

type DisplaySetState = StoreApi<ViewDisplayFields>["setState"];

export function viewDisplaySlice(set: DisplaySetState): ViewDisplayFields {
  return {
    cardProperties: {
      priority: true,
      description: true,
      assignee: true,
      startDate: true,
      dueDate: true,
      project: true,
      childProgress: true,
      labels: true,
    },
    cardPropertyIds: [],
    showSubTasks: true,
    listCollapsedStatuses: [],
    ganttZoom: "week",
    ganttShowCompleted: false,
    swimlaneGrouping: "assignee",
    swimlaneOrders: { parent: [], project: [], assignee: [] },
    collapsedSwimlanes: { parent: [], project: [], assignee: [] },
    tableColumns: DEFAULT_TABLE_COLUMNS.map((column) => ({ ...column })),
    tableGrouping: "none",
    tableCollapsedGroups: [],
    tableCollapsedParents: [],
    tableHierarchy: true,
    tableCalculation: "none",

    setGanttZoom: (zoom) => set({ ganttZoom: zoom }),
    toggleGanttShowCompleted: () =>
      set((state) => ({ ganttShowCompleted: !state.ganttShowCompleted })),
    toggleCardProperty: (key) =>
      set((state) => ({
        cardProperties: {
          ...state.cardProperties,
          [key]: !state.cardProperties[key],
        },
      })),
    toggleCardPropertyId: (propertyId) =>
      set((state) => ({
        cardPropertyIds: state.cardPropertyIds.includes(propertyId)
          ? state.cardPropertyIds.filter((id) => id !== propertyId)
          : [...state.cardPropertyIds, propertyId],
      })),
    toggleShowSubTasks: () =>
      set((state) => ({ showSubTasks: !state.showSubTasks })),
    toggleListCollapsed: (status) =>
      set((state) => ({
        listCollapsedStatuses: state.listCollapsedStatuses.includes(status)
          ? state.listCollapsedStatuses.filter((s) => s !== status)
          : [...state.listCollapsedStatuses, status],
      })),
    setSwimlaneGrouping: (grouping) => set({ swimlaneGrouping: grouping }),
    setSwimlaneOrder: (order) =>
      set((state) => ({
        swimlaneOrders: {
          ...state.swimlaneOrders,
          [state.swimlaneGrouping]: order,
        },
      })),
    toggleSwimlaneCollapsed: (key) =>
      set((state) => {
        const grouping = state.swimlaneGrouping;
        const current = state.collapsedSwimlanes[grouping];
        const next = current.includes(key)
          ? current.filter((k) => k !== key)
          : [...current, key];
        return {
          collapsedSwimlanes: {
            ...state.collapsedSwimlanes,
            [grouping]: next,
          },
        };
      }),
    toggleTableColumn: (key) =>
      set((state) => {
        if (key === "title") return state;
        const exists = state.tableColumns.some((column) => column.key === key);
        return {
          tableColumns: exists
            ? state.tableColumns.filter((column) => column.key !== key)
            : [...state.tableColumns, { key }],
        };
      }),
    reorderTableColumn: (active, over) =>
      set((state) => {
        if (active === "title" || over === "title" || active === over) {
          return state;
        }
        const from = state.tableColumns.findIndex(
          (column) => column.key === active,
        );
        const to = state.tableColumns.findIndex(
          (column) => column.key === over,
        );
        if (from < 0 || to < 0) return state;
        const tableColumns = [...state.tableColumns];
        const [moved] = tableColumns.splice(from, 1);
        if (!moved) return state;
        tableColumns.splice(to, 0, moved);
        return { tableColumns };
      }),
    setTableColumnWidth: (key, width) =>
      set((state) => ({
        tableColumns: state.tableColumns.map((column) =>
          column.key === key
            ? {
                ...column,
                ...(width === undefined ? { width: undefined } : { width }),
              }
            : column,
        ),
      })),
    setTableGrouping: (tableGrouping) => set({ tableGrouping }),
    toggleTableGroupCollapsed: (key) =>
      set((state) => ({
        tableCollapsedGroups: state.tableCollapsedGroups.includes(key)
          ? state.tableCollapsedGroups.filter((item) => item !== key)
          : [...state.tableCollapsedGroups, key],
      })),
    toggleTableParentCollapsed: (taskId) =>
      set((state) => ({
        tableCollapsedParents: state.tableCollapsedParents.includes(taskId)
          ? state.tableCollapsedParents.filter((id) => id !== taskId)
          : [...state.tableCollapsedParents, taskId],
      })),
    toggleTableHierarchy: () =>
      set((state) => ({ tableHierarchy: !state.tableHierarchy })),
    setTableCalculation: (tableCalculation) => set({ tableCalculation }),
  };
}
