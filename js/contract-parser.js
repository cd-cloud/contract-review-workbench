function classifyContract(text) {
  const rules = [
    ["数据采购合同", /数据采购|数据提供|数据集|样本数据|标注数据/],
    ["SaaS 服务合同", /SaaS|软件即服务|订阅|API|平台服务|账号/],
    ["技术服务合同", /技术服务|开发|实施|部署|运维|接口/],
    ["保密协议", /保密协议|NDA|保密义务/],
    ["模型训练合作协议", /模型训练|微调|训练数据|算法模型/],
    ["商业合作协议", /合作|渠道|推广|联合|代理/],
  ];
  const match = rules.find(([, pattern]) => pattern.test(text));
  return match ? match[0] : "其他合同";
}

function classifyClause(text, title = "") {
  const source = `${title}\n${text}`;
  const rules = [
    ["标题", /^(?!第[一二三四五六七八九十百0-9]+条)(.{0,40}(合同|协议|订单|备忘录))\s*$/],
    ["鉴于条款", /^(鉴于|前言|背景|whereas|recital)/i],
    ["当事人信息", /(甲方[：:]|乙方[：:]|丙方[：:]|签约主体|注册地址|统一社会信用代码|法定代表人|联系人[：:]|Party A[：:]|Party B[：:])/i],
    ["保密", /保密|商业秘密|非公开/],
    ["陈述与保证", /陈述|保证|承诺/],
    ["合规承诺", /合规|反洗钱|反商业贿赂|出口管制|制裁/],
    ["责任限制", /责任限制|赔偿责任|间接损失|累计赔偿/],
    ["违约责任", /违约|逾期|违约金/],
    ["赔偿", /赔偿|补偿|indemn/i],
    ["付款", /付款|费用|发票|支付|账期|价款/],
    ["个人信息保护", /个人信息|敏感个人信息|隐私|处理目的|删除|安全措施/],
    ["数据使用", /数据|训练|微调|输入|输出|客户数据/],
    ["知识产权", /知识产权|著作权|专利|商标|软件|算法|模型/],
    ["交付与验收", /交付|验收|上线|里程碑|成果/],
    ["服务范围", /服务内容|服务范围|工作内容|SOW|订单|API|平台/],
    ["期限与终止", /期限|有效期|终止|解除/],
    ["争议解决", /争议|管辖|仲裁|法院|适用法律/],
    ["通知", /通知|送达|电子邮件|地址/],
  ];
  const match = rules.find(([, pattern]) => pattern.test(source));
  return match ? match[0] : "其他";
}

function splitClauses(text, contractId) {
  const normalized = text.replace(/\r/g, "").trim();
  const outlineClauses = splitOutlineTopLevelClauses(normalized);
  const structuredClauses = outlineClauses.length >= 2 ? outlineClauses : splitStructuredClauses(normalized);
  const headingChunks = structuredClauses.length >= 2 ? [] : splitHeadingStyleClauses(normalized);
  const paragraphChunks = normalized.split(/\n{2,}/).filter(Boolean);
  const usableChunks = normalizeClauseChunks(structuredClauses.length >= 2 ? structuredClauses : headingChunks.length >= 3 ? headingChunks : paragraphChunks);
  return usableChunks.map((item, index) => {
    const chunk = typeof item === "string" ? item : item.text;
    const title = typeof item === "string" ? extractClauseTitle(chunk, index) : Object.hasOwn(item, "title") ? item.title : extractClauseTitle(chunk, index);
    const type = typeof item === "string" ? classifyClause(chunk, title) : item.forcedType || classifyClause(chunk, title);
    return {
      id: uid("clause"),
      contractId,
      number: index + 1,
      title,
      text: chunk,
      type,
      chapterTitle: typeof item === "string" ? "" : item.chapterTitle || "",
      hierarchyLevel: typeof item === "string" ? "paragraph" : item.hierarchyLevel || "article",
      keyClause: type !== "其他",
      riskLevel: "low",
      deviates: false,
      sourceKind: "draft",
    };
  });
}

function splitOutlineTopLevelClauses(text) {
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const markers = collectOutlineMarkers(lines);
  if (markers.length < 2) return [];
  const topLevel = Math.min(...markers.map((marker) => marker.level));
  const topMarkers = markers.filter((marker) => marker.level === topLevel);
  if (topMarkers.length < 2) return [];
  const chunks = [];
  const firstTopIndex = topMarkers[0].index;
  const preface = lines.slice(0, firstTopIndex).join("\n").trim();
  if (preface && !isDocumentControlNotice(preface) && !isContractTitleOnly(preface)) {
    chunks.push({
      text: preface,
      title: extractClauseTitle(preface, 0),
      chapterTitle: "",
      hierarchyLevel: "preface",
    });
  }
  topMarkers.forEach((marker, position) => {
    const next = topMarkers[position + 1];
    const chunkLines = lines.slice(marker.index, next ? next.index : lines.length);
    const chunk = chunkLines.join("\n").trim();
    if (!chunk || isDocumentControlNotice(chunk) || isContractTitleOnly(chunk)) return;
    chunks.push({
      text: chunk,
      title: isExplicitOutlineTitle(marker.body) ? marker.title : "",
      chapterTitle: marker.style === "chapter" ? marker.raw : "",
      hierarchyLevel: "article",
      outlineLevel: marker.level,
    });
  });
  return chunks;
}

