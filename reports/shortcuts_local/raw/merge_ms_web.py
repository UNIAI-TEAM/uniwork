"""Merge the three web-proposal files (W1-W3, MS 365 for the web) into shortcuts.csv.

Run:  python -I raw/merge_ms_web.py   (stdlib only; idempotent: refuses to run on an already merged file)

- keeps the 486 rows and their order and every existing column;
- replaces `proposal_web` by `proposal_web_new`;
- adds `ms_web_win, ms_web_mac, ms_web_source` right after `ms_source`
  and `proposal_web_basis` right after `proposal_web`;
- every id of shortcuts.csv must be in exactly one W file, else it fails;
- keeps the encoding (UTF-8 with BOM, LF) and quotes cells as csv does;
- writes ../WEB-DIFF.md (English, for the Advisor).
"""
import collections
import csv
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
R = os.path.dirname(HERE)
SC = os.path.join(R, 'shortcuts.csv')
DIFF = os.path.join(R, 'WEB-DIFF.md')
W = [
    ('W1', os.path.join(HERE, 'synth2', 'W1-text-editors')),
    ('W2', os.path.join(HERE, 'synth2', 'W2-sheets-slides')),
    ('W3', os.path.join(HERE, 'synth2', 'W3-common-pdf-shell-global')),
]
BASES = ['MS-WEB', 'MS-WEB-ALT', 'DESKTOP-FALLBACK', 'ALT-PROPOSED', 'KEEP', 'OFFICE-WINS', 'n/a']
W_COLS = ['id', 'ms_web_win', 'ms_web_mac', 'ms_web_source', 'proposal_web_new', 'proposal_web_basis', 'change_note']
OLD_COLS = ['id', 'group', 'action', 'ms_win', 'ms_mac', 'ms_source', 'web_today', 'desktop_today', 'evidence',
            'status', 'proposal_web', 'proposal_desktop', 'slice', 'ime_altgr', 'confidence', 'notes']
NEW_COLS = ['id', 'group', 'action', 'ms_win', 'ms_mac', 'ms_source', 'ms_web_win', 'ms_web_mac', 'ms_web_source',
            'web_today', 'desktop_today', 'evidence', 'status', 'proposal_web', 'proposal_web_basis',
            'proposal_desktop', 'slice', 'ime_altgr', 'confidence', 'notes']
GROUPS = ['common', 'docs', 'sheets', 'slides', 'pdf', 'html', 'markdown', 'uninote', 'shell', 'global']

# Cells reworded because gitleaks `generic-api-key` flags the text (false positive). (id, column) -> (old, new)
REWORDS = {}


def die(msg):
    sys.exit('merge_ms_web: ' + msg)


def read_csv(path, bom):
    with open(path, 'r', encoding='utf-8-sig' if bom else 'utf-8', newline='') as f:
        return list(csv.reader(f))


def short(s, n):
    s = ' '.join(s.split()).replace('|', '\\|')
    return s if len(s) <= n else s[:n - 1].rstrip() + '…'


