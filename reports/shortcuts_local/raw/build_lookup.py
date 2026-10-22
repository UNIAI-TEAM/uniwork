"""Build C2-ms-lookup.csv from C2-ms-raw.csv and the old C-ms-reference.csv.

Run:  python -I build_lookup.py
Every key string is copied from a C2-ms-raw.csv row picked by (page, line_in_html); a guard
substring of the action text is checked so a wrong line number fails loudly. Nothing is typed
from memory except the literal 'not documented' and the few literals marked LIT (a key that
Microsoft prints inside a function-key row's description text instead of its own key cell).
"""
import csv
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = list(csv.DictReader(open(os.path.join(HERE, "C2-ms-raw.csv"), encoding="utf-8")))
OLD = list(csv.DictReader(open(os.path.join(HERE, "C-ms-reference.csv"), encoding="utf-8")))

URL = {
    "wd": "https://support.microsoft.com/en-us/accessibility/word/keyboard-shortcuts-in-word",
    "xl": "https://support.microsoft.com/en-us/accessibility/excel/keyboard-shortcuts-in-excel",
    "pp": "https://support.microsoft.com/en-us/accessibility/powerpoint/use-keyboard-shortcuts-to-create-powerpoint-presentations",
    "ppd": "https://support.microsoft.com/en-us/accessibility/powerpoint/use-keyboard-shortcuts-to-deliver-powerpoint-presentations",
    "egn": "https://support.microsoft.com/en-us/edge/microsoft-edge-keyboard-shortcuts",
    "egc": "https://support.microsoft.com/en-us/edge/keyboard-shortcuts-in-microsoft-edge",
    "oc": "https://support.microsoft.com/en-us/accessibility/office-accessibility/common-office-for-mac-keyboard-shortcuts",
}
BY_URL = {v: k for k, v in URL.items()}
ND = "not documented"
errors = []


def rows_at(tag, plat, line):
    out = [x for x in RAW if BY_URL.get(x["source_url"]) == tag and x["platform"] == plat
           and x["line_in_html_or_table_index"].split("/")[0] == "L%d" % line]
    return out


def ref(tag, plat, line, guard, kfilter=None):
    rs = rows_at(tag, plat, line)
    # "Office 2010 and Office 2007: Not available" is a version remark in the key cell, not a key
    rs = [x for x in rs if not re.match(r"Office 20\d\d", x["keys"]) and (not kfilter or re.search(kfilter, x["keys"]))]
    if not rs or guard.lower() not in rs[0]["action"].lower():
        errors.append("bad ref %s %s L%d guard=%r got=%r" % (tag, plat, line, guard, rs[0]["action"][:60] if rs else None))
        return "??", set()
    keys = []
    for x in rs:
        if x["keys"] not in keys:
            keys.append(x["keys"])
    return " or ".join(keys), {tag}


def cell(plat, spec):
    """spec: ND | (sep, [items]) ; item = (tag, line, guard) | ('LIT', text) | ND"""
    if spec == ND:
        return ND, set()
    sep, items = spec
    parts, tags = [], set()
    for it in items:
        if it[0] == "LIT":
            parts.append(it[1])
        else:
            k, t = ref(it[0], plat, it[1], it[2], it[3] if len(it) > 3 else None)
            parts.append(k)
            tags |= t
    return sep.join(parts), tags


def one(tag, line, guard):
    return (" or ", [(tag, line, guard)])


def many(sep, *items):
    return (sep, list(items))


def canon(s):
    """Loose form for the CHANGED comparison only: drops the spelled-out names Microsoft adds."""
    s = s.lower().replace("⌘", "cmd")
    s = re.sub(r"[a-z]+(?: [a-z]+)*\s*\(\s*([^a-z\s])\s*\)", r"\1", s)  # 'plus sign (+)' -> '+'
    s = re.sub(r"\(.*?\)", "", s)
    for a, b in (("command", "cmd"), ("control", "ctrl"), ("option", "opt"), ("spacebar", "space"), ("arrow keys", "arrow"),
                 ("arrow key", "arrow"), ("page down", "pagedown"), ("page up", "pageup"), ("pgdn", "pagedown"), ("pgup", "pageup"),
                 ("hyphen", "-"), ("minus", "-"), ("plus", "+"), ("equal sign", "="), ("semicolon", ";"), ("colon", ":"),
                 ("forward slash", "/")):
        s = s.replace(a, b)
    s = re.sub(r"\b(sign|symbol|key|keys|mark|point)\b", "", s)
    s = s.replace(" or ", "/").replace(",", "/")
    return re.sub(r"[^a-z0-9+=;/\\\[\]<>~!@#$%^:.-]", "", s)


W, M = "windows", "mac"
rows = []


