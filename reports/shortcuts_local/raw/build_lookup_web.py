"""Build C3-ms-web-lookup.csv: for every (module, action) row of C2-ms-lookup.csv, what Microsoft 365 for the web prints.

Run:  python -I -X utf8 build_lookup_web.py     (after parse_ms_web.py)
Every key is copied from a row of C3-ms-web-raw.csv picked by (source, line, platform) and a guard substring of
the action text is asserted, so a wrong reference fails the build. Prose facts (address-bar shortcuts, "applies to
the browser", Mac start keys) are asserted against the saved HTML / the browser-notes CSV. Raw rows that no
desktop row uses are appended as WEB-ONLY rows, so no row of the web articles is lost.
"""
import csv
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ND = "not documented"

SRC = {
    "wd": "ms-html/word-a11y.html", "xl": "ms-html/excel-a11y.html", "pp": "ms-html/ppt-a11y-create.html",
    "pd": "ms-html/ppt-a11y-deliver.html", "wa": "ms-html-web/word-web-app-2554e572.html",
    "cp": "ms-html-web/copy-paste-office-web.html", "pc": "ms-html-web/ppt-modern-comments.html",
    "rb": "ms-html-web/ribbon-keyboard-954cd3f7.html",
}


def load(name):
    with open(os.path.join(HERE, name), encoding="utf-8", newline="") as fh:
        return list(csv.DictReader(fh))


RAW = load("C3-ms-web-raw.csv")
NOTES = load("C3-ms-web-browser-notes.csv")
C2 = load("C2-ms-lookup.csv")
for r in RAW:
    f, loc = r["line_in_html_or_table_index"].rsplit(":", 1)
    r["_file"], r["_line"] = f, int(loc[1:].split("/")[0])
    r["_id"] = id(r)
USED = set()
URLS = []


def pick(src, line, guard, plat):
    hits = [r for r in RAW if r["_file"] == SRC[src] and r["_line"] == line and r["platform"] == plat]
    assert hits, (src, line, plat)
    assert guard.lower() in hits[0]["action"].lower(), (src, line, guard, hits[0]["action"])
    for h in hits:
        USED.add(h["_id"])
    URLS.append(hits[0]["source_url"] + " (%s:L%d)" % (os.path.basename(SRC[src]), line))
    return " ; ".join(h["keys"] for h in hits)


def W(src, line, guard):   # 2-column table (OS not stated)
    return pick(src, line, guard, "web")


def WW(src, line, guard):  # 3-column table, Windows column
    return pick(src, line, guard, "web-windows")


def WM(src, line, guard):  # 3-column table, Mac column
    return pick(src, line, guard, "web-mac")


def F(src, action, keys, plat):  # row found by action + keys (Word for the web 4-column equivalents table)
    hits = [r for r in RAW if r["_file"] == SRC[src] and r["platform"] == plat and r["action"] == action and r["keys"] == keys]
    assert len(hits) == 1, (src, action, keys, plat, len(hits))
    USED.add(hits[0]["_id"])
    URLS.append(hits[0]["source_url"] + " (%s:L%d)" % (os.path.basename(SRC[src]), hits[0]["_line"]))
    return keys


def has(src, substr):  # substring must be in the visible text of the saved page
    with open(os.path.join(HERE, SRC[src]), encoding="utf-8", errors="replace") as fh:
        t = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", fh.read()).replace("&nbsp;", " "))
    assert substr in t, (src, substr)
    return substr


def sent(src, substr):  # the page sentence that contains substr (from the browser-notes CSV)
    for n in NOTES:
        if n["where"].startswith(SRC[src]) and substr in n["text"]:
            for s in re.split(r"(?<=[.!?]) ", n["text"]):
                if substr in s:
                    URLS.append(n["source_url"] + " (%s)" % n["where"].split("/")[-1])
                    return s.strip()
    raise AssertionError((src, substr))


def prose_url(src):
    URLS.append([r["source_url"] for r in RAW if r["_file"] == SRC[src]][0] if src in ("wd", "xl", "pp", "pd") else src)


OUT = []


def ent(module, action, win=ND, mac=ND, conf="n/a", notes=""):
    desk = [c for c in C2 if c["module"] == module and c["action"] == action]
    assert len(desk) == 1, (module, action)
    d = desk[0]
    urls = []
    for u in URLS:
        if u not in urls:
            urls.append(u)
    URLS.clear()
    OUT.append({"module": module, "action": action, "key_web_win": win, "key_web_mac": mac,
                "key_desktop_win_ref": d["key_win"], "key_desktop_mac_ref": d["key_mac"],
                "source_url": " ; ".join(urls) if urls else "(no web page row; see notes)", "confidence": conf, "notes": notes})


