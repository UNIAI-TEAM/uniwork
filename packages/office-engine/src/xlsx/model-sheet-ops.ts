// XLSX session-model sheet operations: add / rename / remove / duplicate /
// reorder / hide applied in emission order against the live sheet registry.
// Split out of model.ts by FIX-926-D (mechanical move, behaviour byte-identical)
// so both files stay under the max-lines budget.
import { XlsxEngineError } from "./engine.ts";
import { toA1, type XlsxFilterOp, type XlsxHyperlinkOp, type XlsxNotesOp, type XlsxSheetOp, type XlsxStructuralOp } from "./ops.ts";
import { type XlsxPageSetupOp } from "./page-setup.ts";
import { type XlsxTableAddOp } from "./tables.ts";
import { type XlsxSheetProtectionOp } from "./ops-protection.ts";
import { type ModelSheetState, type PendingCell, type RemovedSheetState, type XlsxSheetEditPlan } from "./model-state.ts";

/** The subset of session state the sheet ops read and write. */
export interface XlsxSheetOpHost {
  sheetStates: ModelSheetState[];
  removedStates: Map<string, RemovedSheetState>;
  removedOriginals: string[];
  pending: Map<string, PendingCell>;
  structural: Map<string, XlsxStructuralOp[]>;
  filters: Map<string, XlsxFilterOp>;
  pageSetups: Map<string, XlsxPageSetupOp>;
  tables: XlsxTableAddOp[];
  sheetProtections: Map<string, XlsxSheetProtectionOp>;
  hyperlinks: Map<string, Map<string, XlsxHyperlinkOp>>;
  notes: Map<string, XlsxNotesOp>;
  sheetOrderChanged: boolean;
  sheetOpsApplied: number;
  addedSheetSequence: number;
  touched: boolean;
  revision: number;
}

export class XlsxSheetOps {
  constructor(readonly host: XlsxSheetOpHost) {}

  // ── sheet ops (add / rename / remove / duplicate / reorder / hide) ───────
  //
  // Applied in emission order against the live sheet registry. A rename
  // rewrites pending cell edits and the structural journal so both keep
  // addressing the sheet's current name; a removal drops them (nothing may
  // reach a part the save deletes); a duplicate clones the source's pending
  // state, mirroring the renderer journal's own copy — the gateway seeds the
  // clone from the source PART, and the cloned edits bring it to the source's
  // on-screen state.

  applySheetOp(op: XlsxSheetOp): void {
    switch (op.kind) {
      case "add_sheet": {
        const tombstone = this.host.removedStates.get(op.name);
        if (tombstone !== undefined) {
          // Undo of a removal: resurrect the original state (identity and
          // pending edits intact) and cancel the removal, so the save emits
          // no sheet op for this name and the file keeps its original part.
          this.host.removedStates.delete(op.name);
          const removedIndex = this.host.removedOriginals.indexOf(op.name);
          if (removedIndex >= 0) this.host.removedOriginals.splice(removedIndex, 1);
          this.host.sheetStates.splice(this.insertIndex(op.index ?? tombstone.index), 0, tombstone.state);
          for (const entry of tombstone.pending) this.host.pending.set(JSON.stringify([entry.sheetName, toA1(entry.row, entry.column)]), entry);
          if (tombstone.structural.length > 0) this.host.structural.set(tombstone.state.name, tombstone.structural);
          if (tombstone.filter !== undefined) this.host.filters.set(tombstone.state.name, tombstone.filter);
          if (tombstone.pageSetup !== undefined) this.host.pageSetups.set(tombstone.state.name, tombstone.pageSetup);
          if (tombstone.tables !== undefined) for (const table of tombstone.tables) this.host.tables.push(table);
          if (tombstone.protection !== undefined) this.host.sheetProtections.set(tombstone.state.name, tombstone.protection);
          if (tombstone.hyperlinks !== undefined) this.host.hyperlinks.set(tombstone.state.name, new Map(tombstone.hyperlinks.map((link) => [link.address, link])));
          if (tombstone.notes !== undefined) this.host.notes.set(tombstone.state.name, tombstone.notes);
          break;
        }
        this.host.sheetStates.splice(this.insertIndex(op.index), 0, this.makeAddedSheet(op.name, undefined));
        break;
      }
      case "duplicate_sheet": {
        const source = this.requireSheet(op.sheetName);
        const addition = this.makeAddedSheet(op.name, source.key);
        this.host.sheetStates.splice(this.insertIndex(op.index), 0, addition);
        this.cloneSheetEdits(source.name, addition.name);
        break;
      }
      case "rename_sheet": {
        const sheet = this.requireSheet(op.sheetName);
        if (sheet.name !== op.newName) {
          const previous = sheet.name;
          sheet.name = op.newName;
          this.renamePendingSheet(previous, op.newName);
        }
        break;
      }
      case "remove_sheet": {
        const sheet = this.requireSheet(op.sheetName);
        // F9: refuse removing the last visible sheet early, matching the
        // strip's own `visible.length > 1` guard and the gateway's rule.
        if (!sheet.hidden && this.host.sheetStates.every((candidate) => candidate === sheet || candidate.hidden)) {
          throw new XlsxEngineError("bad_target", "a workbook needs at least one visible sheet");
        }
        if (sheet.originalName !== undefined) this.host.removedOriginals.push(sheet.originalName);
        // Keep the state and its pending edits as a tombstone so an undo
        // (an `add_sheet` of the same name) can resurrect the sheet intact.
        const index = this.host.sheetStates.indexOf(sheet);
        this.host.removedStates.set(sheet.name, {
          state: sheet,
          pending: [...this.host.pending.values()].filter((entry) => entry.sheetName === sheet.name),
          structural: [...(this.host.structural.get(sheet.name) ?? [])],
          filter: this.host.filters.get(sheet.name),
          pageSetup: this.host.pageSetups.get(sheet.name),
          tables: this.host.tables.filter((table) => table.sheetName === sheet.name),
          protection: this.host.sheetProtections.get(sheet.name),
          ...(this.host.hyperlinks.has(sheet.name) ? { hyperlinks: [...(this.host.hyperlinks.get(sheet.name) ?? new Map()).values()] } : {}),
          ...(this.host.notes.has(sheet.name) ? { notes: this.host.notes.get(sheet.name) } : {}),
          index,
        });
        this.dropPendingSheet(sheet.name);
        this.host.sheetStates.splice(index, 1);
        break;
      }
      case "reorder_sheet": {
        const sheet = this.requireSheet(op.sheetName);
        const from = this.host.sheetStates.indexOf(sheet);
        this.host.sheetStates.splice(from, 1);
        this.host.sheetStates.splice(op.index, 0, sheet);
        // F9: a same-index move changes nothing; it must not stale the
        // calcChain (orderChanged) or force the recalc skip.
        if (this.host.sheetStates.indexOf(sheet) !== from) this.host.sheetOrderChanged = true;
        break;
      }
      case "set_sheet_hidden": {
        const sheet = this.requireSheet(op.sheetName);
        // F9: refuse hiding the last visible sheet early, matching the
        // strip's own `visible.length > 1` guard (the gateway would too).
        if (op.hidden && !sheet.hidden && this.host.sheetStates.every((candidate) => candidate === sheet || candidate.hidden)) {
          throw new XlsxEngineError("bad_target", "a workbook needs at least one visible sheet");
        }
        sheet.hidden = op.hidden;
        sheet.hiddenTouched = true;
        break;
      }
    }
    this.host.sheetOpsApplied += 1;
    this.host.touched = true;
    this.host.revision += 1;
  }