def row(module, action, win, mac, conf, note="", old_action=None):
    rows.append((module, action, win, mac, conf, note, old_action or action))


# ---------------------------------------------------------------- WORD
row("word", "New document", one("wd", 707, "new document"), one("oc", 644, "new file"), "medium",
    "Mac: the Word for Mac table has no New row; value is the common Office for Mac page ('Create a new file or item (context dependent)').")
row("word", "Open document", one("wd", 703, "open a document"), one("oc", 664, "open a file"), "medium",
    "Mac: not on the Word for Mac table; value is the common Office for Mac page.")
row("word", "Save", one("wd", 711, "save the document"), one("oc", 656, "save"), "medium",
    "Mac: not on the Word for Mac table; value is the common Office for Mac page ('Save or sync').")
row("word", "Save As", one("wd", 2229, "F12 alone"), one("wd", 2394, "Save As"), "high",
    "Windows key is the function-key row F12 ('F12 alone: displays the Save As dialog box'). Shift+F12 saves, Ctrl+F12 opens (same row).")
row("word", "Print", one("wd", 1073, "print the document"), one("wd", 2412, "Print dialog"), "high")
row("word", "Close document", one("wd", 715, "close the document"), one("wd", 2419, "close the current document"), "high",
    "Windows page also prints Ctrl+F4 (closes the current document) in the F4 function-key row L2197. Mac: the common Office for Mac page prints Command+W for 'Close a file or item' (oc L668).")
row("word", "Undo", one("wd", 775, "undo"), one("wd", 2291, "undo"), "high",
    "Mac cell reads 'Cmd+Z or F1' as one string; F1 = Undo only with Mac function keys (page F-key table).")
row("word", "Redo", one("wd", 779, "redo"), one("wd", 2298, "redo"), "high",
    "Neither Word table prints Ctrl+Shift+Z / Cmd+Shift+Z (Excel for Mac prints Cmd+Shift+Z, see the common Redo row).")
row("word", "Cut", one("wd", 719, "cut"), one("wd", 2305, "cut"), "high", "Mac cell 'Cmd+X or F2'.")
row("word", "Copy", one("wd", 723, "copy"), one("wd", 2312, "copy"), "high", "Mac cell 'Cmd+C or F3'.")
row("word", "Paste", one("wd", 727, "paste"), one("wd", 2319, "paste"), "high", "Mac cell 'Cmd+V or F4'.")
row("word", "Paste text only", one("wd", 731, "paste text only"), one("wd", 2326, "paste text only"), "high")
row("word", "Paste Special", ND, one("wd", 2738, "Paste Special"), "high",
    "Windows table has no row labelled Paste Special; the key Ctrl+Alt+V is printed at wd L1264 with the label 'Paste the selected text formatting' (Mac prints Cmd+Option+V for that label, wd L2766). Mac Paste Special row is Cmd+Control+V.")
row("word", "Select all", one("wd", 735, "select all"), one("wd", 2653, "select all"), "high")
row("word", "Find (Navigation pane)", one("wd", 1048, "navigation"), one("wd", 2401, "find text"), "high",
    "Mac: Find text moves focus to the Search in Document box.")
row("word", "Replace", one("wd", 1276, "replace"), one("wd", 2408, "find and replace"), "high")
row("word", "Go To", one("wd", 1052, "go to"), one("wd", 2362, "go to"), "high",
    "Windows: F5 also opens Go To (F5 function-key row L2201). Mac cell 'Cmd+Option+G or F5'.")
row("word", "Bold", one("wd", 739, "bold"), one("wd", 2976, "bold"), "high")
row("word", "Italic", one("wd", 743, "italic"), one("wd", 3011, "italic"), "high")
row("word", "Underline", one("wd", 747, "underline"), one("wd", 2990, "underline"), "high")
row("word", "Double underline", one("wd", 1442, "double-underline"), one("wd", 3004, "double-underline"), "high")
row("word", "Strikethrough", ND, one("wd", 3025, "strike-through"), "high",
    "Windows: no strikethrough row in the Word for Windows tables (searched every raw row).")
row("word", "Subscript", one("wd", 1454, "subscript"), one("wd", 3032, "subscript"), "high",
    "Printed key for Word is Ctrl+Shift+Minus sign (-); PowerPoint's page prints Ctrl+Equal sign for subscript. Not verified in an app.")
row("word", "Superscript", one("wd", 1458, "superscript"), ND, "high",
    "Mac: no superscript row in the Word for Mac tables (searched every raw row).")
