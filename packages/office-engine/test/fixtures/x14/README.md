# x14 CF/DV fixtures (UNI-940 X01 review M1)

Minimal workbooks for `test/xlsx-cf-dv-x14.test.ts`. They are not saved from
Excel. `make-x14.cjs.txt` derived them on 2026-10-06 from the G0 fixture
`docs/office/g0/fixtures/files/sheets/xlsx-compatibility-edit.xlsx`: it keeps
that package's styles, rels and content types and replaces
`xl/worksheets/sheet1.xml` with hand-written XML in the shape Excel 365 writes.

| File | Sheet `Data` (A1:D6, inline strings + numbers) | Extra |
| --- | --- | --- |
| `xlsx-x14-data-bar.xlsx` | A data bar on `B2:B6`. The base `<cfRule type="dataBar">` (min/max cfvo, `FF638EC6`) carries `<extLst><ext uri="{B025F937-…}"><x14:id>`, and the worksheet `<extLst><ext uri="{78C0D931-…}">` holds the linked `x14:cfRule` (autoMin/autoMax, border, negative colours, `xm:sqref`). | none |
| `xlsx-x14-data-validation.xlsx` | A list validation on `C2:C6` that exists only as `x14:dataValidation` (formula `Lists!$A$1:$A$3`) in the worksheet `<extLst><ext uri="{CCE6A557-…}">`. Excel writes cross-sheet list sources this way. | sheet `Lists` (A1:A3), `rId9` |

To regenerate, run from the repository root:

```sh
node packages/office-engine/test/fixtures/x14/make-x14.cjs.txt \
  "$PWD/packages/office-upstream/node_modules/jszip" \
  docs/office/g0/fixtures/files/sheets/xlsx-compatibility-edit.xlsx \
  packages/office-engine/test/fixtures/x14
```

The generator has a `.txt` extension so lint, knip and the test runners skip it.
