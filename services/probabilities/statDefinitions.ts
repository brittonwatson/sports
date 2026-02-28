
export interface StatDefinition {
    title: string;
    shortDesc: string; // For the list view or subtitle
    fullDesc: string; // For the modal "What is this?" section
    better: 'High' | 'Low'; // Is a high number better?
    impact: 'Critical' | 'High' | 'Moderate' | 'Low'; // How much does this drive winning?
}

export const STAT_DEFINITIONS: Record<string, StatDefinition> = {
    // --- Football ---
    'passing yards': {
        title: 'Passing Yards',
        shortDesc: 'Aerial Production',
        fullDesc: 'The total number of yards gained by the offense through pass plays. High passing yardage often indicates a high-tempo or trailing game script.',
        better: 'High',
        impact: 'Moderate'
    },
    'passing tds': {
        title: 'Passing TDs',
        shortDesc: 'Aerial Scoring',
        fullDesc: 'Touchdowns scored via pass plays. A key indicator of Red Zone efficiency and quarterback performance.',
        better: 'High',
        impact: 'High'
    },
    'rushing yards': {
        title: 'Rushing Yards',
        shortDesc: 'Ground Production',
        fullDesc: 'The total number of yards gained by the offense through run plays. Efficient rushing allows teams to control the clock and wear down defenses.',
        better: 'High',
        impact: 'High'
    },
    'rushing tds': {
        title: 'Rushing TDs',
        shortDesc: 'Ground Scoring',
        fullDesc: 'Touchdowns scored via run plays. Often correlates with a physical offensive line and short-yardage dominance.',
        better: 'High',
        impact: 'High'
    },
    'points': {
        title: 'Points Per Game',
        shortDesc: 'Scoring Output',
        fullDesc: 'The average number of points scored per game. This is the ultimate measure of offensive effectiveness.',
        better: 'High',
        impact: 'Critical'
    },
    'points against': {
        title: 'Points Allowed',
        shortDesc: 'Scoring Defense',
        fullDesc: 'The average number of points surrendered to opponents per game. Low points allowed correlates most strongly with championship contenders.',
        better: 'Low',
        impact: 'Critical'
    },
    'turnovers': {
        title: 'Turnovers',
        shortDesc: 'Giveaways',
        fullDesc: 'The total times the offense lost possession via Interception or Fumble. This is statistically the single most damaging event to a team\'s win probability.',
        better: 'Low',
        impact: 'Critical'
    },
    'interceptions': {
        title: 'Interceptions Thrown',
        shortDesc: 'Picks',
        fullDesc: 'Passes caught by the opposing defense. A high number suggests poor decision making or accuracy by the quarterback.',
        better: 'Low',
        impact: 'High'
    },
    'sacks': {
        title: 'Sacks',
        shortDesc: 'QB Takedowns',
        fullDesc: 'The number of times the defense tackled the quarterback behind the line of scrimmage. Sacks kill drives and create long-yardage situations.',
        better: 'High',
        impact: 'High'
    },
    '3rd down %': {
        title: '3rd Down Conversion %',
        shortDesc: 'Drive Sustainability',
        fullDesc: 'The percentage of 3rd down attempts that result in a first down. High conversion rates allow teams to sustain drives, rest their defense, and control the clock.',
        better: 'High',
        impact: 'High'
    },
    'red zone %': {
        title: 'Red Zone Efficiency',
        shortDesc: 'TD Rate inside 20',
        fullDesc: 'The percentage of drives penetrating the opponent\'s 20-yard line that result in a Touchdown. Teams that settle for Field Goals here often lose close games.',
        better: 'High',
        impact: 'High'
    },
    'yards per play': {
        title: 'Yards Per Play',
        shortDesc: 'Per-Snap Efficiency',
        fullDesc: 'The average gain per offensive snap. This removes the bias of "pace" and purely measures how efficient the offense is at moving the ball.',
        better: 'High',
        impact: 'High'
    },
    'completion %': {
        title: 'Completion %',
        shortDesc: 'Pass Accuracy',
        fullDesc: 'The percentage of pass attempts that are caught. A high percentage indicates an efficient, often short-yardage passing attack or an elite quarterback.',
        better: 'High',
        impact: 'Moderate'
    },

    // --- Basketball ---
    'field goal %': {
        title: 'Field Goal %',
        shortDesc: 'Shooting Accuracy',
        fullDesc: 'The percentage of total shots taken (2PT and 3PT) that are made. It reflects shot quality, selection, and execution.',
        better: 'High',
        impact: 'Critical'
    },
    '3-point %': {
        title: '3-Point %',
        shortDesc: 'Deep Range Accuracy',
        fullDesc: 'The percentage of shots taken from beyond the arc that are made. In the modern game, this is a critical driver of offensive rating and spacing.',
        better: 'High',
        impact: 'Critical'
    },
    'free throw %': {
        title: 'Free Throw %',
        shortDesc: 'Free Points Accuracy',
        fullDesc: 'Accuracy from the charity stripe. Crucial for closing out games in the final minutes.',
        better: 'High',
        impact: 'Moderate'
    },
    'rebounds': {
        title: 'Rebounds',
        shortDesc: 'Board Control',
        fullDesc: 'Total rebounds secured per game. Controlling the glass limits opponent second chances and initiates fast breaks.',
        better: 'High',
        impact: 'High'
    },
    'offensive rebounds': {
        title: 'Offensive Rebounds',
        shortDesc: 'Second Chances',
        fullDesc: 'Rebounds secured off a team\'s own missed shot. Creates extra possessions and high-percentage putback opportunities.',
        better: 'High',
        impact: 'Moderate'
    },
    'assists': {
        title: 'Assists',
        shortDesc: 'Ball Movement',
        fullDesc: 'Passes that lead directly to a made basket. High assist numbers indicate strong team chemistry, unselfishness, and an efficient offensive system.',
        better: 'High',
        impact: 'Moderate'
    },
    'pace': {
        title: 'Pace',
        shortDesc: 'Possessions / 48m',
        fullDesc: 'An estimate of the number of possessions a team uses per game. Fast pace leads to higher scores but not necessarily higher efficiency. It is a stylistic metric.',
        better: 'High',
        impact: 'Low'
    },
    'blocks': {
        title: 'Blocks',
        shortDesc: 'Rim Protection',
        fullDesc: 'Shots blocked by the defense. Indicates interior defensive presence and rim protection capability.',
        better: 'High',
        impact: 'Moderate'
    },
    'steals': {
        title: 'Steals',
        shortDesc: 'Disruptive Defense',
        fullDesc: 'Live-ball turnovers forced by the defense. Steals often lead directly to high-percentage transition points.',
        better: 'High',
        impact: 'High'
    },

    // --- Baseball ---
    'batting avg': {
        title: 'Batting Average',
        shortDesc: 'Hits per At-Bat',
        fullDesc: 'The classic measure of a hitter\'s success rate. While modern analytics prefer OBP/OPS, AVG remains a solid baseline for contact skills.',
        better: 'High',
        impact: 'Moderate'
    },
    'era': {
        title: 'ERA',
        shortDesc: 'Earned Run Average',
        fullDesc: 'The average number of earned runs a pitching staff gives up over 9 innings. The gold standard for measuring run prevention.',
        better: 'Low',
        impact: 'Critical'
    },
    'whip': {
        title: 'WHIP',
        shortDesc: 'Walks+Hits / Inning',
        fullDesc: 'A measure of how many baserunners a pitcher allows per inning pitched. Lower WHIP prevents big innings.',
        better: 'Low',
        impact: 'Critical'
    },
    'home runs': {
        title: 'Home Runs',
        shortDesc: 'Power Production',
        fullDesc: 'Total balls hit out of the park. The most efficient way to score runs in modern baseball.',
        better: 'High',
        impact: 'High'
    },
    'on base %': {
        title: 'On-Base %',
        shortDesc: 'OBP',
        fullDesc: 'The frequency with which a batter reaches base. OBP is considered more valuable than Batting Average as it accounts for walks.',
        better: 'High',
        impact: 'High'
    },

    // --- Hockey ---
    'goals': {
        title: 'Goals For',
        shortDesc: 'Scoring Rate',
        fullDesc: 'Goals scored per game. In a low-scoring sport like hockey, marginal differences in goal scoring are decisive.',
        better: 'High',
        impact: 'Critical'
    },
    'power play %': {
        title: 'Power Play %',
        shortDesc: 'Man Advantage',
        fullDesc: 'Percentage of power play opportunities converted into goals. Special teams are often the difference in tight games.',
        better: 'High',
        impact: 'High'
    },
    'penalty kill %': {
        title: 'Penalty Kill %',
        shortDesc: 'Shorthanded Defense',
        fullDesc: 'Percentage of opponent power plays successfully defended without conceding a goal.',
        better: 'High',
        impact: 'High'
    },
    'save %': {
        title: 'Save %',
        shortDesc: 'Goaltending',
        fullDesc: 'The percentage of shots on goal that are saved by the goaltender. This is often the single most impactful stat in hockey.',
        better: 'High',
        impact: 'Critical'
    },

    // --- Soccer ---
    'possession': {
        title: 'Possession %',
        shortDesc: 'Ball Control',
        fullDesc: 'The percentage of time a team controls the ball. While not a guarantee of victory, high possession usually correlates with creating more chances.',
        better: 'High',
        impact: 'Moderate'
    },
    'shots on target': {
        title: 'Shots on Target',
        shortDesc: 'Scoring Threats',
        fullDesc: 'Shots that are on frame and would go in if not saved. A much better predictor of goals than total shots.',
        better: 'High',
        impact: 'High'
    },
    'pass %': {
        title: 'Pass Completion',
        shortDesc: 'Distribution Accuracy',
        fullDesc: 'The percentage of passes successfully completed. High accuracy indicates technical proficiency and control.',
        better: 'High',
        impact: 'Moderate'
    },
    'clean sheets': {
        title: 'Clean Sheets',
        shortDesc: 'Shutouts',
        fullDesc: 'Matches where the team prevents the opponent from scoring a single goal.',
        better: 'High',
        impact: 'Critical'
    },

    // --- General/Fallback ---
    'default': {
        title: 'Statistic',
        shortDesc: 'Performance Metric',
        fullDesc: 'A standard measure of team performance tracked by the league.',
        better: 'High',
        impact: 'Moderate'
    }
};

export const getStatDefinition = (label: string): StatDefinition => {
    const norm = label.toLowerCase()
        .replace(' per game', '')
        .replace(' allowed', ' against')
        .replace('percentage', '%')
        .replace('pct', '%')
        .replace('avg', '')
        .trim();
        
    // Direct match
    if (STAT_DEFINITIONS[norm]) return STAT_DEFINITIONS[norm];

    // Fuzzy match keys
    const key = Object.keys(STAT_DEFINITIONS).find(k => norm.includes(k) || k.includes(norm));
    if (key) return STAT_DEFINITIONS[key];

    return { ...STAT_DEFINITIONS['default'], title: label };
};