  requireSheet(name: string): ModelSheetState {
    const sheet = this.host.sheetStates.find((candidate) => candidate.name === name);
    if (!sheet) throw new XlsxEngineError("bad_target", "unknown sheet " + JSON.stringify(name));
    return sheet;
  }

  /** Insertion point for an addition: an explicit 0-based position (already
   *  range-checked by the parser) or the end of the tab strip. */
  insertIndex(index: number | undefined): number {
    return index ?? this.host.sheetStates.length;
  }

  makeAddedSheet(name: string, sourceKey: string | undefined): ModelSheetState {
    this.host.addedSheetSequence += 1;
    return {
      key: `added:${this.host.addedSheetSequence}`,
      name,
      hidden: false,
      hiddenTouched: false,
      added: true,
      ...(sourceKey === undefined ? {} : { sourceKey }),
    };
  }

  renamePendingSheet(previous: string, next: string): void {
    const moved = new Map<string, PendingCell>();
    for (const entry of this.host.pending.values()) {
      if (entry.sheetName !== previous) {
        moved.set(JSON.stringify([entry.sheetName, toA1(entry.row, entry.column)]), entry);
        continue;
      }
      moved.set(JSON.stringify([next, toA1(entry.row, entry.column)]), {
        ...entry,
        sheetName: next,
        edit: { ...entry.edit, sheetName: next },
      });
    }
    this.host.pending = moved;
    const ops = this.host.structural.get(previous);
    if (ops !== undefined) {
      this.host.structural.delete(previous);
      this.host.structural.set(next, ops.map((structural) => ({ ...structural, sheetName: next })));
    }
    const filter = this.host.filters.get(previous);
    if (filter !== undefined) {
      this.host.filters.delete(previous);
      this.host.filters.set(next, { ...filter, sheetName: next });
    }
    const pageSetup = this.host.pageSetups.get(previous);
    if (pageSetup !== undefined) {
      this.host.pageSetups.delete(previous);
      this.host.pageSetups.set(next, { ...pageSetup, sheetName: next });
    }
    this.host.tables = this.host.tables.map((table) => (table.sheetName === previous ? { ...table, sheetName: next } : table));
    const protection = this.host.sheetProtections.get(previous);
    if (protection !== undefined) {
      this.host.sheetProtections.delete(previous);
      this.host.sheetProtections.set(next, { ...protection, sheetName: next });
    }
    const links = this.host.hyperlinks.get(previous);
    if (links !== undefined) {
      this.host.hyperlinks.delete(previous);
      this.host.hyperlinks.set(next, new Map([...links].map(([address, link]) => [address, { ...link, sheetName: next }])));
    }
    const notes = this.host.notes.get(previous);
    if (notes !== undefined) {
      this.host.notes.delete(previous);
      this.host.notes.set(next, { ...notes, sheetName: next });
    }
  }

