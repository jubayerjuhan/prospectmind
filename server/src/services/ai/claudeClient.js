/**
 * AI Client compatibility layer.
 *
 * Existing pipeline code imports `askClaude()`. Keep that public API stable
 * while the provider underneath is Groq.
 */

import { askGroq } from './groqClient.js';

export const askClaude = askGroq;

export default askGroq;
