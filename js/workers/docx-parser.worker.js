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
  if (doc.querySelector("parsererror")) throw new Error("DOCX 内部 XML 解析失败，文件可能已损坏。");
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
  if (doc.querySelector("parsererror")) return "";
  return [...doc.getElementsByTagName("w:comment")]
    .map((comment, index) => {
      const text = [...comment.getElementsByTagName("w:t")].map((node) => node.textContent || "").join("");
      return `${index + 1}. ${text}`;
    })
    .filter((line) => line.trim())
    .join("\n");
}


self.onmessage = async (e) => {
  const { buffer } = e.data;
  try {
    const result = await parseDocxBuffer(buffer);
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({ error: error.message || String(error) });
  }
};
