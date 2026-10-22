"""Parse Microsoft 365 *for the web* keyboard-shortcut tables out of saved support HTML.

Run:  python -I parse_ms_web.py
Reads  ms-html/*.html (only the `web` tabpanel of the desktop articles, which C2 skipped)
       ms-html-web/*.html (web-only articles; the `web` tabpanel where the page has tabs)
Writes C3-ms-web-raw.csv, C3-ms-web-browser-notes.csv, parse_ms_web.log.json
Standard library only. Keys are copied as printed; only whitespace and the spacing around
'+' are normalised. One row per key alternative (<li>, <br> or <p> inside a cell).

platform column: `web` = the article does not say which OS (2-column table),
`web-windows` / `web-mac` = the two value columns of a 3-column table.
"""
import csv
import json
import os
import re
import sys
from html.parser import HTMLParser

HERE = os.path.dirname(os.path.abspath(__file__))
D1 = os.path.join(HERE, "ms-html")
D2 = os.path.join(HERE, "ms-html-web")

A = "https://support.microsoft.com/en-us/accessibility/"
# file -> (product, url, web-tab-only)
SOURCES = {
    os.path.join(D1, "word-a11y.html"): ("word", A + "word/keyboard-shortcuts-in-word", True),
    os.path.join(D1, "excel-a11y.html"): ("excel", A + "excel/keyboard-shortcuts-in-excel", True),
    os.path.join(D1, "ppt-a11y-create.html"): ("powerpoint", A + "powerpoint/use-keyboard-shortcuts-to-create-powerpoint-presentations", True),
    os.path.join(D1, "ppt-a11y-deliver.html"): ("powerpoint", A + "powerpoint/use-keyboard-shortcuts-to-deliver-powerpoint-presentations", True),
    os.path.join(D2, "word-web-app-2554e572.html"): ("word", "https://support.microsoft.com/en-us/word/keyboard-shortcuts-in-word-web-app", False),
    os.path.join(D2, "copy-paste-office-web.html"): ("office-common", "https://support.microsoft.com/en-us/word/copy-and-paste-in-office-for-the-web", False),
    os.path.join(D2, "ppt-modern-comments.html"): ("powerpoint", A + "powerpoint/use-keyboard-shortcuts-to-navigate-modern-comments-in-powerpoint", True),
    os.path.join(D2, "ribbon-keyboard-954cd3f7.html"): ("office-common", A + "windows/use-the-keyboard-to-work-with-the-ribbon", True),
}
# pages scanned for browser-conflict prose only (no key tables, or tables already parsed above)
PROSE_ONLY = {
    os.path.join(D2, "copy-paste-ppt-web.html"): ("powerpoint", "https://support.microsoft.com/en-us/powerpoint/copy-and-paste-in-powerpoint-for-the-web", False),
    os.path.join(D2, "word-select-all-web.html"): ("word", "https://support.microsoft.com/en-gb/word/select-all-document-content-in-word-for-the-web", False),
    os.path.join(D2, "sr-word-basic.html"): ("word", A + "word/basic-tasks-using-a-screen-reader-with-word", True),
    os.path.join(D2, "sr-excel-basic.html"): ("excel", A + "excel/basic-tasks-using-a-screen-reader-with-excel", True),
    os.path.join(D2, "sr-ppt-basic.html"): ("powerpoint", A + "powerpoint/basic-tasks-to-create-a-presentation-in-powerpoint-with-a-screen-reader", True),
    os.path.join(D2, "sr-ppt-explore.html"): ("powerpoint", A + "powerpoint/use-a-screen-reader-to-explore-and-navigate-powerpoint", True),
}

ACTION_HDR = {"to do this", "to insert this", "description", "press this key to do this", "option"}
KEY_HDR = {"press", "use", "key", "press this key"}
BLOCK_BREAK = {"br", "li", "p", "div"}
BROWSER_RE = re.compile(r"browser|Ctrl\+F6|override|reserved|Microsoft Edge|Chrome|Firefox|Safari|Alt\+Shift\+A|Mac computer", re.I)


def norm_ws(s):
    s = re.sub("[⁠​﻿]", "", s)
    return re.sub(r"\s+", " ", s.replace("\xa0", " ")).strip()


def norm_keys(s):
    s = norm_ws(s)
    return re.sub(r"(?<=\S)\s*\+\s*(?=\S)", "+", s)


