// G3-05c (UNI-824) - the `./AdvancedFilterDialog` scope boundary. The
// vendored `univer-sync` uses `buildCustomFilters` only inside its filter-save
// snapshot; filters stay `engine-gap` in this slice, so reaching it is a typed
// refusal rather than a fabricated empty filter set.
export function buildCustomFilters(): never {
  throw new Error(
    "xlsx_advanced_filter_unsupported: advanced filter criteria are outside G3-05c (capability row engine-gap)",
  );
}
