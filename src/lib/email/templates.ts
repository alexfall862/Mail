/**
 * Email templates (SPEC §12): plain, mobile-friendly HTML plus a text part.
 * Every vendor email footer carries the magic link; admin emails never do.
 */

export type EmailContent = {
  template: string;
  subject: string;
  html: string;
  text: string;
};

export type ProjectSummary = {
  /** Short per-project handle (see projectRef); keeps threads apart. */
  ref: string;
  candidateSupported: string;
  officeLabel: string;
  mailDateFormatted: string;
};

const styles = {
  body: "margin:0;padding:0;background-color:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827;",
  card: "max-width:560px;margin:24px auto;background:#ffffff;border-radius:8px;padding:32px;",
  h1: "font-size:20px;margin:0 0 16px 0;color:#111827;",
  p: "font-size:15px;line-height:1.6;margin:0 0 14px 0;color:#374151;",
  notes:
    "font-size:15px;line-height:1.6;margin:0 0 14px 0;color:#111827;background:#fef3c7;border-radius:6px;padding:14px;white-space:pre-wrap;",
  button:
    "display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:6px;font-size:15px;",
  footer:
    "font-size:13px;color:#6b7280;margin:24px 0 0 0;border-top:1px solid #e5e7eb;padding-top:16px;line-height:1.6;",
};

function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function wrap(opts: {
  /** The project this email belongs to — its ref anchors the footer.
   * Null for emails spanning several projects. */
  p: ProjectSummary | null;
  heading: string;
  bodyHtml: string;
  /** Vendor/reviewer emails: the recipient's private link for the footer. */
  magicLink?: string | null;
  /** Footer label for that link (default: vendor status wording). */
  linkLabel?: string;
}): { html: string } {
  const label = opts.linkLabel ?? "Check status anytime";
  const ref = opts.p ? `Project ref #${esc(opts.p.ref)}` : "KDP Mail Program";
  const footer = opts.magicLink
    ? `<p style="${styles.footer}">${ref}<br/>${esc(label)}: <a href="${esc(opts.magicLink)}">${esc(opts.magicLink)}</a></p>`
    : `<p style="${styles.footer}">${ref}<br/>KDP Mail Program internal notification.</p>`;
  return {
    html: `<!doctype html><html><body style="${styles.body}"><div style="${styles.card}"><h1 style="${styles.h1}">${esc(opts.heading)}</h1>${opts.bodyHtml}${footer}</div></body></html>`,
  };
}

function footerText(
  p: ProjectSummary,
  link: string | null,
  label: string,
): string {
  const ref = `Project ref #${p.ref}`;
  return link
    ? `\n\n--\n${ref}\n${label}: ${link}`
    : `\n\n--\n${ref}`;
}

function vendorFooterText(p: ProjectSummary, magicLink: string | null): string {
  return footerText(p, magicLink, "Check status anytime");
}

/** Admin/internal emails: no link, but the same quotable project ref. */
function adminFooterText(p: ProjectSummary): string {
  return footerText(p, null, "");
}

function pieceLine(p: ProjectSummary): string {
  return `${p.candidateSupported} (${p.officeLabel}), mailing ${p.mailDateFormatted}`;
}

/** Every subject opens with this so recipients can filter/search "[KDP Mail". */
export const SUBJECT_PREFIX = "[KDP Mail";

/**
 * Subjects are unique per project. Mail clients thread on the normalized
 * subject whenever References doesn't resolve (Outlook's conversation topic,
 * Gmail's fallback), so three pieces for one candidate used to collapse into a
 * single chain that reviewers couldn't tell apart. The ref in the prefix gives
 * every project its own thread and a handle people can quote back to us.
 */
function subj(p: ProjectSummary, subject: string): string {
  return `${SUBJECT_PREFIX} #${p.ref}] ${subject}`;
}

