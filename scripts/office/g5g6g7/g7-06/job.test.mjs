// AC-1 tests for the G7-06 job (UNI-1378, contract section 4). Every rule is
// green on the unmutated input and red on a planted mutation with the reason
// the contract names. The four checks run as modules against fake dirs — a
// git-init'd fake fork, the checked-in fake captures, a temp goldens dir — so
// nothing here touches the checkout or needs a cloud VM.
//
// This file is the one entry the node --test lists of scripts/check.sh and
// ci.yml name; each check's cases live in test-cases/<check>.cases.mjs and
// register their tests on this file when imported.
import "./test-cases/protocol.cases.mjs";
import "./test-cases/extractor.cases.mjs";
import "./test-cases/golden.cases.mjs";
import "./test-cases/brand.cases.mjs";