class Page(HTMLParser):
    def __init__(self, web_tab_only):
        super().__init__(convert_charrefs=True)
        self.web_tab_only = web_tab_only
        self.rows = []
        self.unparsed = []
        self.notes = []          # (line, tab, section, text) blocks that mention the browser
        self.tab_raw = None
        self.h = {"h2": "", "h3": "", "h4": ""}
        self.in_h = None
        self.h_buf = []
        self.blk = None          # prose block being collected: [tag, line, buf]
        self.table_idx = -1
        self.in_table = False
        self.header = None
        self.in_thead = False
        self.cur_row = None
        self.row_line = 0
        self.row_is_head = False
        self.cell = None
        self.table_ctx = None
        self.skipped = {}
        self.empty_cells = []    # 4-column table cells that print nothing (no entry on that OS)

    def section(self):
        return " > ".join(x for x in (self.h["h2"], self.h["h3"], self.h["h4"]) if x)

    def active(self):
        return (not self.web_tab_only) or self.tab_raw == "web"

    def new_line(self):
        if self.cell is not None and (not self.cell or self.cell[-1].strip()):
            self.cell.append("")

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "section" and a.get("role") == "tabpanel":
            self.tab_raw = a.get("data-tab")
        elif tag == "h1":
            self.h = {"h2": "", "h3": "", "h4": ""}
        elif tag in ("h2", "h3", "h4") and not self.in_table:
            self.in_h = tag
            self.h_buf = []
        elif tag in ("p", "li") and self.blk is None:
            self.blk = [tag, self.getpos()[0], []]
        elif tag == "table":
            self.table_idx += 1
            self.in_table = True
            self.header = None
            self.table_ctx = (self.tab_raw, self.section())
        elif tag == "thead":
            self.in_thead = True
        elif tag == "tr" and self.in_table:
            self.cur_row = []
            self.row_line = self.getpos()[0]
            self.row_is_head = self.in_thead
        elif tag in ("td", "th") and self.cur_row is not None:
            self.cell = [""]
            if tag == "th":
                self.row_is_head = True
        elif tag == "img" and self.cell is not None:
            src, alt = a.get("src", ""), a.get("alt", "")
            if src.endswith("mac-cmd.gif"):
                if not self.cell[-1].rstrip().endswith("Cmd"):
                    self.cell[-1] += " Cmd "
            else:
                self.cell[-1] += " [img: %s] " % alt
        elif self.cell is not None and tag in BLOCK_BREAK:
            self.new_line()

    def handle_endtag(self, tag):
        if tag in ("h2", "h3", "h4") and self.in_h == tag:
            text = norm_ws("".join(self.h_buf))
            self.h[tag] = text
            if tag == "h2":
                self.h["h3"] = self.h["h4"] = ""
            elif tag == "h3":
                self.h["h4"] = ""
            self.in_h = None
        elif tag in ("p", "li") and self.blk is not None and self.blk[0] == tag:
            text = norm_ws("".join(self.blk[2]))
            if text and self.active() and BROWSER_RE.search(text):
                self.notes.append((self.blk[1], self.tab_raw or "-", self.section(), text))
            self.blk = None
        elif tag in ("td", "th") and self.cell is not None:
            lines = [l for l in (norm_ws(x) for x in self.cell) if l and l.lower() != "or"]
            self.cur_row.append(lines)
            self.cell = None
        elif tag == "tr" and self.cur_row is not None:
            if self.row_is_head and self.header is None:
                self.header = [norm_ws(" ".join(c)).lower() for c in self.cur_row]
            elif self.cur_row:
                self.finish_row()
            self.cur_row = None
        elif tag == "thead":
            self.in_thead = False
        elif tag == "table":
            self.in_table = False
            self.header = None
        elif self.cell is not None and tag in BLOCK_BREAK:
            self.new_line()

    def handle_data(self, data):
        if self.in_h and not self.in_table:
            self.h_buf.append(data)
        if self.blk is not None:
            self.blk[2].append(data)
        if self.cell is not None:
            self.cell[-1] += data
            # table cells that mention the browser are notes too (e.g. "Ctrl+O applies to the browser")

    def finish_row(self):
        tab_raw, section = self.table_ctx
        cells = self.cur_row
        hdr = self.header
        info = {"table": self.table_idx, "line": self.row_line, "tab": tab_raw, "section": section}
        if self.web_tab_only and tab_raw != "web":
            self.skipped[tab_raw] = self.skipped.get(tab_raw, 0) + 1
            return
        if hdr is None:
            self.unparsed.append(dict(info, why="row before any header row", cells=[" | ".join(c) for c in cells]))
            return
        h1 = hdr[1] if len(hdr) > 1 else ""
        h2 = hdr[2] if len(hdr) > 2 else ""
        if len(hdr) == 3 and len(cells) == 3 and hdr[0] in ACTION_HDR and "windows" in h1 and "mac" in h2:
            action = " ".join(cells[0])
            self.emit("web-windows", section, action, cells[1], info)
            self.emit("web-mac", section, action, cells[2], info)
        elif len(hdr) == 4 and len(cells) == 4 and hdr[0] == "key" and hdr[1] == "modifier" and hdr[2] == "windows" and hdr[3] == "mac":
            # Word for the web "Windows and Mac keyboard equivalents": the Windows / Mac cells say what the
            # combination does on that OS (a description, not a key), so key = modifier+key, action = the cell.
            key = " ".join(cells[0])
            mod = " ".join(cells[1])
            combo = key if mod.lower() in ("none", "") else mod.replace("-", "+") + "+" + key
            for plat, cell in (("web-windows", cells[2]), ("web-mac", cells[3])):
                if not cell:
                    self.empty_cells.append(dict(info, plat=plat, combo=combo))
                    continue
                for desc in cell:
                    self.rows.append({"platform": plat, "section": section, "action": norm_ws(desc),
                                      "keys": combo, "line": info["line"], "table": info["table"]})
        elif len(hdr) == 2 and len(cells) == 2 and hdr[0] in ACTION_HDR and hdr[1] in KEY_HDR:
            self.emit("web", section, " ".join(cells[0]), cells[1], info)
        elif len(hdr) == 2 and len(cells) == 2 and hdr[0] in KEY_HDR and hdr[1] in ACTION_HDR:
            self.emit("web", section, " ".join(cells[1]), cells[0], info)
        else:
            self.unparsed.append(dict(info, why="unrecognised table layout " + repr(hdr)[:200], cells=[" | ".join(c)[:200] for c in cells][:3]))

    def emit(self, plat, section, action, keycell, info):
        if not keycell:
            self.unparsed.append(dict(info, why="empty key cell (%s)" % plat, action=norm_ws(action)))
            return
        for k in keycell:
            self.rows.append({"platform": plat, "section": section, "action": norm_ws(action),
                              "keys": norm_keys(k), "line": info["line"], "table": info["table"]})


