const normalizeWhitespace = (value = '') =>
  String(value)
    .replace(/\s+/g, ' ')
    .trim();

const clipText = (value, maxLength) => {
  const normalized = normalizeWhitespace(value);
  if (!normalized || normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
};

const clipList = (items = [], limit = 5, itemMaxLength = 120) =>
  (Array.isArray(items) ? items : [])
    .filter(Boolean)
    .slice(0, limit)
    .map((item) => clipText(item, itemMaxLength));

export const buildProfileSnapshot = (profile = {}, { includeContact = true } = {}) => {
  const snapshot = {
    currentRole: clipText(profile.currentRole, 120),
    seniority: profile.seniority || 'unknown',
    yearsOfExperience: profile.yearsOfExperience ?? null,
    location: clipText(profile.location, 120),
    founderExperience: Boolean(profile.founderExperience),
    web3NativeScore: profile.web3NativeScore ?? null,
    influenceLevel: profile.influenceLevel || 'unknown',
    programmingLanguages: clipList(profile.programmingLanguages, 8, 40),
    blockchainEcosystems: clipList(profile.blockchainEcosystems, 8, 40),
    frameworks: clipList(profile.frameworks, 8, 40),
    previousCompanies: clipList(profile.previousCompanies, 8, 60),
    recentActivity: clipList(profile.recentActivity, 4, 180),
    daoInvolvement: clipList(profile.daoInvolvement, 4, 80),
    bio: clipText(profile.bio, 320),
    githubStats: profile.githubStats
      ? {
          repos: profile.githubStats.repos ?? null,
          stars: profile.githubStats.stars ?? null,
          contributions: profile.githubStats.contributions ?? null,
          topLanguages: clipList(profile.githubStats.topLanguages, 6, 40),
        }
      : null,
    experience: (Array.isArray(profile.experience) ? profile.experience : []).slice(0, 4).map((item) => ({
      title: clipText(item?.title, 80),
      company: clipText(item?.company, 80),
      duration: clipText(item?.duration, 60),
      location: clipText(item?.location, 80),
      description: clipText(item?.description, 180),
      skills: clipList(item?.skills, 5, 40),
    })),
    education: (Array.isArray(profile.education) ? profile.education : []).slice(0, 3).map((item) => ({
      institution: clipText(item?.institution, 120),
      degree: clipText(item?.degree, 120),
    })),
  };

  if (includeContact) {
    snapshot.contact = {
      linkedinUrl: clipText(profile.linkedinUrl, 180),
      githubUrl: clipText(profile.githubUrl, 180),
      xUrl: clipText(profile.xUrl, 180),
      telegramHandle: clipText(profile.telegramHandle, 80),
      email: clipText(profile.email, 120),
    };
  }

  return snapshot;
};

export const clipPromptText = (value, maxLength = 1200) => clipText(value, maxLength);