row("word", "Increase font size (preset steps)", one("wd", 1398, "increase the font size."), one("wd", 2930, "increase the font size."), "high")
row("word", "Decrease font size (preset steps)", one("wd", 1402, "decrease the font size."), one("wd", 2937, "decrease the font size."), "high")
row("word", "Increase font size 1 point", one("wd", 1406, "1 point"), one("wd", 2944, "1 point"), "high")
row("word", "Decrease font size 1 point", one("wd", 1410, "1 point"), one("wd", 2951, "1 point"), "high")
row("word", "Clear character formatting", one("wd", 1462, "remove manual"), ND, "high",
    "Mac: no matching row in the Word for Mac tables.")
row("word", "Align left", one("wd", 1313, "left"), one("wd", 2811, "left"), "high")
row("word", "Align center", one("wd", 1305, "center"), one("wd", 2797, "center"), "high")
row("word", "Align right", one("wd", 1317, "right"), one("wd", 2818, "right"), "high")
row("word", "Justify", one("wd", 1309, "justify"), one("wd", 2804, "justify"), "high")
row("word", "Bulleted list", one("wd", 1430, "bulleted list"), one("wd", 2983, "bulleted list"), "high")
row("word", "Numbered list", ND, ND, "low",
    "No numbered-list row on the Word Windows or Mac tables (searched action text for 'numbered', 'list'). Mac prints Cmd+Shift+L 'Apply the List style' (wd L2906) and Windows Ctrl+Alt+L is 'Insert a LISTNUM field' (wd L1837), neither is a numbered-list toggle.")
row("word", "Indent paragraph", one("wd", 1321, "indent the paragraph"), one("wd", 2825, "indent the paragraph"), "high",
    "Mac prints Control+Shift+M here and Cmd+Shift+M for 'Remove a paragraph indent'.")
row("word", "Remove paragraph indent", one("wd", 1325, "remove a paragraph indent"), one("wd", 2829, "remove a paragraph indent"), "high")
row("word", "Hanging indent", one("wd", 1329, "create a hanging indent"), one("wd", 2836, "create a hanging indent"), "high")
row("word", "Normal style", one("wd", 1357, "normal style"), one("wd", 2878, "normal style"), "high")
row("word", "Heading 1", one("wd", 1361, "heading 1"), one("wd", 2885, "heading 1"), "high")
row("word", "Heading 2", one("wd", 1365, "heading 2"), one("wd", 2892, "heading 2"), "high")
row("word", "Heading 3", one("wd", 1369, "heading 3"), one("wd", 2899, "heading 3"), "high")
row("word", "Insert hyperlink", one("wd", 1576, "hyperlink"), one("oc", 744, "hyperlink"), "medium",
    "Mac: not on the Word for Mac tables; value is the common Office for Mac page.")
row("word", "Insert comment", one("wd", 1726, "insert a comment"), one("wd", 3441, "insert a comment"), "high")
row("word", "Track changes on/off", one("wd", 1730, "change tracking"), one("wd", 3448, "change tracking"), "high")
row("word", "Activate ribbon access keys", one("wd", 903, "access keys"), ND, "high",
    "Windows cell text is printed with an explanation: 'Alt or F10. To move to a different tab, use access keys or the arrow keys.' F10 function-key row L2221 says F10 alone turns KeyTips on or off. Mac: no key-tip row.")
row("word", "Expand or collapse ribbon", one("wd", 939, "ribbon"), one("wd", 2426, "ribbon"), "high")
row("word", "Cycle panes forward", one("wd", 2205, "F6 alone"), one("wd", 3619, "F6 alone"), "high",
    "F6 function-key row: switch between the document, task pane, status bar and ribbon. Mac Word page lists F6 as plain F6.")
row("word", "Cycle panes backward", many("", ("LIT", "Shift+F6")), many("", ("LIT", "Shift+F6")), "medium",
    "Shift+F6 is printed inside the F6 function-key row text (wd L2205 / L3619), not in its own key cell.")
row("word", "Help", one("wd", 2185, "F1 alone"), ND, "high",
    "Mac: F1 alone is Undo (wd L3587); no Help key row on the Mac table.")

# ---------------------------------------------------------------- EXCEL
row("excel", "New workbook", ND, one("xl", 1961, "new blank workbook"), "high",
    "Windows: no New row on the Windows tab (searched every raw row, Ctrl+N is not printed).")
row("excel", "Open workbook", one("xl", 709, "open a workbook"), one("xl", 1989, "open dialog"), "high")
row("excel", "Save workbook", one("xl", 717, "save a workbook"), one("xl", 1878, "save workbook"), "high")
row("excel", "Save As", one("xl", 1721, "F12 alone"), one("xl", 1969, "save as"), "high",
    "Windows key is the F12 function-key row.")
row("excel", "Print", ND, one("xl", 1901, "print workbook"), "high",
    "Windows: Ctrl+P not printed on the Windows tab.")
