# Width-less column fixture (UNI-953 column-group save)

`xlsx-widthless-cols.xlsx` is the G0 kitchen-sink
(`docs/office/g0/fixtures/files/sheets/xlsx-kitchen-sink.xlsx`, formulas on
`Data!B6:C6` and sheet `PhuLuc`) with one change: sheet `Data` gets
`<cols><col min="2" max="3" style="0"/></cols>`. OOXML makes `width` optional
and some producers leave it off a style-only, hidden or grouped column;
IronCalc 0.7.1 refused such a package, so a formula edit in it could never
save (patch 0017). Used by `test/xlsx-recalc-widthless-columns.test.ts`.

`make-widthless-cols.cjs.txt` derived it on 2026-10-07. To regenerate, copy the
generator to a `.cjs` path outside the repository and run it from the
repository root (the zip bytes differ run to run; the XML does not):

```sh
cp packages/office-engine/test/fixtures/widthless-cols/make-widthless-cols.cjs.txt /tmp/make-widthless-cols.cjs
node /tmp/make-widthless-cols.cjs \
  "$PWD/packages/office-upstream/node_modules/jszip" \
  docs/office/g0/fixtures/files/sheets/xlsx-kitchen-sink.xlsx \
  packages/office-engine/test/fixtures/widthless-cols
```

The generator has a `.txt` extension so lint, knip and the test runners skip it.
