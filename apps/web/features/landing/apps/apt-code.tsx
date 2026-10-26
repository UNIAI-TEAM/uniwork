import { Fragment } from "react";

/**
 * A "/" ends a path name and may be followed by a line break, but only when a
 * name stands before it (so a leading "/" stays with its first name) and not
 * inside the "//" of "://".
 */
const AFTER_PATH_NAME = /(?<=[^/:\s]\/)(?=[^/])/;

/**
 * An apt command whose lines wrap only at a space or after a "/" that ends a
 * path name. Every other stretch (a flag such as "-s" or "--", a file name
 * with hyphens, "https://host/") is one nowrap span, so it moves whole to the
 * next line, and a stretch wider than the box scrolls inside the box. The
 * markup adds no text: the text content stays the command, byte for byte.
 */
export function AptCode({ command }: { command: string }) {
  return <pre className="apt-code"><code>{command.split(/(\s+)/).map((piece, index) => (
    piece === "" || /^\s/.test(piece)
      ? piece
      : <Fragment key={index}>{piece.split(AFTER_PATH_NAME).map((name, part) => (
        <Fragment key={part}>{part > 0 && <wbr />}<span className="apt-tok">{name}</span></Fragment>
      ))}</Fragment>
  ))}</code></pre>;
}
