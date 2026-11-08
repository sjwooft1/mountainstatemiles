/**
 * Mountain State Miles — Shared Email Engine
 * ===========================================
 * One email system for the whole site (Cross Country + Track + the News Desk),
 * replacing the old CrossCountry-only helpers that each page re-implemented.
 *
 * DESIGN
 * ------
 * • Data lives under a single root node so both sports share one audience:
 *     email/lists/{id}          { name, description, tags[], emails[], createdAt, updatedAt }
 *     email/suppressions/{key}  { email, reason, at }        (unsubscribed / bounced — never emailed)
 *     email/queue/{id}          { subject, preheader, html, text, from, listIds[], recipients[],
 *                                 status, scheduledFor, createdAt, sentAt, provider,
 *                                 deliveryStatus{total,sent,failed,bounced}, isTest, attempt, lastError }
 *     email/templates/{id}      { name, subject, preheader, doc, createdAt, usageCount, lastUsed }
 *     email/settings/delivery   { adapter, webhookUrl, fromName, fromEmail, replyTo, footerNote, unsubscribeUrl }
 *
 * • DELIVERY IS PLUGGABLE. Nothing is sent from the browser by default and no
 *   secret is stored in this repo. `dispatch()` posts the message to a webhook
 *   if you configure one; otherwise the message stays `queued` and the desk
 *   gives you the rendered HTML + recipient CSV so you can send it through
 *   Mailchimp / Substack / Brevo / a Cloud Function. See `deliveryContract()`.
 *
 * • READ-ONLY LEGACY BRIDGE. The old records still live under
 *   crosscountry/email-lists and crosscountry/email-templates. `importLegacy()`
 *   copies them into the new nodes once, marking each with `legacyId` so it
 *   never duplicates. Nothing old is deleted or rewritten.
 *
 * Exposes window.MSMEmail.
 */
