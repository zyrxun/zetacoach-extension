// ZetaCoach Tier Definitions — loaded in both dashboard and content script contexts.
// Exposes window.ZetaTiers = { TIERS, getTier, svgFor }

'use strict';

(function () {

const TIER_DEFS = [
  { name: 'Unranked',    min: 0,   topPct: null },
  { name: 'Iron',        min: 15,  topPct: 80   },
  { name: 'Bronze',      min: 25,  topPct: 65   },
  { name: 'Stone',       min: 35,  topPct: 55   },
  { name: 'Silver',      min: 50,  topPct: 45   },
  { name: 'Gold',        min: 65,  topPct: 30   },
  { name: 'Platinum',    min: 80,  topPct: 18   },
  { name: 'Diamond',     min: 100, topPct: 10   },
  { name: 'Master',      min: 125, topPct: 5    },
  { name: 'Grandmaster', min: 150, topPct: 2    },
  { name: 'Elite',       min: 175, topPct: 0.5  },
  { name: 'Legend',      min: 200, topPct: 0.1  },
];

const TIER_SVGS = {
  Unranked: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <circle cx="50" cy="50" r="40" fill="#12141c" stroke="#2e3440" stroke-width="3" opacity="0.6"/>
    <circle cx="50" cy="50" r="20" fill="none" stroke="#4c566a" stroke-width="2" stroke-dasharray="4 4"/>
  </svg>`,

  Iron: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <polygon points="50,10 90,30 90,70 50,90 10,70 10,30" fill="#1a1c23" stroke="#d8dee9" stroke-width="3"/>
    <path d="M35,50 L65,50 M50,35 L50,65" stroke="#e5e9f0" stroke-width="2" opacity="0.8"/>
  </svg>`,

  Bronze: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <polygon points="50,12 88,50 50,88 12,50" fill="#1e1714" stroke="#d08770" stroke-width="3"/>
    <path d="M25,25 L75,75" stroke="#bf616a" stroke-width="4" stroke-linecap="round"/>
  </svg>`,

  Stone: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <polygon points="50,15 85,35 85,65 50,85 15,65 15,35" fill="#242933" stroke="#4c566a" stroke-width="4"/>
    <rect x="40" y="40" width="20" height="20" transform="rotate(45 50 50)" fill="#bf616a" filter="drop-shadow(0 0 4px #bf616a)"/>
  </svg>`,

  Silver: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <polygon points="50,10 90,80 10,80" fill="#1f232a" stroke="#e5e9f0" stroke-width="3"/>
    <polygon points="50,30 75,72 25,72" fill="none" stroke="#a3be8c" stroke-width="3" filter="drop-shadow(0 0 6px #a3be8c)"/>
  </svg>`,

  Gold: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <path d="M20,30 L50,15 L80,30 M20,45 L50,30 L80,45" fill="none" stroke="#ebcb8b" stroke-width="4" stroke-linecap="round"/>
    <polygon points="50,45 65,60 50,75 35,60" fill="#88c0d0" filter="drop-shadow(0 0 8px #88c0d0)"/>
  </svg>`,

  Platinum: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <polygon points="15,20 85,20 75,70 50,90 25,70" fill="#231f26" stroke="#b48ead" stroke-width="3"/>
    <path d="M30,35 L50,75 L70,35" fill="none" stroke="#b48ead" stroke-width="4" filter="drop-shadow(0 0 8px #b48ead)"/>
  </svg>`,

  Diamond: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <polygon points="50,5 95,50 50,95 5,50" fill="none" stroke="#81a1c1" stroke-width="2"/>
    <polygon points="50,18 82,50 50,82 18,50" fill="#1b222c" stroke="#88c0d0" stroke-width="4" filter="drop-shadow(0 0 10px #88c0d0)"/>
    <circle cx="50" cy="50" r="6" fill="#e5e9f0"/>
  </svg>`,

  Master: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <circle cx="50" cy="50" r="42" fill="#1c1618" stroke="#bf616a" stroke-width="4" filter="drop-shadow(0 0 5px #bf616a)"/>
    <path d="M30,40 L70,40 L65,65 L50,80 L35,65 Z" fill="none" stroke="#bf616a" stroke-width="4" filter="drop-shadow(0 0 12px #bf616a)"/>
    <path d="M40,50 L45,55 M60,50 L55,55" stroke="#e5e9f0" stroke-width="3"/>
  </svg>`,

  Grandmaster: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <rect x="20" y="20" width="60" height="60" rx="8" fill="#241e1a" stroke="#d08770" stroke-width="3"/>
    <line x1="15" y1="85" x2="85" y2="15" stroke="#d08770" stroke-width="5" filter="drop-shadow(0 0 12px #d08770)"/>
    <line x1="15" y1="15" x2="85" y2="85" stroke="#d08770" stroke-width="5" filter="drop-shadow(0 0 12px #d08770)"/>
  </svg>`,

  Elite: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <path d="M10,50 L30,15 L90,30 L70,85 Z" fill="#2b2a1a" stroke="#ebcb8b" stroke-width="4" filter="drop-shadow(0 0 8px #ebcb8b)"/>
    <path d="M35,40 L65,40 C65,65 55,75 35,80 M52,40 C52,55 48,68 38,75" fill="none" stroke="#ebcb8b" stroke-width="6" stroke-linecap="round" filter="drop-shadow(0 0 15px #ebcb8b)"/>
  </svg>`,

  Legend: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <circle cx="50" cy="55" r="30" fill="#bf616a" filter="drop-shadow(0 0 25px #bf616a)"/>
    <path d="M20,35 L35,65 L50,20 L65,65 L80,35 L70,80 L30,80 Z" fill="#1a1c23" stroke="#eceff4" stroke-width="4" filter="drop-shadow(0 0 10px #eceff4)"/>
    <line x1="20" y1="85" x2="80" y2="85" stroke="#eceff4" stroke-width="4" stroke-linecap="round"/>
  </svg>`,
};

function getTier(score) {
  let tier = TIER_DEFS[0];
  for (const t of TIER_DEFS) {
    if (score >= t.min) tier = t;
  }
  return tier;
}

function svgFor(name) {
  const svg = TIER_SVGS[name] || TIER_SVGS['Unranked'];
  // Inject a <title> child so screen readers announce the tier name.
  // Insert right after the opening <svg ...> tag.
  return svg.replace(/(<svg[^>]*>)/, `$1<title>${name} tier</title>`);
}

window.ZetaTiers = { TIERS: TIER_DEFS, getTier, svgFor };

})();
