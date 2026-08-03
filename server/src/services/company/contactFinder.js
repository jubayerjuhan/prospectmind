/**
 * Company Contact Finder — an AI agent over the company's OWN website.
 *
 * Mirrors companyAnalyzer.js's shape (gather context -> ask AI for structured
 * JSON -> persist on the Company doc, cached until `force`), but the context
 * here is a live multi-page site visit (companyContactScraper.js) rather than
 * search snippets/LinkedIn, and the goal is contact info, not a summary.
 */

import Company from '../../models/Company.js';
import { askClaude, AIFallbackRequiredError } from '../ai/claudeClient.js';
import { scrapeCompanySite } from '../scraper/companyContactScraper.js';
import { clipPromptText } from '../pipeline/profileSnapshot.js';

const SYSTEM_PROMPT = `You are a precision contact-research agent for a B2B prospect intelligence platform.
Given raw scraped content and links from a company's own website, identify legitimate ways to contact
this company or its people.

Only report contacts that are explicitly present in the provided content — never invent an email,
handle, name, or role. Prefer a named individual with a role (e.g. "Jane Doe, Head of Talent") over a
generic address when both are present for the same channel. Ignore placeholder/example addresses
(info@example.com, test@..., etc.) and any link that is clearly not the company's own (ad networks,
cookie-consent vendors, unrelated third parties).

Always return valid JSON.`;

/**
 * Find (or re-find, with force) contact info for a company by scraping its
 * own website. Requires company.website — callers should guard that
 * themselves (see companyController.js's 409 NO_WEBSITE check).
 *
 * @param {String|Object} companyOrId
 * @param {Object} opts
 * @param {Function} opts.callAI  AI caller (defaults to askClaude)
 * @param {Boolean} opts.force    Re-scan even if already scanned
 * @returns {Promise<Object|null>} the updated company, or null if not found
 */
export const findCompanyContacts = async (companyOrId, { callAI = askClaude, force = false } = {}) => {
  const company =
    typeof companyOrId === 'object' && companyOrId?._id
      ? companyOrId
      : await Company.findById(companyOrId);
  if (!company) return null;
  if (!company.website) return company;

  if (company.contactsScannedAt && !force) {
    return company;
  }

  const scraped = await scrapeCompanySite(company.website);
  if (!scraped?.text) {
    console.warn(`[contactFinder] No content scraped from ${company.website} for "${company.name}" — skipping`);
    return company;
  }

  const rawLinksText = scraped.rawLinks.length
    ? scraped.rawLinks.map((l) => `- ${l.type}: ${l.value}`).join('\n')
    : '(none found)';

  const userPrompt = `Find contact info for this company from its own website.

Company name: ${company.name}
Website: ${company.website}
Pages visited: ${scraped.pagesVisited.join(', ')}

=== LINKS FOUND ON THE SITE (already classified — use these as candidates, don't invent others) ===
${rawLinksText}

=== SITE TEXT ===
${clipPromptText(scraped.text, 5000)}

Return JSON:
{
  "contacts": [
    {
      "type": "email" | "phone" | "twitter" | "linkedin" | "telegram" | "discord" | "github" | "person",
      "value": "the email address, phone number, or profile URL — required",
      "name": "person's name, only for type 'person' or when a name is clearly tied to this contact channel",
      "role": "person's title/role, only when known"
    }
  ]
}`;

  try {
    const result = await callAI({ systemPrompt: SYSTEM_PROMPT, userPrompt, maxTokens: 1024, jsonMode: true, thinkingBudget: 0 });

    const contacts = (Array.isArray(result?.contacts) ? result.contacts : [])
      .filter((c) => c?.type && c?.value)
      .map((c) => ({
        type: String(c.type),
        value: String(c.value).trim(),
        name: typeof c.name === 'string' ? c.name.trim() : '',
        role: typeof c.role === 'string' ? c.role.trim() : '',
        source: 'website',
        detectedAt: new Date(),
      }));

    company.contacts = contacts;
    company.contactsScannedAt = new Date();
    company.sourceRefs.push({
      source: 'website-contact-scan',
      url: company.website,
      note: `${scraped.pagesVisited.length} page(s) scanned`,
    });

    await company.save();
    console.log(`[contactFinder] ✅ Found ${contacts.length} contact(s) for "${company.name}"`);
    return company;
  } catch (error) {
    if (error instanceof AIFallbackRequiredError) {
      console.warn(`[contactFinder] AI fallback for "${company.name}" — contact scan skipped`);
      return company;
    }
    console.warn(`[contactFinder] Failed for "${company.name}": ${error.message}`);
    return company;
  }
};
