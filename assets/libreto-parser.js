/*
 * libreto-parser.js — parsea Libreto_Aladdin.md (la única fuente de verdad
 * del guion) directamente en el navegador, con las mismas reglas que la
 * herramienta de conversión a PDF: así el sitio siempre refleja el
 * libreto actual sin ningún paso de build intermedio.
 *
 * Para actualizar el sitio tras editar el libreto: copia el .md nuevo a
 * public/data/Libreto_Aladdin.md (ver public/sync_libreto.sh) y listo.
 */
(function (global) {
  "use strict";

  const CUE_RE_A = /^\*\*([^*:]+?):\*\*\s*(.*)$/;
  const CUE_RE_B = /^\*\*([^*]+?)\*\*\s*\*\(([^)]*)\)\*\s*:\s*(.*)$/;
  const FULLLINE_ACTION_RE = /^\*\((.*)\)\*$/;

  function escapeHtml(text) {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function inlineMarkupToHtml(text) {
    let out = escapeHtml(text);
    out = out.replace(/\*\(([^)]*)\)\*/g, "<em>($1)</em>");
    out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    out = out.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    return out;
  }

  function splitIntoBlocks(text) {
    const blocks = [];
    let current = [];
    for (const raw of text.split("\n")) {
      const line = raw.replace(/\r$/, "");
      if (line.trim() === "") {
        if (current.length) { blocks.push(current); current = []; }
      } else {
        current.push(line);
      }
    }
    if (current.length) blocks.push(current);
    return blocks;
  }

  function slugify(text, seen) {
    let s = text
      .normalize("NFKD")
      .replace(new RegExp("[̀-ͯ]", "g"), "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!s) s = "escena";
    const base = s;
    let n = 2;
    while (seen.has(s)) { s = `${base}-${n}`; n++; }
    seen.add(s);
    return s;
  }

  function extractCastAndBody(blocks) {
    const body = [];
    let i = 0;
    while (i < blocks.length) {
      const block = blocks[i];
      const first = block[0].trim();
      if (/^#\s/.test(first) && !first.startsWith("##")) { i++; continue; }
      if (/^##\s*personajes/i.test(first)) {
        i++;
        while (i < blocks.length) {
          const f2 = blocks[i][0].trim();
          if (f2.startsWith("#") || f2 === "---") break;
          i++;
        }
        continue;
      }
      body.push(block);
      i++;
    }
    return body;
  }

  function buildScenes(bodyBlocks) {
    const scenes = [];
    let current = null;
    let currentAct = "ACTO I";
    let lastSpeakerOpen = false;
    const seenIds = new Set();

    for (const block of bodyBlocks) {
      const first = block[0].trim();

      if (first.startsWith("## ")) {
        const title = first.replace(/^#{1,3}\s*/, "").trim();
        if (/^—\s*FIN DEL PRIMER ACTO/i.test(title)) continue;
        if (/^—\s*INICIO DEL SEGUNDO ACTO/i.test(title)) { currentAct = "ACTO II"; continue; }
        current = { id: slugify(title, seenIds), act: currentAct, title, blocks: [] };
        scenes.push(current);
        lastSpeakerOpen = false;
        continue;
      }

      if (first.startsWith("### ")) {
        const title = first.replace(/^#{1,3}\s*/, "").trim();
        if (current) current.blocks.push({ type: "song", text: inlineMarkupToHtml(title) });
        lastSpeakerOpen = false;
        continue;
      }

      if (first === "---") continue;
      if (first.startsWith(">")) continue; // notas de producción: se omiten en la web
      if (!current) continue;

      if (block.every(l => FULLLINE_ACTION_RE.test(l.trim()))) {
        const txt = block.map(l => FULLLINE_ACTION_RE.exec(l.trim())[1]).join(" ");
        current.blocks.push({ type: "action", html: inlineMarkupToHtml(txt) });
        lastSpeakerOpen = false;
        continue;
      }

      if (block.length === 1 && /^\*[^*].*[^*]\*$/.test(first) && !first.startsWith("**")) {
        const txt = first.replace(/^\*|\*$/g, "");
        current.blocks.push({ type: "action", html: inlineMarkupToHtml(txt) });
        lastSpeakerOpen = false;
        continue;
      }

      const m = CUE_RE_B.exec(block[0]) || CUE_RE_A.exec(block[0]);
      if (m) {
        let name, note, rest;
        if (m.length === 4) { name = m[1].trim(); note = (m[2] || "").trim(); rest = (m[3] || "").trim(); }
        else { name = m[1].trim(); note = ""; rest = (m[2] || "").trim(); }
        const remaining = block.slice(1);
        const noteHtml = note ? `<em>(${inlineMarkupToHtml(note)})</em> ` : "";

        if (rest && remaining.length === 0) {
          current.blocks.push({ type: "dialogue", character: name.toUpperCase(), html: noteHtml + inlineMarkupToHtml(rest) });
        } else if (rest && remaining.length) {
          const lines = [inlineMarkupToHtml(rest)].concat(remaining.map(l => inlineMarkupToHtml(l.trim())));
          current.blocks.push({ type: "dialogue", character: name.toUpperCase(), html: noteHtml + lines.join("<br>") });
        } else if (!rest && remaining.length) {
          const lines = remaining.map(l => l.trim()).filter(l => l !== "").map(inlineMarkupToHtml);
          current.blocks.push({ type: "lyric", character: name.toUpperCase(), lines });
        } else {
          current.blocks.push({ type: "dialogue", character: name.toUpperCase(), html: noteHtml });
        }
        lastSpeakerOpen = true;
        continue;
      }

      const joined = block.map(l => inlineMarkupToHtml(l.trim())).join("<br>");
      current.blocks.push({ type: lastSpeakerOpen ? "continuation" : "action", html: joined });
    }

    return scenes;
  }

  function parse(mdText) {
    const blocks = splitIntoBlocks(mdText);
    const body = extractCastAndBody(blocks);
    return { scenes: buildScenes(body) };
  }

  global.LibretoParser = { parse };
})(window);