NOMAC = "NO-MAC-COLUMN: the web table is 2-column (OS not stated), so no Mac key is printed. "
LEGACY = "the older 'Keyboard shortcuts in Word for the web' article (word-web-app-2554e572)"




def taken(src):
    return "BROWSER-TAKEN: " + sent(src, "apply to the web browser")


has("wd", "If you're using Word for the web on a Mac computer, press Control+Period (.) to start.")
has("xl", "If you're using Excel for the web on a Mac computer, press Control+Option to start.")
has("cp", "press ⌘+C, ⌘+X, or ⌘+V (Mac)")
CPMAC = " Mac value is prose in the copy-paste article (copy-paste-office-web L711): 'press ⌘+C, ⌘+X, or ⌘+V (Mac)'."

# ------------------------------------------------------------------------------------------ Word
ent("word", "New document", conf="medium", notes=NOMAC + "BROWSER-ALT: no key row; page tip: " + sent("wd", "Word.new") + " Ctrl+N is not printed for the web.")
ent("word", "Open document", conf="medium", notes=NOMAC + taken("wd") + " The Word-web tables have no Open row.")
ent("word", "Save", notes="No Word-web row for Save.")
ent("word", "Save As", notes="No Word-web row (Excel for the web prints Alt+F2 for 'Open the Save As dialog box').")
ent("word", "Print", win=W("wd", 4166, "Print the document"), conf="high", notes=NOMAC + "The older Word-web article's Reading view row is also CTRL+P (word-web-app L662).")
ent("word", "Close document", conf="medium", notes="BROWSER-ALT: no Word-web row for Close. The Word for the web screen-reader walkthrough closes with the browser: 'Navigate back to Word for the web, and then press Ctrl+W to close the browser tab.' (sr-word-basic L1399).")
ent("word", "Undo", win=W("wd", 4404, "Undo the previous action"), conf="high", notes=NOMAC + "The older article's Reading view prints CTRL+Z for 'Switch to Zoom control' (word-web-app L650).")
ent("word", "Redo", win=W("wd", 4408, "Redo the previous action"), conf="high", notes=NOMAC)
ent("word", "Cut", win=W("wd", 4392, "Cut the selected content"), mac="⌘+X", conf="medium", notes=NOMAC.replace("no Mac key is printed. ", "no Mac key in the table.") + CPMAC)
ent("word", "Copy", win=W("wd", 4396, "Copy the selected content"), mac="⌘+C", conf="medium", notes="Mac key not in the table." + CPMAC)
ent("word", "Paste", win=W("wd", 4400, "Paste the content"), mac="⌘+V", conf="medium", notes="Mac key not in the table." + CPMAC)
ent("word", "Paste text only", win="Ctrl+Shift+V", mac="⌘+Shift+V", conf="medium", notes="BROWSER-ALT: browser dependent. " + sent("cp", "paste text only") + " Page: copy-paste-office-web L711/L722; not a row of the Word web key tables.")
ent("word", "Paste Special", notes="No Word-web row.")
ent("word", "Select all", win=W("wd", 4375, "Select all document content"), conf="high", notes=NOMAC)
ent("word", "Find (Navigation pane)", win=W("wd", 4150, "Find text in the Editing view"), conf="high", notes=NOMAC + "Editing view prints 'Ctrl+F or Ctrl+G'. Reading view: Ctrl+F or F3 (wd L4146).")
ent("word", "Replace", win=W("wd", 4154, "Find and replace text in the Editing view"), conf="high", notes=NOMAC)
ent("word", "Go To", win=W("wa", 654, "page-number control"), conf="medium", notes=NOMAC + "Reading view only (older article, word-web-app L654: 'Switch to page-number control', then 'Type page number'); in the Editing view Ctrl+G is a second Find key (wd L4150). No Editing-view Go To row.")
ent("word", "Bold", win=W("wd", 4420, "bold"), conf="high", notes=NOMAC)
ent("word", "Italic", win=W("wd", 4424, "italic"), conf="high", notes=NOMAC)
ent("word", "Underline", win=W("wd", 4428, "Underline"), conf="high", notes=NOMAC)
ent("word", "Double underline", notes="No Word-web row.")
ent("word", "Strikethrough", notes="No Word-web row.")
ent("word", "Subscript", notes="No Word-web row.")
ent("word", "Superscript", notes="No Word-web row.")
ent("word", "Increase font size (preset steps)", notes="No Word-web row for the preset-step key (Ctrl+Shift+>); the web table has the 1-point 'Grow the font size' row, see 'Increase font size 1 point'.")
ent("word", "Decrease font size (preset steps)", notes="No Word-web row for the preset-step key (Ctrl+Shift+<); see 'Decrease font size 1 point'.")
ent("word", "Increase font size 1 point", win=W("wd", 4416, "Grow the font size"), conf="medium", notes=NOMAC + "Web label is 'Grow the font size' (no '1 point').")
ent("word", "Decrease font size 1 point", win=W("wd", 4412, "Shrink the font size"), conf="medium", notes=NOMAC + "Web label is 'Shrink the font size' (no '1 point').")
ent("word", "Clear character formatting", notes="No Word-web row.")
ent("word", "Align left", win=W("wd", 4432, "left"), conf="high", notes=NOMAC)
ent("word", "Align center", win=W("wd", 4440, "Center"), conf="high", notes=NOMAC)
ent("word", "Align right", win=W("wd", 4436, "right"), conf="high", notes=NOMAC)
ent("word", "Justify", win=W("wd", 4444, "Justify"), conf="high", notes=NOMAC)
ent("word", "Bulleted list", win=W("wd", 4448, "bulleted list"), conf="high", notes=NOMAC + "Differs from desktop (Ctrl+Shift+L). Older article agrees: 'Bulleted list' CTRL+PERIOD (word-web-app L893).")
ent("word", "Numbered list", win=W("wd", 4452, "numbered list"), conf="high", notes=NOMAC + "Web-only key: the desktop page has no numbered-list row.")
ent("word", "Indent paragraph", win=F("wa", "Indent", "ALT+SHIFT+Right", "web-windows") + " ; " + F("wa", "Indent or Navigate to next Table Cell", "TAB", "web-windows"),
    mac=F("wa", "Indent, Navigate to next Table Cell, or Insert a Table", "TAB", "web-mac"), conf="medium",
    notes="Older article, 'Windows and Mac keyboard equivalents' table (key and modifier are separate columns; keys here are modifier+key and the printed cell is what the combination does on that OS). Mac column prints no Alt+Shift+Right indent (that Mac cell says 'Select left by word').")