(function () {
  "use strict";

  const ROOT = "email";
  const LEGACY = {
    lists: "crosscountry/email-lists",
    templates: "crosscountry/email-templates",
    queue: "crosscountry/scheduled-emails",
  };

  /* Brand palette — mirrors assets/main.css so email matches the site. */
  const BRAND = {
    pine: "#2c5a47",
    pineMid: "#3f7d63",
    cream: "#fbf7ef",
    paper: "#fffdf8",
    clay: "#e0794f",
    gold: "#e0a63f",
    ink: "#2f2a24",
    soft: "#6b6154",
    faint: "#8b7c68",
    border: "#e6dcc8",
    white: "#ffffff",
    site: "https://mountainstatemiles.com",
  };

  const STATUS = {
    DRAFT: "draft",
    QUEUED: "queued",
    SCHEDULED: "scheduled",
    SENDING: "sending",
    SENT: "sent",
    FAILED: "failed",
    CANCELED: "canceled",
  };

  const STATUS_LABEL = {
    draft: "Draft",
    queued: "Queued",
    scheduled: "Scheduled",
    sending: "Sending",
    sent: "Sent",
    failed: "Failed",
    canceled: "Canceled",
  };

  /* Statuses that still have a future (can be edited, sent, or canceled). */
  const OPEN_STATUS = new Set([STATUS.DRAFT, STATUS.QUEUED, STATUS.SCHEDULED, STATUS.FAILED]);

  /* ==================================================================
   *  Low-level plumbing
   * ================================================================== */

  let _db = null;

  function db() {
    if (!_db) {
      if (!window.firebaseDatabase) throw new Error("Firebase database not ready");
      _db = window.firebaseDatabase;
    }
    return _db;
  }

  async function waitForDb(timeoutMs = 8000) {
    const started = Date.now();
    while (!window.firebaseDatabase && Date.now() - started < timeoutMs) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!window.firebaseDatabase) throw new Error("Firebase database not ready");
    return db();
  }

  function snapshotToArray(snapshot) {
    const out = [];
    if (snapshot && typeof snapshot.forEach === "function") {
      snapshot.forEach((child) => out.push({ id: child.key, ...(child.val() || {}) }));
    }
    return out;
  }

  const esc = (value) =>
    String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[c]);

  function nowIso() {
    return new Date().toISOString();
  }

  function formatDateTime(value) {
    if (!value) return "—";
    const d = new Date(value);
    if (isNaN(d)) return "—";
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function formatDate(value) {
    if (!value) return "";
    const d = new Date(String(value).slice(0, 10) + "T12:00:00");
    if (isNaN(d)) return "";
    return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  }

  /** ISO -> value usable by <input type="datetime-local">, in local time. */
  function toLocalInputValue(iso) {
    const d = iso ? new Date(iso) : new Date();
    if (isNaN(d)) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  /** <input type="datetime-local"> value -> ISO. */
  function fromLocalInputValue(value) {
    if (!value) return null;
    const d = new Date(value);
    return isNaN(d) ? null : d.toISOString();
  }

  /* ==================================================================
   *  Recipients — parsing, validation, de-duplication
   * ================================================================== */

  /* Deliberately conservative: the common "one @, a dotted TLD" shape. */
  const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[A-Za-z]{2,}$/;

  function isValidEmail(email) {
    return EMAIL_RE.test(String(email || "").trim());
  }

  function normalizeEmail(email) {
    const raw = String(email || "").trim();
    // Pull the address out of `Name <a@b.com>` and strip surrounding punctuation.
    const angled = raw.match(/<([^>]+)>/);
    const core = (angled ? angled[1] : raw).trim().replace(/^[("'<]+|[)"',;:.>]+$/g, "");
    return core.toLowerCase();
  }

  /**
   * Parse a pasted blob (commas, semicolons, newlines, spaces) into addresses.
   * Returns everything that was rejected so the UI can show it rather than
   * silently dropping it.
   */
  function parseRecipients(text) {
    const valid = [];
    const invalid = [];
    const duplicates = [];
    const seen = new Set();

    const take = (candidate) => {
      const email = normalizeEmail(candidate);
      if (!isValidEmail(email)) {
        invalid.push(String(candidate).trim());
        return;
      }
      if (seen.has(email)) {
        duplicates.push(email);
        return;
      }
      seen.add(email);
      valid.push(email);
    };

    // `Display Name <addr@host>` must be lifted out BEFORE splitting on
    // whitespace, or the name is shredded into spurious invalid entries.
    const rest = String(text || "").replace(/[^<,;]*<([^>]+)>/g, (full, address) => {
      take(address);
      return " ";
    });

    rest
      .split(/[\s,;]+/)
      .map((piece) => piece.trim())
      .filter(Boolean)
      .forEach(take);

    return { valid, invalid, duplicates };
  }

  function suppressionKey(email) {
    // RTDB keys can't hold . # $ [ ] / — flatten the address.
    return normalizeEmail(email).replace(/[.#$/[\]]/g, "_");
  }

  function dedupeEmails(emails) {
    const seen = new Set();
    const out = [];
    (emails || []).forEach((email) => {
      const normalized = normalizeEmail(email);
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      out.push(normalized);
    });
    return out;
  }

  /* ==================================================================
   *  Lists
   * ================================================================== */

  const listsRef = () => db().ref(`${ROOT}/lists`);

  async function listLists() {
    const snap = await listsRef().once("value");
    return snapshotToArray(snap).sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  }

  async function getList(id) {
    if (!id) return null;
    const snap = await db().ref(`${ROOT}/lists/${id}`).once("value");
    return snap.exists() ? { id, ...snap.val() } : null;
  }

  async function createList({ name, emails = [], description = "", tags = [] }) {
    if (!name || !String(name).trim()) throw new Error("A list name is required.");
    const clean = dedupeEmails(emails.filter(isValidEmail));
    const ref = listsRef().push();
    const record = {
      name: String(name).trim(),
      description: String(description || "").trim(),
      tags: dedupeEmails(tags).length ? tags : [],
      emails: clean,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await ref.set(record);
    return { id: ref.key, ...record };
  }

  async function updateList(id, patch) {
    const update = { ...patch, updatedAt: nowIso() };
    if (patch && patch.emails) update.emails = dedupeEmails(patch.emails.filter(isValidEmail));
    await db().ref(`${ROOT}/lists/${id}`).update(update);
    return { id, ...update };
  }

  async function deleteList(id) {
    await db().ref(`${ROOT}/lists/${id}`).remove();
    return true;
  }

  /**
   * Add addresses to a list. Returns a report so the caller can explain what
   * happened (added / already there / invalid / suppressed).
   */
  async function addToLists(ids, textOrEmails) {
    const parsed = Array.isArray(textOrEmails)
      ? { valid: dedupeEmails(textOrEmails), invalid: [], duplicates: [] }
      : parseRecipients(textOrEmails);
    const suppressed = await listSuppressions();
    const suppressedSet = new Set(suppressed.map((s) => normalizeEmail(s.email)));
    const report = { added: 0, alreadyPresent: 0, invalid: parsed.invalid.length, suppressed: 0, lists: 0 };

    for (const id of ids || []) {
      const list = await getList(id);
      if (!list) continue;
      report.lists += 1;
      const existing = new Set(dedupeEmails(list.emails));
      const next = [...existing];
      parsed.valid.forEach((email) => {
        if (suppressedSet.has(email)) {
          report.suppressed += 1;
          return;
        }
        if (existing.has(email)) {
          report.alreadyPresent += 1;
          return;
        }
        existing.add(email);
        next.push(email);
        report.added += 1;
      });
      if (next.length !== list.emails.length) await updateList(id, { emails: next });
    }
    return report;
  }

  /** Remove a single address from every list (used when suppressing). */
  async function removeEmailEverywhere(email) {
    const target = normalizeEmail(email);
    const lists = await listLists();
    let touched = 0;
    for (const list of lists) {
      const filtered = dedupeEmails(list.emails).filter((e) => e !== target);
      if (filtered.length !== (list.emails || []).length) {
        await updateList(list.id, { emails: filtered });
        touched += 1;
      }
    }
    return touched;
  }

  /* ==================================================================
   *  Suppressions (unsubscribes + bounces)
   * ================================================================== */

  async function listSuppressions() {
    const snap = await db().ref(`${ROOT}/suppressions`).once("value");
    return snapshotToArray(snap).sort((a, b) => String(a.email || "").localeCompare(String(b.email || "")));
  }

  async function suppress(email, reason = "unsubscribed") {
    const clean = normalizeEmail(email);
    if (!isValidEmail(clean)) throw new Error("That does not look like an email address.");
    await db().ref(`${ROOT}/suppressions/${suppressionKey(clean)}`).set({ email: clean, reason, at: nowIso() });
    await removeEmailEverywhere(clean);
    return true;
  }

  async function unsuppress(email) {
    await db().ref(`${ROOT}/suppressions/${suppressionKey(email)}`).remove();
    return true;
  }

  /* ==================================================================
   *  Audience
   * ================================================================== */

  /**
   * Flatten the selected lists into the address list an email will actually go
   * to, dropping de-duplicates and suppressed addresses.
   */
  async function resolveAudience(ids, { includeSuppressed = false } = {}) {
    const lists = await listLists();
    const chosen = (ids && ids.length ? lists.filter((l) => ids.includes(l.id)) : []);
    const suppressed = includeSuppressed ? [] : await listSuppressions();
    const blocked = new Set(suppressed.map((s) => normalizeEmail(s.email)));

    const all = [];
    const perList = [];
    chosen.forEach((list) => {
      const own = dedupeEmails(list.emails).filter((e) => includeSuppressed || !blocked.has(e));
      perList.push({ id: list.id, name: list.name, count: own.length });
      all.push(...own);
    });

    return { emails: dedupeEmails(all), perList, suppressedCount: suppressed.length };
  }

  /* ==================================================================
   *  Branded HTML renderer
   * ================================================================== */

  /**
   * Render one content block to email-safe HTML. Every block is a table row
   * with inline styles — the only thing Outlook, Gmail and Apple Mail agree on.
   */
  function renderBlock(block) {
    if (!block || !block.type) return "";
    const pad = "18px 32px";

    switch (block.type) {
      case "heading":
        return `<tr><td style="padding:26px 32px 6px;font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:bold;color:${BRAND.pine};line-height:1.25;">${esc(block.text)}</td></tr>`;

      case "paragraph":
        return `<tr><td style="padding:8px 32px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.65;color:${BRAND.ink};">${esc(block.text).replace(/\n/g, "<br>")}</td></tr>`;

      case "list": {
        const items = (block.items || [])
          .filter(Boolean)
          .map(
            (item) =>
              `<li style="margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:${BRAND.ink};">${esc(item)}</li>`
          )
          .join("");
        return `<tr><td style="padding:8px 32px;"><ul style="margin:0;padding-left:20px;">${items}</ul></td></tr>`;
      }

      case "stats": {
        const cells = (block.items || [])
          .filter(Boolean)
          .map(
            (stat) => `<td align="center" style="padding:14px 10px;background:${BRAND.cream};border-radius:12px;">
              <div style="font-family:Georgia,serif;font-size:22px;font-weight:bold;color:${BRAND.pine};line-height:1.1;">${esc(stat.value)}</div>
              <div style="font-family:Arial,sans-serif;font-size:10px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:${BRAND.faint};padding-top:5px;">${esc(stat.label)}</div>
            </td>`
          )
          .join('<td style="width:10px;">&nbsp;</td>');
        return `<tr><td style="padding:14px 32px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>${cells}</tr></table></td></tr>`;
      }

      case "quote":
        return `<tr><td style="padding:14px 32px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-left:4px solid ${BRAND.gold};"><tr><td style="padding:4px 0 4px 16px;font-family:Georgia,serif;font-size:17px;font-style:italic;line-height:1.5;color:${BRAND.pineMid};">${esc(block.text)}</td></tr></table></td></tr>`;

      case "divider":
        return `<tr><td style="padding:16px 32px;"><div style="border-top:1px solid ${BRAND.border};font-size:0;line-height:0;">&nbsp;</div></td></tr>`;

      case "button":
        return `<tr><td align="center" style="padding:18px 32px;"><a href="${esc(block.href || BRAND.site)}" style="display:inline-block;background:${BRAND.pine};color:${BRAND.white};font-family:Arial,sans-serif;font-size:14px;font-weight:bold;text-decoration:none;padding:13px 26px;border-radius:99px;">${esc(block.text || "Read more")}</a></td></tr>`;

      case "image": {
        if (!block.src) return "";
        const caption = block.caption
          ? `<div style="font-family:Arial,sans-serif;font-size:12px;color:${BRAND.faint};padding-top:8px;text-align:center;">${esc(block.caption)}</div>`
          : "";
        return `<tr><td style="padding:14px 32px;${block.full ? "padding-left:0;padding-right:0;" : ""}"><img src="${esc(block.src)}" alt="${esc(block.alt || "")}" width="100%" style="display:block;width:100%;max-width:${block.full ? "600" : "536"}px;height:auto;border-radius:12px;border:0;" />${caption}</td></tr>`;
      }

      default:
        return "";
    }
  }

  /**
   * Build a complete, self-contained email document.
   *
   * @param {Object} doc
   *   subject, preheader, kicker, headline, dek, blocks[], author, footerNote,
   *   from, replyTo, unsubscribeUrl, stats[]
   */
  function renderEmail(doc = {}) {
    const subject = String(doc.subject || "").trim() || "Mountain State Miles";
    const preheader = String(doc.preheader || doc.dek || "").trim();
    const kicker = String(doc.kicker || "Mountain State Miles").trim();
    const headline = String(doc.headline || subject).trim();
    const dek = String(doc.dek || "").trim();
    const blocks = Array.isArray(doc.blocks) ? doc.blocks : [];
    const author = String(doc.author || "").trim();
    const footerNote = String(doc.footerNote || "").trim();
    const unsubscribeUrl = doc.unsubscribeUrl || "";

    const bodyBlocks = blocks.map(renderBlock).join("");
    const stats = Array.isArray(doc.stats) && doc.stats.length
      ? renderBlock({ type: "stats", items: doc.stats })
      : "";

    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.cream};">
<!-- Preheader: shows in the inbox preview, hidden in the body. -->
<div style="display:none;font-size:1px;color:${BRAND.cream};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${BRAND.cream};padding:28px 12px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:${BRAND.paper};border-radius:18px;overflow:hidden;">
      <tr><td style="background:${BRAND.pine};padding:30px 32px 26px;">
        <div style="font-family:Arial,sans-serif;font-size:11px;font-weight:bold;letter-spacing:2.5px;text-transform:uppercase;color:${BRAND.gold};">${esc(kicker)}</div>
        <h1 style="margin:12px 0 0;font-family:Georgia,'Times New Roman',serif;font-size:29px;line-height:1.14;color:${BRAND.white};">${esc(headline)}</h1>
        ${dek ? `<div style="margin-top:12px;font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:rgba(251,247,239,0.85);">${esc(dek)}</div>` : ""}
      </td></tr>
      ${stats}
      ${bodyBlocks}
      <tr><td style="padding:22px 32px 26px;"><div style="border-top:1px solid ${BRAND.border};padding-top:16px;font-family:Arial,sans-serif;font-size:12px;line-height:1.6;color:${BRAND.faint};">
        ${footerNote ? `${esc(footerNote)}<br>` : ""}
        ${author ? `<strong style="color:${BRAND.soft};">${esc(author)}</strong> · ` : ""}
        <a href="${esc(BRAND.site)}" style="color:${BRAND.pineMid};text-decoration:underline;">Mountain State Miles</a>
        ${unsubscribeUrl ? ` · <a href="${esc(unsubscribeUrl)}" style="color:${BRAND.faint};text-decoration:underline;">Unsubscribe</a>` : ""}
      </div></td></tr>
    </table>
    <div style="font-family:Arial,sans-serif;font-size:11px;color:${BRAND.faint};padding:16px 8px 0;max-width:600px;">
      You are receiving this because you are on a Mountain State Miles coaching list.
    </div>
  </td></tr>
</table>
</body>
</html>`;

    return { subject, preheader, html, text: htmlToText(html) };
  }

  /** Plain-text alternative — improves deliverability and powers copy/paste. */
  function htmlToText(html) {
    return String(html || "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<div[^>]*display:none[^>]*>[\s\S]*?<\/div>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|h1|h2|h3|li|tr|table)>/gi, "\n")
      .replace(/<li[^>]*>/gi, "  • ")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  /** Turn free text into paragraph blocks (blank line = new paragraph). */
  function textToBlocks(text) {
    return String(text || "")
      .split(/\n\s*\n/)
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .map((chunk) => ({ type: "paragraph", text: chunk }));
  }

  /**
   * Email a News Desk story or article. Story fields may still contain
   * {{tokens}} — pass a resolver to keep the stats live at send time.
   */
  function fromStory(story = {}, { resolve } = {}) {
    const r = typeof resolve === "function" ? resolve : (v) => v;
    return {
      subject: r(story.title || ""),
      kicker: r(story.kicker || "Story of the Week"),
      headline: r(story.title || ""),
      dek: r(story.dek || ""),
      author: story.author || "MSM Data Desk",
      blocks: textToBlocks(r(story.body || "")),
      preheader: r(story.dek || ""),
    };
  }

  function fromArticle(article = {}) {
    const blocks = textToBlocks(article.content || "");
    const highlights = Array.isArray(article.highlights) ? article.highlights.filter(Boolean) : [];
    if (highlights.length) {
      blocks.push({ type: "heading", text: "Key points" });
      blocks.push({ type: "list", items: highlights });
    }
    return {
      subject: article.title || "",
      kicker: article.category || "News",
      headline: article.title || "",
      dek: "",
      author: "MSM Data Desk",
      blocks,
    };
  }

  /* ==================================================================
   *  Templates
   * ================================================================== */

  const STARTER_TEMPLATES = [
    {
      name: "Weekly recap",
      subject: "This week in West Virginia running",
      preheader: "Results, risers and what it means for the standings.",
      doc: {
        kicker: "Weekly Recap",
        headline: "This week in West Virginia running",
        dek: "The results that moved the state.",
        blocks: [
          { type: "stats", items: [{ label: "Meets", value: "—" }, { label: "Rated runs", value: "—" }, { label: "Schools", value: "—" }] },
          { type: "heading", text: "The headline" },
          { type: "paragraph", text: "Write the story here." },
          { type: "button", text: "See the full meet results", href: "https://mountainstatemiles.com/CrossCountry/meets.html" },
        ],
      },
    },
    {
      name: "Meet the field — preview",
      subject: "Preview: the meet ahead",
      preheader: "Who is racing, and where the race will be decided.",
      doc: {
        kicker: "Meet Preview",
        headline: "Who to watch this week",
        dek: "The teams, the course, and the athletes to follow.",
        blocks: [
          { type: "heading", text: "The course" },
          { type: "paragraph", text: "How the terrain shapes the race." },
          { type: "heading", text: "The contenders" },
          { type: "paragraph", text: "Name the athletes and their form." },
          { type: "button", text: "Open the course viewer", href: "https://mountainstatemiles.com/CrossCountry/courses/course%20viewer.html" },
        ],
      },
    },
    {
      name: "Championship week",
      subject: "Championship week is here",
      preheader: "Everything you need before the gun goes off.",
      doc: {
        kicker: "Championship Week",
        headline: "Championship week is here",
        dek: "Start lists, course notes, and the numbers behind the favourites.",
        blocks: [
          { type: "paragraph", text: "Open with the stakes." },
          { type: "quote", text: "Every season comes down to a few minutes on Saturday." },
          { type: "heading", text: "What to watch" },
          { type: "list", items: ["Team battle", "Individual favourites", "Course conditions"] },
          { type: "button", text: "Full championship coverage", href: "https://mountainstatemiles.com/CrossCountry/rankings.html" },
        ],
      },
    },
    {
      name: "Plain announcement",
      subject: "",
      preheader: "",
      doc: { kicker: "Announcement", headline: "", dek: "", blocks: [{ type: "paragraph", text: "" }] },
    },
  ];

  async function listTemplates() {
    const snap = await db().ref(`${ROOT}/templates`).once("value");
    return snapshotToArray(snap).sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  }

  async function saveTemplate({ name, doc, subject, preheader }) {
    if (!name || !String(name).trim()) throw new Error("Give the template a name.");
    const ref = db().ref(`${ROOT}/templates`).push();
    const record = {
      name: String(name).trim(),
      subject: subject || (doc && doc.subject) || "",
      preheader: preheader || (doc && doc.preheader) || "",
      doc: doc || {},
      createdAt: nowIso(),
      usageCount: 0,
    };
    await ref.set(record);
    return { id: ref.key, ...record };
  }

  async function deleteTemplate(id) {
    await db().ref(`${ROOT}/templates/${id}`).remove();
    return true;
  }

  async function markTemplateUsed(id) {
    const ref = db().ref(`${ROOT}/templates/${id}`);
    const snap = await ref.once("value");
    if (!snap.exists()) return;
    await ref.update({ usageCount: (snap.val().usageCount || 0) + 1, lastUsed: nowIso() });
  }

  /* ==================================================================
   *  Queue — drafts, scheduling, sending
   * ================================================================== */

  const queueRef = () => db().ref(`${ROOT}/queue`);

  async function listQueue() {
    const snap = await queueRef().once("value");
    return snapshotToArray(snap).sort((a, b) => {
      const aT = a.scheduledFor || a.createdAt || "";
      const bT = b.scheduledFor || b.createdAt || "";
      return String(bT).localeCompare(String(aT));
    });
  }

  async function getQueued(id) {
    const snap = await db().ref(`${ROOT}/queue/${id}`).once("value");
    return snap.exists() ? { id, ...snap.val() } : null;
  }

  /**
   * Create a queue record.
   * @param {Object} message  subject, preheader, html, text, listIds, recipients, doc
   * @param {Object} options  status, scheduledFor, isTest, templateId
   */
  async function queueMessage(message, options = {}) {
    const recipients = dedupeEmails(message.recipients || []).filter(isValidEmail);
    if (!recipients.length) throw new Error("There are no recipients to send to.");

    const status = options.status || STATUS.QUEUED;
    const ref = queueRef().push();
    const record = {
      subject: String(message.subject || "").trim() || "(no subject)",
      preheader: message.preheader || "",
      html: message.html || "",
      text: message.text || "",
      from: message.from || "",
      replyTo: message.replyTo || "",
      listIds: options.listIds || message.listIds || [],
      recipients,
      doc: message.doc || null,
      templateId: options.templateId || null,
      isTest: !!options.isTest,
      status,
      scheduledFor: options.scheduledFor || (status === STATUS.SCHEDULED ? null : nowIso()),
      createdAt: nowIso(),
      sentAt: null,
      provider: null,
      attempt: 0,
      lastError: null,
      deliveryStatus: { total: recipients.length, sent: 0, failed: 0, bounced: 0 },
    };
    if (status === STATUS.SCHEDULED && !record.scheduledFor) {
      throw new Error("Pick a date and time to schedule this email.");
    }
    await ref.set(record);
    return { id: ref.key, ...record };
  }

  async function updateQueueRecord(id, patch) {
    await db().ref(`${ROOT}/queue/${id}`).update(patch);
    return { id, ...patch };
  }

  /**
   * Send now.
   *
   * With a webhook configured the message is POSTed and the record is marked
   * sent or failed. Without one, the record stays `queued` so a worker (or you,
   * by hand) can pick it up — nothing is silently lost.
   */
  async function sendNow(id) {
    const record = await getQueued(id);
    if (!record) throw new Error("That email is no longer in the queue.");
    if (record.status === STATUS.SENT) throw new Error("That email has already been sent.");

    const settings = await getDelivery();
    await updateQueueRecord(id, {
      status: STATUS.SENDING,
      attempt: (record.attempt || 0) + 1,
      scheduledFor: nowIso(),
    });

    if (!settings.webhookUrl) {
      // No adapter configured: hand the queue over rather than pretending.
      await updateQueueRecord(id, { status: STATUS.QUEUED, lastError: null });
      return {
        ok: true,
        queued: true,
        message: `Queued for ${record.recipients.length} recipients. No delivery webhook is configured, so it is waiting to be picked up — use Export to send it through your platform.`,
      };
    }

    const payload = buildPayload(record, settings);
    try {
      const response = await fetch(settings.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(`Delivery endpoint responded ${response.status}`);
      await updateQueueRecord(id, {
        status: STATUS.SENT,
        sentAt: nowIso(),
        provider: settings.adapter || "webhook",
        lastError: null,
        deliveryStatus: { ...record.deliveryStatus, sent: record.recipients.length },
      });
      return { ok: true, queued: false, message: `Sent to ${record.recipients.length} recipients.` };
    } catch (error) {
      await updateQueueRecord(id, {
        status: STATUS.FAILED,
        lastError: error.message,
        deliveryStatus: { ...record.deliveryStatus, failed: record.recipients.length, sent: 0 },
      });
      return { ok: false, queued: false, message: `Delivery failed: ${error.message}` };
    }
  }

  async function schedule(id, isoWhen) {
    if (!isoWhen) throw new Error("Pick a date and time to schedule this email.");
    await updateQueueRecord(id, { status: STATUS.SCHEDULED, scheduledFor: isoWhen, lastError: null });
    return true;
  }

  async function cancel(id) {
    await updateQueueRecord(id, { status: STATUS.CANCELED });
    return true;
  }

  /** Retry a failed send (or re-queue a canceled one). */
  async function retry(id) {
    await updateQueueRecord(id, { status: STATUS.QUEUED, lastError: null });
    return sendNow(id);
  }

  async function deleteQueueRecord(id) {
    await db().ref(`${ROOT}/queue/${id}`).remove();
    return true;
  }

  async function analytics() {
    const emails = await listQueue();
    const lists = await listLists().catch(() => []);
    const suppressed = await listSuppressions().catch(() => []);
    const reach = dedupeEmails(lists.flatMap((l) => dedupeEmails(l.emails)).filter((e) => !suppressed.some((s) => normalizeEmail(s.email) === e)));

    return {
      total: emails.length,
      sent: emails.filter((e) => e.status === STATUS.SENT).length,
      scheduled: emails.filter((e) => e.status === STATUS.SCHEDULED).length,
      queued: emails.filter((e) => e.status === STATUS.QUEUED).length,
      drafts: emails.filter((e) => e.status === STATUS.DRAFT).length,
      failed: emails.filter((e) => e.status === STATUS.FAILED).length,
      lists: lists.length,
      suppressed: suppressed.length,
      reach: reach.length,
      totalRecipients: emails.reduce((sum, e) => sum + ((e.deliveryStatus && e.deliveryStatus.total) || 0), 0),
      totalDelivered: emails.reduce((sum, e) => sum + ((e.deliveryStatus && e.deliveryStatus.sent) || 0), 0),
      upcoming: emails
        .filter((e) => e.status === STATUS.SCHEDULED)
        .sort((a, b) => String(a.scheduledFor || "").localeCompare(String(b.scheduledFor || ""))),
      recent: emails.slice(0, 12),
    };
  }

  /* ==================================================================
   *  Delivery adapter
   * ================================================================== */

  const ADAPTERS = {
    none: { label: "None — queue + export only", sendsFromBrowser: false, note: "Emails are queued and exported; nothing is transmitted." },
    webhook: { label: "Webhook / worker", sendsFromBrowser: true, note: "Each send POSTs a JSON payload to your endpoint, which does the actual delivery." },
    mailchimp: { label: "Mailchimp (via webhook)", sendsFromBrowser: true, note: "Point the webhook at your Mailchimp automation or a small proxy." },
    resend: { label: "Resend (via webhook)", sendsFromBrowser: true, note: "Point the webhook at a proxy that holds your Resend API key server-side." },
    brevo: { label: "Brevo / Sendinblue (via webhook)", sendsFromBrowser: true, note: "Point the webhook at a proxy that holds your Brevo API key server-side." },
  };

  async function getDelivery() {
    const snap = await db().ref(`${ROOT}/settings/delivery`).once("value");
    return {
      adapter: "none",
      webhookUrl: "",
      fromName: "Mountain State Miles",
      fromEmail: "",
      replyTo: "",
      footerNote: "",
      unsubscribeUrl: "",
      ...(snap.val() || {}),
    };
  }

  async function saveDelivery(settings) {
    await db().ref(`${ROOT}/settings/delivery`).update(settings);
    return getDelivery();
  }

  /**
   * The exact JSON contract a worker receives. Kept stable and documented so
   * the email side can be built without touching this file.
   */
  function buildPayload(record, settings = {}) {
    return {
      version: 1,
      to: record.recipients,
      from: { name: settings.fromName || "Mountain State Miles", email: settings.fromEmail || "" },
      replyTo: settings.replyTo || settings.fromEmail || "",
      subject: record.subject,
      preheader: record.preheader || "",
      html: record.html,
      text: record.text || htmlToText(record.html),
      unsubscribeUrl: settings.unsubscribeUrl || "",
      meta: {
        queuedId: record.id || null,
        listIds: record.listIds || [],
        isTest: !!record.isTest,
        sentAt: nowIso(),
        source: "mountainstatemiles.com",
      },
    };
  }

  function deliveryContract() {
    return {
      method: "POST",
      contentType: "application/json",
      body: buildPayload(
        { recipients: ["recipient@example.com"], subject: "Subject", html: "<p>Hi</p>", text: "Hi", listIds: [], isTest: false },
        { fromName: "Mountain State Miles", fromEmail: "news@mountainstatemiles.com", unsubscribeUrl: "https://mountainstatemiles.com/unsubscribe" }
      ),
      expectations: [
        "Respond 2xx once the message is accepted for delivery.",
        "Any non-2xx response marks the send failed and stores the status code.",
        "Honour the `unsubscribeUrl` field (CAN-SPAM / GDPR).",
        "Never log the recipient list in plain text.",
      ],
    };
  }

  /* ==================================================================
   *  Export
   * ================================================================== */

  function csvCell(value) {
    const text = String(value == null ? "" : value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function toCSV(rows) {
    return (rows || []).map((row) => (Array.isArray(row) ? row : Object.values(row)).map(csvCell).join(",")).join("\r\n");
  }

  function recipientsCSV(emails) {
    return toCSV([["email"], ...dedupeEmails(emails).map((e) => [e])]);
  }

  /** Mailchimp's importer expects EMAIL (and optional FNAME/LNAME). */
  function mailchimpCSV(entries) {
    const rows = [["Email Address", "First Name", "Last Name"]];
    (entries || []).forEach((entry) => {
      if (typeof entry === "string") rows.push([entry, "", ""]);
      else rows.push([entry.email || "", entry.firstName || "", entry.lastName || ""]);
    });
    return toCSV(rows);
  }

  function downloadText(filename, content, mime = "text/plain;charset=utf-8") {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  async function copyToClipboard(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) {
      /* fall through to the legacy path */
    }
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (_) {
      ok = false;
    }
    area.remove();
    return ok;
  }

  /** Open the rendered email in a new tab, ready to print or save as PDF. */
  function openPreview(html) {
    const win = window.open("", "_blank");
    if (!win) return false;
    win.document.write(html);
    win.document.close();
    return true;
  }

  function slugify(text) {
    return String(text || "email")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "email";
  }

  /* ==================================================================
   *  Legacy bridge
   * ================================================================== */

  /**
   * Copy the old crosscountry/email-lists + email-templates into the new
   * shared nodes. Idempotent: records already bridged carry `legacyId` and are
   * skipped. Nothing in the old nodes is modified.
   */
  async function importLegacy({ includeQueue = false } = {}) {
    const report = { listsAdded: 0, listsSkipped: 0, templatesAdded: 0, templatesSkipped: 0, queueAdded: 0 };

    const [legacyListsSnap, legacyTemplatesSnap, existingLists, existingTemplates] = await Promise.all([
      db().ref(LEGACY.lists).once("value").catch(() => null),
      db().ref(LEGACY.templates).once("value").catch(() => null),
      listLists(),
      listTemplates(),
    ]);

    const seenListIds = new Set(existingLists.map((l) => l.legacyId).filter(Boolean));
    const seenTemplateIds = new Set(existingTemplates.map((t) => t.legacyId).filter(Boolean));

    const legacyLists = legacyListsSnap ? snapshotToArray(legacyListsSnap) : [];
    for (const list of legacyLists) {
      if (seenListIds.has(list.id)) {
        report.listsSkipped += 1;
        continue;
      }
      await createList({
        name: list.name || "Imported list",
        emails: list.emails || [],
        description: "Imported from the Cross Country email tools.",
      }).then(async (created) => {
        await db().ref(`${ROOT}/lists/${created.id}`).update({ legacyId: list.id });
        report.listsAdded += 1;
      });
    }

    const legacyTemplates = legacyTemplatesSnap ? snapshotToArray(legacyTemplatesSnap) : [];
    for (const template of legacyTemplates) {
      if (seenTemplateIds.has(template.id)) {
        report.templatesSkipped += 1;
        continue;
      }
      await saveTemplate({
        name: template.name || "Imported template",
        subject: template.subject || "",
        preheader: template.preheader || "",
        doc: template.doc || template.emailConfig || { blocks: textToBlocks(template.htmlContent || "") },
      }).then(async (created) => {
        await db().ref(`${ROOT}/templates/${created.id}`).update({ legacyId: template.id });
        report.templatesAdded += 1;
      });
    }

    if (includeQueue && legacyListsSnap) {
      const legacyQueueSnap = await db().ref(LEGACY.queue).once("value").catch(() => null);
      const existingQueue = legacyQueueSnap ? snapshotToArray(legacyQueueSnap) : [];
      for (const item of existingQueue) {
        await db().ref(`${ROOT}/queue/${item.id}`).update({
          subject: item.subject || "(no subject)",
          html: item.htmlContent || "",
          text: htmlToText(item.htmlContent || ""),
          recipients: dedupeEmails(item.recipients || []),
          status: item.status === "sent" ? STATUS.SENT : STATUS.QUEUED,
          scheduledFor: item.scheduledFor || item.createdAt || nowIso(),
          createdAt: item.createdAt || nowIso(),
          sentAt: item.sentAt || null,
          isTest: !!item.isTestEmail,
          legacyId: item.id,
          deliveryStatus: item.deliveryStatus || { total: (item.recipients || []).length, sent: 0, failed: 0, bounced: 0 },
        });
        report.queueAdded += 1;
      }
    }

    return report;
  }

  /* ==================================================================
   *  Public surface
   * ================================================================== */

  window.MSMEmail = {
    BRAND,
    STATUS,
    STATUS_LABEL,
    OPEN_STATUS,
    ADAPTERS,
    STARTER_TEMPLATES,

    // plumbing
    waitForDb,
    esc,
    nowIso,
    formatDate,
    formatDateTime,
    toLocalInputValue,
    fromLocalInputValue,
    slugify,

    // recipients
    isValidEmail,
    normalizeEmail,
    parseRecipients,
    dedupeEmails,

    // lists
    listLists,
    getList,
    createList,
    updateList,
    deleteList,
    addToLists,
    removeEmailEverywhere,

    // suppressions
    listSuppressions,
    suppress,
    unsuppress,

    // audience
    resolveAudience,

    // rendering
    renderEmail,
    renderBlock,
    htmlToText,
    textToBlocks,
    fromStory,
    fromArticle,

    // templates
    listTemplates,
    saveTemplate,
    deleteTemplate,
    markTemplateUsed,

    // queue
    listQueue,
    getQueued,
    queueMessage,
    updateQueueRecord,
    sendNow,
    schedule,
    cancel,
    retry,
    deleteQueueRecord,
    analytics,

    // delivery
    getDelivery,
    saveDelivery,
    buildPayload,
    deliveryContract,

    // export
    toCSV,
    recipientsCSV,
    mailchimpCSV,
    downloadText,
    copyToClipboard,
    openPreview,

    // migration
    importLegacy,
  };
})();