row("excel", "Close workbook", one("xl", 705, "close a workbook"), one("xl", 1929, "close window"), "high")
row("excel", "Undo", one("xl", 729, "undo"), one("xl", 1882, "undo"), "high")
row("excel", "Redo / repeat", one("xl", 1328, "repeat the last"), one("xl", 1886, "redo"), "high",
    "Windows: Ctrl+Y is printed as 'Repeat the last command or action'; a second table (xl L1534) labels Ctrl+Y 'Redo the last action'.")
row("excel", "Cut / Copy / Paste",
    many(" / ", ("xl", 741, "cut"), ("xl", 721, "copy"), ("xl", 725, "paste")),
    many(" / ", ("xl", 1890, "cut"), ("xl", 1870, "copy"), ("xl", 1866, "paste")), "high",
    "Mac Cut also prints Shift+<Mac Delete key with a cross symbol> as an image.")
row("excel", "Paste Special", one("xl", 1092, "paste special"), one("xl", 1949, "paste special"), "high")
row("excel", "Select all / worksheet", one("xl", 1260, "entire worksheet"), one("xl", 1977, "select all"), "high")
row("excel", "Find", ND, one("xl", 2174, "find dialog"), "high",
    "Windows: no Find row (Ctrl+F not printed). Mac cell lists Ctrl+F and Shift+F5; the common Office for Mac page prints Command+F for Find (oc L740).")
row("excel", "Replace", ND, one("xl", 1945, "replace"), "high",
    "Windows: Ctrl+H not printed on the Windows tab.")
row("excel", "Go To", one("xl", 1606, "go to"), one("xl", 1937, "go to"), "high",
    "Windows F5 is also printed in the F5 function-key row (xl L1693).")
row("excel", "Edit active cell", one("xl", 1681, "F2 alone"), many(" or ", ("xl", 2207, "edit the selected cell"), ("xl", 2346, "edit the active cell")), "high",
    "Mac Ctrl+U is printed as 'Edit the active cell and position the insertion point at the end of the line'.")
row("excel", "New line inside cell", one("xl", 1288, "new line"), one("xl", 2215, "new line"), "high",
    "Mac also prints Cmd+Option+Return and Ctrl+Option+Return for 'Insert a line break in a cell' (xl L2435).")
row("excel", "Fill down", one("xl", 1128, "fill down"), one("xl", 1909, "fill cells down"), "high")
row("excel", "Fill right", ND, one("xl", 1913, "fill cells right"), "high",
    "Windows: no Fill Right row on the Windows tab; Ctrl+R there is 'Rename the table' (xl L1526, table-only context).")
row("excel", "Insert cells / rows / columns", one("xl", 1056, "insert dialog"), one("xl", 1917, "insert cells"), "high")
row("excel", "Delete cells / rows / columns", one("xl", 1060, "delete dialog"), one("xl", 1921, "delete cells"), "high")
row("excel", "Number format: General", one("xl", 1132, "general"), one("xl", 2467, "general"), "high")
row("excel", "Number format: Currency", one("xl", 1136, "currency"), one("xl", 2471, "currency"), "high")
row("excel", "Number format: Percentage", one("xl", 1140, "percentage"), one("xl", 2475, "percentage"), "high")
row("excel", "Number format: Scientific", one("xl", 1144, "scientific"), one("xl", 2479, "exponential"), "high",
    "Mac label is 'exponential number format'.")
row("excel", "Number format: Date", one("xl", 1148, "date format"), one("xl", 2483, "date format"), "high")
row("excel", "Number format: Time", one("xl", 1152, "time format"), one("xl", 2487, "time format"), "high")
row("excel", "Number format: Number (2 decimals, thousands)", one("xl", 1156, "number format"), one("xl", 2491, "number format"), "high")
row("excel", "Number formats Ctrl+Shift+1..6", ND, ND, "high",
    "Not on either page: the number-format keys are the symbol keys above (Ctrl+Shift+~ ! @ # $ % ^). Searched every raw row for Ctrl+Shift+digit.")
row("excel", "Format Cells dialog", one("xl", 1036, "format cells"), one("xl", 1941, "format cells"), "high")
row("excel", "Select entire row", one("xl", 1304, "entire row"), one("xl", 2620, "entire row"), "high")
row("excel", "Select entire column", one("xl", 1300, "entire column"), one("xl", 2616, "entire column"), "high",
    "Mac row is marked with an asterisk by Microsoft (conflicts with a default macOS shortcut).")
row("excel", "Go to start of sheet", one("xl", 967, "beginning of a worksheet"), one("xl", 2134, "beginning of the sheet"), "high",
    "Mac cell also prints 'On a MacBook, Ctrl+Fn+Left arrow key'.")
row("excel", "Go to last used cell", one("xl", 955, "last cell on a worksheet"), one("xl", 2138, "last cell in use"), "high",
    "Mac cell also prints 'On a MacBook, Ctrl+Fn+Right arrow key'.")