/* ------------------------------------------------------------------ 1 */
export function vendorConfirmation(
  p: ProjectSummary,
  magicLink: string,
): EmailContent {
  const subject = subj(p, `Submission received: ${p.candidateSupported}`);
  const bodyHtml =
    `<p style="${styles.p}">Thanks. We received your mail piece submission for <strong>${esc(pieceLine(p))}</strong>.</p>` +
    `<p style="${styles.p}">It now goes through four review steps: content review, campaign review, legal review, and final review. You'll get an email at each step, and if anything needs to change we'll send you the reviewer's notes with instructions to resubmit.</p>` +
    `<p style="${styles.p}"><a href="${esc(magicLink)}" style="${styles.button}">View your project status</a></p>` +
    `<p style="${styles.p}"><strong>Bookmark that link.</strong> It's your private page for this project. No account or password needed.</p>`;
  const text =
    `Thanks. We received your mail piece submission for ${pieceLine(p)}.\n\n` +
    `It now goes through three review steps: content review, legal review, and final review. You'll get an email at each step, and if anything needs to change we'll send you the reviewer's notes with instructions to resubmit.\n\n` +
    `View your project status: ${magicLink}\n\n` +
    `Bookmark that link. It's your private page for this project. No account or password needed.` +
    vendorFooterText(p, magicLink);
  return {
    template: "vendor_confirmation",
    subject,
    ...wrap({ p, heading: "Submission received", bodyHtml, magicLink }),
    text,
  };
}

/* ------------------------------------------------------------------ 2 */
export function adminNewSubmission(
  p: ProjectSummary,
  adminUrl: string,
): EmailContent {
  const subject = subj(p, `New mail submission: ${p.candidateSupported} (mails ${p.mailDateFormatted})`);
  const bodyHtml =
    `<p style="${styles.p}">A new mail piece was submitted:</p>` +
    `<p style="${styles.p}"><strong>${esc(p.candidateSupported)}</strong><br/>${esc(p.officeLabel)}<br/>Mail date: ${esc(p.mailDateFormatted)}</p>` +
    `<p style="${styles.p}">It's waiting in content review.</p>` +
    `<p style="${styles.p}"><a href="${esc(adminUrl)}" style="${styles.button}">Open in the review dashboard</a></p>`;
  const text =
    `A new mail piece was submitted:\n\n${p.candidateSupported}\n${p.officeLabel}\nMail date: ${p.mailDateFormatted}\n\nIt's waiting in content review.\n\nOpen it: ${adminUrl}` + adminFooterText(p);
  return {
    template: "admin_new_submission",
    subject,
    ...wrap({ p, heading: "New mail submission", bodyHtml }),
    text,
  };
}

/* ------------------------------------------------------------------ 3 */
export function vendorStagePassed(
  p: ProjectSummary,
  stageLabel: string,
  nextStageLabel: string,
  magicLink: string | null,
): EmailContent {
  const subject = subj(p, `${p.candidateSupported}: passed ${stageLabel.toLowerCase()}`);
  const bodyHtml =
    `<p style="${styles.p}">Good news. Your mail piece for <strong>${esc(pieceLine(p))}</strong> passed <strong>${esc(stageLabel.toLowerCase())}</strong>.</p>` +
    `<p style="${styles.p}">It has moved on to ${esc(nextStageLabel.toLowerCase())}. No action is needed from you right now.</p>`;
  const text =
    `Good news. Your mail piece for ${pieceLine(p)} passed ${stageLabel.toLowerCase()}.\n\n` +
    `It has moved on to ${nextStageLabel.toLowerCase()}. No action is needed from you right now.` +
    vendorFooterText(p, magicLink);
  return {
    template: "vendor_stage_passed",
    subject,
    ...wrap({ p, heading: `Passed ${stageLabel.toLowerCase()}`, bodyHtml, magicLink }),
    text,
  };
}