ent("word", "Remove paragraph indent", win=F("wa", "Outdent", "ALT+SHIFT+Left", "web-windows") + " ; " + F("wa", "Outdent, Navigate to Previous Table Cell", "SHIFT+TAB", "web-windows"),
    mac=F("wa", "Outdent, Navigate to Previous Table Cell", "SHIFT+TAB", "web-mac"), conf="medium",
    notes="Same source as Indent paragraph (word-web-app 'Windows and Mac keyboard equivalents').")
ent("word", "Hanging indent", notes="No Word-web row.")
ent("word", "Normal style", notes="No Word-web row.")
ent("word", "Heading 1", notes="No Word-web row.")
ent("word", "Heading 2", notes="No Word-web row.")
ent("word", "Heading 3", notes="No Word-web row.")
ent("word", "Insert hyperlink", win=F("wa", "Insert hyperlink", "CTRL+K", "web"), conf="high", notes=NOMAC + "Only the older article has this row (word-web-app L854); the current Word web table has none.")
ent("word", "Insert comment", win=W("wd", 4474, "Add a new comment"), conf="medium", notes=NOMAC + "Web label is 'Add a new comment'. Also 'Show or hide the Comments pane': Alt+Period, R, K or Alt+Windows logo key, R, K (wd L4470).")
ent("word", "Track changes on/off", notes="No Word-web row.")
ent("word", "Activate ribbon access keys", win=W("wd", 4266, "activate the access keys"), mac="Control+Period (.)", conf="high",
    notes="Windows cell is printed with the prose 'To move to a different tab, use an access key or the Tab key.' Mac: page prose 'If you're using Word for the web on a Mac computer, press Control+Period (.) to start.' Also 'You can alternatively press Ctrl+F6 until you reach the Home tab.' Desktop is Alt or F10.")
ent("word", "Expand or collapse ribbon", win=W("wd", 4290, "Collapse or expand the ribbon"), conf="high", notes=NOMAC + "Differs from desktop (Ctrl+F1). Older article agrees: CTRL+F3 (word-web-app L701).")
ent("word", "Cycle panes forward", win=W("wd", 4170, "landmark region"), conf="medium", notes=NOMAC + "BROWSER-ALT: " + sent("wd", "instead of F6") + " Web label is 'Move to the next landmark region.' Older article: 'Move between ribbon and document content' CTRL+F6 or CTRL+SHIFT+F6 (word-web-app L677).")
ent("word", "Cycle panes backward", win=W("wa", 677, "ribbon and document content"), conf="medium", notes="BROWSER-ALT: the current Word web table has no backward row; the older article prints 'CTRL+F6 or CTRL+SHIFT+F6' for 'Move between ribbon and document content' (word-web-app L677), so value includes both keys. " + sent("wd", "instead of F6"))
ent("word", "Help", conf="medium", notes=taken("wd") + " No Word-web Help row.")

