/**
 * Shared contract text parsing utilities (UMD: works in browser and Node.js).
 * In the browser, loading this script defines the functions in global scope.
 * In Node.js, require() returns an object with the functions.
 *
 * Extracted from js/contract-parser.js, server/legal-skill-adapter.js,
 * scripts/legal-skill-runner.js to eliminate triplicate definitions.
 */
(function (root, factory) {
  const exports = factory(root);
  if (typeof module === "object" && module.exports) {
    module.exports = exports;
  }
}(typeof self !== "undefined" ? self : this, function (global) {
  function isChapterHeading(line) {
    return /^第[一二三四五六七八九十百零〇两0-9]+章(?:\s|　)*(.*)?$/.test(String(line || "").trim());
  }

  function isArticleHeading(line) {
    return /^第[一二三四五六七八九十百零〇两0-9]+条(?:\s|　)*(.*)?$/.test(String(line || "").trim());
  }

  function isMainArticleHeading(line) {
    const trimmed = String(line || "").trim();
    return /^第[一二三四五六七八九十百零〇两0-9]+条(?:\s|　)*(.*)?$/.test(trimmed);
  }

  function isDecimalClauseHeading(line) {
    const trimmed = String(line || "").trim();
    const match = trimmed.match(/^([0-9]+(?:\.[0-9]+)+)\s+(.+)$/);
    if (!match) return false;
    return isExplicitHeadingText(match[2].trim(), 32);
  }

  function extractExplicitArticleTitle(line) {
    const trimmed = String(line || "").trim();
    const match = trimmed.match(/^(第[一二三四五六七八九十百零〇两0-9]+条)(?:\s|　)*(.*)?$/);
    if (!match) return isExplicitHeadingLine(trimmed) ? trimmed : "";
    const titleText = (match[2] || "").trim();
    if (!titleText) return match[1];
    return isExplicitHeadingText(titleText) ? trimmed : "";
  }

  function isExplicitHeadingLine(line) {
    const trimmed = String(line || "").trim();
    if (!trimmed) return false;
    const article = trimmed.match(/^第[一二三四五六七八九十百零〇两0-9]+条(?:\s|　)*(.*)?$/);
    if (article) return !article[1] || isExplicitHeadingText(article[1]);
    const chapter = trimmed.match(/^第[一二三四五六七八九十百零〇两0-9]+章(?:\s|　)*(.*)?$/);
    if (chapter) return !chapter[1] || isExplicitHeadingText(chapter[1]);
    return isExplicitHeadingText(trimmed, 24);
  }

  function isExplicitHeadingText(text, maxLength) {
    maxLength = maxLength === undefined ? 28 : maxLength;
    const titleText = String(text || "").trim();
    if (!titleText || titleText.length > maxLength) return false;
    if (/^[""''「」《》（(]/.test(titleText)) return false;
    if (/[。；;，,、]$/.test(titleText)) return false;
    if (/[。；;]/.test(titleText)) return false;
    if (/(是指|指，|指,|应当|应就|应以|应向|不得|不得以|可以|有权|无权|同意|确认|构成|不会|违反|包括|如下|除外|前提是|为免疑义|任何一方|接收方|提供方|违约方|守约方|甲方|乙方|双方|公司|企业|应当|负责|承担|支付|提供|交付|保证|承诺|发生|造成|导致|视为)/.test(titleText)) return false;
    return true;
  }

  function extractClauseTitle(chunk, index) {
    const lines = String(chunk || "").split("\n").map((line) => line.trim()).filter(Boolean);
    const chapterLine = lines.find((line) => isChapterHeading(line) && isExplicitHeadingLine(line));
    if (chapterLine) return chapterLine;
    const articleLine = lines.find((line) => isArticleHeading(line));
    if (articleLine) return extractExplicitArticleTitle(articleLine);
    const firstLine = lines[0] || "";
    return isExplicitHeadingLine(firstLine) ? firstLine : "";
  }

  function isDocumentControlNotice(text) {
    const lines = String(text || "").split("\n").map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return true;
    const compact = lines.join("");
    if (compact.length > 120) return false;
    const noticePatterns = [
      /^严格保密$/,
      /^保密$/,
      /^机密$/,
      /^confidential$/i,
      /^strictly confidential$/i,
      /仅供(讨论|审阅|参考|内部使用)/,
      /不得(外传|传播|披露|转发)/,
      /未经.*(许可|同意).*不得/,
      /草案|草稿|draft/i,
      /privileged|attorney[- ]client/i,
    ];
    if (noticePatterns.some((pattern) => pattern.test(compact))) return true;
    if (lines.length <= 3 && lines.every((line) => /^(严格)?保密|机密|confidential|draft|草案|草稿$/i.test(line))) return true;
    return false;
  }

  function isContractTitleOnly(text) {
    const lines = String(text || "").split("\n").map((line) => line.trim()).filter(Boolean);
    if (!lines.length || lines.length > 2) return false;
    const compact = lines.join("");
    if (compact.length > 60) return false;
    if (isArticleHeading(compact) || isChapterHeading(compact)) return false;
    if (/[：:；;。]/.test(compact)) return false;
    return /(合同|协议|订单|备忘录|条款书|NDA)$/i.test(compact) || /(合同|协议|订单|备忘录|条款书|NDA)$/i.test(lines[0]);
  }

  function isPartyInfoChunk(text) {
    const lines = String(text || "").split("\n").map((line) => line.trim()).filter(Boolean);
    if (!lines.length || lines.length > 12) return false;
    return lines.every(isPartyInfoLine) || (lines.some(isPartyInfoLine) && lines.join("").length <= 300);
  }

  function isPartyInfoLine(line) {
    const compact = String(line || "").replace(/\s+/g, "");
    return /^(甲方|乙方|丙方|丁方|披露方|接收方|提供方|服务方|采购方|委托方|受托方|签约主体|注册地址|地址|联系地址|通讯地址|统一社会信用代码|法定代表人|授权代表|联系人|联系电话|电话|手机|邮箱|电子邮箱|PartyA|PartyB|DisclosingParty|ReceivingParty)[：:]/i.test(compact);
  }

  // Expose to global scope in browser so existing scripts can use them directly.
  if (typeof global !== "undefined") {
    global.isChapterHeading = isChapterHeading;
    global.isArticleHeading = isArticleHeading;
    global.isMainArticleHeading = isMainArticleHeading;
    global.isDecimalClauseHeading = isDecimalClauseHeading;
    global.extractExplicitArticleTitle = extractExplicitArticleTitle;
    global.isExplicitHeadingLine = isExplicitHeadingLine;
    global.isExplicitHeadingText = isExplicitHeadingText;
    global.extractClauseTitle = extractClauseTitle;
    global.isDocumentControlNotice = isDocumentControlNotice;
    global.isContractTitleOnly = isContractTitleOnly;
    global.isPartyInfoChunk = isPartyInfoChunk;
    global.isPartyInfoLine = isPartyInfoLine;
  }

  return {
    isChapterHeading,
    isArticleHeading,
    isMainArticleHeading,
    isDecimalClauseHeading,
    extractExplicitArticleTitle,
    isExplicitHeadingLine,
    isExplicitHeadingText,
    extractClauseTitle,
    isDocumentControlNotice,
    isContractTitleOnly,
    isPartyInfoChunk,
    isPartyInfoLine,
  };
}));