row("excel", "Move to edge of data region", one("xl", 947, "edge of the current data region"), one("xl", 2126, "edge of the current data region"), "high")
row("excel", "Next sheet", one("xl", 975, "next sheet"), one("xl", 2158, "next sheet"), "high")
row("excel", "Previous sheet", one("xl", 991, "previous sheet"), one("xl", 2162, "previous sheet"), "medium",
    "Mac cell prints two keys, 'Ctrl+Page down' and 'Option+Left arrow key'; Ctrl+Page down also appears for Next sheet, so it is probably a Microsoft typo. Both are copied as printed.")
row("excel", "AutoSum", one("xl", 1413, "sum formula"), one("xl", 2370, "autosum"), "high")
row("excel", "Enter current date", one("xl", 1068, "current date"), one("xl", 2374, "date"), "high")
row("excel", "Enter current time", one("xl", 1064, "current time"), one("xl", 2378, "time"), "high")
row("excel", "Absolute / relative reference (F4)", one("xl", 1421, "absolute and relative"), one("xl", 2366, "absolute, relative"), "high",
    "Windows F4 alone also repeats the last action (F4 function-key row xl L1689).")
row("excel", "Insert hyperlink", one("xl", 1160, "hyperlink"), one("xl", 2342, "hyperlink"), "high")
row("excel", "Bold", one("xl", 1100, "bold"), one("xl", 1897, "bold"), "high")
row("excel", "Italic", one("xl", 1096, "italic"), one("xl", 1957, "italic"), "high")
row("excel", "Underline", one("xl", 1104, "underline"), one("xl", 1953, "underline"), "high")
row("excel", "Strikethrough", one("xl", 1108, "strikethrough"), one("xl", 2531, "strikethrough"), "high")
row("excel", "Expand or collapse ribbon", one("xl", 898, "ribbon"), one("xl", 2050, "ribbon"), "high")
row("excel", "Activate ribbon key tips", one("xl", 866, "access keys"), ND, "high",
    "Windows: 'Alt or F10. To move to a different tab, use access keys or the arrow keys.' Mac: no key-tip row.")
row("excel", "Cycle panes", many(" / ", ("xl", 1697, "F6 alone"), ("LIT", "Shift+F6")), one("xl", 2962, "switch focus"), "medium",
    "Windows: F6 is the table key; Shift+F6 is printed inside that function-key row's text (xl L1697).")
row("excel", "Help", one("xl", 1677, "F1 alone"), one("xl", 1973, "help window"), "high",
    "Mac cell 'F1 or Cmd+Forward slash (/)'.")

# ---------------------------------------------------------------- POWERPOINT
row("powerpoint", "New presentation", one("pp", 713, "create new presentation"), one("pp", 1803, "create a new presentation"), "high")
row("powerpoint", "Open", one("pp", 826, "open a presentation"), one("pp", 1924, "open a presentation"), "high")
row("powerpoint", "Save", one("pp", 777, "save the presentation"), one("pp", 1867, "save the presentation"), "high")
row("powerpoint", "Save As", one("pp", 834, "different name"), one("pp", 1936, "different name"), "high")
row("powerpoint", "Print", one("pp", 773, "print"), one("pp", 1863, "print"), "high")
row("powerpoint", "Close presentation", one("pp", 830, "close a presentation"), one("pp", 1928, "close a presentation"), "low",
    "Windows page prints Ctrl+D for 'Close a presentation' but the same page prints Ctrl+D for 'Duplicate selected objects' (pp L873): likely a Microsoft error, not verified. The same page prints Ctrl+Q for 'Close PowerPoint' (pp L781).")
row("powerpoint", "Undo", one("pp", 749, "undo"), one("pp", 1839, "undo"), "high")
row("powerpoint", "Redo", one("pp", 753, "redo"), one("pp", 1843, "redo"), "high")
row("powerpoint", "Cut / Copy / Paste",
    many(" / ", ("pp", 861, "cut"), ("pp", 865, "copy"), ("pp", 869, "paste")),
    many(" / ", ("pp", 1967, "cut"), ("pp", 1971, "copy"), ("pp", 1975, "paste")), "high")
row("powerpoint", "Paste Special", one("pp", 893, "paste special"), one("pp", 1999, "paste special"), "high")
row("powerpoint", "Select all (objects / slides)", one("pp", 926, "select all objects"), one("pp", 2036, "select all objects"), "high",
    "Slide Sorter / thumbnail pane Select all is also Ctrl+A / Cmd+A (pp L1399 / L2497).")