  dropPendingSheet(sheetName: string): void {
    for (const [key, entry] of this.host.pending) {
      if (entry.sheetName === sheetName) this.host.pending.delete(key);
    }
    this.host.structural.delete(sheetName);
    this.host.filters.delete(sheetName);
    this.host.pageSetups.delete(sheetName);
    this.host.tables = this.host.tables.filter((table) => table.sheetName !== sheetName);
    this.host.sheetProtections.delete(sheetName);
    this.host.hyperlinks.delete(sheetName);
    this.host.notes.delete(sheetName);
  }

  cloneSheetEdits(fromName: string, toName: string): void {
    for (const entry of [...this.host.pending.values()]) {
      if (entry.sheetName !== fromName) continue;
      this.host.pending.set(JSON.stringify([toName, toA1(entry.row, entry.column)]), {
        ...entry,
        sheetName: toName,
        edit: { ...entry.edit, sheetName: toName },
      });
    }
    const ops = this.host.structural.get(fromName);
    if (ops !== undefined) {
      this.host.structural.set(toName, ops.map((structural) => ({ ...structural, sheetName: toName })));
    }
    const filter = this.host.filters.get(fromName);
    if (filter !== undefined) this.host.filters.set(toName, { ...filter, sheetName: toName });
    const pageSetup = this.host.pageSetups.get(fromName);
    if (pageSetup !== undefined) this.host.pageSetups.set(toName, { ...pageSetup, sheetName: toName });
    const protection = this.host.sheetProtections.get(fromName);
    if (protection !== undefined) this.host.sheetProtections.set(toName, { ...protection, sheetName: toName });
    for (const table of this.host.tables.filter((candidate) => candidate.sheetName === fromName)) {
      this.host.tables.push({ ...table, sheetName: toName });
    }
    const links = this.host.hyperlinks.get(fromName);
    if (links !== undefined) this.host.hyperlinks.set(toName, new Map([...links].map(([address, link]) => [address, { ...link, sheetName: toName }])));
    const notes = this.host.notes.get(fromName);
    if (notes !== undefined) this.host.notes.set(toName, { ...notes, sheetName: toName });
  }

  /** The gateway's SheetEditPlan rebuilt from the model's final state. Field
   *  names follow the vendored interface exactly: renames/addition names are
   *  final, removals are original file names, `order` is the complete final
   *  tab order and hidden changes are keyed by the original (or added) name. */
  pendingSheetPlan(): XlsxSheetEditPlan | undefined {
    if (this.host.sheetOpsApplied === 0) return undefined;
    const live = this.host.sheetStates;
    const renames = live.flatMap((sheet) =>
      !sheet.added && sheet.originalName !== sheet.name
        ? [{ sheetName: sheet.originalName as string, newName: sheet.name }]
        : [],
    );
    const additions = live.flatMap((sheet) => {
      if (!sheet.added) return [];
      const sourceSheetName = this.duplicateSourceOriginal(sheet.sourceKey);
      return [{ name: sheet.name, ...(sourceSheetName === undefined ? {} : { sourceSheetName }) }];
    });
    const hiddenChanges = live.flatMap((sheet) =>
      sheet.hiddenTouched ? [{ sheetName: sheet.originalName ?? sheet.name, hidden: sheet.hidden }] : [],
    );
    // A resurrected removal (or a same-index reorder) leaves no plan field to
    // write: the file already holds this state, so the save stays a pure
    // cell/structural edit instead of a no-op sheet plan.
    if (
      renames.length === 0 && additions.length === 0 && this.host.removedOriginals.length === 0 &&
      hiddenChanges.length === 0 && !this.host.sheetOrderChanged
    ) {
      return undefined;
    }
    return {
      renames,
      additions,
      removals: [...this.host.removedOriginals],
      order: live.map((sheet) => sheet.name),
      ...(hiddenChanges.length === 0 ? {} : { hiddenChanges }),
      ...(this.host.sheetOrderChanged ? { orderChanged: true } : {}),
    };
  }

  /** Walks a duplicate chain back to a file sheet (its original name is the
   *  clone base the gateway can resolve). A chain that ends at an added sheet,
   *  or at one removed before save, has no file part — the clone base is
   *  blank and the cloned pending edits carry the content. */
  duplicateSourceOriginal(sourceKey: string | undefined): string | undefined {
    let key = sourceKey;
    const seen = new Set<string>();
    while (key !== undefined && !seen.has(key)) {
      seen.add(key);
      if (!key.startsWith("added:")) return key;
      const sheet = this.host.sheetStates.find((candidate) => candidate.key === key);
      if (sheet === undefined) return undefined;
      key = sheet.sourceKey;
    }
    return undefined;
  }
}