function collectOutlineMarkers(lines) {
  const rawMarkers = lines
    .map((line, index) => {
      const marker = parseOutlineMarker(line);
      return marker ? { ...marker, index } : null;
    })
    .filter(Boolean);
  if (!rawMarkers.length) return [];
  const ranks = inferOutlineStyleRanks(rawMarkers);
  return rawMarkers.map((marker) => ({ ...marker, level: ranks.get(marker.style) ?? marker.baseLevel }));
}

function inferOutlineStyleRanks(markers) {
  const styles = [];
  markers.forEach((marker) => {
    if (!styles.includes(marker.style)) styles.push(marker.style);
  });
  const intrinsic = new Map(styles.map((style) => [style, outlineStyleBaseLevel(style)]));
  styles.sort((a, b) => intrinsic.get(a) - intrinsic.get(b));
  return new Map(styles.map((style, index) => [style, index + 1]));
}

function outlineStyleBaseLevel(style) {
  if (style === "chapter") return 0;
  if (style === "article") return 1;
  if (style === "cn-comma") return 2;
  if (style === "arabic") return 3;
  if (style.startsWith("decimal-")) return 3 + Number(style.replace("decimal-", "") || 2);
  if (style === "cn-paren") return 7;
  if (style === "num-paren") return 8;
  return 9;
}

function parseOutlineMarker(line) {
  const text = String(line || "").trim();
  if (!text) return null;
  const chapter = text.match(/^(第[一二三四五六七八九十百零〇两0-9]+章)\s*(.*)$/);
  if (chapter) return outlineMarker("chapter", chapter[1], chapter[2], text);
  const article = text.match(/^(第[一二三四五六七八九十百零〇两0-9]+条)\s*(.*)$/);
  if (article) return outlineMarker("article", article[1], article[2], text);
  const cnComma = text.match(/^([一二三四五六七八九十百零〇两]+)[、．.]\s*(.+)$/);
  if (cnComma) return outlineMarker("cn-comma", cnComma[1], cnComma[2], text);
  const decimal = text.match(/^([0-9]+(?:\.[0-9]+)+)[、．.]?\s*(.+)$/);
  if (decimal) return outlineMarker(`decimal-${decimal[1].split(".").length}`, decimal[1], decimal[2], text);
  const arabic = text.match(/^([0-9]{1,2})[、．.]\s*(.+)$/);
  if (arabic) return outlineMarker("arabic", arabic[1], arabic[2], text);
  const cnParen = text.match(/^[（(]([一二三四五六七八九十百零〇两]+)[）)]\s*(.+)$/);
  if (cnParen) return outlineMarker("cn-paren", cnParen[1], cnParen[2], text);
  const numParen = text.match(/^[（(]([0-9]{1,2})[）)]\s*(.+)$/);
  if (numParen) return outlineMarker("num-paren", numParen[1], numParen[2], text);
  return null;
}

function outlineMarker(style, marker, body, raw) {
  const cleanBody = String(body || "").trim();
  return {
    style,
    marker,
    body: cleanBody,
    raw,
    title: cleanBody ? `${marker}${style === "article" || style === "chapter" ? " " : "、"}${cleanBody}`.trim() : raw,
    baseLevel: outlineStyleBaseLevel(style),
  };
}