row("powerpoint", "New slide", one("pp", 798, "new slide"), one("pp", 1892, "new slide"), "high")
row("powerpoint", "Duplicate selected slide", one("pp", 822, "copy of the selected slide"), one("pp", 1920, "copy of the selected slide"), "high",
    "Row text is 'Make a copy of the selected slide.'")
row("powerpoint", "Duplicate selected object", one("pp", 873, "duplicate selected objects"), one("pp", 1979, "duplicate selected objects"), "high")
row("powerpoint", "Move slide up / down",
    many(" / ", ("pp", 1318, "up in order"), ("pp", 1322, "down in order")),
    many(" / ", ("pp", 2404, "up in order"), ("pp", 2408, "down in order")), "high")
row("powerpoint", "Move slide to start / end",
    many(" / ", ("pp", 1326, "beginning"), ("pp", 1330, "end")),
    many(" / ", ("pp", 2412, "beginning"), ("pp", 2416, "end")), "high")
row("powerpoint", "Next / previous slide",
    many(" / ", ("pp", 757, "next slide"), ("pp", 761, "previous slide")),
    many(" / ", ("pp", 1847, "next slide"), ("pp", 1851, "previous slide")), "high")
row("powerpoint", "Group", one("pp", 930, "group the selected"), one("pp", 2040, "group the selected"), "high")
row("powerpoint", "Ungroup", one("pp", 934, "ungroup"), one("pp", 2044, "ungroup"), "high")
row("powerpoint", "Regroup", one("pp", 938, "regroup"), one("pp", 2048, "regroup"), "high")
row("powerpoint", "Nudge selected object", ND, one("pp", 2080, "move the selected object"), "high",
    "Windows tab has no move/nudge row (rotate is Alt+Left/Right arrow, pp L942/L946).")
row("powerpoint", "Start slide show", one("pp", 765, "start the slide show"), one("pp", 1855, "start the slide show"), "high",
    "Delivery page: F5 / Cmd+Shift+Return = 'Start a presentation from the beginning' (ppd L681 / L1019).")
row("powerpoint", "Start slide show from current slide", one("ppd", 685, "current slide"), one("ppd", 1023, "current slide"), "high",
    "On the 'deliver' article, not the 'create' article.")
row("powerpoint", "Presenter view", one("ppd", 689, "presenter view"), one("ppd", 1027, "presenter view"), "high")
row("powerpoint", "Bold", one("pp", 1207, "bold"), one("pp", 2293, "bold"), "high")
row("powerpoint", "Italic", one("pp", 1215, "italic"), one("pp", 2301, "italic"), "high")
row("powerpoint", "Underline", one("pp", 1211, "underline"), one("pp", 2297, "underline"), "high")
row("powerpoint", "Strikethrough", ND, ND, "high", "No strikethrough row on the PowerPoint Windows or Mac tables.")
row("powerpoint", "Subscript", one("pp", 1219, "subscript"), one("pp", 2305, "subscript"), "high")
row("powerpoint", "Superscript", one("pp", 1223, "superscript"), one("pp", 2309, "superscript"), "high")
row("powerpoint", "Clear character formatting", one("pp", 1227, "remove manual"), one("pp", 2313, "remove manual"), "high")
row("powerpoint", "Increase font size", one("pp", 1195, "increase the font size"), one("pp", 2277, "increase the font size"), "high")
row("powerpoint", "Decrease font size", one("pp", 1199, "decrease the font size"), one("pp", 2281, "decrease the font size"), "high")
row("powerpoint", "Align center / left / right / justify",
    many(" / ", ("pp", 1231, "center"), ("pp", 1239, "left"), ("pp", 1243, "right"), ("pp", 1235, "justify")),
    many(" / ", ("pp", 2317, "center"), ("pp", 2325, "left"), ("pp", 2329, "right"), ("pp", 2321, "justify")), "high")
row("powerpoint", "Bulleted list", ND, ND, "high",
    "No bullet or numbered-list row on the PowerPoint Windows or Mac tables.")
row("powerpoint", "Indent (demote paragraph)", one("pp", 1140, "demote"), one("pp", 2235, "demote"), "high")
row("powerpoint", "Outdent (promote paragraph)", one("pp", 1136, "promote"), one("pp", 2231, "promote"), "high")
row("powerpoint", "Insert hyperlink", one("pp", 954, "hyperlink"), one("pp", 2064, "hyperlink"), "high")
row("powerpoint", "Find", one("pp", 1165, "find dialog"), one("pp", 2252, "search"), "high",
    "Mac label is 'Open the Search in Presentation search field'.")
row("powerpoint", "Replace", one("pp", 1169, "replace"), one("pp", 2256, "replace"), "high",
    "Mac label is 'Open the Find and Replace pane'.")
