function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function riskLabel(level) {
  return { high: "高", medium: "中", low: "低" }[level] || "低";
}

function numberToChinese(number) {
  const value = Number(number);
  const map = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
  if (!Number.isFinite(value) || value < 0) return "";
  if (value <= 10) return map[value] || "";
  if (value < 20) return `十${map[value - 10]}`;
  const tens = Math.floor(value / 10);
  const ones = value % 10;
  return `${map[tens] || ""}十${ones ? map[ones] : ""}`;
}

function normalizeClauseTypeLabel(value) {
  const source = String(value || "").trim();
  if (!source) return "其他";
  if (typeof clauseTypes !== "undefined" && clauseTypes.includes(source)) return source;
  const normalized = source.toLowerCase().replace(/[\s-]+/g, "_");
  const map = {
    service_scope: "服务范围",
    scope_of_services: "服务范围",
    services: "服务范围",
    delivery_acceptance: "交付与验收",
    deliverables_acceptance: "交付与验收",
    acceptance: "交付与验收",
    fees_payment: "付款",
    payment: "付款",
    fees: "付款",
    intellectual_property: "知识产权",
    ip: "知识产权",
    data_model: "数据使用",
    data_use: "数据使用",
    data_usage: "数据使用",
    personal_information_protection: "个人信息保护",
    privacy: "个人信息保护",
    confidentiality: "保密",
    confidential: "保密",
    reps_warranties: "陈述与保证",
    representations_warranties: "陈述与保证",
    compliance: "合规承诺",
    breach_liability: "违约责任",
    default_liability: "违约责任",
    liability_cap: "责任限制",
    limitation_of_liability: "责任限制",
    indemnity: "赔偿",
    indemnification: "赔偿",
    term_termination: "期限与终止",
    term: "期限与终止",
    termination: "期限与终止",
    dispute_resolution: "争议解决",
    governing_law_dispute: "争议解决",
    notices: "通知",
    notice: "通知",
    recitals: "鉴于条款",
    background: "鉴于条款",
    other: "其他",
  };
  if (map[normalized]) return map[normalized];
  const compact = source.replace(/\s+/g, "");
  return clauseTypes.find((item) => compact.includes(item)) || (/(鉴于|前言|背景|recital)/i.test(source) ? "鉴于条款" : "其他");
}