function isExplicitOutlineTitle(text) {
  const body = String(text || "").trim();
  if (!body) return true;
  if (body.length > 28) return false;
  if (/^["“”‘’「」《》（(]/.test(body)) return false;
  if (/[。；;，,、]$/.test(body)) return false;
  if (/(是指|指，|指,|应当|应就|应以|应向|不得|可以|有权|同意|确认|构成|不会|违反|包括|如下|除外|前提是|为免疑义|任何一方|接收方|提供方|违约方|守约方|控制|企业|公司|提供|解决|必须|不得|负责|承担)/.test(body)) return false;
  return true;
}

function normalizeClauseChunks(chunks) {
  const normalized = [];
  let partyBuffer = [];
  let listBuffer = null;
  const flushPartyBuffer = () => {
    if (!partyBuffer.length) return;
    const text = partyBuffer.map((item) => (typeof item === "string" ? item : item.text)).join("\n");
    normalized.push({
      text,
      title: "当事人信息",
      chapterTitle: "",
      hierarchyLevel: "preface",
      forcedType: "当事人信息",
    });
    partyBuffer = [];
  };
  const flushListBuffer = () => {
    if (!listBuffer?.items?.length) return;
    normalized.push({
      text: listBuffer.items.map((item) => (typeof item === "string" ? item : item.text)).join("\n"),
      title: listBuffer.title,
      chapterTitle: "",
      hierarchyLevel: "article",
    });
    listBuffer = null;
  };

  chunks.forEach((item) => {
    const text = typeof item === "string" ? item : item.text;
    if (isDocumentControlNotice(text) || isContractTitleOnly(text)) return;
    if (isPartyInfoChunk(text)) {
      flushListBuffer();
      partyBuffer.push(item);
      return;
    }
    if (isLooseNumberedListChunk(text) && !isLooseNumberedTopLevelHeading(String(text).split("\n").find(Boolean) || "", normalized.length, [])) {
      flushPartyBuffer();
      if (!listBuffer) listBuffer = { title: inferLooseNumberedListTitle(text), items: [] };
      listBuffer.items.push(item);
      return;
    }
    flushListBuffer();
    flushPartyBuffer();
    normalized.push(item);
  });
  flushListBuffer();
  flushPartyBuffer();
  return normalized;
}

function isLooseNumberedListChunk(text) {
  const lines = String(text || "").split("\n").map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return false;
  const first = lines[0];
  if (/^第[一二三四五六七八九十百零〇两0-9]+条/.test(first)) return false;
  return /^[0-9]{1,2}[、．.]\s*/.test(first);
}

function inferLooseNumberedListTitle(text) {
  const first = String(text || "").split("\n").map((line) => line.trim()).find(Boolean) || "编号事项";
  const match = first.match(/^([0-9]{1,2}[、．.]\s*[^：:；;。]{0,24}[：:])/);
  return match ? match[1].trim() : "编号事项";
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
        if (prefaceText && !isDocumentControlNotice(prefaceText)) {
          chunks.push({
            text: prefaceText,
            title: extractClauseTitle(prefaceText, 0),
            chapterTitle: "",
            hierarchyLevel: "preface",
          });
        }
      }
      pushCurrent();
      current = {
        title: extractExplicitArticleTitle(line),
        chapterTitle: currentChapter,
        lines: [line],
      };
      return;
    }
    if (current) {
      current.lines.push(line);
    } else {
      preface.push(line);
    }
  });

  pushCurrent();
  if (!chunks.length && preface.length) {
    const prefaceText = preface.join("\n");
    if (!isDocumentControlNotice(prefaceText)) {
      chunks.push({ text: prefaceText, title: extractClauseTitle(prefaceText, 0), chapterTitle: "", hierarchyLevel: "preface" });
    }
  }
  return chunks;
}










function splitHeadingStyleClauses(text) {
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const headingIndexes = [];
  lines.forEach((line, index) => {
    if (isStandaloneClauseHeading(line, index, lines)) headingIndexes.push(index);
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

function isStandaloneClauseHeading(line, index, lines = []) {
  const compact = line.replace(/\s+/g, "");
  if (!compact || compact.length > 24) return false;
  if (/^[0-9]{1,2}[、．.]/.test(compact)) return isLooseNumberedTopLevelHeading(line, index, lines);
  if (/^["“”‘’「」《》（(]/.test(compact)) return false;
  if (/[。；;，,：:]$/.test(compact)) return false;
  if (/^(甲方|乙方|丙方|丁方|地址|联系人|电话|邮箱|签署|签字|盖章)/.test(compact)) return false;
  if (index === 0 && /(合同|协议|备忘录|条款书)$/.test(compact)) return true;
  return /^(鉴于|前言|背景|定义|释义|保密义务|保密责任|保密信息|保密义务的期限|知识产权|陈述与保证|违约责任|法律适用与争议解决|争议解决|适用法律|通知|其他|附则|生效|期限|终止|解除|费用|付款|交付|验收|数据|个人信息|合规|反商业贿赂|不可抗力|附件)/.test(compact);
}

function isLooseNumberedTopLevelHeading(line, index, lines) {
  const trimmed = String(line || "").trim();
  const match = trimmed.match(/^([0-9]{1,2})[、．.]\s*(.+)$/);
  if (!match) return false;
  const body = match[2].trim();
  if (!body || body.length > 20) return false;
  if (/[。；;，,]$/.test(body)) return false;
  const prev = findPreviousMeaningfulLine(lines, index);
  const next = findNextMeaningfulLine(lines, index);
  const nextNumber = next?.match(/^([0-9]{1,2})[、．.]\s*/)?.[1];
  const prevNumber = prev?.match(/^([0-9]{1,2})[、．.]\s*/)?.[1];
  const number = Number(match[1]);
  const isSequentialList =
    (nextNumber && Number(nextNumber) === number + 1) ||
    (prevNumber && Number(prevNumber) === number - 1);
  if (isSequentialList && /[:：]$/.test(body)) return false;
  if (/[:：]$/.test(body)) return true;
  if (next && !/^[0-9]{1,2}[、．.]|^第[一二三四五六七八九十百零〇两0-9]+条/.test(next)) return true;
  return false;
}

function findPreviousMeaningfulLine(lines, index) {
  for (let i = index - 1; i >= 0; i -= 1) {
    if (String(lines[i] || "").trim()) return String(lines[i]).trim();
  }
  return "";
}

function findNextMeaningfulLine(lines, index) {
  for (let i = index + 1; i < lines.length; i += 1) {
    if (String(lines[i] || "").trim()) return String(lines[i]).trim();
  }
  return "";
}