# ----------------------------------------------------------------------------------------- Excel
OVR = ("Override: Excel for the web, Help > Keyboard Shortcuts > 'Override browser shortcuts' (xl L4308-L4316). "
       "'Overriding browser shortcuts also enables you to open the Excel for the web Help by pressing F1.'")
ent("excel", "New workbook", conf="medium", notes=NOMAC + "BROWSER-ALT: no key row; page tip: " + sent("xl", "Excel.new") + " No Ctrl+N row.")
ent("excel", "Open workbook", win=W("xl", 3514, "Open workbook"), conf="high", notes=NOMAC + "BROWSER-TAKEN (MS contradicts itself): the table prints Ctrl+O, but the same page intro says: " + sent("xl", "apply to the web browser"))
ent("excel", "Save workbook", notes="No Excel-web row for Save.")
ent("excel", "Save As", win=W("xl", 3522, "Save As"), conf="high", notes=NOMAC + "Differs from desktop (F12).")
ent("excel", "Print", win=W("xl", 3494, "Print a workbook"), conf="high", notes=NOMAC)
ent("excel", "Close workbook", win=W("xl", 3518, "Close workbook"), conf="high", notes=NOMAC + "Ctrl+W is also the browser close-tab key (the Word for the web screen-reader article closes with it: 'press Ctrl+W to close the browser tab', sr-word-basic L1399); the Excel web page itself prints no browser caveat for it.")
ent("excel", "Undo", win=W("xl", 3510, "Undo action"), conf="high", notes=NOMAC)
ent("excel", "Redo / repeat", win=W("xl", 3695, "Redo an action"), conf="high", notes=NOMAC + "The web page has no 'repeat' row.")
ent("excel", "Cut / Copy / Paste", win=W("xl", 3506, "Cut selection") + " / " + W("xl", 3498, "Copy selection") + " / " + W("xl", 3502, "Paste selection"), conf="high", notes=NOMAC + "BROWSER-ALT: Excel for the web pasting outside text keeps formatting in Edge/Chrome 'unless you press Ctrl+SHIFT+V to paste as plain text' (copy-paste-office-web L824); other browsers always paste plain text (L825).")
ent("excel", "Paste Special", notes="No Excel-web row. 'Paste formatting' is Shift+Ctrl+V (xl L3870); Ctrl+Shift+V pastes plain text per the copy-paste article.")
ent("excel", "Select all / worksheet", notes="No Excel-web row (Ctrl+A / Ctrl+Shift+Spacebar absent from the web tab).")
ent("excel", "Find", win=W("xl", 3526, "Use Find"), conf="high", notes=NOMAC + "Shift+F3 is also printed for 'Insert a function' (xl L3711).")
ent("excel", "Replace", notes="No Excel-web row.")
ent("excel", "Go To", win=W("xl", 3482, "Go to a specific cell"), conf="high", notes=NOMAC + "Differs from desktop Windows (F5); Ctrl+G is the desktop Mac key.")
ent("excel", "Edit active cell", win=W("xl", 3781, "Edit the selected cell"), conf="high", notes=NOMAC)
ent("excel", "New line inside cell", win=W("xl", 3699, "Start a new line in the same cell"), conf="high", notes=NOMAC)
ent("excel", "Fill down", notes="No Excel-web row.")
ent("excel", "Fill right", notes="No Excel-web row.")
ent("excel", "Insert cells / rows / columns", win=W("xl", 4061, "Insert cells, rows, or columns"), conf="high", notes=NOMAC + "Also access keys: " + W("xl", 3671, "Insert a row above") + " (row above), " + W("xl", 3675, "Insert a column to the left") + " (column left).")
ent("excel", "Delete cells / rows / columns", win=W("xl", 4065, "Delete cells, rows, or columns"), conf="high", notes=NOMAC)
ent("excel", "Number format: General", notes="No Excel-web row.")
ent("excel", "Number format: Currency", win=W("xl", 3890, "currency format"), conf="high", notes=NOMAC + "Web key is Ctrl+Shift+4, not the desktop symbol key.")
ent("excel", "Number format: Percentage", win=W("xl", 3894, "percentage format"), conf="high", notes=NOMAC + "Web key is Ctrl+Shift+5.")
ent("excel", "Number format: Scientific", win=W("xl", 3898, "scientific format"), conf="high", notes=NOMAC + "Web key is Ctrl+Shift+6.")
ent("excel", "Number format: Date", win=W("xl", 3886, "date format"), conf="high", notes=NOMAC + "Web key is Ctrl+Shift+3.")
ent("excel", "Number format: Time", win=W("xl", 3882, "time format"), conf="high", notes=NOMAC + "Web key is Ctrl+Shift+2.")
ent("excel", "Number format: Number (2 decimals, thousands)", win=W("xl", 3878, "number format"), conf="medium", notes=NOMAC + "Web label is only 'Apply the number format.' (no '2 decimals, thousands'); key is Ctrl+Shift+1.")
ent("excel", "Number formats Ctrl+Shift+1..6", win=W("xl", 3878, "number format") + " ; " + W("xl", 3882, "time format") + " ; " + W("xl", 3886, "date format") + " ; " + W("xl", 3890, "currency format") + " ; " + W("xl", 3894, "percentage format") + " ; " + W("xl", 3898, "scientific format"), conf="high", notes=NOMAC + "Web-only family: 1 number, 2 time, 3 date, 4 currency, 5 percentage, 6 scientific (the desktop page prints none of these). Ctrl+Shift+7 = 'Apply outside border' (xl L3902).")
ent("excel", "Format Cells dialog", win=W("xl", 3906, "Number Format dialog"), conf="medium", notes=NOMAC + "Web label is 'Open the Number Format dialog box.'")
ent("excel", "Select entire row", win=W("xl", 4049, "entire row"), conf="high", notes=NOMAC)
ent("excel", "Select entire column", win=W("xl", 4045, "entire column"), conf="high", notes=NOMAC)
ent("excel", "Go to start of sheet", win=W("xl", 3939, "cell A1"), conf="high", notes=NOMAC)
ent("excel", "Go to last used cell", win=W("xl", 3943, "last cell of the used range"), conf="high", notes=NOMAC)
ent("excel", "Move to edge of data region", win=W("xl", 3955, "edge of the current data region"), conf="high", notes=NOMAC + "Only the Left/Right arrow pair is printed.")
ent("excel", "Next sheet", win=W("xl", 3971, "next sheet") + " ; " + W("xl", 3975, "next sheet"), conf="high", notes=NOMAC + "BROWSER-ALT: Ctrl+Page down is printed as 'Switch to the next sheet (when in Microsoft Teams or a browser other than Chrome).'; Alt+Ctrl+Page down is the default web key.")
ent("excel", "Previous sheet", win=W("xl", 3979, "previous sheet") + " ; " + W("xl", 3983, "previous sheet"), conf="high", notes=NOMAC + "BROWSER-ALT: Ctrl+Page up is printed as 'Switch to previous sheet (when in Microsoft Teams or a browser other than Chrome).'; Alt+Ctrl+Page up is the default web key.")
ent("excel", "AutoSum", win=W("xl", 4171, "Auto Sum"), conf="high", notes=NOMAC)
ent("excel", "Enter current date", win=W("xl", 3825, "current date"), conf="high", notes=NOMAC)
ent("excel", "Enter current time", win=W("xl", 3829, "current time"), conf="high", notes=NOMAC)
ent("excel", "Absolute / relative reference (F4)", win=W("xl", 3785, "absolute and relative"), conf="high", notes=NOMAC)
ent("excel", "Insert hyperlink", win=W("xl", 3703, "hyperlink"), conf="high", notes=NOMAC)
ent("excel", "Bold", win=W("xl", 3858, "bold"), conf="high", notes=NOMAC + "The frequently-used table also prints Ctrl+B (xl L3530). Desktop alternative Ctrl+2 is not printed.")
ent("excel", "Italic", win=W("xl", 3862, "italic"), conf="high", notes=NOMAC)
ent("excel", "Underline", win=W("xl", 3866, "underline"), conf="high", notes=NOMAC)
ent("excel", "Strikethrough", notes="No Excel-web row.")
ent("excel", "Expand or collapse ribbon", notes="No Excel-web row.")
ent("excel", "Activate ribbon key tips", win=W("xl", 3630, "activate the access keys"), mac="Control+Option", conf="high",
    notes="Windows cell is printed with 'To move to a different tab, use an access key or the Tab key.' Mac: page prose 'If you're using Excel for the web on a Mac computer, press Control+Option to start.' BROWSER-ALT: "
    + sent("xl", "override the browser's Alt-based ribbon shortcuts") + " Classic ribbon with Narrator: Alt+Period (.) (xl L3554). Desktop is Alt or F10.")
