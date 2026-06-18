// TabNest — shared category definitions for auto-grouping.
// Each nest has a name, emoji, a hex theme color (UI), a Chrome tab-group color
// (one of: grey, blue, red, yellow, green, pink, purple, cyan, orange), a set
// of domain matchers, and optional title-keyword matchers.

const CATEGORIES = [
  {
    id: 'code',
    name: 'Code',
    icon: '🪵',
    color: '#8B6F47',
    chromeColor: 'orange',
    domains: [
      'github.com', 'gitlab.com', 'bitbucket.org',
      'stackoverflow.com', 'stackexchange.com',
      'codepen.io', 'jsfiddle.net', 'replit.com', 'codesandbox.io',
      'dev.to', 'hackernoon.com', 'leetcode.com', 'hackerrank.com',
      'npmjs.com', 'pypi.org', 'rubygems.org', 'crates.io'
    ],
    keywords: ['github', 'commit', 'pull request', 'bug', 'api docs']
  },
  {
    id: 'learning',
    name: 'Learning',
    icon: '📚',
    color: '#7A9B7E',
    chromeColor: 'green',
    domains: [
      'coursera.org', 'udemy.com', 'edx.org', 'khanacademy.org',
      'mdn.mozilla.org', 'developer.mozilla.org', 'w3schools.com',
      'tutorialspoint.com', 'codecademy.com', 'pluralsight.com',
      'freecodecamp.org', 'brilliant.org', 'skillshare.com',
      'duolingo.com', 'wikipedia.org', 'wikibooks.org'
    ],
    keywords: ['tutorial', 'course', 'how to', 'guide', 'documentation']
  },
  {
    id: 'media',
    name: 'Media',
    icon: '🎬',
    color: '#E07856',
    chromeColor: 'red',
    domains: [
      'youtube.com', 'youtu.be', 'netflix.com', 'hulu.com',
      'disneyplus.com', 'primevideo.com', 'spotify.com', 'twitch.tv',
      'vimeo.com', 'soundcloud.com', 'tidal.com', 'apple.com/music',
      'hotstar.com', 'jiocinema.com', 'sonyliv.com', 'zee5.com'
    ],
    keywords: ['video', 'episode', 'season', 'soundtrack', 'playlist']
  },
  {
    id: 'social',
    name: 'Social',
    icon: '💬',
    color: '#D4A574',
    chromeColor: 'yellow',
    domains: [
      'twitter.com', 'x.com', 'facebook.com', 'instagram.com',
      'linkedin.com', 'reddit.com', 'discord.com', 'tumblr.com',
      'pinterest.com', 'snapchat.com', 'tiktok.com', 'mastodon.social',
      'threads.net', 'bsky.app', 'whatsapp.com'
    ],
    keywords: []
  },
  {
    id: 'shopping',
    name: 'Shopping',
    icon: '🛍️',
    color: '#C97D60',
    chromeColor: 'pink',
    domains: [
      'amazon.com', 'amazon.in', 'amazon.co.uk', 'ebay.com',
      'etsy.com', 'walmart.com', 'target.com', 'flipkart.com',
      'alibaba.com', 'aliexpress.com', 'shopify.com', 'myntra.com',
      'meesho.com', 'ajio.com', 'nykaa.com', 'snapdeal.com',
      'bestbuy.com', 'ikea.com', 'hm.com', 'zara.com'
    ],
    keywords: ['cart', 'checkout', 'buy', 'order', 'product']
  },
  {
    id: 'news',
    name: 'News',
    icon: '📰',
    color: '#9B7B5E',
    chromeColor: 'grey',
    domains: [
      'cnn.com', 'bbc.com', 'bbc.co.uk', 'nytimes.com',
      'washingtonpost.com', 'theguardian.com', 'reuters.com',
      'medium.com', 'substack.com', 'wsj.com', 'bloomberg.com',
      'forbes.com', 'thehindu.com', 'timesofindia.indiatimes.com',
      'hindustantimes.com', 'ndtv.com', 'aljazeera.com', 'apnews.com'
    ],
    keywords: ['breaking', 'opinion', 'editorial']
  },
  {
    id: 'work',
    name: 'Work',
    icon: '💼',
    color: '#6B4423',
    chromeColor: 'cyan',
    domains: [
      'mail.google.com', 'gmail.com', 'outlook.com', 'office.com',
      'slack.com', 'teams.microsoft.com', 'notion.so', 'asana.com',
      'trello.com', 'jira.com', 'atlassian.net', 'monday.com',
      'clickup.com', 'figma.com', 'miro.com', 'zoom.us',
      'meet.google.com', 'calendar.google.com', 'drive.google.com',
      'docs.google.com', 'sheets.google.com', 'slides.google.com',
      'dropbox.com', 'onedrive.live.com', 'sharepoint.com'
    ],
    keywords: ['meeting', 'project', 'task', 'document', 'inbox']
  },
  {
    id: 'ai',
    name: 'AI',
    icon: '🤖',
    color: '#8E7CC3',
    chromeColor: 'purple',
    domains: [
      'claude.ai', 'chat.openai.com', 'chatgpt.com',
      'gemini.google.com', 'bard.google.com', 'perplexity.ai',
      'anthropic.com', 'openai.com', 'huggingface.co',
      'replicate.com', 'midjourney.com', 'character.ai'
    ],
    keywords: []
  },
  {
    id: 'search',
    name: 'Search',
    icon: '🔍',
    color: '#A8917A',
    chromeColor: 'blue',
    domains: [
      'google.com/search', 'bing.com/search', 'duckduckgo.com',
      'yahoo.com/search', 'search.brave.com', 'ecosia.org',
      'startpage.com', 'kagi.com'
    ],
    keywords: []
  }
];

