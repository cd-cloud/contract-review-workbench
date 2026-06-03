/**
 * Shared contract text splitting utilities (UMD: works in browser and Node.js).
 * In the browser, loading this script defines the functions in global scope.
 * In Node.js, require() returns an object with the functions.
 *
 * Extracted from server/legal-skill-adapter.js and scripts/legal-skill-runner.js
 * to eliminate duplicate definitions and inconsistent clause IDs.
 */
(function (root, factory) {
  const exports = factory(root);
  if (typeof module === "object" && module.exports) {
    module.exports = exports;
  }
}(typeof self !== "undefined" ? self : this, function (global) {
  // --- Re-use shared parsing helpers if available ---
  const isChapterHeading = typeof global !== "undefined" && global.isChapterHeading
    ? global.isChapterHeading
    : function (line) { return /^第[一二三四五六七八九十百零〇两0-9]+章(?:\s|　)*(.*)?$/.test(String(line || "").trim()); };
  const isMainArticleHeading = typeof global !== "undefined" && global.isMainArticleHeading
    ? global.isMainArticleHeading
    : function (line) { return /^第[一二三四五六七八九十百零〇两0-9]+条(?:\s|　)*(.*)?$/.test(String(line || "").trim()); };
  const isDecimalClauseHeading = typeof global !== "undefined" && global.isDecimalClauseHeading
    ? global.isDecimalClauseHeading
    : function (line) {
        const trimmed = String(line || "").trim();
        const match = trimmed.match(/^([0-9]+(?:\.[0-9]+)+)\s+(.+)$/);
        if (!match) return false;
        const tail = match[2].trim();
        if (tail.length > 32) return false;
        return /^(定义|释义|保密义务|保密责任|保密信息|知识产权|陈述与保证|违约责任|争议解决|适用法律|通知|其他|附则|生效|期限|终止|解除|费用|付款|交付|验收|数据|个人信息|合规|反商业贿赂|不可抗力|附件)/.test(tail);
      };
  const extractExplicitArticleTitle = typeof global !== "undefined" && global.extractExplicitArticleTitle
    ? global.extractExplicitArticleTitle
    : function (line) {
        const trimmed = String(line || "").trim();
        const match = trimmed.match(/^(第[一二三四五六七八九十百零〇两0-9]+条)(?:\s|　)*(.*)?$/);
        if (!match) return trimmed;
        const titleText = (match[2] || "").trim();
        if (!titleText) return match[1];
        return titleText.length <= 32 && /^[\u4e00-\u9fa5a-zA-Z0-9\s\-]+$/.test(titleText) ? trimmed : match[1];
      };
  const extractClauseTitle = typeof global !== "undefined" && global.extractClauseTitle
    ? global.extractClauseTitle
    : function (chunk, index) {
        const lines = String(chunk || "").split("\n").map((l) => l.trim()).filter(Boolean);
        if (!lines.length) return "";
        const first = lines[0];
        if (isMainArticleHeading(first)) return extractExplicitArticleTitle(first);
        if (/^第[一二三四五六七八九十百零〇两0-9]+章/.test(first)) return first;
        if (/^([0-9]+(?:\.[0-9]+)+)\s+/.test(first)) return first;
        if (index === 0) {
          const compact = first.replace(/\s+/g, "");
          if (compact.length <= 24 && !/[。；;，,：:]$/.test(compact)) return first;
        }
        return "";
      };

  function splitClauses(text, options = {}) {
    const normalized = String(text || "").replace(/\r/g, "").trim();
    const structuredClauses = splitStructuredClauses(normalized);
    const headingChunks = structuredClauses.length >= 2 ? [] : splitHeadingStyleClauses(normalized);
    const paragraphChunks = normalized.split(/\n{2,}/).map((chunk) => chunk.trim()).filter(Boolean);
    const chunks = structuredClauses.length >= 2 ? structuredClauses : headingChunks.length >= 3 ? headingChunks : paragraphChunks;
    const idPrefix = options.idPrefix || "clause";
    return chunks.map((item, index) => {
      const chunk = typeof item === "string" ? item : item.text;
      const title = typeof item === "string" ? extractClauseTitle(chunk, index) : item.title || extractClauseTitle(chunk, index);
      return {
        id: `${idPrefix}-${index + 1}`,
        number: index + 1,
        title,
        type: classifyClause(chunk, title),
        text: chunk,
        chapterTitle: typeof item === "string" ? "" : item.chapterTitle || "",
        hierarchyLevel: typeof item === "string" ? "paragraph" : item.hierarchyLevel || "article",
      };
    });
  }

  function splitStructuredClauses(text) {
    const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    const chunks = [];
    let preface = [];
    let current = null;
    let currentChapter = "";
    const hasArticleHeadings = lines.some((line) => isMainArticleHeading(line));
    const pushCurrent = () => {
      if (current?.lines?.length) {
        chunks.push({
          text: current.lines.join("\n"),
          title: current.title,
          chapterTitle: current.chapterTitle,
          hierarchyLevel: "article",
        });
      }
    };
    lines.forEach((line) => {
      if (isChapterHeading(line)) {
        currentChapter = line;
        if (!current) preface.push(line);
        return;
      }
      if (isMainArticleHeading(line) || (!hasArticleHeadings && isDecimalClauseHeading(line))) {
        if (!current && preface.length) {
          const prefaceText = preface.filter((item) => item !== currentChapter).join("\n").trim();
          if (prefaceText) chunks.push({ text: prefaceText, title: extractClauseTitle(prefaceText, 0), chapterTitle: "", hierarchyLevel: "preface" });
        }
        pushCurrent();
        current = { title: extractExplicitArticleTitle(line), chapterTitle: currentChapter, lines: [line] };
        return;
      }
      if (current) current.lines.push(line);
      else preface.push(line);
    });
    pushCurrent();
    if (!chunks.length && preface.length) chunks.push({ text: preface.join("\n"), title: extractClauseTitle(preface.join("\n"), 0), chapterTitle: "", hierarchyLevel: "preface" });
    return chunks;
  }

  function splitHeadingStyleClauses(text) {
    const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    const headingIndexes = [];
    lines.forEach((line, index) => {
      if (isStandaloneClauseHeading(line, index)) headingIndexes.push(index);
    });
    if (headingIndexes.length < 3) return [];

    const chunks = [];
    if (headingIndexes[0] > 0) chunks.push(lines.slice(0, headingIndexes[0]).join("\n"));
    headingIndexes.forEach((start, index) => {
      const end = index + 1 < headingIndexes.length ? headingIndexes[index + 1] : lines.length;
      const chunk = lines.slice(start, end).join("\n").trim();
      if (chunk) chunks.push(chunk);
    });
    return chunks.filter(Boolean);
  }

  function isStandaloneClauseHeading(line, index) {
    const compact = line.replace(/\s+/g, "");
    if (!compact || compact.length > 24) return false;
    if (/^[""''「」《》（(]/.test(compact)) return false;
    if (/[。；;，,：:]$/.test(compact)) return false;
    if (/^(甲方|乙方|丙方|丁方|地址|联系人|电话|邮箱|签署|签字|盖章)/.test(compact)) return false;
    if (index === 0 && /(合同|协议|备忘录|条款书)$/.test(compact)) return true;
    return /^(鉴于|前言|背景|定义|释义|保密义务|保密责任|保密信息|保密义务的期限|知识产权|陈述与保证|违约责任|法律适用与争议解决|争议解决|适用法律|通知|其他|附则|生效|期限|终止|解除|费用|付款|交付|验收|数据|个人信息|合规|反商业贿赂|不可抗力|附件)/.test(compact);
  }

  function classifyClause(text, title = "") {
    const source = `${title}\n${text}`;
    const rules = [
      ["公司治理", /股东会|董事会|表决权|一票否决|保护性权利|重大事项|治理/],
      ["出资与股权", /出资|认缴|实缴|注册资本|股权|股份|持股比例|增资/],
      ["创始人限制", /创始人|锁定|竞业|全职|离职|回购|服务期/],
      ["股权转让", /转让|优先购买|共同出售|随售|领售|转股/],
      ["投资人权利", /优先认购|反稀释|清算优先|信息权|检查权|最惠国|优先权/],
      ["服务范围", /服务内容|服务范围|工作内容|SaaS|API|交付/],
      ["付款", /付款|费用|账期|发票|支付|价款/],
      ["知识产权", /知识产权|软件|算法|模型|著作权|专利|商标/],
      ["数据使用", /数据|训练|输出|输入|语料|客户数据/],
      ["个人信息保护", /个人信息|隐私|个人数据|处理目的|删除|安全措施/],
      ["保密", /保密|商业秘密|秘密信息|NDA/i],
      ["责任限制", /责任限制|赔偿责任|间接损失|累计赔偿/],
      ["期限与终止", /期限|有效期|终止|解除/],
      ["争议解决", /争议|管辖|仲裁|法院|法律/],
    ];
    return (rules.find(([, pattern]) => pattern.test(source)) || ["其他"])[0];
  }

  // Expose to global scope in browser so existing scripts can use them directly.
  if (typeof global !== "undefined") {
    global.splitClauses = splitClauses;
    global.splitStructuredClauses = splitStructuredClauses;
    global.splitHeadingStyleClauses = splitHeadingStyleClauses;
    global.isStandaloneClauseHeading = isStandaloneClauseHeading;
    global.classifyClause = classifyClause;
  }

  return {
    splitClauses,
    splitStructuredClauses,
    splitHeadingStyleClauses,
    isStandaloneClauseHeading,
    classifyClause,
  };
}));