/* ------------------------------------------------------------------ 4 */
export function vendorChangesRequested(
  p: ProjectSummary,
  stageLabel: string,
  notes: string,
  magicLink: string,
): EmailContent {
  const subject = subj(p, `${p.candidateSupported}: changes requested`);
  const bodyHtml =
    `<p style="${styles.p}">The reviewer at <strong>${esc(stageLabel.toLowerCase())}</strong> requested changes to your mail piece for <strong>${esc(pieceLine(p))}</strong>:</p>` +
    `<p style="${styles.notes}">${esc(notes)}</p>` +
    `<p style="${styles.p}">To resubmit: open your project page below, update the fields or files the reviewer flagged (anything you don't replace carries over), and submit the revision. Review picks back up automatically.</p>` +
    `<p style="${styles.p}"><a href="${esc(magicLink)}" style="${styles.button}">Open your project &amp; resubmit</a></p>`;
  const text =
    `The reviewer at ${stageLabel.toLowerCase()} requested changes to your mail piece for ${pieceLine(p)}:\n\n` +
    `${notes}\n\n` +
    `To resubmit: open your project page (${magicLink}), update the fields or files the reviewer flagged (anything you don't replace carries over), and submit the revision. Review picks back up automatically.` +
    vendorFooterText(p, magicLink);
  return {
    template: "vendor_changes_requested",
    subject,
    ...wrap({ p, heading: "Changes requested", bodyHtml, magicLink }),
    text,
  };
}

/* ------------------------------------------------------------------ 5 */
export function vendorApproved(
  p: ProjectSummary,
  magicLink: string | null,
): EmailContent {
  const subject = subj(p, `${p.candidateSupported}: approved, cleared to print`);
  const bodyHtml =
    `<p style="${styles.p}">Your mail piece for <strong>${esc(pieceLine(p))}</strong> has completed all reviews and is <strong>approved. You are cleared to print and mail.</strong></p>` +
    `<p style="${styles.p}">Keep this email for your records. If anything about the piece changes before it mails, contact KDP before printing.</p>`;
  const text =
    `Your mail piece for ${pieceLine(p)} has completed all reviews and is APPROVED. You are cleared to print and mail.\n\n` +
    `Keep this email for your records. If anything about the piece changes before it mails, contact KDP before printing.` +
    vendorFooterText(p, magicLink);
  return {
    template: "vendor_approved",
    subject,
    ...wrap({ p, heading: "Approved: cleared to print", bodyHtml, magicLink }),
    text,
  };
}

/* ------------------------------------------------------------------ 6 */
export function vendorDenied(
  p: ProjectSummary,
  reason: string,
  magicLink: string | null,
): EmailContent {
  const subject = subj(p, `${p.candidateSupported}: submission denied`);
  const bodyHtml =
    `<p style="${styles.p}">We're sorry. Your mail piece for <strong>${esc(pieceLine(p))}</strong> was denied. The reviewer's reason:</p>` +
    `<p style="${styles.notes}">${esc(reason)}</p>` +
    `<p style="${styles.p}">If you believe this was decided in error or want to discuss next steps, reply to this email and the mail program team will follow up.</p>`;
  const text =
    `We're sorry. Your mail piece for ${pieceLine(p)} was denied. The reviewer's reason:\n\n` +
    `${reason}\n\n` +
    `If you believe this was decided in error or want to discuss next steps, reply to this email and the mail program team will follow up.` +
    vendorFooterText(p, magicLink);
  return {
    template: "vendor_denied",
    subject,
    ...wrap({ p, heading: "Submission denied", bodyHtml, magicLink }),
    text,
  };
}

/* ------------------------------------------------------------------ 7 */
export function adminResubmission(
  p: ProjectSummary,
  versionNumber: number,
  vendorNote: string | null,
  adminUrl: string,
): EmailContent {
  const subject = subj(p, `Resubmitted (v${versionNumber}): ${p.candidateSupported}`);
  const noteHtml = vendorNote
    ? `<p style="${styles.p}">Vendor note:</p><p style="${styles.notes}">${esc(vendorNote)}</p>`
    : `<p style="${styles.p}">The vendor didn't include a note.</p>`;
  const bodyHtml =
    `<p style="${styles.p}">Version ${versionNumber} of <strong>${esc(pieceLine(p))}</strong> was resubmitted and is back in review.</p>` +
    noteHtml +
    `<p style="${styles.p}"><a href="${esc(adminUrl)}" style="${styles.button}">Review the new version</a></p>`;
  const text =
    `Version ${versionNumber} of ${pieceLine(p)} was resubmitted and is back in review.\n\n` +
    (vendorNote ? `Vendor note:\n${vendorNote}\n\n` : `The vendor didn't include a note.\n\n`) +
    `Review it: ${adminUrl}` +
    adminFooterText(p);
  return {
    template: "admin_resubmission",
    subject,
    ...wrap({ p, heading: `Version ${versionNumber} resubmitted`, bodyHtml }),
    text,
  };
}

