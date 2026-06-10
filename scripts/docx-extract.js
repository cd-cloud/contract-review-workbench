const fs = require("fs");
const zlib = require("zlib");
const {
  decodeXml,
  decodeWordSymbol,
  normalizeDocxTextArtifacts,
  hasDocxRevisionMarkers,
  formatNumber,
} = require("../lib/docx-shared");

function readZipEntries(buffer) {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("未找到 docx zip 目录");
  const centralDirectorySize = buffer.readUInt32LE(eocd + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocd + 16);
  const entries = new Map();
  let offset = centralDirectoryOffset;
  while (offset < centralDirectoryOffset + centralDirectorySize) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + fileNameLength).toString("utf8");
    entries.set(name, { method, compressedSize, uncompressedSize, localHeaderOffset });
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

function readZipTextEntry(buffer, entry) {
  if (!entry) return "";
  const local = entry.localHeaderOffset;
  const nameLength = buffer.readUInt16LE(local + 26);
  const extraLength = buffer.readUInt16LE(local + 28);
  const dataStart = local + 30 + nameLength + extraLength;
  const compressed = buffer.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.method === 0) return compressed.toString("utf8");
  if (entry.method === 8) return zlib.inflateRawSync(compressed).toString("utf8");
  throw new Error(`暂不支持 zip 压缩方法：${entry.method}`);
}

function paragraphText(xml, mode = "accept", numberingContext = null) {
  const parts = [];
  const paragraphPattern = /<w:p[\s\S]*?<\/w:p>/g;
  const textPattern = /<w:ins\b[^>]*>|<\/w:ins>|<w:del\b[^>]*>|<\/w:del>|<(?:w:t|w:delText)(?:\s[^>]*)?>([\s\S]*?)<\/(?:w:t|w:delText)>|<w:sym\b[^>]*\/>|<w:tab\/>|<w:br\/>/g;
  for (const paragraph of xml.match(paragraphPattern) || []) {
    let line = "";
    let match;
    let state = "normal";
    while ((match = textPattern.exec(paragraph))) {
      const token = match[0];
      if (token.startsWith("<w:ins")) {
        state = "insert";
      } else if (token.startsWith("</w:ins")) {
        state = "normal";
      } else if (token.startsWith("<w:del")) {
        state = "delete";
      } else if (token.startsWith("</w:del")) {
        state = "normal";
      } else if (token.startsWith("<w:tab")) {
        line += "\t";
      } else if (token.startsWith("<w:br")) {
        line += "\n";
      } else if (token.startsWith("<w:sym")) {
        line += decodeWordSymbol(attrValue(token, "w:font"), attrValue(token, "w:char"));
      } else {
        const value = decodeXml(match[1]);
        if (state === "delete") {
          if (mode === "reject") line += value;
          if (mode === "markup") line += `[-${value}-]`;
        } else if (state === "insert") {
          if (mode === "accept") line += value;
          if (mode === "markup") line += `{+${value}+}`;
        } else {
          line += value;
        }
      }
    }
    const prefix = numberingContext ? nextNumberingPrefix(paragraph, numberingContext) : "";
    if (line.trim()) parts.push(`${prefix}${line.trim()}`);
  }
  return parts;
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

function legacyNormalizeWordTextArtifacts(text) {
  return String(text || "")
    .replace(/（([0-9一二三四五六七八九十]+)[�）]+/g, "（$1）")
    .replace(/\(([0-9a-zA-Z]+)[�)]+/g, "($1)")
    .replace(/([0-9一二三四五六七八九十]+)[�）]{2,}/g, "$1）");
}

function attrValue(xml, name) {
  const escaped = name.replace(":", "\\:");
  return xml.match(new RegExp(`${escaped}="([^"]+)"`))?.[1] || "";
}

function extractTag(xml, tagName) {
  return xml.match(new RegExp(`<${tagName}\\b[\\s\\S]*?<\\/${tagName}>`))?.[0] || "";
}

function parseDocxStyles(stylesXml) {
  const styles = new Map();
  for (const styleXml of stylesXml.match(/<w:style\b[\s\S]*?<\/w:style>/g) || []) {
    if (!/w:type="paragraph"/.test(styleXml)) continue;
    const styleId = attrValue(styleXml, "w:styleId");
    if (!styleId) continue;
    styles.set(styleId, {
      basedOn: styleXml.match(/<w:basedOn\b[^>]*w:val="([^"]+)"/)?.[1] || "",
      numId: styleXml.match(/<w:numId\b[^>]*w:val="([^"]+)"/)?.[1] || "",
      ilvl: styleXml.match(/<w:ilvl\b[^>]*w:val="([^"]+)"/)?.[1] || "",
    });
  }
  return styles;
}

function parseDocxNumbering(numberingXml) {
  const abstractNums = new Map();
  for (const abstractXml of numberingXml.match(/<w:abstractNum\b[\s\S]*?<\/w:abstractNum>/g) || []) {
    const abstractId = attrValue(abstractXml, "w:abstractNumId");
    const levels = new Map();
    for (const levelXml of abstractXml.match(/<w:lvl\b[\s\S]*?<\/w:lvl>/g) || []) {
      const ilvl = attrValue(levelXml, "w:ilvl") || "0";
      levels.set(ilvl, {
        start: Number(levelXml.match(/<w:start\b[^>]*w:val="([^"]+)"/)?.[1] || 1),
        numFmt: levelXml.match(/<w:numFmt\b[^>]*w:val="([^"]+)"/)?.[1] || "decimal",
        lvlText: levelXml.match(/<w:lvlText\b[^>]*w:val="([^"]+)"/)?.[1] || `%${Number(ilvl) + 1}.`,
      });
    }
    if (abstractId) abstractNums.set(abstractId, levels);
  }

  const nums = new Map();
  for (const numXml of numberingXml.match(/<w:num\b[\s\S]*?<\/w:num>/g) || []) {
    const numId = attrValue(numXml, "w:numId");
    const abstractId = numXml.match(/<w:abstractNumId\b[^>]*w:val="([^"]+)"/)?.[1] || "";
    if (numId && abstractId) nums.set(numId, abstractId);
  }
  return { abstractNums, nums };
}

