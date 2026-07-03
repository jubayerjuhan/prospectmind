import { askAI } from '../ai/claudeClient.js';

const GITHUB_API_URL = 'https://api.github.com';

const getHeaders = () => {
  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'ProspectMind-GTE',
  };
  if (process.env.GITHUB_TOKEN) {
    headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const generateKeywords = async (description, preferredAiModel = 'auto') => {
  if (!description?.trim()) return [];

  const systemPrompt = `You are a GitHub search query expert. Your goal is to generate 3 to 6 highly targeted search queries based on a user's talent requirement description.
These queries will be used against the GitHub Search API (q parameter).
Focus on technical keywords, languages, and ecosystems. Do NOT use search qualifiers like 'language:rust' or 'stars:>1000' unless absolutely necessary, stick to broad topic keywords.

Return ONLY a JSON object with a single array field "keywords" containing the search strings.`;

  const userPrompt = `User Description: "${description}"

Generate 3-6 GitHub search keywords.
Example output format:
{
  "keywords": ["solidity smart-contracts", "rust blockchain defi", "ethereum developer"]
}`;

  try {
    const { result } = await askAI(
      { systemPrompt, userPrompt, maxTokens: 256, jsonMode: true },
      { preferredProvider: preferredAiModel }
    );
    return result?.keywords || [];
  } catch (err) {
    console.error('[githubTalentScraper] Failed to generate keywords:', err.message);
    return [];
  }
};

export const searchRepositories = async (keywords, maxRepos = 10) => {
  const allRepos = new Map(); // Use Map to deduplicate by full_name
  const reposPerKeyword = Math.ceil(maxRepos / keywords.length) || 1;

  for (const keyword of keywords) {
    try {
      const res = await fetch(`${GITHUB_API_URL}/search/repositories?q=${encodeURIComponent(keyword)}&sort=stars&order=desc&per_page=${reposPerKeyword}`, {
        headers: getHeaders(),
      });
      
      if (!res.ok) {
        console.warn(`[githubTalentScraper] GitHub search failed for keyword "${keyword}": ${res.status} ${res.statusText}`);
        continue;
      }
      
      const data = await res.json();
      const repos = data.items || [];
      
      for (const repo of repos) {
        allRepos.set(repo.full_name, {
          name: repo.name,
          fullName: repo.full_name,
          description: repo.description,
          stars: repo.stargazers_count,
          language: repo.language,
          url: repo.html_url,
        });
      }
      
      // Delay to respect rate limits
      await delay(300);
      
    } catch (err) {
      console.error(`[githubTalentScraper] Error searching repos for keyword "${keyword}":`, err.message);
    }
  }

  // Convert map values to array, sort by stars, and limit to maxRepos
  return Array.from(allRepos.values())
    .sort((a, b) => (b.stars || 0) - (a.stars || 0))
    .slice(0, maxRepos);
};

export const fetchContributors = async (repoFullName) => {
  try {
    // Fetch up to 100 top contributors for the repo
    const res = await fetch(`${GITHUB_API_URL}/repos/${repoFullName}/contributors?per_page=100`, {
      headers: getHeaders(),
    });
    
    if (!res.ok) {
      console.warn(`[githubTalentScraper] Failed to fetch contributors for ${repoFullName}: ${res.status} ${res.statusText}`);
      return [];
    }
    
    const contributors = await res.json();
    return (Array.isArray(contributors) ? contributors : []).filter(c => c.type === 'User');
  } catch (err) {
    console.error(`[githubTalentScraper] Error fetching contributors for ${repoFullName}:`, err.message);
    return [];
  }
};

export const fetchUserProfile = async (username) => {
  try {
    const res = await fetch(`${GITHUB_API_URL}/users/${username}`, {
      headers: getHeaders(),
    });
    
    if (!res.ok) {
      console.warn(`[githubTalentScraper] Failed to fetch user profile for ${username}: ${res.status} ${res.statusText}`);
      return null;
    }
    
    return await res.json();
  } catch (err) {
    console.error(`[githubTalentScraper] Error fetching user profile for ${username}:`, err.message);
    return null;
  }
};

export const buildProspectData = (ghUser, sourceContext = '') => {
  // Try to parse out a first and last name from the full name
  const nameParts = (ghUser.name || ghUser.login).trim().split(/\s+/);
  const firstName = nameParts[0] || ghUser.login;
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';
  
  let rawX = null;
  if (ghUser.twitter_username) {
    rawX = `https://x.com/${ghUser.twitter_username}`;
  }
  
  let rawLinkedin = null;
  if (ghUser.blog && ghUser.blog.includes('linkedin.com/in/')) {
      rawLinkedin = ghUser.blog;
  }
  
  return {
    firstName,
    lastName,
    company: ghUser.company || '',
    typeHint: 'talent', // Default to talent
    description: sourceContext ? `Sourced from GitHub. Context: ${sourceContext}. Bio: ${ghUser.bio || 'None'}` : `Sourced from GitHub. Bio: ${ghUser.bio || 'None'}`,
    rawEmail: ghUser.email || '',
    rawGithub: ghUser.html_url || `https://github.com/${ghUser.login}`,
    rawLinkedin: rawLinkedin || '',
    rawX: rawX || '',
    // Additional data we can seed into the object for context or enrichment
    _githubContext: {
      bio: ghUser.bio,
      location: ghUser.location,
      blog: ghUser.blog,
      followers: ghUser.followers,
      publicRepos: ghUser.public_repos,
    }
  };
};