def main():
    with open(SC, 'rb') as f:
        raw = f.read()
    if not raw.startswith(b'\xef\xbb\xbf'):
        die('shortcuts.csv lost its BOM')
    if b'\r' in raw:
        die('shortcuts.csv has CR characters; this script assumes LF')
    rows = read_csv(SC, True)
    if rows[0] != OLD_COLS:
        die('shortcuts.csv header is not the pre-merge header (already merged?): %s' % rows[0])
    old = {r[0]: dict(zip(OLD_COLS, r)) for r in rows[1:]}
    order = [r[0] for r in rows[1:]]
    if len(order) != 486 or len(old) != 486:
        die('expected 486 unique rows, got %d / %d' % (len(order), len(old)))
    if any(len(r) != len(OLD_COLS) for r in rows):
        die('ragged rows in shortcuts.csv')

    # ---- load W files, each id exactly once
    web = {}
    src_of = {}
    for name, base in W:
        wr = read_csv(base + '.csv', False)
        if wr[0] != W_COLS:
            die('%s header is %s' % (name, wr[0]))
        for r in wr[1:]:
            if len(r) != len(W_COLS):
                die('%s: ragged row %s' % (name, r[:1]))
            d = dict(zip(W_COLS, r))
            i = d['id']
            if i not in old:
                die('%s: id %s is not in shortcuts.csv' % (name, i))
            if i in web:
                die('id %s is in both %s and %s' % (i, src_of[i], name))
            if d['proposal_web_basis'] not in BASES:
                die('%s: %s has basis %r' % (name, i, d['proposal_web_basis']))
            for k in ('ms_web_win', 'ms_web_mac', 'ms_web_source', 'proposal_web_new'):
                if not d[k].strip():
                    die('%s: %s has an empty %s' % (name, i, k))
            web[i] = d
            src_of[i] = name
    missing = [i for i in order if i not in web]
    if missing:
        die('%d ids of shortcuts.csv are in no W file: %s' % (len(missing), missing[:10]))

    # ---- build the merged table
    out_rows = [NEW_COLS]
    reworded = []
    for i in order:
        o, n = old[i], web[i]
        cell = dict(o)
        cell.update(ms_web_win=n['ms_web_win'], ms_web_mac=n['ms_web_mac'], ms_web_source=n['ms_web_source'],
                    proposal_web=n['proposal_web_new'], proposal_web_basis=n['proposal_web_basis'])
        for (rid, col), (a, b) in REWORDS.items():
            if rid == i:
                if a not in cell[col]:
                    die('reword for %s.%s does not match' % (rid, col))
                cell[col] = cell[col].replace(a, b)
                reworded.append((rid, col, a, b))
        out_rows.append([cell[c] for c in NEW_COLS])
    buf = io.StringIO(newline='')
    csv.writer(buf, lineterminator='\n').writerows(out_rows)
    data = buf.getvalue()
    # sanity: re-read gives the same table
    if list(csv.reader(io.StringIO(data, newline=''))) != out_rows:
        die('csv round trip changed the table')
    with open(SC, 'wb') as f:
        f.write(b'\xef\xbb\xbf' + data.encode('utf-8'))

    write_diff(order, old, web, src_of, reworded)
    cnt = collections.Counter(web[i]['proposal_web_basis'] for i in order)
    print('merged %d rows; basis counts: %s' % (len(order), dict(cnt)))


def alt_reasons():
    """why-text of every ALT-PROPOSED row, read from the ALT-PROPOSED section of the three W .md files."""
    why = {}
    for name, base in W:
        with open(base + '.md', 'r', encoding='utf-8') as f:
            lines = f.read().split('\n')
        on = False
        for ln in lines:
            if ln.startswith('## '):
                on = 'ALT-PROPOSED' in ln
                continue
            if not on:
                continue
            m = re.match(r'^\| ((?:[a-z]+)-\d+) \| (.*?) \| (.*) \|$', ln)
            if m and m.group(1) != 'id':
                why[m.group(1)] = m.group(3)
                continue
            m = re.match(r'^- \*\*([a-z]+-\d+)\b[^*]*\*\*(.*)$', ln)
            if m:
                why[m.group(1)] = m.group(2).lstrip(' ,:').strip()
    for i, t in list(why.items()):
        m = re.match(r'^as ([a-z]+-\d+)\.$', t)
        if m and m.group(1) in why:
            why[i] = '%s (same reason as %s)' % (why[m.group(1)], m.group(1))
    return why