row("powerpoint", "Cycle panes forward / backward",
    many(" / ", ("pp", 1371, "clockwise through panes"), ("pp", 1375, "counterclockwise")),
    many(" / ", ("pp", 2485, "clockwise through panes"), ("pp", 2489, "counterclockwise")), "high")
row("powerpoint", "Toggle Outline and Thumbnail panes", one("pp", 1355, "outline and thumbnail"), one("pp", 2469, "outline view and thumbnail"), "high")
row("powerpoint", "Activate ribbon access keys", one("pp", 1629, "access keys"), ND, "high",
    "Windows cell text: 'Alt or F10. To move to a different tab, use access keys or the arrow keys.' Mac: no ribbon rows on the Mac tab.")
row("powerpoint", "Expand or collapse ribbon", one("pp", 1661, "ribbon"), ND, "high",
    "The same Windows page also prints Ctrl+F1 for 'Switch to full screen (hide menus)' (pp L1359). Mac: no row.")
row("powerpoint", "Help", one("pp", 1403, "help"), one("pp", 2501, "help"), "high")

# ---------------------------------------------------------------- PDF (Edge)
EGNOTE = " Chromium Edge page = keyboard-shortcuts-in-microsoft-edge; the page /edge/microsoft-edge-keyboard-shortcuts is the legacy EdgeHTML page ('The new browser recommended by Microsoft is here')."
row("pdf", "Zoom in / out", many(" / ", ("egc", 831, "zoom in"), ("egc", 835, "zoom out")),
    many(" / ", ("egc", 1163, "zoom in"), ("egc", 1167, "zoom out")), "high",
    "Page-level zoom shortcut, not PDF-specific." + EGNOTE)
row("pdf", "Toggle fit to width / fit to page", one("egc", 839, "fit to page"), one("egc", 1171, "fit to page"), "high",
    "Printed with '(in a PDF)'. Legacy EdgeHTML page prints Ctrl+Shift+A (egn L919)." + EGNOTE)
row("pdf", "Rotate PDF", many(" / ", ("egc", 843, "counter-clockwise"), ("egc", 847, "clockwise")),
    many(" / ", ("egc", 1175, "counter-clockwise"), ("egc", 1179, "clockwise")), "high",
    "First key rotates counter-clockwise 90, second clockwise 90; both printed '(in a PDF)'. Legacy EdgeHTML page prints F9 (egn L927)." + EGNOTE)
row("pdf", "Find in document", one("egc", 678, "find on page"), one("egc", 1019, "find on page"), "medium",
    "Label is 'Open find on page', not PDF-specific. Next / previous result are Ctrl+G / Ctrl+Shift+G (Cmd+G / Cmd+Shift+G).")
row("pdf", "Go to page number", ND, ND, "high",
    "Chromium Edge page has no go-to-page row (Ctrl+G is 'Jump to the next result for find on page', egc L687). Legacy EdgeHTML page prints Ctrl+G for PDFs (egn L903)." + EGNOTE)
row("pdf", "Open or close table of contents", ND, ND, "high",
    "Chromium Edge page has no row. Legacy EdgeHTML page prints Alt+T (egn L907)." + EGNOTE)
row("pdf", "Toggle one-page / two-page layout", ND, ND, "high",
    "Chromium Edge page has no row. Legacy EdgeHTML page prints F8 (egn L923)." + EGNOTE)
row("pdf", "Full-screen reading", one("egc", 934, "full screen"), one("egc", 1023, "full-screen"), "medium",
    "Browser full screen, not PDF-specific. Legacy EdgeHTML page prints F11 for PDFs (egn L931)." + EGNOTE)
row("pdf", "Read aloud", one("egc", 787, "read aloud"), one("egc", 1111, "read aloud"), "medium",
    "Browser Read Aloud, not PDF-specific. Legacy EdgeHTML page prints Ctrl+Shift+G for PDFs (egn L935)." + EGNOTE)
row("pdf", "Add notes", ND, ND, "high",
    "Chromium Edge page has no row. Legacy EdgeHTML page prints Ctrl+Shift+M 'Add notes to PDF books' (egn L939); on the Chromium page Ctrl+Shift+M is 'Sign in as a different user or browse as a Guest' (egc L731)." + EGNOTE)
row("pdf", "Save a copy of the PDF", one("egc", 767, "save the current page"), one("egc", 1099, "save the current tab"), "low",
    "Chromium page label is 'Save the current page', not a PDF row; whether it saves the PDF is not stated. Legacy EdgeHTML page prints Ctrl+Shift+S 'Save a copy of the PDF document' (egn L943)." + EGNOTE)
row("pdf", "Print", one("egc", 751, "print the current page"), one("egc", 1083, "print the current tab"), "high")
row("pdf", "Next / previous page", ND, ND, "high",
    "Not on either Edge page. The 'Go to next / previous page' rows on the legacy page (egn L841 / L845) are in the 'When reading books' table, not the PDF table." + EGNOTE)