const OTHER_CATEGORY = {
  id: 'other',
  name: 'Other',
  icon: '🪶',
  color: '#A89684',
  chromeColor: 'grey',
  domains: [],
  keywords: []
};

let CUSTOM_NESTS = [];

function setCustomNests(list) {
  CUSTOM_NESTS = Array.isArray(list) ? list : [];
}

function getHostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function categorizeTab(tab) {
  if (!tab || !tab.url) return OTHER_CATEGORY;
  const url = tab.url.toLowerCase();
  const host = getHostname(url);
  const title = (tab.title || '').toLowerCase();

  // Custom user nests take priority — these are explicit user choices.
  for (const cn of CUSTOM_NESTS) {
    const domains = cn.domains || [];
    for (const d of domains) {
      const dl = String(d).toLowerCase().trim();
      if (!dl) continue;
      if (host === dl || host.endsWith('.' + dl) || url.includes(dl)) {
        return {
          id: cn.id,
          name: cn.name,
          icon: cn.icon || '🪶',
          color: cn.color || '#8B6F47',
          chromeColor: cn.chromeColor || 'grey',
          domains: cn.domains,
          keywords: cn.keywords || []
        };
      }
    }
    const keywords = cn.keywords || [];
    for (const k of keywords) {
      const kl = String(k).toLowerCase().trim();
      if (kl && title.includes(kl)) {
        return {
          id: cn.id,
          name: cn.name,
          icon: cn.icon || '🪶',
          color: cn.color || '#8B6F47',
          chromeColor: cn.chromeColor || 'grey',
          domains: cn.domains,
          keywords: cn.keywords
        };
      }
    }
  }

  for (const cat of CATEGORIES) {
    for (const d of cat.domains) {
      if (host === d || host.endsWith('.' + d) || url.includes(d)) {
        return cat;
      }
    }
  }
  for (const cat of CATEGORIES) {
    for (const k of cat.keywords) {
      if (title.includes(k)) return cat;
    }
  }
  return OTHER_CATEGORY;
}

if (typeof module !== 'undefined') {
  module.exports = { CATEGORIES, OTHER_CATEGORY, categorizeTab, getHostname, setCustomNests };
}