ent("excel", "Cycle panes", win=W("xl", 3959, "ribbon and workbook content"), conf="medium", notes=NOMAC + "BROWSER-ALT: " + sent("xl", "instead of F6") + " 'Cycle between landmark regions' = Ctrl+F6 or Ctrl+Shift+F6 (xl L4243).")
ent("excel", "Help", conf="medium", notes=taken("xl") + " " + OVR)

# ------------------------------------------------------------------------------------ PowerPoint
def PW(line, guard, src="pp"):
    return WW(src, line, guard)


def PM(line, guard, src="pp"):
    return WM(src, line, guard)


ent("powerpoint", "New presentation", conf="medium", notes="BROWSER-ALT: no key row; page tip: " + sent("pp", "PowerPoint.new") + " Ctrl+N is not printed for the web.")
ent("powerpoint", "Open", conf="medium", notes=taken("pp") + " No PowerPoint-web row for Open.")
ent("powerpoint", "Save", win=PW(3068, "Save the presentation"), mac=PM(3068, "Save the presentation"), conf="high", notes="No key: the row (both columns) says 'PowerPoint for the web saves changes automatically.' Desktop is Ctrl+S / ⌘+S.")
ent("powerpoint", "Save As", notes="No PowerPoint-web row.")
ent("powerpoint", "Print", win=PW(3063, "Print a presentation"), mac=PM(3063, "Print a presentation"), conf="high")
ent("powerpoint", "Close presentation", notes="No PowerPoint-web row (and Ctrl+W is the browser close-tab key; not stated on the PowerPoint web page).")
ent("powerpoint", "Undo", win=PW(3018, "Undo"), mac=PM(3018, "Undo"), conf="high")
ent("powerpoint", "Redo", win=PW(3023, "Redo"), mac=PM(3023, "Redo"), conf="high")
ent("powerpoint", "Cut / Copy / Paste", win=PW(3143, "Cut") + " / " + PW(3148, "Copy") + " / " + PW(3153, "Paste"), mac=PM(3143, "Cut") + " / " + PM(3148, "Copy") + " / " + PM(3153, "Paste"), conf="high")
ent("powerpoint", "Paste Special", notes="No PowerPoint-web row. 'Paste text, unformatted' is Ctrl+Shift+V / ⌘+Shift+V (pp L3163); the copy-paste article: 'Currently, Paste Text Only is only available in Chrome and Microsoft Edge. For Chrome, you need an Office extension to use this command in PowerPoint for the web.' (copy-paste-ppt-web L722).")
ent("powerpoint", "Select all (objects / slides)", win=PW(3207, "Select all objects"), mac=PM(3207, "Select all objects"), conf="high", notes="Row is 'Select all objects on the page.'; the next row is Ctrl+A / ⌘+A for text in a box (pp L3212).")
ent("powerpoint", "New slide", win=PW(3087, "Create a new slide"), mac=PM(3087, "Create a new slide"), conf="high", notes="Mac cell prints 'No shortcut' (desktop Mac is ⌘+Shift+N).")
ent("powerpoint", "Duplicate selected slide", notes="No PowerPoint-web row for slides (the only duplicate row is for objects).")
ent("powerpoint", "Duplicate selected object", win=PW(3158, "Duplicate selected objects"), mac=PM(3158, "Duplicate selected objects"), conf="high", notes="Mac key is ⌘+D (desktop Mac is Control+D).")
ent("powerpoint", "Move slide up / down", win=PW(3626, "up one position") + " / " + PW(3631, "down one position"), mac=PM(3626, "up one position") + " / " + PM(3631, "down one position"), conf="high")
ent("powerpoint", "Move slide to start / end", win=PW(3636, "to the beginning") + " / " + PW(3641, "to the end"), mac=PM(3636, "to the beginning") + " / " + PM(3641, "to the end"), conf="high")
ent("powerpoint", "Next / previous slide", win=PW(3043, "next slide") + " / " + PW(3048, "previous slide"), mac=PM(3043, "next slide") + " / " + PM(3048, "previous slide"), conf="high", notes="Mac web uses Fn+Down / Fn+Up arrow key; desktop Mac prints Page down / Page up. Slide Show view has its own keys (N / P / arrows, pp L3102/L3107).")
ent("powerpoint", "Group", notes="No PowerPoint-web row.")
ent("powerpoint", "Ungroup", notes="No PowerPoint-web row.")
ent("powerpoint", "Regroup", notes="No PowerPoint-web row.")
ent("powerpoint", "Nudge selected object", win=PW(3038, "Move a shape"), mac=PM(3038, "Move a shape"), conf="medium", notes="Web label is 'Move a shape.'; both columns print 'Arrow keys'.")
ent("powerpoint", "Start slide show", win=PW(1251, "from the beginning", "pd"), mac=PM(1251, "from the beginning", "pd"), conf="high", notes="Differs from desktop (F5 / ⌘+Shift+Return). Web Windows key is Ctrl+F5.")
ent("powerpoint", "Start slide show from current slide", win=PW(1256, "from the current slide", "pd"), mac=PM(1256, "from the current slide", "pd"), conf="high", notes="Differs from desktop (Shift+F5 / ⌘+Return).")
ent("powerpoint", "Presenter view", notes="No PowerPoint-web row.")
ent("powerpoint", "Bold", win=PW(3463, "bold"), mac=PM(3463, "bold"), conf="high")
ent("powerpoint", "Italic", win=PW(3468, "italic"), mac=PM(3468, "italic"), conf="high")
ent("powerpoint", "Underline", win=PW(3473, "underline"), mac=PM(3473, "underline"), conf="high")
ent("powerpoint", "Strikethrough", notes="No PowerPoint-web row.")
ent("powerpoint", "Subscript", notes="No PowerPoint-web row (Ctrl+Spacebar row only mentions removing subscript/superscript).")
ent("powerpoint", "Superscript", notes="No PowerPoint-web row.")
ent("powerpoint", "Clear character formatting", win=PW(3478, "Remove manual character formatting"), mac=PM(3478, "Remove manual character formatting"), conf="medium", notes="Web label: 'Remove manual character formatting, such as subscript and superscript.'")
ent("powerpoint", "Increase font size", win=PW(3453, "Increase the font size"), mac=PM(3453, "Increase the font size"), conf="high")
ent("powerpoint", "Decrease font size", win=PW(3458, "Decrease the font size"), mac=PM(3458, "Decrease the font size"), conf="high")
ent("powerpoint", "Align center / left / right / justify",
    win=PW(3488, "Center") + " / " + PW(3483, "Left align") + " / " + PW(3493, "Right align") + " / " + PW(3498, "Justify"),
    mac=PM(3488, "Center") + " / " + PM(3483, "Left align") + " / " + PM(3493, "Right align") + " / " + PM(3498, "Justify"), conf="high",
    notes="Mac web left/right are ⌘+Shift+L / ⌘+Shift+R (desktop Mac prints ⌘+L / ⌘+R).")