# ---------------------------------------------------------------- COMMON
row("common", "Move focus to next pane", one("egc", 900, "next pane"), ND, "high",
    "Chromium Edge page: F6 next pane, Shift+F6 previous pane (egc L904). Legacy page prints F6 as 'Toggle focus between webpage content and the address bar' (egn L782). Mac Edge table has no F6 row.")
row("common", "Developer tools", one("egc", 938, "developer tools"), one("egc", 1203, "developer tools"), "high",
    "Chromium Edge also prints Ctrl+Shift+I (egc L699) and Mac Command+Shift+C (egc L1003) for Developer Tools. Mac F12 is printed as 'Open Developer Tools (toggle)'.")

# ---------------------------------------------------------------- ADDED
row("word", "Move cursor to last change / previous revision", one("wd", 1032, "previous revision"), one("wd", 2542, "previous insertion point"), "medium",
    "Added by C2. Windows label is 'previous revision' (wd L1032; 'Shift+F5, immediately after opening the document' = last revision before close, wd L1036); the F5 function-key row says 'moves the cursor to the last change'. Mac label is 'previous insertion point' (wd L2542).", old_action="(new)")
row("word", "Repeat last action / F4", one("wd", 2197, "F4 alone"), one("wd", 3605, "F4 alone"), "high",
    "Added by C2. Windows F4 repeats the last command; Mac F4 alone PASTES (Word for Mac function-key map), Shift+F4 repeats the last Find or Go To.", old_action="(new)")
row("common", "Shortcut help (Ctrl+/)", ND, many("", ("xl", 1973, "help window", "Forward slash")), "high",
    "Added by C2. No Ctrl+/ on any Windows page or row (searched every raw row). Excel for Mac prints Cmd+Forward slash (/) next to F1 for 'Display the Help window'.", old_action="(new)")
row("common", "Redo (Ctrl+Shift+Z)", ND, many("", ("xl", 1886, "redo", r"Shift\+Z")), "high",
    "Added by C2. Ctrl+Shift+Z is not printed on any Windows page. Excel for Mac prints Cmd+Shift+Z beside Cmd+Y / Ctrl+Y.", old_action="(new)")
row("excel", "Repeat last action (Windows Ctrl+Y / F4)", many(" / ", ("xl", 1328, "repeat the last"), ("xl", 1689, "F4 alone")), ND, "high",
    "Added by C2. Ctrl+Y repeats in Excel for Windows; F4 alone repeats the last command or action (and cycles references when a reference is selected).", old_action="(new)")
row("powerpoint", "Zoom to fit", one("pp", 818, "zoom to fit"), one("pp", 1916, "zoom to fit"), "high", "Added by C2.", old_action="(new)")


def build():
    out = []
    old_by = {(o["module"], o["action"]): o for o in OLD}
    seen = set()
    for module, action, win, mac, conf, note, old_action in rows:
        kw, tw = cell(W, win)
        km, tm = cell(M, mac)
        tags = sorted(tw | tm)
        urls = " ; ".join(URL[t] for t in tags) or URL.get({"word": "wd", "excel": "xl", "powerpoint": "pp", "pdf": "egc", "common": "egc"}[module])
        o = old_by.get((module, old_action))
        notes = []
        if o:
            seen.add((module, old_action))
            for lab, newv, oldv in (("windows", kw, o["key_win"]), ("mac", km, o["key_mac"])):
                if newv == ND and re.match(r"not (documented|extracted)", oldv) and not oldv.startswith("not extracted"):
                    continue
                if canon(newv) != canon(oldv):
                    notes.append("CHANGED: %s was '%s', raw page %s" % (lab, oldv, "prints '%s'" % newv if newv != ND else "has no such row"))
        elif old_action != "(new)":
            errors.append("old row not found: %s / %s" % (module, old_action))
        notes.append(note)
        out.append({"module": module, "action": action, "key_win": kw, "key_mac": km, "source_url": urls,
                    "confidence": "n/a" if kw == ND and km == ND else conf,
                    "notes": " ".join(n for n in notes if n)})
    for o in OLD:
        if (o["module"], o["action"]) not in seen:
            errors.append("old row not covered: %s / %s" % (o["module"], o["action"]))
    return out


if __name__ == "__main__":
    out = build()
    if errors:
        print("\n".join(errors))
        sys.exit(1)
    with open(os.path.join(HERE, "C2-ms-lookup.csv"), "w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=["module", "action", "key_win", "key_mac", "source_url", "confidence", "notes"], quoting=csv.QUOTE_ALL)
        w.writeheader()
        w.writerows(out)
    print("rows", len(out), "old", len(OLD))