/* ------------------------------------------------------------------ 8 */
export function vendorLinkRegenerated(
  p: ProjectSummary,
  magicLink: string,
): EmailContent {
  const subject = subj(p, `${p.candidateSupported}: your status link was replaced`);
  const bodyHtml =
    `<p style="${styles.p}">KDP generated a new private status link for your mail piece <strong>${esc(pieceLine(p))}</strong>. The old link no longer works.</p>` +
    `<p style="${styles.p}"><a href="${esc(magicLink)}" style="${styles.button}">Open your new status link</a></p>` +
    `<p style="${styles.p}">Please update your bookmark.</p>`;
  const text =
    `KDP generated a new private status link for your mail piece ${pieceLine(p)}. The old link no longer works.\n\n` +
    `Your new link: ${magicLink}\n\nPlease update your bookmark.` +
    vendorFooterText(p, magicLink);
  return {
    template: "vendor_link_regenerated",
    subject,
    ...wrap({ p, heading: "New status link", bodyHtml, magicLink }),
    text,
  };
}

/* --------------------------- campaign review request (admin-triggered) */
export function campaignReviewRequest(
  p: ProjectSummary,
  primaryOrgs: string[],
  reviewLink: string | null,
): EmailContent {
  const partners =
    primaryOrgs.length > 0 ? primaryOrgs.join(" and ") : "our mail vendors";
  const subject = subj(p, `Please review: mail piece supporting ${p.candidateSupported}`);
  const reviewButton = reviewLink
    ? `<p style="${styles.p}"><a href="${esc(reviewLink)}" style="${styles.button}">Review &amp; approve the mail piece</a></p>`
    : "";
  const bodyHtml =
    `<p style="${styles.p}">Congratulations. The Kansas Democratic Party has decided to invest in your race and will be printing and mailing a mail piece in support of your campaign.</p>` +
    `<p style="${styles.p}">We would like you to review it for any content that is not accurate, and to otherwise be aware that this mailer is currently scheduled to be sent on <strong>${esc(p.mailDateFormatted)}</strong>, working with ${esc(partners)}.</p>` +
    `<p style="${styles.p}">The button below opens your private review page. If everything looks right, approve it there: your sign-off is recorded and the piece moves straight to the next review step. If something is off, flag the issue on the same page and the mail program team will follow up.</p>` +
    reviewButton;
  const text =
    `Congratulations. The Kansas Democratic Party has decided to invest in your race and will be printing and mailing a mail piece in support of your campaign.\n\n` +
    `We would like you to review it for any content that is not accurate, and to otherwise be aware that this mailer is currently scheduled to be sent on ${p.mailDateFormatted}, working with ${partners}.\n\n` +
    `The link below opens your private review page. If everything looks right, approve it there: your sign-off is recorded and the piece moves straight to the next review step. If something is off, flag the issue on the same page and the mail program team will follow up.` +
    (reviewLink ? `\n\nReview & approve the mail piece: ${reviewLink}` : "") +
    footerText(p, reviewLink, "Your private review page");
  return {
    template: "campaign_review_request",
    subject,
    ...wrap({
      p,
      heading: "Please review this mail piece",
      bodyHtml,
      magicLink: reviewLink,
      linkLabel: "Your private review page",
    }),
    text,
  };
}