ent("powerpoint", "Bulleted list", notes="No PowerPoint-web row.")
ent("powerpoint", "Indent (demote paragraph)", notes="No PowerPoint-web row.")
ent("powerpoint", "Outdent (promote paragraph)", notes="No PowerPoint-web row.")
ent("powerpoint", "Insert hyperlink", win=PW(3013, "hyperlink"), mac=PM(3013, "hyperlink"), conf="high", notes="Also in 'Work with objects and text' (pp L3217).")
ent("powerpoint", "Find", win=PW(3033, "Find dialog"), mac=PM(3033, "Find dialog"), conf="high")
ent("powerpoint", "Replace", notes="No PowerPoint-web row.")
ent("powerpoint", "Cycle panes forward / backward", win=PW(3682, "Move forward between") + " / " + PW(3687, "Move backward between"), mac=PM(3682, "Move forward between") + " / " + PM(3687, "Move backward between"), conf="high",
    notes="BROWSER-ALT: Ctrl+F6 / Ctrl+Shift+F6 instead of F6. " + sent("pp", "instead of F6") + " " + sent("pp", "press Ctrl+F6 (forward)"))
ent("powerpoint", "Toggle Outline and Thumbnail panes", notes="No PowerPoint-web row.")
ent("powerpoint", "Activate ribbon access keys", win=PW(3717, "access keys"), mac=PM(3717, "access keys"), conf="high",
    notes="Also: " + sent("pp", "To move the focus to the ribbon") + " Switch simplified/classic ribbon: Alt+Period (.), Z, or R (pp L3712).")