function createNumberingContext(numberingXml, stylesXml) {
  const numbering = parseDocxNumbering(numberingXml || "");
  return {
    ...numbering,
    styles: parseDocxStyles(stylesXml || ""),
    counters: new Map(),
  };
}

function paragraphStyleId(paragraph) {
  return paragraph.match(/<w:pStyle\b[^>]*w:val="([^"]+)"/)?.[1] || "";
}

function paragraphNumbering(paragraph, context) {
  const pPr = extractTag(paragraph, "w:pPr");
  const directNumId = pPr.match(/<w:numId\b[^>]*w:val="([^"]+)"/)?.[1] || "";
  const directIlvl = pPr.match(/<w:ilvl\b[^>]*w:val="([^"]+)"/)?.[1] || "";
  if (directNumId) return { numId: directNumId, ilvl: directIlvl || "0" };

  let styleId = paragraphStyleId(paragraph);
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

function nextNumberingPrefix(paragraph, context) {
  const paragraphNum = paragraphNumbering(paragraph, context);
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
    return formatNumber(value, fmt);
  });
  prefix = decodeXml(prefix).replace(/\s+/g, "");
  return prefix ? `${prefix} ` : "";
}

function legacyFormatNumber(value, format) {
  if (format === "upperLetter") return String.fromCharCode(64 + value);
  if (format === "lowerLetter") return String.fromCharCode(96 + value);
  if (format === "upperRoman") return toRoman(value);
  if (format === "lowerRoman") return toRoman(value).toLowerCase();
  if (/chinese|ideograph/i.test(format)) return toChineseNumber(value);
  if (/decimalFullWidth/i.test(format)) return toFullWidthNumber(value);
  return String(value);
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

function legacyToRoman(value) {
  const pairs = [
    [1000, "M"],
    [900, "CM"],
    [500, "D"],
    [400, "CD"],
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
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

function commentsText(xml) {
  const comments = xml.match(/<w:comment\b[\s\S]*?<\/w:comment>/g) || [];
  return comments
    .map((comment, index) => {
      const text = paragraphText(comment, "accept").join("");
      return text.trim() ? `${index + 1}. ${text.trim()}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

function extractDocxText(filePath) {
  const buffer = fs.readFileSync(filePath);
  return extractDocxPackage(buffer).acceptedText;
}

function extractDocxBuffer(buffer) {
  return extractDocxPackage(buffer).acceptedText;
}

function extractDocxPackage(buffer) {
  const entries = readZipEntries(buffer);
  const names = ["word/document.xml", ...[...entries.keys()].filter((name) => /^word\/(?:header|footer)\d+\.xml$/i.test(name))];
  const xmls = names.map((name) => readZipTextEntry(buffer, entries.get(name)));
  const numberingXml = readZipTextEntry(buffer, entries.get("word/numbering.xml"));
  const stylesXml = readZipTextEntry(buffer, entries.get("word/styles.xml"));
  const acceptedParagraphs = xmls.flatMap((xml) => paragraphText(xml, "accept", createNumberingContext(numberingXml, stylesXml)));
  const rejectedParagraphs = xmls.flatMap((xml) => paragraphText(xml, "reject", createNumberingContext(numberingXml, stylesXml)));
  const revisionParagraphs = xmls.flatMap((xml) => paragraphText(xml, "markup", createNumberingContext(numberingXml, stylesXml)));
  const commentsXml = readZipTextEntry(buffer, entries.get("word/comments.xml"));
  const normalizedAcceptedParagraphs = acceptedParagraphs.map(normalizeDocxTextArtifacts);
  const normalizedRejectedParagraphs = rejectedParagraphs.map(normalizeDocxTextArtifacts);
  const normalizedRevisionParagraphs = revisionParagraphs.map(normalizeDocxTextArtifacts);
  const acceptedText = normalizedAcceptedParagraphs.filter(Boolean).join("\n\n");
  const rejectedText = normalizedRejectedParagraphs.filter(Boolean).join("\n\n");
  const revisionText = normalizedRevisionParagraphs.filter(Boolean).join("\n\n");
  return {
    plainText: acceptedText,
    acceptedText,
    rejectedText,
    revisionText,
    commentsText: normalizeDocxTextArtifacts(commentsText(commentsXml)),
    paragraphs: normalizedAcceptedParagraphs,
    revisionParagraphs: normalizedRevisionParagraphs,
    rejectedParagraphs: normalizedRejectedParagraphs,
    hasRevisions: hasDocxRevisionMarkers(acceptedText, rejectedText, revisionText),
  };
}

if (require.main === module) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: node scripts/docx-extract.js <file.docx>");
    process.exit(1);
  }
  process.stdout.write(extractDocxText(filePath));
}

module.exports = { extractDocxText, extractDocxBuffer, extractDocxPackage };
