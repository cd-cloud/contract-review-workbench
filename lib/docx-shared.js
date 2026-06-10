(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
    return;
  }
  root.DocxShared = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function decodeXml(text) {
    return String(text || "")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, "\"")
      .replace(/&apos;/g, "'");
  }

  function decodeWordSymbol(font, charCode) {
    const code = parseInt(String(charCode || "").replace(/^0x/i, ""), 16);
    if (!Number.isFinite(code)) return "";
    const fontName = String(font || "").toLowerCase();
    if (fontName.includes("wingdings")) {
      const wingdings = {
        0xf0fc: "✓",
        0xf0fb: "☻",
        0xf0fe: "☾",
        0xf0b7: "•",
        0xf0a7: "▪",
        0xf06c: "◼",
        0xf0d8: "➘",
      };
      return wingdings[code] || "";
    }
    if (fontName.includes("symbol")) {
      const symbol = {
        0xf0b7: "•",
        0xf0d7: "×",
        0xf0fc: "●",
        0xf0a3: "≥",
        0xf0b3: "≤",
        0xf0b1: "±",
      };
      return symbol[code] || "";
    }
    return code ? String.fromCodePoint(code) : "";
  }

  function normalizeDocxTextArtifacts(text) {
    return String(text || "")
      .replace(/（?([0-9一二三四五六七八九十]+)[\uFFFD）]+/g, "（$1）")
      .replace(/\(([0-9a-zA-Z]+)[\uFFFD)]+/g, "($1)")
      .replace(/([0-9一二三四五六七八九十]+)[\uFFFD）]{2,}/g, "$1）");
  }

  function hasDocxRevisionMarkers(acceptedText, rejectedText, revisionText) {
    const safeAccepted = String(acceptedText || "");
    const safeRejected = String(rejectedText || "");
    const safeRevision = String(revisionText || "");
    return safeAccepted !== safeRejected || safeRevision.includes("[-") || safeRevision.includes("{+");
  }

  function formatNumber(value, format) {
    if (format === "upperLetter") return String.fromCharCode(64 + value);
    if (format === "lowerLetter") return String.fromCharCode(96 + value);
    if (format === "upperRoman") return toRoman(value);
    if (format === "lowerRoman") return toRoman(value).toLowerCase();
    if (/chinese|ideograph/i.test(format)) return toChineseNumber(value);
    if (/decimalFullWidth/i.test(format)) return toFullWidthNumber(value);
    return String(value);
  }

  function toChineseNumber(value) {
    const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return String(value);
    if (number <= 10) return number === 10 ? "十" : digits[number];
    if (number < 20) return `十${digits[number % 10]}`;
    if (number < 100) return `${digits[Math.floor(number / 10)]}十${number % 10 ? digits[number % 10] : ""}`;
    return String(value);
  }

  function toFullWidthNumber(value) {
    return String(value).replace(/[0-9]/g, (digit) => String.fromCharCode(0xff10 + Number(digit)));
  }

  function toRoman(value) {
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

  return {
    decodeXml,
    decodeWordSymbol,
    normalizeDocxTextArtifacts,
    hasDocxRevisionMarkers,
    formatNumber,
    toChineseNumber,
    toFullWidthNumber,
    toRoman,
  };
});
