"""Parse the saved Microsoft support HTML articles into (section, action, keys) rows.

Run:  python -I parse_ms.py
Reads  ms-html/*.html (kept as evidence), writes C2-ms-raw.csv and parse_ms.log.json
Standard library only. Keys are copied as printed; only whitespace and the spacing
around '+' are normalised. One row per key alternative (<li>, <br> or <p> inside a cell).
"""
import csv
import json
import os
import re
import sys
from html.parser import HTMLParser

HERE = os.path.dirname(os.path.abspath(__file__))
HTML_DIR = os.path.join(HERE, "ms-html")

# file -> (product, final URL after redirects, default platform when the page has no OS tabs)
SOURCES = {
    "word-a11y.html": ("word", "https://support.microsoft.com/en-us/accessibility/word/keyboard-shortcuts-in-word", None),
    "excel-a11y.html": ("excel", "https://support.microsoft.com/en-us/accessibility/excel/keyboard-shortcuts-in-excel", None),
    "ppt-a11y-create.html": ("powerpoint", "https://support.microsoft.com/en-us/accessibility/powerpoint/use-keyboard-shortcuts-to-create-powerpoint-presentations", None),
    "ppt-a11y-deliver.html": ("powerpoint", "https://support.microsoft.com/en-us/accessibility/powerpoint/use-keyboard-shortcuts-to-deliver-powerpoint-presentations", None),
    "edge-shortcuts.html": ("edge", "https://support.microsoft.com/en-us/edge/microsoft-edge-keyboard-shortcuts", "windows"),
    "edge-shortcuts-old.html": ("edge", "https://support.microsoft.com/en-us/edge/keyboard-shortcuts-in-microsoft-edge", None),
    "office-mac-common.html": ("office-common", "https://support.microsoft.com/en-us/accessibility/office-accessibility/common-office-for-mac-keyboard-shortcuts", "mac"),
}

TAB_PLATFORM = {"windows": "windows", "macos": "mac", "mac": "mac"}
ACTION_HDR = {"to do this", "to insert this", "description", "press this key to do this"}
KEY_HDR = {"press", "use", "key", "press this key"}
BLOCK_BREAK = {"br", "li", "p", "div"}


def norm_ws(s):
    s = re.sub("[⁠​﻿]", "", s)  # invisible word joiners Edge prints inside key names
    return re.sub(r"\s+", " ", s.replace("\xa0", " ")).strip()


def norm_keys(s):
    s = norm_ws(s)
    return re.sub(r"(?<=\S)\s*\+\s*(?=\S)", "+", s)


class Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.rows = []          # emitted dicts
        self.unparsed = []      # tables / rows we could not read
        self.tab = None         # current tabpanel platform key
        self.tab_raw = None
        self.h = {"h2": "", "h3": "", "h4": ""}
        self.in_h = None
        self.h_buf = []
        self.in_p = False
        self.p_buf = []
        self.last_p = ""        # last paragraph outside tables: the caption on pages without headings (Edge)
        self.table_idx = -1
        self.in_table = False
        self.header = None      # list of lower-cased header strings
        self.in_thead = False
        self.cur_row = None     # list of cells (each a list of lines)
        self.row_line = 0
        self.row_is_head = False
        self.cell = None        # list of lines
        self.table_ctx = None
        self.skipped_tabs = {}

    # --- helpers ---
    def section(self):
        return " > ".join(x for x in (self.h["h2"], self.h["h3"], self.h["h4"]) if x)

    def new_line(self):
        if self.cell is not None and (not self.cell or self.cell[-1].strip()):
            self.cell.append("")

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "section" and a.get("role") == "tabpanel":
            self.tab_raw = a.get("data-tab")
            self.tab = TAB_PLATFORM.get(self.tab_raw)
        elif tag == "h1":
            self.h = {"h2": "", "h3": "", "h4": ""}  # drops the page chrome heading "Global"
        elif tag in ("h2", "h3", "h4") and not self.in_table:
            self.in_h = tag
            self.h_buf = []
        elif tag == "p" and not self.in_table:
            self.in_p = True
            self.p_buf = []
        elif tag == "table":
            self.table_idx += 1
            self.in_table = True
            self.header = None
            cap = self.last_p if self.last_p.endswith(":") else ""
            self.table_ctx = (self.tab_raw, self.tab, self.section() or cap)
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
            # Word/Excel for Mac print the Command key as an image (mac-cmd.gif); keep it as "Cmd"
            src, alt = a.get("src", ""), a.get("alt", "")
            if src.endswith("mac-cmd.gif"):
                # some rows already print the text "Cmd" right before the image: do not double it
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
        elif tag == "p" and self.in_p:
            self.in_p = False
            self.last_p = norm_ws("".join(self.p_buf))
        elif tag in ("td", "th") and self.cell is not None:
            # a line that is just "or" separates alternatives (Excel for Mac); it is not a key
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
        if self.in_p and not self.in_table:
            self.p_buf.append(data)
        if self.cell is not None:
            self.cell[-1] += data

    def finish_row(self):
        tab_raw, tab, section = self.table_ctx
        cells = self.cur_row
        hdr = self.header
        info = {"table": self.table_idx, "line": self.row_line, "tab": tab_raw, "section": section}
        if hdr is None:
            self.unparsed.append(dict(info, why="row before any header row", cells=[" | ".join(c) for c in cells]))
            return
        # layout 1: [action, keys]; layout 2: [keys, action]; layout 3: [action, windows, mac]
        if len(hdr) == 3 and hdr[1] == "windows" and hdr[2] == "mac" and len(cells) == 3:
            # these tables list Windows and Mac browser keys: they only occur in the "web" tab,
            # so they are not desktop-app keys and are skipped (counted in skipped_non_desktop_cells)
            if tab is None:
                self.skipped_tabs[tab_raw] = self.skipped_tabs.get(tab_raw, 0) + 1
                return
            action = " ".join(cells[0])
            for plat, cell in (("windows", cells[1]), ("mac", cells[2])):
                self.emit(plat, section, action, cell, info)
        elif len(hdr) == 2 and len(cells) == 2 and hdr[0] in ACTION_HDR and hdr[1] in KEY_HDR:
            self.emit(tab, section, " ".join(cells[0]), cells[1], info)
        elif len(hdr) == 2 and len(cells) == 2 and hdr[0] in KEY_HDR and hdr[1] in ACTION_HDR:
            self.emit(tab, section, " ".join(cells[1]), cells[0], info)
        else:
            self.unparsed.append(dict(info, why="unrecognised table layout " + repr(hdr), cells=[" | ".join(c) for c in cells][:3]))

    def emit(self, plat, section, action, keycell, info):
        if plat is None:
            self.skipped_tabs[info["tab"]] = self.skipped_tabs.get(info["tab"], 0) + 1
            return
        if not keycell:
            self.unparsed.append(dict(info, why="empty key cell", action=norm_ws(action)))
            return
        for k in keycell:
            self.rows.append({
                "platform": plat, "section": section, "action": norm_ws(action),
                "keys": norm_keys(k), "line": info["line"], "table": info["table"],
            })


def main():
    out_rows, logs = [], {}
    for fname, (product, url, default_plat) in SOURCES.items():
        with open(os.path.join(HTML_DIR, fname), encoding="utf-8", errors="replace") as fh:
            html = fh.read()
        p = Page()
        # pages without OS tabs: pretend they are one tabpanel of default_plat
        if default_plat:
            p.tab_raw = default_plat
            p.tab = TAB_PLATFORM.get(default_plat, default_plat)
        p.feed(html)
        # old Edge page tab ids are "windows"/"mac"; all handled by TAB_PLATFORM
        for r in p.rows:
            out_rows.append({
                "product": product, "platform": r["platform"], "section": r["section"] or "(no heading)",
                "action": r["action"], "keys": r["keys"], "source_url": url,
                "line_in_html_or_table_index": "L%d/T%d" % (r["line"], r["table"]),
            })
        logs[fname] = {
            "product": product, "url": url, "tables": p.table_idx + 1,
            "rows": len(p.rows), "skipped_non_desktop_cells": p.skipped_tabs,
            "unparsed": p.unparsed,
        }
    out_rows = [r for r in out_rows if r["keys"]]
    path = os.path.join(HERE, "C2-ms-raw.csv")
    cols = ["product", "platform", "section", "action", "keys", "source_url", "line_in_html_or_table_index"]
    with open(path, "w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=cols, quoting=csv.QUOTE_ALL)
        w.writeheader()
        w.writerows(out_rows)
    with open(os.path.join(HERE, "parse_ms.log.json"), "w", encoding="utf-8") as fh:
        json.dump(logs, fh, indent=1, ensure_ascii=False)
    print("rows", len(out_rows))
    for f, l in logs.items():
        print(f, l["tables"], "tables", l["rows"], "rows", len(l["unparsed"]), "unparsed", l["skipped_non_desktop_cells"])


if __name__ == "__main__":
    sys.exit(main())
