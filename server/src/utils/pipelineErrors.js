/**
 * Typed pipeline errors so the queue can react to them (e.g. skip retries).
 */

// Thrown when the LinkedIn scraper cannot authenticate (dead session or, most
// often, a security checkpoint). These must NOT be retried by the queue — each
// retry fires another headless login that trips the same checkpoint again.
export class LinkedInAuthError extends Error {
  constructor(message, { checkpoint = false } = {}) {
    super(message);
    this.name = 'LinkedInAuthError';
    this.code = 'LINKEDIN_AUTH';
    this.checkpoint = checkpoint;
  }
}
