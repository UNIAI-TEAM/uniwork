#!/usr/bin/env python3
"""Harness-owned org.gnome.keyring.SystemPrompter that cancels every prompt (G7-03b FL-09, INJECTED).

On a real desktop a locked login keyring makes gnome-keyring ask the user for the
password through gcr-prompter; the user answers or cancels. A headless VM has nobody
to answer it: the activated gcr-prompter cannot reach a display/session bus, never
replies, and the app's browser process stalls inside the Secret Service call until
the launch times out. This stub takes that name on the harness's own session bus
first (so the bus never activates gcr-prompter) and answers each prompt the way a
user who dismisses the dialog does. It never unlocks anything and never sees a
password: the reply is "no" with no properties.

Protocol (gcr system prompter, org.gnome.keyring.internal.Prompter, as in gcr 3.40 /
gnome-keyring 40-46): BeginPrompting(callback) -> the prompter calls
callback.PromptReady("", {}, "") once it is ready; PerformPrompt(callback, type,
properties, exchange) -> callback.PromptReady("no", {}, ""); StopPrompting(callback) ->
callback.PromptDone().

Usage: app-keyring-prompter.py <log-file>   (one JSON line per event; exits on SIGTERM)
"""
import json
import signal
import sys
import time

import gi

gi.require_version("Gio", "2.0")
from gi.repository import Gio, GLib  # noqa: E402

NAME = "org.gnome.keyring.SystemPrompter"
PATH = "/org/gnome/keyring/Prompter"
CALLBACK_IFACE = "org.gnome.keyring.internal.Prompter.Callback"
XML = """<node><interface name="org.gnome.keyring.internal.Prompter">
  <method name="BeginPrompting"><arg type="o" name="callback" direction="in"/></method>
  <method name="PerformPrompt">
    <arg type="o" name="callback" direction="in"/><arg type="s" name="type" direction="in"/>
    <arg type="a{sv}" name="properties" direction="in"/><arg type="s" name="exchange" direction="in"/>
  </method>
  <method name="StopPrompting"><arg type="o" name="callback" direction="in"/></method>
</interface></node>"""

LOG = sys.argv[1] if len(sys.argv) > 1 else None
LOOP = GLib.MainLoop()


def log(event, **fields):
    if not LOG:
        return
    with open(LOG, "a", encoding="utf-8") as out:
        out.write(json.dumps({"t": round(time.time(), 3), "event": event, **fields}) + "\n")


def call_back(conn, sender, callback, method, params):
    # after the method's own reply has gone out: the daemon is not blocked on us
    def send():
        conn.call(sender, callback, CALLBACK_IFACE, method, params, None, Gio.DBusCallFlags.NONE, -1, None, None, None)
        return False

    GLib.idle_add(send)


def on_method(conn, sender, _path, _iface, method, params, invocation):
    callback = params.unpack()[0]
    if method == "BeginPrompting":
        log("begin")
        invocation.return_value(None)
        call_back(conn, sender, callback, "PromptReady", GLib.Variant("(sa{sv}s)", ("", {}, "")))
    elif method == "PerformPrompt":
        kind = params.unpack()[1]
        log("prompt", type=kind, answered="cancel")
        invocation.return_value(None)
        call_back(conn, sender, callback, "PromptReady", GLib.Variant("(sa{sv}s)", ("no", {}, "")))
    elif method == "StopPrompting":
        log("stop")
        invocation.return_value(None)
        call_back(conn, sender, callback, "PromptDone", None)
    else:
        invocation.return_dbus_error("org.freedesktop.DBus.Error.UnknownMethod", method)


def on_bus(conn, _name):
    conn.register_object(PATH, Gio.DBusNodeInfo.new_for_xml(XML).interfaces[0], on_method, None, None)


def on_acquired(_conn, _name):
    log("ready")
    print("APP_KEYRING_PROMPTER ready", flush=True)


def on_lost(_conn, _name):
    log("name-lost")
    print("APP_KEYRING_PROMPTER name-lost", file=sys.stderr, flush=True)
    LOOP.quit()


Gio.bus_own_name(Gio.BusType.SESSION, NAME, Gio.BusNameOwnerFlags.DO_NOT_QUEUE, on_bus, on_acquired, on_lost)
for sig in (signal.SIGTERM, signal.SIGINT):
    GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, sig, LOOP.quit)
LOOP.run()
