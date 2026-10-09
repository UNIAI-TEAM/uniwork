# Fork CI replica r6 (uniwork-office @ a4304d6e), fresh VMs, test/cursor-cloud-env 0a10070c6
Cost ~21c (test 6.1c, e2e 14.8c). Suite verdict PASS: `test` job all steps incl. npm test (FTS5 Node, file-index tests pass); `e2e` job all steps incl. Electron suite.
Same caveat as r4: the final spec excludes docs-visual kitchen-sink and docs-table-float-click, which this replica does not prove.
