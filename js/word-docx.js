const docxShared = globalThis.DocxShared || {};
const decodeXml = docxShared.decodeXml || ((text) => String(text || "")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&amp;/g, "&")
  .replace(/&quot;/g, "\"")
  .replace(/&apos;/g, "'"));
const decodeWordSymbol = docxShared.decodeWordSymbol || function fallbackDecodeWordSymbol(font, charCode) {
  const code = parseInt(String(charCode || "").replace(/^0x/i, ""), 16);
  if (!Number.isFinite(code)) return "";
  return code ? String.fromCodePoint(code) : "";
};
const normalizeDocxTextArtifacts = docxShared.normalizeDocxTextArtifacts || ((text) => String(text || ""));
const hasDocxRevisionMarkers = docxShared.hasDocxRevisionMarkers || ((acceptedText, rejectedText, revisionText) => {
  const safeAccepted = String(acceptedText || "");
  const safeRejected = String(rejectedText || "");
  const safeRevision = String(revisionText || "");
  return safeAccepted !== safeRejected || safeRevision.includes("[-") || safeRevision.includes("{+");
});
const formatDocxNumber = docxShared.formatNumber || ((value) => String(value));

function detectMaterialKind(text) {
  if (!text.trim()) return "empty";
  if (/发件人|收件人|主题|From:|To:|Subject:|请确认|请法务|修改建议|反馈|回复|邮件|客户要求|业务可接受/i.test(text)) {
    return "comments";
  }
  if (/红线|修订|删除|新增|对比|修订稿|修改稿|track changes|\[-|\{\+|^\+|^-|→|=>/im.test(text)) {
    return "redline";
  }
  return "version";
}

async function readUploadedFile(file) {
  const fileBuffer = await file.arrayBuffer();
  const originalBufferBase64 = arrayBufferToBase64(fileBuffer);
  if (/\.docx$/i.test(file.name) || file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    // Prefer backend parsing for fidelity and consistency; browser parsing is only an offline fallback.
    const buffer = fileBuffer;
    const backendParsed = await parseDocxOnBackend(file.name, buffer);
    if (backendParsed) {
      const kind = backendParsed.hasRevisions ? "redline" : detectMaterialKind(backendParsed.acceptedText || backendParsed.plainText || "");
      return {
        sourceType: "docx-backend",
        fileName: file.name,
        kind,
        displayText: normalizeDocxTextArtifacts(backendParsed.hasRevisions ? backendParsed.revisionText : backendParsed.acceptedText),
        plainText: normalizeDocxTextArtifacts(backendParsed.plainText),
        acceptedText: normalizeDocxTextArtifacts(backendParsed.acceptedText),
        rejectedText: normalizeDocxTextArtifacts(backendParsed.rejectedText || ""),
        revisionText: normalizeDocxTextArtifacts(backendParsed.revisionText || backendParsed.acceptedText),
        commentsText: normalizeDocxTextArtifacts(backendParsed.commentsText || ""),
        paragraphs: (backendParsed.paragraphs || []).map(normalizeDocxTextArtifacts),
        hasRevisions: Boolean(backendParsed.hasRevisions),
        hasComments: Boolean(backendParsed.commentsText),
        originalBufferBase64,
      };
    }
    if (typeof showToast === "function") showToast("正在解析 Word 文档，大文件可能需要几秒...", "info");
    // Yield to browser so the toast renders before the synchronous parse blocks the main thread
    await new Promise((resolve) => setTimeout(resolve, 50));
    const parsed = await parseDocxBuffer(buffer);
    if (typeof hideToast === "function") hideToast();
    const kind = parsed.hasRevisions ? "redline" : detectMaterialKind(parsed.acceptedText || parsed.plainText || "");
    return {
      sourceType: "docx",
      fileName: file.name,
      kind,
      displayText: normalizeDocxTextArtifacts(parsed.hasRevisions ? parsed.revisionText : parsed.acceptedText),
      plainText: normalizeDocxTextArtifacts(parsed.plainText),
      acceptedText: normalizeDocxTextArtifacts(parsed.acceptedText),
      rejectedText: normalizeDocxTextArtifacts(parsed.rejectedText),
      revisionText: normalizeDocxTextArtifacts(parsed.revisionText),
      commentsText: normalizeDocxTextArtifacts(parsed.commentsText),
      paragraphs: parsed.paragraphs.map(normalizeDocxTextArtifacts),
      hasRevisions: parsed.hasRevisions,
      hasComments: Boolean(parsed.commentsText),
      originalBufferBase64,
    };
  }
  const text = await file.text();
  const kind = detectMaterialKind(text);
  return {
    sourceType: "text",
    fileName: file.name,
    kind,
    displayText: text,
    plainText: text,
    acceptedText: kind === "redline" ? acceptRedlineText(text) : text,
    rejectedText: kind === "redline" ? rejectRedlineText(text) : "",
    revisionText: text,
    commentsText: "",
    paragraphs: text.split(/\n{2,}/).filter(Boolean),
    hasRevisions: kind === "redline",
    hasComments: kind === "comments",
    originalBufferBase64,
  };
}

async function parseDocxOnBackend(fileName, buffer) {
  try {
    const response = await legalWorkbenchFetch("/api/docx/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: fileName,
        contentBase64: arrayBufferToBase64(buffer),
      }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (!data.ok || !data.text) return null;
    return {
      plainText: data.text,
      acceptedText: data.acceptedText || data.text,
      rejectedText: data.rejectedText || "",
      revisionText: data.revisionText || data.acceptedText || data.text,
      commentsText: data.commentsText || "",
      paragraphs: data.paragraphs || data.text.split(/\n{2,}/).filter(Boolean),
      hasRevisions: Boolean(data.hasRevisions),
    };
  } catch (error) {
    // Debug: backend docx parser unavailable; using browser parser.
    return null;
  }
}

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function uint8ArrayToBase64(uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < uint8Array.length; i += chunkSize) {
    binary += String.fromCharCode(...uint8Array.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function parseDocxBuffer(buffer) {
  const entries = readZipEntries(buffer);
  const documentXml = await readZipTextEntry(buffer, entries.get("word/document.xml"));
  const numberingXml = await readZipTextEntry(buffer, entries.get("word/numbering.xml"));
  const stylesXml = await readZipTextEntry(buffer, entries.get("word/styles.xml"));
  const commentsXml = entries.has("word/comments.xml") ? await readZipTextEntry(buffer, entries.get("word/comments.xml")) : "";
  const headerFooterXml = await readDocxHeaderFooterXml(buffer, entries);
  const acceptedParagraphs = wordDocumentXmlToBlocks(documentXml, "accept", createBrowserNumberingContext(numberingXml, stylesXml));
  const rejectedParagraphs = wordDocumentXmlToBlocks(documentXml, "reject", createBrowserNumberingContext(numberingXml, stylesXml));
  const revisionParagraphs = wordDocumentXmlToBlocks(documentXml, "markup", createBrowserNumberingContext(numberingXml, stylesXml));
  const headerFooterParagraphs = headerFooterXml.flatMap((xml) => wordDocumentXmlToBlocks(xml, "accept", createBrowserNumberingContext(numberingXml, stylesXml)));
  const acceptedText = normalizeDocxTextArtifacts(acceptedParagraphs.join("\n\n"));
  const rejectedText = normalizeDocxTextArtifacts(rejectedParagraphs.join("\n\n"));
  const revisionText = normalizeDocxTextArtifacts(revisionParagraphs.join("\n\n"));
  const commentsText = normalizeDocxTextArtifacts(commentsXml ? wordCommentsXmlToText(commentsXml) : "");
  const normalizedHeaderFooterParagraphs = headerFooterParagraphs.map(normalizeDocxTextArtifacts);
  const normalizedAcceptedParagraphs = acceptedParagraphs.map(normalizeDocxTextArtifacts);
  return {
    plainText: [...normalizedHeaderFooterParagraphs, acceptedText].filter(Boolean).join("\n\n"),
    acceptedText: [...normalizedHeaderFooterParagraphs, acceptedText].filter(Boolean).join("\n\n"),
    rejectedText,
    revisionText,
    commentsText,
    paragraphs: [...normalizedHeaderFooterParagraphs, ...normalizedAcceptedParagraphs],
    revisionParagraphs: revisionParagraphs.map(normalizeDocxTextArtifacts),
    rejectedParagraphs: rejectedParagraphs.map(normalizeDocxTextArtifacts),
    headerFooterParagraphs: normalizedHeaderFooterParagraphs,
    hasRevisions: hasDocxRevisionMarkers(acceptedText, rejectedText, revisionText),
  };
}

async function readDocxHeaderFooterXml(buffer, entries) {
  const names = [...entries.keys()].filter((name) => /^word\/(?:header|footer)\d+\.xml$/i.test(name));
  return await Promise.all(names.map((name) => readZipTextEntry(buffer, entries.get(name))));
}

function readZipEntries(buffer) {
  const view = new DataView(buffer);
  let eocd = -1;
  for (let i = view.byteLength - 22; i >= 0; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("未找到 docx zip 目录");
  const centralDirectorySize = view.getUint32(eocd + 12, true);
  const centralDirectoryOffset = view.getUint32(eocd + 16, true);
  const entries = new Map();
  let offset = centralDirectoryOffset;
  const decoder = new TextDecoder();
  while (offset < centralDirectoryOffset + centralDirectorySize) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const nameBytes = new Uint8Array(buffer, offset + 46, fileNameLength);
    const name = decoder.decode(nameBytes);
    entries.set(name, { method, compressedSize, uncompressedSize, localHeaderOffset });
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

async function readZipTextEntry(buffer, entry) {
  if (!entry) return "";
  const view = new DataView(buffer);
  const local = entry.localHeaderOffset;
  const nameLength = view.getUint16(local + 26, true);
  const extraLength = view.getUint16(local + 28, true);
  const dataStart = local + 30 + nameLength + extraLength;
  const compressed = buffer.slice(dataStart, dataStart + entry.compressedSize);
  let bytes;
  if (entry.method === 0) {
    bytes = new Uint8Array(compressed);
  } else if (entry.method === 8) {
    bytes = new Uint8Array(await inflateRaw(compressed));
  } else {
    throw new Error(`暂不支持 zip 压缩方法：${entry.method}`);
  }
  return new TextDecoder("utf-8").decode(bytes);
}

async function inflateRaw(buffer) {
  if (!("DecompressionStream" in window)) {
    throw new Error("当前浏览器不支持本地解压 docx，请后续使用后端解析。");
  }
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return await new Response(stream).arrayBuffer();
}

function wordDocumentXmlToText(xml, mode = "accept") {
  return wordDocumentXmlToBlocks(xml, mode).join("\n\n");
}

function wordDocumentXmlToParagraphs(xml, mode = "accept") {
  return wordDocumentXmlToBlocks(xml, mode);
}

function wordDocumentXmlToBlocks(xml, mode = "accept", numberingContext = null) {
  if (!xml) return [];
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const body = doc.getElementsByTagName("w:body")[0] || doc.documentElement;
  return [...body.childNodes]
    .flatMap((node) => wordBlockToText(node, mode, numberingContext))
    .map((text) => text.trim())
    .filter(Boolean);
}

function wordBlockToText(node, mode, numberingContext) {
  if (node.nodeName === "w:p") return [wordParagraphToText(node, mode, numberingContext)];
  if (node.nodeName === "w:tbl") return [wordTableToText(node, mode, numberingContext)];
  return [...node.childNodes].flatMap((child) => wordBlockToText(child, mode, numberingContext));
}

function wordTableToText(table, mode, numberingContext) {
  return [...table.getElementsByTagName("w:tr")]
    .map((row) =>
      [...row.getElementsByTagName("w:tc")]
        .map((cell) =>
          [...cell.getElementsByTagName("w:p")]
            .map((paragraph) => wordParagraphToText(paragraph, mode, numberingContext).trim())
            .filter(Boolean)
            .join(" / ")
        )
        .filter(Boolean)
        .join(" | ")
    )
    .filter(Boolean)
    .join("\n");
}

function wordParagraphToText(paragraph, mode, numberingContext = null) {
  let output = "";
  const walk = (node, state = "normal") => {
    const name = node.nodeName;
    let nextState = state;
    if (name === "w:ins") nextState = "insert";
    if (name === "w:del") nextState = "delete";
    if (name === "w:t" || name === "w:delText") {
      const text = node.textContent || "";
      if (nextState === "delete") {
        if (mode === "reject") output += text;
        if (mode === "markup") output += `[-${text}-]`;
      } else if (nextState === "insert") {
        if (mode === "accept") output += text;
        if (mode === "markup") output += `{+${text}+}`;
      } else {
        output += text;
      }
      return;
    }
    if (name === "w:sym") {
      const symbol = decodeWordSymbol(node.getAttribute("w:font") || "", node.getAttribute("w:char") || "");
      if (symbol) output += symbol;
      return;
    }
    if (name === "w:tab") output += "\t";
    if (name === "w:br" || name === "w:cr") output += "\n";
    node.childNodes.forEach((child) => walk(child, nextState));
  };
  paragraph.childNodes.forEach((child) => walk(child));
  const prefix = numberingContext ? nextBrowserNumberingPrefix(paragraph, numberingContext) : "";
  return `${prefix}${output}`;
}

function legacyDecodeWordSymbol(font, charCode) {
  const code = parseInt(String(charCode || "").replace(/^0x/i, ""), 16);
  if (!Number.isFinite(code)) return "";
  const fontName = String(font || "").toLowerCase();
  if (fontName.includes("wingdings")) {
    const wingdings = {
      0xf0fc: "✓",
      0xf0fb: "☑",
      0xf0fe: "☒",
      0xf0b7: "•",
      0xf0a7: "▪",
      0xf06c: "●",
      0xf0d8: "➢",
    };
    return wingdings[code] || "";
  }
  if (fontName.includes("symbol")) {
    const symbol = {
      0xf0b7: "•",
      0xf0d7: "×",
      0xf0fc: "√",
      0xf0a3: "≤",
      0xf0b3: "≥",
      0xf0b1: "±",
    };
    return symbol[code] || "";
  }
  return code ? String.fromCodePoint(code) : "";
}

function legacyNormalizeDocxTextArtifacts(text) {
  return String(text || "")
    .replace(/（([0-9一二三四五六七八九十]+)[�）]+/g, "（$1）")
    .replace(/\(([0-9a-zA-Z]+)[�)]+/g, "($1)")
    .replace(/([0-9一二三四五六七八九十]+)[�）]{2,}/g, "$1）");
}

function createBrowserNumberingContext(numberingXml, stylesXml) {
  return {
    ...parseBrowserNumbering(numberingXml || ""),
    styles: parseBrowserStyles(stylesXml || ""),
    counters: new Map(),
  };
}

function parseBrowserXml(xml) {
  return new DOMParser().parseFromString(xml || "<root/>", "application/xml");
}

function nodeAttr(node, name) {
  return node?.getAttribute(name) || "";
}

function parseBrowserStyles(stylesXml) {
  const doc = parseBrowserXml(stylesXml);
  const styles = new Map();
  [...doc.getElementsByTagName("w:style")].forEach((style) => {
    if (nodeAttr(style, "w:type") !== "paragraph") return;
    const styleId = nodeAttr(style, "w:styleId");
    if (!styleId) return;
    styles.set(styleId, {
      basedOn: nodeAttr(style.getElementsByTagName("w:basedOn")[0], "w:val"),
      numId: nodeAttr(style.getElementsByTagName("w:numId")[0], "w:val"),
      ilvl: nodeAttr(style.getElementsByTagName("w:ilvl")[0], "w:val"),
    });
  });
  return styles;
}

function parseBrowserNumbering(numberingXml) {
  const doc = parseBrowserXml(numberingXml);
  const abstractNums = new Map();
  [...doc.getElementsByTagName("w:abstractNum")].forEach((abstractNum) => {
    const abstractId = nodeAttr(abstractNum, "w:abstractNumId");
    const levels = new Map();
    [...abstractNum.getElementsByTagName("w:lvl")].forEach((level) => {
      const ilvl = nodeAttr(level, "w:ilvl") || "0";
      levels.set(ilvl, {
        start: Number(nodeAttr(level.getElementsByTagName("w:start")[0], "w:val") || 1),
        numFmt: nodeAttr(level.getElementsByTagName("w:numFmt")[0], "w:val") || "decimal",
        lvlText: nodeAttr(level.getElementsByTagName("w:lvlText")[0], "w:val") || `%${Number(ilvl) + 1}.`,
      });
    });
    if (abstractId) abstractNums.set(abstractId, levels);
  });

  const nums = new Map();
  [...doc.getElementsByTagName("w:num")].forEach((num) => {
    const numId = nodeAttr(num, "w:numId");
    const abstractId = nodeAttr(num.getElementsByTagName("w:abstractNumId")[0], "w:val");
    if (numId && abstractId) nums.set(numId, abstractId);
  });
  return { abstractNums, nums };
}

function paragraphDirectChild(parent, name) {
  return [...(parent?.childNodes || [])].find((node) => node.nodeName === name) || null;
}

function browserParagraphNumbering(paragraph, context) {
  const pPr = paragraphDirectChild(paragraph, "w:pPr");
  const directNumPr = paragraphDirectChild(pPr, "w:numPr");
  const directNumId = nodeAttr(paragraphDirectChild(directNumPr, "w:numId"), "w:val");
  const directIlvl = nodeAttr(paragraphDirectChild(directNumPr, "w:ilvl"), "w:val");
  if (directNumId) return { numId: directNumId, ilvl: directIlvl || "0" };

  let styleId = nodeAttr(paragraphDirectChild(pPr, "w:pStyle"), "w:val");
  let inheritedIlvl = directIlvl || "";
  const visited = new Set();
  while (styleId && !visited.has(styleId)) {
    visited.add(styleId);
    const style = context.styles.get(styleId);
    if (!style) break;
    if (style.ilvl && !inheritedIlvl) inheritedIlvl = style.ilvl;
    if (style.numId) return { numId: style.numId, ilvl: inheritedIlvl || style.ilvl || "0" };
    styleId = style.basedOn;
  }
  return null;
}

function nextBrowserNumberingPrefix(paragraph, context) {
  const paragraphNum = browserParagraphNumbering(paragraph, context);
  if (!paragraphNum) return "";
  const { numId, ilvl } = paragraphNum;
  const abstractId = context.nums.get(numId);
  const levels = context.abstractNums.get(abstractId);
  const level = levels?.get(ilvl);
  if (!level) return "";
  const key = String(numId);
  const counters = context.counters.get(key) || [];
  const levelIndex = Number(ilvl) || 0;
  if (!counters[levelIndex]) counters[levelIndex] = Math.max(1, level.start || 1) - 1;
  counters[levelIndex] += 1;
  counters.length = levelIndex + 1;
  context.counters.set(key, counters);
  let prefix = level.lvlText || `%${levelIndex + 1}.`;
  prefix = prefix.replace(/%([1-9])/g, (_, rawIndex) => {
    const index = Number(rawIndex) - 1;
    const value = counters[index] || 1;
    const fmt = levels.get(String(index))?.numFmt || level.numFmt;
    return formatBrowserNumber(value, fmt);
  });
  prefix = decodeXml(prefix).replace(/\s+/g, "");
  return prefix ? `${prefix} ` : "";
}

function formatBrowserNumber(value, format) {
  return formatDocxNumber(value, format);
}

function legacyToChineseNumber(value) {
  const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return String(value);
  if (number <= 10) return number === 10 ? "十" : digits[number];
  if (number < 20) return `十${digits[number % 10]}`;
  if (number < 100) return `${digits[Math.floor(number / 10)]}十${number % 10 ? digits[number % 10] : ""}`;
  return String(value);
}

function legacyToFullWidthNumber(value) {
  return String(value).replace(/[0-9]/g, (digit) => String.fromCharCode(0xff10 + Number(digit)));
}

function legacyToBrowserRoman(value) {
  const pairs = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let number = value;
  let output = "";
  for (const [unit, label] of pairs) {
    while (number >= unit) {
      output += label;
      number -= unit;
    }
  }
  return output;
}

function wordCommentsXmlToText(xml) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return [...doc.getElementsByTagName("w:comment")]
    .map((comment, index) => {
      const text = [...comment.getElementsByTagName("w:t")].map((node) => node.textContent || "").join("");
      return `${index + 1}. ${text}`;
    })
    .filter((line) => line.trim())
    .join("\n");
}

const MAX_UPLOADED_FILE_CACHE = 20;

function cacheUploadedFileResult(target, result) {
  if (uploadedFileCache.size >= MAX_UPLOADED_FILE_CACHE) {
    const first = uploadedFileCache.keys().next().value;
    uploadedFileCache.delete(first);
  }
  const cacheId = uid("file");
  uploadedFileCache.set(cacheId, result);
  target.dataset.uploadCacheId = cacheId;
  target.dataset.uploadFileName = result.fileName || "";
}

function getUploadedFileResult(selector) {
  const target = document.querySelector(selector);
  const cacheId = target?.dataset.uploadCacheId;
  return cacheId ? uploadedFileCache.get(cacheId) || null : null;
}

function buildVersionPayload(text, uploadResult = null) {
  const kind = uploadResult?.kind || detectMaterialKind(text);
  const acceptedText = uploadResult?.acceptedText || (kind === "redline" ? acceptRedlineText(text) : text);
  const rejectedText = uploadResult?.rejectedText || (kind === "redline" ? rejectRedlineText(text) : "");
  return {
    materialKind: kind,
    versionText: uploadResult?.displayText || text,
    acceptedText,
    rejectedText,
    revisionText: uploadResult?.revisionText || text,
    commentsText: uploadResult?.commentsText || "",
    paragraphs: uploadResult?.paragraphs || text.split(/\n{2,}/).filter(Boolean),
    sourceType: uploadResult?.sourceType || "text",
    fileName: uploadResult?.fileName || "",
    hasRevisions: Boolean(uploadResult?.hasRevisions || kind === "redline"),
    hasComments: Boolean(uploadResult?.hasComments || kind === "comments" || uploadResult?.commentsText),
  };
}

function materialKindLabel(kind) {
  return {
    version: "普通版本文本",
    redline: "疑似红线/修订稿",
    prepared: "拟发送版本",
    comments: "邮件 / 修改建议",
    empty: "无文本",
  }[kind] || "普通版本文本";
}

function buildWordRedlineHtml(contract) {
  const material = getWorkbenchMaterial(contract);
  const clauses = splitVersionClauses(material.text, material.sourceKey);
  const actions = getClauseActions(material.sourceKey);
  const body = clauses
    .map((clause) => {
      const action = actions[clause.id] || {};
      const original = renderWordHtmlClauseText(clause.text);
      const edited = escapeHtml(action.editedText || "").replaceAll("\n", "<br />");
      const comment = action.comment
        ? `<div class="comment"><strong>批注：</strong>${escapeHtml(action.comment).replaceAll("\n", "<br />")}</div>`
        : "";
      if (action.deleted) {
        return `<section><div class="deleted">${original}</div>${comment}</section>`;
      }
      if (action.editedText && action.editedText !== clause.text) {
        return `<section><p>${buildInlineDiffHtmlForWord(clause.text, action.editedText)}</p>${comment}</section>`;
      }
      return `<section>${original}${comment}</section>`;
    })
    .join("");
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(contract.name || "合同修订批注稿")}</title>
  <style>
    body { font-family: "Microsoft YaHei", SimSun, serif; font-size: 12pt; line-height: 1.7; color: #111827; }
    h1 { font-size: 18pt; margin-bottom: 4pt; }
    .meta { color: #667085; margin-bottom: 18pt; }
    section { margin-bottom: 14pt; }
    .clause-line { margin: 0 0 8pt; }
    .line-heading { font-weight: 700; margin-top: 10pt; }
    .line-cn { margin-left: 18pt; text-indent: -18pt; }
    .line-arabic { margin-left: 24pt; text-indent: -18pt; }
    .line-decimal { margin-left: 30pt; text-indent: -21pt; }
    .line-paren { margin-left: 36pt; text-indent: -18pt; }
    .deleted { color: #b42318; text-decoration: line-through; }
    .inserted { color: #067647; text-decoration: underline; font-weight: 600; }
    .comment { border-left: 3pt solid #b54708; background: #fff7ed; padding: 6pt 8pt; margin-top: 5pt; color: #7a2e0e; }
  </style>
</head>
<body>
  <h1>${escapeHtml(contract.name || "合同修订批注稿")}</h1>
  <div class="meta">导出版本：${escapeHtml(material.title)}｜生成时间：${new Date().toLocaleString()}</div>
  ${body}
</body>
</html>`;
}

function renderWordHtmlClauseText(text) {
  return String(text || "")
    .split(/\n+/)
    .map((line, index) => {
      const clean = line.trim();
      if (!clean) return "";
      const className = index === 0 && (isDocxNumberedClauseTitle(clean) || /^第[一二三四五六七八九十百零〇两0-9]+章/.test(clean))
        ? "line-heading"
        : getWordHtmlLineClass(clean);
      return `<p class="clause-line ${className}">${escapeHtml(clean)}</p>`;
    })
    .join("");
}

function getWordHtmlLineClass(text) {
  const source = String(text || "").trim();
  if (/^\d+(?:\.\d+)+[、．.]?\s*/.test(source)) return "line-decimal";
  if (/^[（(][一二三四五六七八九十百零〇两0-9]+[）)]\s*/.test(source)) return "line-paren";
  if (/^[一二三四五六七八九十百零〇两]+[、．.]\s*/.test(source)) return "line-cn";
  if (/^\d{1,2}[、．.]\s*/.test(source)) return "line-arabic";
  return "";
}

function buildDocxPageBreak() {
  return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
}

function buildDocxCoverParagraphs(contract, material) {
  const now = new Date().toLocaleString("zh-CN");
  const spacer = '<w:p><w:pPr><w:spacing w:before="1200"/></w:pPr><w:r><w:t xml:space="preserve"> </w:t></w:r></w:p>';
  return [
    spacer,
    spacer,
    buildDocxParagraph([{ type: "same", text: contract.name || "合同审阅批注稿" }], "Title"),
    buildDocxParagraph([{ type: "same", text: "Legal Work Orchestrator 红线批注稿" }], "Meta"),
    buildDocxParagraph([{ type: "same", text: `导出版本：${material.title}` }], "MetaLine"),
    buildDocxParagraph([{ type: "same", text: `生成时间：${now}` }], "MetaLine"),
    buildDocxParagraph([{ type: "same", text: `相对方：${contract.counterpartyName || "未填写"}` }], "MetaLine"),
    buildDocxParagraph([{ type: "same", text: `我方角色：${contract.ourRole || "未填写"}` }], "MetaLine"),
    buildDocxParagraph([{ type: "same", text: `合同类型：${contract.type || "未识别"}` }], "MetaLine"),
    buildDocxPageBreak(),
  ];
}

function buildEnrichedClauseComment(userComment, clauseFindings, subComments) {
  const parts = [];
  if (userComment) parts.push(userComment);

  clauseFindings.forEach((finding) => {
    const severityLabel = finding.severity === "high" ? "【高风险】" : finding.severity === "medium" ? "【中风险】" : "【低风险】";
    parts.push(`${severityLabel} ${finding.issue || finding.title || ""}`);
    if (finding.proposedRevision || finding.fix) {
      parts.push(`建议文本：${finding.proposedRevision || finding.fix}`);
    }
    if (finding.negotiation || finding.negotiationPosition) {
      parts.push(`谈判立场：${finding.negotiation || finding.negotiationPosition}`);
    }
    if (finding.businessDecision) {
      parts.push(`业务确认：${finding.businessDecision}`);
    }
  });

  if (subComments.length) {
    parts.push(...subComments);
  }

  return parts.join("\n\n");
}

function buildDocxRedlinePackage(contract) {
  const material = getWorkbenchMaterial(contract);
  const clauses = splitVersionClauses(material.text, material.sourceKey);
  const actions = getClauseActions(material.sourceKey);
  const findings = getAnalysisFindings(contract, clauses);
  const comments = [];
  const generatedAt = new Date().toISOString();
  let revisionId = 1;
  let commentId = 0;

  const paragraphs = [
    ...buildDocxCoverParagraphs(contract, material),
    buildDocxParagraph([{ type: "same", text: contract.name || "合同修订批注稿" }], "Title"),
    buildDocxParagraph([{ type: "same", text: `导出版本：${material.title}｜生成时间：${new Date().toLocaleString()}` }], "Meta"),
    ...buildDocxExportIntroParagraphs(contract, material, clauses, actions),
  ];

  clauses.forEach((clause) => {
    const baseAction = actions[clause.id] || {};
    const effectiveText = getEditedClauseText(material.sourceKey, clause);
    const subComments = splitSubclauses(clause).map((subclause) => actions[subclause.id]?.comment).filter(Boolean);
    const clauseFindings = findings.filter((f) => f.clauseId === clause.id);
    const enrichedComment = buildEnrichedClauseComment(baseAction.comment, clauseFindings, subComments);
    const action = {
      ...baseAction,
      editedText: baseAction.editedText || (effectiveText !== clause.text ? effectiveText : ""),
      comment: enrichedComment,
    };
    const currentCommentId = action.comment ? commentId : null;
    if (action.comment) {
      comments.push({
        id: currentCommentId,
        text: action.comment,
        clauseTitle: clause.title,
      });
      commentId += 1;
    }

    const revisionRef = { value: revisionId };
    paragraphs.push(...buildDocxClauseParagraphs(clause, action, currentCommentId, revisionRef, generatedAt));
    revisionId = revisionRef.value;
  });

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphs.join("\n")}
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
  </w:body>
</w:document>`;

  const commentsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  ${comments
    .map(
      (comment) => `<w:comment w:id="${comment.id}" w:author="Legal Work Orchestrator" w:date="${new Date().toISOString()}">
        ${buildDocxCommentBody(comment)}
      </w:comment>`
    )
    .join("\n")}
</w:comments>`;

  return createZip({
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
  <Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
  <Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`,
    "word/_rels/document.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>
</Relationships>`,
    "word/document.xml": documentXml,
    "word/styles.xml": buildDocxStylesXml(),
    "word/numbering.xml": buildDocxNumberingXml(),
    "word/settings.xml": buildDocxSettingsXml(),
    "word/comments.xml": commentsXml,
    "docProps/core.xml": buildDocxCorePropertiesXml(contract),
    "docProps/app.xml": buildDocxAppPropertiesXml(),
  });
}

function buildDeliveryPackageZip(contract) {
  const prepared = buildPreparedSendingVersionText(contract);
  const material = getWorkbenchMaterial(contract);
  const clauses = splitVersionClauses(material.text, material.sourceKey);
  const cleanText = prepared?.text || clauses.map((clause) => getEditedClauseText(material.sourceKey, clause)).join("\n\n");
  const checks = buildAutomaticReviewChecks(contract, material, clauses);
  const skillResult = getStoredSkillResult(contract.id) || {};
  const redlineDocx = buildDocxRedlinePackage(contract);
  const baseName = safeDownloadName(contract.name || "合同审阅交付包");
  return createZip({
    [`${baseName}_对外红线批注稿.docx`]: redlineDocx,
    [`${baseName}_对外清洁稿.txt`]: cleanText,
    [`${baseName}_业务摘要.md`]: buildBusinessSummaryMarkdown(contract, skillResult, checks),
    [`${baseName}_内部审阅报告.md`]: buildInternalReviewReportMarkdown(contract, material, clauses, checks),
    [`${baseName}_发送前检查清单.md`]: buildPreSendChecklistMarkdown(checks),
    [`${baseName}_条款沉淀候选.json`]: JSON.stringify(buildKnowledgeDepositCandidates(contract, material, clauses), null, 2),
  });
}

function buildBusinessSummaryMarkdown(contract, skillResult, checks) {
  const summary = skillResult.businessSummary || "暂无 Skill 业务摘要。";
  const highChecks = checks.filter((check) => check.severity === "high").length;
  const mediumChecks = checks.filter((check) => check.severity === "medium").length;
  return [
    `# ${contract.name} 业务摘要`,
    "",
    `- 合同类型：${contract.type || "未识别"}`,
    `- 我方角色：${contract.ourRole || "未识别"}`,
    `- 相对方：${contract.counterpartyName || "未识别"}`,
    `- 整体风险：${riskLabel(contract.riskLevel || "low")}`,
    `- 发送前检查：高风险 ${highChecks} 项，中风险 ${mediumChecks} 项`,
    "",
    "## 摘要",
    "",
    summary,
  ].join("\n");
}

function buildInternalReviewReportMarkdown(contract, material, clauses, checks) {
  const findings = getAnalysisFindings(contract, clauses);
  const actions = getClauseActions(material.sourceKey);
  const actionLines = Object.entries(actions)
    .filter(([, action]) => action.editedText || action.deleted || action.comment)
    .map(([clauseId, action]) => {
      const clause = clauses.find((item) => item.id === clauseId) || {};
      return `- ${clause.title || clauseId}：${action.deleted ? "删除；" : ""}${action.editedText ? "修改；" : ""}${action.comment ? `批注：${action.comment}` : ""}`;
    });
  const riskLines = findings.slice(0, 30).map((finding) => `- [${riskLabel(finding.severity)}] ${finding.title || finding.issue}：${finding.issue || ""} ${finding.fix ? `建议：${finding.fix}` : ""}`);
  return [
    `# ${contract.name} 内部审阅报告`,
    "",
    `生成时间：${new Date().toLocaleString()}`,
    `材料版本：${material.title}`,
    "",
    "## 风险清单",
    "",
    riskLines.join("\n") || "暂无风险记录。",
    "",
    "## 本次处理记录",
    "",
    actionLines.join("\n") || "暂无显式修改、删除或批注。",
    "",
    "## 发送前检查",
    "",
    buildPreSendChecklistMarkdown(checks),
  ].join("\n");
}

function buildPreSendChecklistMarkdown(checks) {
  if (!checks.length) return "# 发送前检查清单\n\n- 自动核查未发现明显编号、引用或核心条款问题。";
  return [
    "# 发送前检查清单",
    "",
    ...checks.map((check) => `- [${riskLabel(check.severity)}] ${check.title}：${check.detail || ""}`),
  ].join("\n");
}

function buildKnowledgeDepositCandidates(contract, material, clauses) {
  const actions = getClauseActions(material.sourceKey);
  return clauses
    .map((clause) => ({
      contractId: contract.id,
      contractName: contract.name,
      counterpartyName: contract.counterpartyName,
      type: clause.type,
      title: clause.title,
      finalText: getEditedClauseText(material.sourceKey, clause),
      action: actions[clause.id] || {},
      sourceVersion: material.title,
    }))
    .filter((item) => item.finalText && (item.action.editedText || item.action.comment || item.action.deleted || item.type !== "其他"));
}

function buildDocxClauseParagraphs(clause, action, commentId, revisionRef, generatedAt) {
  const original = splitClauseTextForDocx(clause.text, clause.title);
  const normalizedEditedText = action.editedText
    ? normalizeClauseTextNumbering(clause.contractId || "", clause, action.editedText)
    : action.editedText;
  const edited = normalizedEditedText ? splitClauseTextForDocx(normalizedEditedText, clause.title) : null;
  const titleStyle = getDocxClauseTitleStyle(clause, original.title);
  const titleParts = buildDocxTitleParts(original.title, edited?.title, clause, action, revisionRef, generatedAt);
  const bodyParts = buildDocxClauseBodyParts(original.body, edited?.body, action, revisionRef, generatedAt, clause.inserted);
  const output = [buildDocxParagraph(titleParts, titleStyle, commentId)];
  partitionDocxPartsIntoParagraphs(bodyParts).forEach((paragraphParts) => {
    const text = paragraphParts.map((part) => part.text || "").join("");
    output.push(buildDocxParagraph(paragraphParts, getDocxBodyParagraphStyle(text)));
  });
  return output;
}

function getDocxClauseTitleStyle(clause, title) {
  if (clause.hierarchyLevel === "chapter" || /^第[一二三四五六七八九十百零〇两0-9]+章/.test(String(title || ""))) return "ChapterHeading";
  if (isDocxNumberedClauseTitle(title)) return "ClauseHeading";
  if (clause.hierarchyLevel === "preface") return "PrefaceHeading";
  return "DocumentHeading";
}

function buildDocxExportIntroParagraphs(contract, material, clauses, actions) {
  const findings = getAnalysisFindings(contract, clauses);
  const high = findings.filter((item) => item.severity === "high");
  const medium = findings.filter((item) => item.severity === "medium");
  const actionCount = Object.values(actions).filter((action) => action.deleted || action.editedText || action.comment).length;
  const presentTypes = new Set(clauses.map((clause) => clause.type));
  const coreTypes = ["服务范围", "付款", "知识产权", "数据使用", "个人信息保护", "保密", "责任限制", "期限与终止", "争议解决"];
  const completion = Math.round((coreTypes.filter((type) => presentTypes.has(type)).length / coreTypes.length) * 100);
  const topRisks = high.concat(medium).slice(0, 5).map((item) => item.title).join("；") || "未识别到需在交付说明中单列的重大风险";
  const items = [
    "审阅交付说明",
    `合同名称：${contract.name || "未命名合同"}`,
    `相对方：${contract.counterpartyName || "未填写"}`,
    `当前版本：${material.title}`,
    `风险摘要：重大风险 ${high.length} 项，中风险 ${medium.length} 项；合同完成度约 ${completion}%。`,
    `重点关注：${topRisks}`,
    `修订批注：本文档已将审阅台保存的条款修改、删除和批注写入 Word 修订/批注；建议接收方在 Word 中打开“审阅/修订”视图查看。`,
    `交付状态：共记录 ${actionCount} 处修改或批注。发送前仍建议由经办人结合交易背景复核商业条件、授权签署和附件完整性。`,
  ];
  return items.map((item, index) => buildDocxParagraph([{ type: "same", text: item }], index === 0 ? "DocumentHeading" : "MetaLine"));
}

function buildDocxTitleParts(originalTitle, editedTitle, clause, action, revisionRef, generatedAt) {
  if (action.deleted) {
    return [{ type: "delete", text: originalTitle, id: revisionRef.value++, date: generatedAt }];
  }
  if (clause.inserted) {
    return [{ type: "insert", text: editedTitle || originalTitle, id: revisionRef.value++, date: generatedAt }];
  }
  if (editedTitle && editedTitle !== originalTitle) {
    return buildInlineDiffParts(originalTitle, editedTitle).map((part) =>
      part.type === "same" ? part : { ...part, id: revisionRef.value++, date: generatedAt }
    );
  }
  return [{ type: "same", text: originalTitle }];
}

function buildDocxClauseBodyParts(originalBody, editedBody, action, revisionRef, generatedAt, inserted = false) {
  if (action.deleted) {
    return originalBody ? [{ type: "delete", text: originalBody, id: revisionRef.value++, date: generatedAt }] : [];
  }
  if (inserted) {
    return (editedBody || originalBody) ? [{ type: "insert", text: editedBody || originalBody, id: revisionRef.value++, date: generatedAt }] : [];
  }
  if (editedBody && editedBody !== originalBody) {
    return buildInlineDiffParts(originalBody, editedBody).map((part) =>
      part.type === "same" ? part : { ...part, id: revisionRef.value++, date: generatedAt }
    );
  }
  return originalBody ? [{ type: "same", text: originalBody }] : [];
}

function splitClauseTextForDocx(text, fallbackTitle = "") {
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  const first = (lines.shift() || "").trim();
  if (first && (isDocxNumberedClauseTitle(first) || first === fallbackTitle || first.length <= 40)) {
    return {
      title: first,
      body: lines.join("\n").trim(),
    };
  }
  return {
    title: fallbackTitle || "条款",
    body: [first, ...lines].join("\n").trim(),
  };
}

function partitionDocxPartsIntoParagraphs(parts) {
  const paragraphs = [[]];
  parts.forEach((part) => {
    const chunks = String(part.text || "").split(/\n+/);
    chunks.forEach((chunk, index) => {
      if (index > 0) paragraphs.push([]);
      if (chunk) paragraphs.at(-1).push({ ...part, text: chunk });
    });
  });
  return paragraphs.filter((paragraph) => paragraph.some((part) => String(part.text || "").trim()));
}

function isDocxNumberedClauseTitle(text) {
  return /^(?:第[一二三四五六七八九十百0-9]+条|[0-9]+[.、])/.test(String(text || "").trim());
}

function getDocxBodyParagraphStyle(text) {
  const source = String(text || "").trim();
  if (/^\d+(?:\.\d+)+[、．.]?\s*/.test(source)) return "SubclauseDecimal";
  if (/^[（(][一二三四五六七八九十百零〇两0-9]+[）)]\s*/.test(source)) return "SubclauseParen";
  if (/^[一二三四五六七八九十百零〇两]+[、．.]\s*/.test(source)) return "SubclauseChinese";
  if (/^\d{1,2}[、．.]\s*/.test(source)) return "SubclauseArabic";
  return "ClauseBody";
}

function buildDocxParagraph(parts, style = "", commentId = null, pPrExtra = "") {
  const styleXml = style ? `<w:pStyle w:val="${style}"/>` : "";
  const pPrXml = styleXml || pPrExtra ? `<w:pPr>${styleXml}${pPrExtra}</w:pPr>` : "";
  const commentStart = commentId !== null ? `<w:commentRangeStart w:id="${commentId}"/>` : "";
  const commentEnd =
    commentId !== null
      ? `<w:commentRangeEnd w:id="${commentId}"/><w:r><w:commentReference w:id="${commentId}"/></w:r>`
      : "";
  return `<w:p>${pPrXml}${commentStart}${parts.map(buildDocxRun).join("")}${commentEnd}</w:p>`;
}

function buildDocxRun(part) {
  const runs = String(part.text || "")
    .split("\n")
    .flatMap((segment, index, list) => {
      const nodes = [];
      if (segment) nodes.push(`<w:r>${buildDocxRunProperties(part.type)}${buildDocxText(segment, part.type)}</w:r>`);
      if (index < list.length - 1) nodes.push("<w:r><w:br/></w:r>");
      return nodes;
    })
    .join("");
  if (part.type === "insert") {
    return `<w:ins w:id="${part.id || 1}" w:author="Legal Work Orchestrator" w:date="${part.date || new Date().toISOString()}">${runs}</w:ins>`;
  }
  if (part.type === "delete") {
    return `<w:del w:id="${part.id || 1}" w:author="Legal Work Orchestrator" w:date="${part.date || new Date().toISOString()}">${runs}</w:del>`;
  }
  return runs;
}

function buildDocxRunProperties(type) {
  if (type === "insert") return `<w:rPr><w:color w:val="00875A"/><w:u w:val="single"/></w:rPr>`;
  if (type === "delete") return `<w:rPr><w:color w:val="C0392B"/><w:strike/></w:rPr>`;
  return "";
}

function buildDocxText(text, type) {
  const tag = type === "delete" ? "w:delText" : "w:t";
  return `<${tag} xml:space="preserve">${escapeXml(text)}</${tag}>`;
}

function buildDocxCommentBody(comment) {
  return String(`${comment.clauseTitle}：${comment.text}`)
    .split(/\n+/)
    .filter((line) => line.trim())
    .map((line) => buildDocxParagraph([{ type: "same", text: line }], "CommentText"))
    .join("\n");
}

function buildDocxStylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault><w:rPr><w:rFonts w:ascii="Microsoft YaHei" w:eastAsia="Microsoft YaHei" w:hAnsi="Microsoft YaHei"/><w:sz w:val="24"/><w:lang w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr><w:spacing w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Meta"><w:name w:val="Meta"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="360"/></w:pPr><w:rPr><w:color w:val="667085"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="MetaLine"><w:name w:val="Meta Line"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="80"/></w:pPr><w:rPr><w:color w:val="344054"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="ChapterHeading"><w:name w:val="Chapter Heading"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:spacing w:before="320" w:after="160"/><w:keepNext/></w:pPr><w:rPr><w:b/><w:sz w:val="30"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="DocumentHeading"><w:name w:val="Document Heading"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="PrefaceHeading"><w:name w:val="Preface Heading"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="160" w:after="80"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="ClauseHeading"><w:name w:val="Clause Heading"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="80"/><w:keepNext/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="ClauseBody"><w:name w:val="Clause Body"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:firstLine="480"/><w:spacing w:before="0" w:after="160" w:line="360" w:lineRule="auto"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="SubclauseChinese"><w:name w:val="Subclause Chinese"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="360" w:hanging="360"/><w:spacing w:after="120" w:line="360" w:lineRule="auto"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="SubclauseArabic"><w:name w:val="Subclause Arabic"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="480" w:hanging="360"/><w:spacing w:after="120" w:line="360" w:lineRule="auto"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="SubclauseDecimal"><w:name w:val="Subclause Decimal"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="600" w:hanging="420"/><w:spacing w:after="120" w:line="360" w:lineRule="auto"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="SubclauseParen"><w:name w:val="Subclause Parentheses"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720" w:hanging="360"/><w:spacing w:after="120" w:line="360" w:lineRule="auto"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="CommentText"><w:name w:val="Comment Text"/><w:basedOn w:val="Normal"/><w:rPr><w:color w:val="7A2E0E"/></w:rPr></w:style>
</w:styles>`;
}

function buildDocxSettingsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:trackRevisions/>
  <w:displayBackgroundShape/>
  <w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>
</w:settings>`;
}

function buildDocxCorePropertiesXml(contract) {
  const now = new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${escapeXml(contract.name || "合同修订批注稿")}</dc:title>
  <dc:subject>合同审阅红线批注稿</dc:subject>
  <dc:creator>Legal Work Orchestrator</dc:creator>
  <cp:lastModifiedBy>Legal Work Orchestrator</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`;
}

function buildDocxAppPropertiesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Legal Work Orchestrator</Application>
</Properties>`;
}

function buildDocxNumberingXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="1">
    <w:multiLevelType w:val="singleLevel"/>
    <w:lvl w:ilvl="0">
      <w:start w:val="1"/>
      <w:numFmt w:val="chineseCountingThousand"/>
      <w:lvlText w:val="第%1条"/>
      <w:lvlJc w:val="left"/>
      <w:pPr><w:ind w:left="0" w:hanging="0"/></w:pPr>
    </w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;
}

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
    .replaceAll("\r", "&#13;")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

function createZip(entries) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  Object.entries(entries).forEach(([name, content]) => {
    const nameBytes = encoder.encode(name);
    const data = content instanceof Uint8Array ? content : encoder.encode(content);
    const crc = crc32(data);
    const localHeader = concatUint8([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
    ]);
    localParts.push(localHeader, data);

    centralParts.push(
      concatUint8([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(data.length),
        u32(data.length),
        u16(nameBytes.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        nameBytes,
      ])
    );
    offset += localHeader.length + data.length;
  });

  const centralDirectory = concatUint8(centralParts);
  const endRecord = concatUint8([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(centralParts.length),
    u16(centralParts.length),
    u32(centralDirectory.length),
    u32(offset),
    u16(0),
  ]);
  return concatUint8([...localParts, centralDirectory, endRecord]);
}

function u16(value) {
  return new Uint8Array([value & 255, (value >>> 8) & 255]);
}

function u32(value) {
  return new Uint8Array([value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255]);
}

function concatUint8(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  parts.forEach((part) => {
    result.set(part, offset);
    offset += part.length;
  });
  return result;
}

function crc32(bytes) {
  let crc = -1;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ bytes[i]) & 255];
  }
  return (crc ^ -1) >>> 0;
}

function buildInlineDiffHtmlForWord(oldText, newText) {
  return buildInlineDiffParts(oldText, newText)
    .map((part) => {
      const text = escapeHtml(part.text).replaceAll("\n", "<br />");
      if (part.type === "delete") return `<span class="deleted">${text}</span>`;
      if (part.type === "insert") return `<span class="inserted">${text}</span>`;
      return text;
    })
    .join("");
}

function downloadBlob(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function safeDownloadName(name) {
  return String(name || "合同")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

const CRC32_TABLE = (() => {
  const table = [];
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let j = 0; j < 8; j += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table.push(value >>> 0);
  }
  return table;
})();