def write_diff(order, old, web, src_of, reworded):
    L = []
    A = L.append
    grp = {i: old[i]['group'] for i in order}
    cnt = collections.Counter((grp[i], web[i]['proposal_web_basis']) for i in order)
    tot = collections.Counter(web[i]['proposal_web_basis'] for i in order)
    A('# WEB-DIFF — web proposals rebuilt from Microsoft 365 for the web (UNI-2011)')
    A('')
    A('Generated by `raw/merge_ms_web.py` from `raw/synth2/W1-text-editors`, `W2-sheets-slides` and `W3-common-pdf-shell-global` (`.csv` + `.md`). '
      '`shortcuts.csv` now carries `ms_web_win`, `ms_web_mac`, `ms_web_source` (after `ms_source`) and `proposal_web_basis` (after `proposal_web`); '
      '`proposal_web` is the new web proposal, the old text is in git history and in the table below. Desktop columns (`ms_win`, `ms_mac`, `proposal_desktop`) are unchanged. '
      'Nothing here is validated in a browser.')
    A('')
    A('## 1. Counts per basis (486 rows)')
    A('')
    A('| group | rows | ' + ' | '.join(BASES) + ' |')
    A('|---|---:|' + '---:|' * len(BASES))
    for g in GROUPS:
        n = sum(cnt[(g, b)] for b in BASES)
        A('| %s | %d | ' % (g, n) + ' | '.join(str(cnt[(g, b)]) for b in BASES) + ' |')
    A('| **all** | **%d** | ' % len(order) + ' | '.join('**%d**' % tot[b] for b in BASES) + ' |')
    A('')
    A('Basis: `MS-WEB` = key as MS 365 for the web prints it; `MS-WEB-ALT` = the alternative MS web itself documents for a key the browser keeps; '
      '`DESKTOP-FALLBACK` = MS web prints nothing, the MS desktop key is used; `ALT-PROPOSED` = MS web prints nothing for a Chromium-reserved key (or no Mac key where Windows differs), '
      'a proposed key; `KEEP` = existing behaviour, no MS counterpart; `OFFICE-WINS` = UniWork global key, Office key wins while an Office document is open; `n/a` = no such action.')
    A('')
    fb = [i for i in order if web[i]['proposal_web_basis'] == 'DESKTOP-FALLBACK']
    A('## 2. Rows that fall back to the desktop key: %d of 486' % len(fb))
    A('')
    A('MS web prints nothing for these actions and the key is not browser-reserved, so the web proposal is the MS desktop key. '
      'By group: ' + ', '.join('%s %d' % (g, sum(1 for i in fb if grp[i] == g)) for g in GROUPS if any(grp[i] == g for i in fb)) + '. '
      'A further 2 rows (common-05, common-10) fall back for one product part only (their row-level basis is `ALT-PROPOSED`). '
      'pdf rows are all fallback or KEEP because MS web has no PDF page (the Edge PDF key is the reference).')
    A('')
    A(', '.join(fb) + '.')
    A('')
    ch = [i for i in order if web[i]['change_note'].startswith('CHANGED')]
    A('## 3. Rows whose web proposal CHANGED: %d' % len(ch))
    A('')
    A('Old = `proposal_web` before the merge, new = `proposal_web_new` (both shortened; full text in the W csv files).')
    A('')
    A('| id | action | old -> new | basis | why |')
    A('|---|---|---|---|---|')
    for i in ch:
        why = web[i]['change_note'][len('CHANGED:'):].strip()
        why = re.split(r'(?<=[.;])\s', why, maxsplit=1)[0]
        A('| %s | %s | %s -> %s | %s | %s |' % (i, short(old[i]['action'], 40), short(old[i]['proposal_web'], 70),
                                               short(web[i]['proposal_web_new'], 80), web[i]['proposal_web_basis'], short(why, 150)))
    A('')
    alt = [i for i in order if web[i]['proposal_web_basis'] == 'ALT-PROPOSED']
    why = alt_reasons()
    A('## 4. ALT-PROPOSED rows: %d (proposed keys, untested in browsers)' % len(alt))
    A('')
    A('| id | key | why |')
    A('|---|---|---|')
    for i in alt:
        if i not in why:
            die('no reason found in the W .md files for ALT-PROPOSED row %s' % i)
        key = web[i]['proposal_web_new']
        key = key.split(' (')[0] if len(key) > 80 else key
        A('| %s | %s | %s |' % (i, short(key, 70), short(why[i], 300)))
    A('')
    A('## 5. Contradictions and decisions for the Advisor')
    A('')
    A('Collected from section 4 of the three W files; ids point to rows of `shortcuts.csv`.')
    A('')
    for item in CONTRADICTIONS:
        A('- ' + item)
    A('')
    A('Open questions are in section 6 of each W file (`raw/synth2/W*.md`).')
    A('')
    A('## 6. Notes on this merge')
    A('')
    A('- Row order, row count (486) and every pre-existing column are unchanged; `proposal_web` holds the new proposal. Encoding kept: UTF-8 with BOM, LF.')
    A('- Each id is in exactly one W file (W1 216 rows: docs, uninote, markdown, html; W2 176: sheets, slides; W3 94: common, pdf, shell, global).')
    A('- `change_note` of the W files is not a column of `shortcuts.csv`; its `CHANGED:` part feeds section 3.')
    if reworded:
        A('- Cells reworded because gitleaks `generic-api-key` flags the text (false positive):')
        for rid, col, a, b in reworded:
            A('  - `%s` `%s`: `%s` -> `%s`' % (rid, col, a, b))
    else:
        A('- No cell had to be reworded for gitleaks.')
    A('')
    with open(DIFF, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(L))


