# Fork CI replica r4 (uniwork-office @ 86877508), final replica specs (CI font stack, 2 cases excluded)
Cost ~14c (test 7.1c, e2e 6.6c). Both shards PASS: test job all steps incl. npm test (font-covering now passes); e2e Electron suite 176 passed, 0 failed.
Excluded by the spec (--grep-invert): docs-visual "kitchen-sink renders pixel-identical" (math fallback font not on VM) and docs-table-float-click (caret lands in the paragraph on the VM, cause not found; failed in r3 at spec :106). Those two are NOT proven green by this replica.
Fork runners closed afterwards (`close --all yes --repo uniwork-office`); r5 started on fresh VMs.