ent("powerpoint", "Expand or collapse ribbon", notes="No PowerPoint-web row.")
ent("powerpoint", "Help", conf="medium", notes=taken("pp") + " No PowerPoint-web Help row.")

# --------------------------------------------------------------------------------- Edge PDF / other
for act in ("Zoom in / out", "Toggle fit to width / fit to page", "Rotate PDF", "Find in document", "Go to page number",
            "Open or close table of contents", "Toggle one-page / two-page layout", "Full-screen reading", "Read aloud",
            "Add notes", "Save a copy of the PDF", "Print", "Next / previous page"):
    ent("pdf", act, notes="Not applicable: the Edge PDF viewer is not a Microsoft 365 for the web surface; no web article prints it.")
ent("common", "Move focus to next pane", win=F("rb", "Move the focus to select the active tab, document, task pane, or status bar.", "Windows: Ctrl+F6", "web"),
    mac=F("rb", "Move the focus to select the active tab, document, task pane, or status bar.", "Mac: Command+F6", "web"), conf="medium",
    notes="'Use the keyboard to work with the ribbon' (web tab, rb L1092); label 'Move the focus to select the active tab, document, task pane, or status bar.' Same F6 -> Ctrl+F6 change as every web page.")
ent("common", "Developer tools", notes="Not applicable: browser feature, not on any Microsoft 365 for the web page.")
ent("word", "Move cursor to last change / previous revision", notes="No Word-web row.")
ent("word", "Repeat last action / F4", notes="No Word-web row.")
ent("common", "Shortcut help (Ctrl+/)", win="Alt+Shift+A", mac=ND, conf="medium",
    notes="Excel for the web only (prose): " + sent("xl", "Press Alt+Shift+A") + " Also 'If you use a screen reader, go to Accessibility Shortcuts Menu (Alt+Shift+A).' (xl L3464). Help > Keyboard Shortcuts dialog is described in xl L4308-L4316.")