CONTRADICTIONS = [
    '**`Ctrl+/` (common-14, docs-061, markdown-027, uninote-007).** Word for the web uses `Ctrl+Slash (/)` for Numbered list, so the desktop contract\'s shortcut-sheet key cannot be used in Docs on web: Docs gets no key (Help menu entry), Numbered list takes `Ctrl+/` in the editors. No MS web page prints a key that opens a keyboard shortcut list (Excel web: menu item Help > Keyboard Shortcuts; its `Alt+Shift+A` is the Accessibility Shortcuts Menu, a different action), so Sheets and Slides keep `Ctrl+/` / `Cmd+/` as ALT-PROPOSED (Excel and PowerPoint web use it for nothing).',
    '**Esc `close_requested` forward (global-17).** USER ADDENDUM 1 says no frame-to-host key forwarding, but the frame already forwards unhandled Esc as `close_requested{reason:\'escape\'}` (`escape-forwarder`). Left as existing behaviour; the Advisor decides.',
    '**MS web contradicts itself on `Ctrl+O` (common-03, sheets-02, docs-003, html-001, markdown-001, slides-02).** Every web intro says Ctrl+O belongs to the browser, yet the Excel table prints `Open workbook. Ctrl+O`. Excel: MS-WEB-ALT via its opt-in *Override browser shortcuts* setting (quoted); Word/PowerPoint have no such setting and no Open row, so `Ctrl+O` is ALT-PROPOSED there: handled in the frame where UniWork has an Open action, the browser keeps it elsewhere (not Chromium-reserved).',
    '**MS web contradicts itself on Excel `Shift+Ctrl+V` (sheets-12, shell-07).** The table prints it as *Paste formatting*, the copy-and-paste article says it pastes plain text. Kept paste-values off Ctrl+Shift+V in Sheets; PowerPoint/Word web: `Ctrl+Shift+V` = paste text only (slides-12 loses its *Paste formatting* key on web).',
    '**Save As (common-05, docs-005, html-003, markdown-003, sheets-04).** MS web prints no Word/PowerPoint Save As key; Excel web prints `Alt+F2`, not `F12`. Docs on web keeps `F12` only as the desktop fallback (D8: DevTools key, test in browsers), Sheets uses `Alt+F2`, so web Docs and Sheets differ; Mac for Excel web is `not documented`.',
    '**`F1` Help and `Ctrl+O` Open "apply to the browser" (common-13, docs-094, sheets-86, slides-73).** Only Excel web has the override setting; in MS\'s own Word/PowerPoint web the browser keeps F1. No in-frame key, Help by button (docs-094, sheets-86, slides-73); common-13 now gives the same answer: no in-frame key, Help by button. Excel web\'s Override setting is opt-in and not adopted; intercepting F1 stays an open question (contract section 10).',
    '**`F6` is `Ctrl+F6` on web (common-09, docs-091/092, sheets-85, slides-69).** MS web says so on every tab; the old plan to forward F6 from the frame (global-17) is dropped by ADDENDUM 1.',
    '**New has no MS web key (common-01, docs-001, sheets-01, slides-01).** The route is the address-bar URL `Word.new` / `Excel.new` / `PowerPoint.new`; `Ctrl+N` stays the browser\'s on web and is desktop-only in the contract. The old `Alt+Shift+N` is gone.',
    '**Close (common-07, docs-008, html-005, markdown-005, sheets-06, slides-06).** Word/PowerPoint web print no Close row; Excel web prints `Ctrl+W` in its table, but no Excel page says it closes the tab: the sentence \'press Ctrl+W to close the browser tab\' is on the Word and PowerPoint pages. Where an in-app key is needed, `Alt+Shift+W` stays ALT-PROPOSED (unvalidated; Alt+Shift is the input-language switch on some Windows setups); sheets-06 (ALT-PROPOSED) and slides-06 (MS-WEB-ALT) leave `Ctrl+W` to the browser.',
    '**Find / Go To (docs-018, docs-021, html-012, markdown-013, sheets-42).** Word web Find is `Ctrl+F or Ctrl+G`, taking `Ctrl+G` from Go To (docs-021 moves to F5, ALT-PROPOSED); the older Word article prints Ctrl+G as the Reading-view page control. Excel web Go To is `Ctrl+G` only (not F5). CodeMirror source views also use Ctrl+G for Find next: check html/markdown.',
    '**Indent (docs-050/051/062, uninote-032).** Word web prints `Alt+Shift+Right/Left or Tab/Shift+Tab` for indent (older article, medium confidence) instead of desktop `Ctrl+M` / `Ctrl+Shift+M`; Mac prints only Tab / Shift+Tab. Bullets (`Ctrl+Period`) and ribbon collapse (`Ctrl+F3`) also differ from desktop and have no Mac key.',
    '**PowerPoint web vs desktop contract (slides-14, 22, 23, 28, 44, 45, 53, 55).** Slide show `Ctrl+F5` / `Shift+Ctrl+F5` (not F5 / Shift+F5; Mac `⌘+Shift+Return` / `⌘+Shift+F5`); New slide Mac = "No shortcut"; go to slide = `G` + arrows; `Ctrl+Space` = clear formatting (media play/pause moves to `Space`); `Ctrl+]` / `Ctrl+[` = z-order (UniWork: font size, the editing-vs-selection split is the worker\'s, not MS\'s); Save = autosave, no key.',
    '**Sheets Ctrl+Enter (sheets-16)** is *Follow hyperlink* on MS web, *fill selection* on desktop; kept for the cell editor. Excel web has no Mac column: Mac = desktop key where the Windows key is equal or only notation differs, `not documented` where it differs (Save As, Create chart). `Alt+Windows logo key` cannot reach a page, so `Alt+Period (.)` (printed for Narrator only) is borrowed for key tips (sheets-84, common-12 Sheets part) as ALT-PROPOSED; it goes beyond what MS web states for the default case.',
    '**Excel Mac `Cmd+T` / `Shift+Cmd+T` (sheets-47, sheets-48).** Excel web has no Mac column and the desktop Mac keys are Chromium\'s new-tab / restore-tab chords: sheets-47 Mac = `F4` (the other desktop Mac key), sheets-48 Mac = no key on web Mac (ribbon / button); both ALT-PROPOSED.',
    '**OFFICE-WINS (global-01/02/06/07/10/11/17, slides-59, uninote-015/031/041).** Office keys win while an Office document is open; UniWork global keys (Ctrl+J Ask UNI, Ctrl+K search, Ctrl+B sidebar, Ctrl+[ / ]) are unchanged outside it; no new chord, Ask UNI and search by button; the old `Alt+Shift+J` / `Alt+Shift+Q` are dropped. UniNote is a page editor in the host document, not an Office frame, so it follows contract rule 3 (D2). Word web uses `Ctrl+Enter` to post a comment, not for a page break (global-06, uninote-041).',
    '**pdf (all 27 rows).** MS web has nothing for the Edge PDF viewer; pdf rows use the Edge key as `DESKTOP-FALLBACK` (basis name is a slight misnomer) or `KEEP`.',
    '**AltGr and input language.** Ctrl+Alt chords kept or proposed on web (headings, Ctrl+Alt+M, Ctrl+Alt+V/C, Ctrl+Alt+= / -) need the shared AltGr guard on Windows; `Alt+Shift+<letter>` ALT-PROPOSED keys need a test with Unikey / Telex / VNI. None of the keys was tried in Chrome / Edge / Firefox / Safari; Chromium\'s reserved list was read at a pinned revision (S3 §5a).',
    '**MS desktop data oddity.** The C2 desktop page prints `Ctrl+D` for "Close a presentation" (also Duplicate); web uses the browser `Ctrl+W` (slides-06).',
]

if __name__ == '__main__':
    main()