/* --------------------------- reviewer notice (admin-triggered, any stage) */
export function reviewerNotice(
  p: ProjectSummary,
  stageLabel: string,
  reviewLink: string | null,
): EmailContent {
  const subject = subj(p, `${stageLabel} needed: mail piece supporting ${p.candidateSupported}`);
  const reviewButton = reviewLink
    ? `<p style="${styles.p}"><a href="${esc(reviewLink)}" style="${styles.button}">Review &amp; give feedback</a></p>`
    : "";
  const bodyHtml =
    `<p style="${styles.p}">The KDP Mail Program has a piece awaiting <strong>${esc(stageLabel.toLowerCase())}</strong>:</p>` +
    `<p style="${styles.p}"><strong>${esc(p.candidateSupported)}</strong><br/>${esc(p.officeLabel)}<br/>Scheduled mail date: ${esc(p.mailDateFormatted)}</p>` +
    `<p style="${styles.p}">Please take a look and record your feedback. Approval or any issues you spot can be marked on the review page below. Feedback recorded there is logged for the team automatically; replying to this email works too.</p>` +
    reviewButton;
  const text =
    `The KDP Mail Program has a piece awaiting ${stageLabel.toLowerCase()}:\n\n` +
    `${p.candidateSupported}\n${p.officeLabel}\nScheduled mail date: ${p.mailDateFormatted}\n\n` +
    `Please take a look and record your feedback. Approval or any issues you spot can be marked on the review page below. Feedback recorded there is logged for the team automatically; replying to this email works too.` +
    (reviewLink ? `\n\nReview & give feedback: ${reviewLink}` : "") +
    footerText(p, reviewLink, "Your private review page");
  return {
    template: "reviewer_notice",
    subject,
    ...wrap({
      p,
      heading: `${stageLabel} needed`,
      bodyHtml,
      magicLink: reviewLink,
      linkLabel: "Your private review page",
    }),
    text,
  };
}

/* -------------- review reminder (admin-triggered, same link as before) */
export function reviewReminder(
  p: ProjectSummary,
  stageLabel: string,
  reviewLink: string,
  opts: { campaignContact: boolean; sameLink: boolean },
): EmailContent {
  const subject = subj(p, `Reminder: ${stageLabel.toLowerCase()} needed for mail piece supporting ${p.candidateSupported}`);
  const action = opts.campaignContact
    ? "If everything looks right, approve it on your review page and the piece moves straight to the next step. If something is off, flag the issue there and the mail program team will follow up."
    : "Approval or any issues you spot can be marked on your review page. Feedback recorded there is logged for the team automatically; replying to this email works too.";
  const linkNote = opts.sameLink
    ? "This is the same private link we sent earlier."
    : "This link replaces the one we sent earlier.";
  const bodyHtml =
    `<p style="${styles.p}">A quick reminder: we're still waiting on your review of this mail piece.</p>` +
    `<p style="${styles.p}"><strong>${esc(p.candidateSupported)}</strong><br/>${esc(p.officeLabel)}<br/>Scheduled mail date: ${esc(p.mailDateFormatted)}</p>` +
    `<p style="${styles.p}">${esc(action)} ${esc(linkNote)}</p>` +
    `<p style="${styles.p}"><a href="${esc(reviewLink)}" style="${styles.button}">Open your review page</a></p>`;
  const text =
    `A quick reminder: we're still waiting on your review of this mail piece.\n\n` +
    `${p.candidateSupported}\n${p.officeLabel}\nScheduled mail date: ${p.mailDateFormatted}\n\n` +
    `${action} ${linkNote}\n\n` +
    `Open your review page: ${reviewLink}` +
    footerText(p, reviewLink, "Your private review page");
  return {
    template: "review_reminder",
    subject,
    ...wrap({
      p,
      heading: "Reminder: your review is needed",
      bodyHtml,
      magicLink: reviewLink,
      linkLabel: "Your private review page",
    }),
    text,
  };
}

/* ------- grouped review reminder: every outstanding review for one person */
export type GroupedReminderItem = {
  p: ProjectSummary;
  stageLabel: string;
  reviewLink: string;
  campaignContact: boolean;
  /** False when this link replaces one sent earlier. */
  sameLink: boolean;
};

