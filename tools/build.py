from __future__ import annotations

import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
dictionary = json.loads((root / "data" / "exact-translations.json").read_text())
template = r'''(() => {
  "use strict";

  const EXACT = Object.freeze(__DICTIONARY__);
  const ROOT_SELECTOR = '[data-component="AgentCatalogView"], [data-component="FeatureAgentDetailHost"]';
  const ledger = new Map();
  const attributeLedger = new Map();
  let bodyObserver = null;
  let languageObserver = null;
  let scheduled = false;
  let applying = false;
  let stopped = false;

  function isKorean() {
    const locale = String(document.documentElement.lang || "").toLowerCase();
    return locale === "ko" || locale.startsWith("ko-");
  }

  function replaceText(node, translated) {
    const current = node.nodeValue;
    const previous = ledger.get(node);
    if (!previous || current !== previous.translated) {
      ledger.set(node, { original: current, translated });
    }
    node.nodeValue = translated;
  }

  function translateTextNode(node) {
    if (!node.parentElement) return;
    if (node.parentElement.closest('script, style, input, textarea, [contenteditable="true"]')) return;
    const current = node.nodeValue;
    const leading = current.match(/^\s*/u)?.[0] ?? "";
    const trailing = current.match(/\s*$/u)?.[0] ?? "";
    const core = current.slice(leading.length, current.length - trailing.length);
    const translated = EXACT[core];
    if (!translated) return;
    replaceText(node, `${leading}${translated}${trailing}`);
  }

  function translateAttributes(element) {
    for (const attribute of ["aria-label", "title", "placeholder"]) {
      const current = element.getAttribute(attribute);
      const translated = current ? EXACT[current] : null;
      if (!translated) continue;
      let records = attributeLedger.get(element);
      if (!records) {
        records = new Map();
        attributeLedger.set(element, records);
      }
      const previous = records.get(attribute);
      if (!previous || current !== previous.translated) {
        records.set(attribute, { original: current, translated });
      }
      element.setAttribute(attribute, translated);
    }
  }

  function translateRoot(rootNode) {
    if (rootNode.nodeType === Node.ELEMENT_NODE) translateAttributes(rootNode);
    rootNode.querySelectorAll?.("[aria-label], [title], [placeholder]").forEach(translateAttributes);
    const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      translateTextNode(node);
    }
  }

  function translateAgentsPanelHeader() {
    for (const panel of document.querySelectorAll('[data-component="RightPanel"]')) {
      const activeAgents = panel.querySelector('[data-panel-key="agents"]:not([aria-hidden="true"])');
      if (!activeAgents) continue;
      translateAttributes(panel);
      translateRoot(activeAgents);
      const heading = panel.querySelector("h2");
      if (heading) translateRoot(heading);
    }
  }

  function revertAll() {
    applying = true;
    try {
      for (const [node, entry] of ledger) {
        if (node.isConnected && node.nodeValue === entry.translated) {
          node.nodeValue = entry.original;
        }
      }
      ledger.clear();
      for (const [element, records] of attributeLedger) {
        if (!element.isConnected) continue;
        for (const [attribute, entry] of records) {
          if (element.getAttribute(attribute) === entry.translated) {
            element.setAttribute(attribute, entry.original);
          }
        }
      }
      attributeLedger.clear();
    } finally {
      applying = false;
    }
  }

  function scan() {
    if (stopped) return;
    if (!isKorean()) {
      revertAll();
      return;
    }
    applying = true;
    try {
      document.querySelectorAll(ROOT_SELECTOR).forEach(translateRoot);
      translateAgentsPanelHeader();
    } finally {
      applying = false;
    }
  }

  function schedule() {
    if (stopped || applying || scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      scan();
    });
  }

  function start() {
    if (stopped || bodyObserver || !document.body) return;
    bodyObserver = new MutationObserver(schedule);
    bodyObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["aria-label", "title", "placeholder"],
    });
    languageObserver = new MutationObserver(schedule);
    languageObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
    scan();
  }

  function cleanup() {
    if (stopped) return;
    stopped = true;
    bodyObserver?.disconnect();
    languageObserver?.disconnect();
    bodyObserver = null;
    languageObserver = null;
    revertAll();
  }

  marinara.onCleanup(cleanup);
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
})();
'''
output = template.replace("__DICTIONARY__", json.dumps(dictionary, ensure_ascii=False, indent=2))
(root / "extension.js").write_text(output)
print(json.dumps({"entries": len(dictionary), "bytes": len(output.encode())}))