ent("common", "Redo (Ctrl+Shift+Z)", notes="No web row for Ctrl+Shift+Z (Redo is Ctrl+Y on the Word, Excel and PowerPoint web tables).")
ent("excel", "Repeat last action (Windows Ctrl+Y / F4)", notes="No web 'repeat' row: Ctrl+Y is printed as 'Redo an action' (xl L3695) and F4 as 'Cycle through all the various combinations of absolute and relative references' (xl L3785).")
ent("powerpoint", "Zoom to fit", notes="No PowerPoint-web row.")


# ------------------------------------------------------------------------------ assemble + write
def alts(k):
    k = k.lower().replace("⌘", "cmd").replace("command", "cmd").replace("windows logo key", "win")
    return {re.sub(r"\s", "", x) for x in re.split(r" ; | or | / ", k) if x.strip()}


order = {(c["module"], c["action"]): i for i, c in enumerate(C2)}
assert len(OUT) == len(C2) == len(order), (len(OUT), len(C2))
OUT.sort(key=lambda r: order[(r["module"], r["action"])])
for r in OUT:
    diff, part = [], []
    for plat in ("win", "mac"):
        web, desk = r["key_web_" + plat], r["key_desktop_%s_ref" % plat]
        if web == ND or desk == ND:
            continue
        a_web, a_desk = alts(web), alts(desk)
        if a_web == a_desk:
            continue
        (part if a_web & a_desk else diff).append(plat)
    pre = ""
    if diff:
        pre += "DIFF-FROM-DESKTOP(%s). " % "+".join(diff)
    if part:
        pre += "PARTIAL-OVERLAP-WITH-DESKTOP(%s). " % "+".join(part)
    r["notes"] = pre + r["notes"]
    web_nd = r["key_web_win"] == ND and r["key_web_mac"] == ND
    desk_doc = r["key_desktop_win_ref"] != ND or r["key_desktop_mac_ref"] != ND
    if web_nd and desk_doc and r["module"] != "pdf":
        r["notes"] = "WEB-NOT-DOCUMENTED. " + r["notes"]

# raw rows that no desktop row used: one lookup row per (file, line)
groups = {}
for r in RAW:
    if r["_id"] in USED:
        continue
    groups.setdefault((r["_file"], r["_line"]), []).append(r)
MOD = {"word": "word", "excel": "excel", "powerpoint": "powerpoint", "office-common": "common"}
extra = 0
for (f, line), rows in sorted(groups.items(), key=lambda kv: (kv[1][0]["product"], kv[0][0], kv[0][1])):
    r0 = rows[0]
    by = {}
    for r in rows:
        by.setdefault(r["platform"], []).append(r)
    acts = {p: " / ".join(dict.fromkeys(x["action"] for x in v)) for p, v in by.items()}
    win = " ; ".join(x["keys"] for x in by.get("web-windows", by.get("web", [])))
    mac = " ; ".join(x["keys"] for x in by.get("web-mac", []))
    if len(set(acts.values())) == 1:
        action = next(iter(acts.values()))
    else:
        action = " | ".join("%s: %s" % ("Win" if p == "web-windows" else "Mac", a) for p, a in acts.items())
    note = "UNMAPPED-WEB-ROW (no desktop lookup row; a web-only action or a repeat of a mapped action in another table). Section: %s. Source %s:L%d." % (r0["section"], f, line)
    if "web" in by:
        note = NOMAC + note
    OUT.append({"module": MOD[r0["product"]], "action": action, "key_web_win": win or ND, "key_web_mac": mac or ND,
                "key_desktop_win_ref": "n/a (no desktop lookup row)", "key_desktop_mac_ref": "n/a (no desktop lookup row)",
                "source_url": r0["source_url"] + " (%s:L%d)" % (os.path.basename(f), line), "confidence": "high", "notes": note})
    extra += 1

cols = ["module", "action", "key_web_win", "key_web_mac", "key_desktop_win_ref", "key_desktop_mac_ref", "source_url", "confidence", "notes"]
with open(os.path.join(HERE, "C3-ms-web-lookup.csv"), "w", encoding="utf-8", newline="") as fh:
    w = csv.DictWriter(fh, fieldnames=cols, quoting=csv.QUOTE_ALL)
    w.writeheader()
    w.writerows(OUT)
print("desktop rows", len(C2), "web-only rows", extra, "total", len(OUT), "raw rows used", len(USED), "of", len(RAW))