def read(path):
    with open(path, encoding="utf-8", errors="replace") as fh:
        return fh.read()


def main():
    out_rows, notes, logs = [], [], {}
    for path, (product, url, tab_only) in SOURCES.items():
        p = Page(tab_only)
        p.feed(read(path))
        fn = os.path.relpath(path, HERE).replace("\\", "/")
        for r in p.rows:
            out_rows.append({
                "product": product, "platform": r["platform"], "section": r["section"] or "(no heading)",
                "action": r["action"], "keys": r["keys"], "source_url": url,
                "line_in_html_or_table_index": "%s:L%d/T%d" % (fn, r["line"], r["table"]),
            })
        for ln, tab, sec, text in p.notes:
            notes.append({"product": product, "source_url": url, "where": "%s:L%d" % (fn, ln), "tab": tab, "section": sec, "text": text})
        logs[fn] = {"product": product, "url": url, "tables": p.table_idx + 1, "rows": len(p.rows),
                    "skipped_other_tabs_cells": p.skipped, "empty_cells": len(p.empty_cells), "unparsed": p.unparsed}
    for path, (product, url, tab_only) in PROSE_ONLY.items():
        p = Page(tab_only)
        p.feed(read(path))
        fn = os.path.relpath(path, HERE).replace("\\", "/")
        for ln, tab, sec, text in p.notes:
            notes.append({"product": product, "source_url": url, "where": "%s:L%d" % (fn, ln), "tab": tab, "section": sec, "text": text})
        logs[fn] = {"product": product, "url": url, "tables": p.table_idx + 1, "rows": len(p.rows), "prose_only": True,
                    "unparsed": p.unparsed}
    out_rows = [r for r in out_rows if r["keys"]]
    cols = ["product", "platform", "section", "action", "keys", "source_url", "line_in_html_or_table_index"]
    with open(os.path.join(HERE, "C3-ms-web-raw.csv"), "w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=cols, quoting=csv.QUOTE_ALL)
        w.writeheader()
        w.writerows(out_rows)
    ncols = ["product", "source_url", "where", "tab", "section", "text"]
    seen, uniq = set(), []
    for n in notes:  # the same sentence recurs in sibling articles; keep every distinct (url, text)
        k = (n["source_url"], n["text"])
        if k not in seen:
            seen.add(k)
            uniq.append(n)
    with open(os.path.join(HERE, "C3-ms-web-browser-notes.csv"), "w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=ncols, quoting=csv.QUOTE_ALL)
        w.writeheader()
        w.writerows(uniq)
    with open(os.path.join(HERE, "parse_ms_web.log.json"), "w", encoding="utf-8") as fh:
        json.dump(logs, fh, indent=1, ensure_ascii=False)
    print("rows", len(out_rows), "browser notes", len(uniq))
    for f, l in logs.items():
        print(f, l["tables"], "tables", l["rows"], "rows", len(l["unparsed"]), "unparsed", l.get("skipped_other_tabs_cells", ""))


if __name__ == "__main__":
    sys.exit(main())