export function reviewReminderGrouped(
  recipientName: string,
  items: GroupedReminderItem[],
): EmailContent {
  const n = items.length;
  const subject = `${SUBJECT_PREFIX}] Reminder: ${n} mail piece${n === 1 ? "" : "s"} awaiting your review`;
  const greeting = recipientName ? `Hi ${recipientName},` : "Hello,";
  const anyCampaign = items.some((i) => i.campaignContact);
  const intro = `A quick reminder: we're still waiting on your review of the ${n === 1 ? "mail piece" : `${n} mail pieces`} below, soonest mail date first. Each has its own private review page.`;
  const howTo =
    "Approval or any issues you spot can be marked on each review page. Feedback recorded there is logged for the team automatically." +
    (anyCampaign
      ? " For pieces marked campaign sign-off, your approval moves the piece straight to the next step."
      : "");
  const itemNote = (i: GroupedReminderItem) =>
    [
      i.campaignContact ? "campaign sign-off" : "",
      i.sameLink ? "" : "new link, replaces the earlier one",
    ]
      .filter(Boolean)
      .join(" · ");

  const itemsHtml = items
    .map((i) => {
      const note = itemNote(i);
      return (
        `<p style="${styles.p}"><strong>${esc(i.p.candidateSupported)}</strong> (${esc(i.p.officeLabel)})<br/>` +
        `${esc(i.stageLabel)} · mailing ${esc(i.p.mailDateFormatted)} · ref #${esc(i.p.ref)}` +
        (note ? `<br/><em>${esc(note)}</em>` : "") +
        `<br/><a href="${esc(i.reviewLink)}">Open review page</a></p>`
      );
    })
    .join("");
  const bodyHtml =
    `<p style="${styles.p}">${esc(greeting)}</p>` +
    `<p style="${styles.p}">${esc(intro)}</p>` +
    itemsHtml +
    `<p style="${styles.p}">${esc(howTo)}</p>`;

  const itemsText = items
    .map((i) => {
      const note = itemNote(i);
      return (
        `- ${i.p.candidateSupported} (${i.p.officeLabel})\n` +
        `  ${i.stageLabel} · mailing ${i.p.mailDateFormatted} · ref #${i.p.ref}\n` +
        (note ? `  (${note})\n` : "") +
        `  Review page: ${i.reviewLink}`
      );
    })
    .join("\n\n");
  const text =
    `${greeting}\n\n${intro}\n\n${itemsText}\n\n${howTo}\n\n--\nKDP Mail Program`;

  return {
    template: "review_reminder_grouped",
    subject,
    ...wrap({ p: null, heading: "Reminder: your reviews are needed", bodyHtml }),
    text,
  };
}

/* ------------------- campaign sign-off landed (internal, admin-only) */
export function adminCampaignApproved(
  p: ProjectSummary,
  contactName: string,
  contactEmail: string,
  adminUrl: string,
): EmailContent {
  const who = contactName ? `${contactName} (${contactEmail})` : contactEmail;
  const subject = subj(p, `Campaign signed off: ${p.candidateSupported}`);
  const bodyHtml =
    `<p style="${styles.p}"><strong>${esc(who)}</strong> approved <strong>${esc(pieceLine(p))}</strong> on their review page.</p>` +
    `<p style="${styles.p}">The project has moved from campaign review to legal review. The vendor was not emailed for this step.</p>` +
    `<p style="${styles.p}"><a href="${esc(adminUrl)}" style="${styles.button}">Open the project</a></p>`;
  const text =
    `${who} approved ${pieceLine(p)} on their review page.\n\n` +
    `The project has moved from campaign review to legal review. The vendor was not emailed for this step.\n\n` +
    `Open it: ${adminUrl}` +
    adminFooterText(p);
  return {
    template: "admin_campaign_approved",
    subject,
    ...wrap({ p, heading: "Campaign signed off", bodyHtml }),
    text,
  };
}

/* ------------------------------------------- §5 row 10 (admin notice) */
export function adminReopened(
  p: ProjectSummary,
  reason: string,
  reopenedBy: string,
  adminUrl: string,
): EmailContent {
  const subject = subj(p, `Reopened: ${p.candidateSupported}`);
  const bodyHtml =
    `<p style="${styles.p}"><strong>${esc(reopenedBy)}</strong> reopened <strong>${esc(pieceLine(p))}</strong>. It's back in final review.</p>` +
    `<p style="${styles.p}">Reason:</p><p style="${styles.notes}">${esc(reason)}</p>` +
    `<p style="${styles.p}"><a href="${esc(adminUrl)}" style="${styles.button}">Open the project</a></p>`;
  const text =
    `${reopenedBy} reopened ${pieceLine(p)}. It's back in final review.\n\nReason:\n${reason}\n\nOpen it: ${adminUrl}` + adminFooterText(p);
  return {
    template: "admin_reopened",
    subject,
    ...wrap({ p, heading: "Project reopened", bodyHtml }),
    text,
  };
}
