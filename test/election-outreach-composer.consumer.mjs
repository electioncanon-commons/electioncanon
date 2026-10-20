// ============================================================
// OUTREACH ACTIVATION — BRANDED HTML EMAIL COMPOSER TESTS  (Launch
// Engine closed-loop, Phase 7)
// Covers: src/domains/outreach/composer.js
// ============================================================

import {
  TEAL, escapeHtml, splitParagraphs, validateLogoUrl, validateComposerInput, buildBrandedEmail,
} from "../src/domains/outreach/composer.js";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };

console.log("\nOUTREACH ACTIVATION — branded HTML email composer\n");

console.log("A — escapeHtml() (the only path user text takes into HTML)");
{
  ok("1. escapes the five dangerous characters", escapeHtml(`<script>&"'</script>`) === "&lt;script&gt;&amp;&quot;&#39;&lt;/script&gt;");
  ok("2. a plain string with nothing dangerous passes through unchanged", escapeHtml("Hello World") === "Hello World");
  ok("3. null/undefined never throws", escapeHtml(null) === "" && escapeHtml(undefined) === "");
}

console.log("\nB — splitParagraphs()");
{
  ok("1. splits on a blank line", splitParagraphs("Para one.\n\nPara two.").length === 2);
  ok("2. a single newline within a paragraph does NOT split it", splitParagraphs("Line one.\nLine two.").length === 1);
  ok("3. trims and drops empty paragraphs", splitParagraphs("\n\nOnly one.\n\n\n").length === 1);
}

console.log("\nC — validateLogoUrl() (Phase 7's 'stable HTTPS, never an expiring sandbox URL' rule)");
{
  ok("1. null/absent is valid (falls back to the text wordmark)", validateLogoUrl(null).valid === true);
  ok("2. a real https URL on a plausible durable domain is valid", validateLogoUrl("https://electioncanon.org/logo.png").valid === true);
  ok("3. plain http:// is rejected", validateLogoUrl("http://electioncanon.org/logo.png").valid === false);
  ok("4. a file: URL is rejected", validateLogoUrl("file:///C:/logo.png").valid === false);
  ok("5. a data: URI is rejected", validateLogoUrl("data:image/png;base64,abc").valid === false);
  ok("6. localhost is rejected", validateLogoUrl("https://localhost/logo.png").valid === false);
  ok("7. a bare IP address is rejected", validateLogoUrl("https://127.0.0.1/logo.png").valid === false);
  ok("8. a known ephemeral preview/sandbox hostname fragment is rejected", validateLogoUrl("https://my-preview.vercel.app/logo.png").valid === false);
  ok("9. a malformed URL string is rejected, not thrown", validateLogoUrl("not a url").valid === false);
}

console.log("\nD — validateComposerInput()");
{
  ok("1. a valid subject+body passes", validateComposerInput({ subject: "Hi", bodyText: "Body text." }).valid === true);
  ok("2. an empty subject is rejected", validateComposerInput({ subject: "", bodyText: "Body." }).valid === false);
  ok("3. an overlong subject is rejected", validateComposerInput({ subject: "x".repeat(301), bodyText: "Body." }).valid === false);
  ok("4. an empty body is rejected", validateComposerInput({ subject: "Hi", bodyText: "" }).valid === false);
  ok("5. a bad logoUrl is rejected even with an otherwise-valid subject/body", validateComposerInput({ subject: "Hi", bodyText: "Body.", logoUrl: "http://x.com/a.png" }).valid === false);
}

console.log("\nE — buildBrandedEmail() (the final HTML/text pair)");
{
  const result = buildBrandedEmail({
    subject: "Hello <there>", bodyText: "First paragraph.\n\nSecond paragraph with a <tag> & an ampersand.",
    recipientName: "Jane O'Brien", organization: "Example Org",
  });
  ok("1. succeeds with no logoUrl (text wordmark path)", result.valid === true);
  ok("2. the HTML contains the escaped subject", result.html.includes("Hello &lt;there&gt;"));
  ok("3. the recipient name is escaped (apostrophe) in the HTML greeting", result.html.includes("Jane O&#39;Brien"));
  ok("4. a literal <tag> in the body is escaped, never rendered as real markup", result.html.includes("&lt;tag&gt;") && !result.html.includes("<tag>"));
  ok("5. the brand teal color appears in the HTML", result.html.includes(TEAL));
  ok("6. no local file path or sandbox URL appears anywhere in the HTML (no logoUrl was given, so no <img> tag at all)", !result.html.includes("<img"));
  ok("7. the plain-text alternative contains the UNESCAPED recipient name (not HTML entities)", result.text.includes("Jane O'Brien") && !result.text.includes("&#39;"));
  ok("8. the plain-text alternative contains the real body text verbatim", result.text.includes("Second paragraph with a <tag> & an ampersand."));
  ok("9. both the subject field and the HTML <title> carry the same (escaped) subject", result.subject === "Hello <there>" && result.html.includes("<title>Hello &lt;there&gt;</title>"));
  ok("10. a hidden preheader div is omitted when no preheader is given", !result.html.includes('style="display:none;max-height:0'));

  const withPreheader = buildBrandedEmail({ subject: "Hi", bodyText: "Body.", preheader: "A short preview line" });
  ok("11. a given preheader IS rendered in a hidden div", withPreheader.html.includes("A short preview line") && withPreheader.html.includes("display:none"));

  const noPersonalization = buildBrandedEmail({ subject: "Hi", bodyText: "Body." });
  ok("12. with no recipientName/organization, no fabricated greeting name is inserted", !noPersonalization.html.includes("Dear ,"));

  const badLogo = buildBrandedEmail({ subject: "Hi", bodyText: "Body.", logoUrl: "http://not-https.com/x.png" });
  ok("13. an invalid logoUrl fails the whole build rather than silently falling back", badLogo.valid === false && badLogo.html === null);

  const withLogo = buildBrandedEmail({ subject: "Hi", bodyText: "Body.", logoUrl: "https://electioncanon.org/logo.png" });
  ok("14. a valid logoUrl is embedded as a real <img> tag with non-empty alt text", /<img src="https:\/\/electioncanon\.org\/logo\.png" alt="ElectionCanon"/.test(withLogo.html));
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
process.exit(fail ? 1 : 0);
