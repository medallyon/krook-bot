const Cache = require("node-cache")
	, request = require("request")
	, cheerio = require("cheerio")
	, { InteractionResponseType } = require("discord-interactions")
	, { Command, CommandResponse } = require(join(__libdir, "classes", "Command.js"))
	, { DefaultEmbed } = require(join(__libdir, "utils"));

const Platform = {
	PC: "pc",
	XBOX_LIVE: "xbl",
	PLAYSTATION_NETWORK: "psn",
	NINTENDO_SWITCH: "nintendo-switch"
};
const CompetitiveTiers = {
	BRONZE: "bronze",
	SILVER: "silver",
	GOLD: "gold",
	PLATINUM: "platinum",
	DIAMOND: "diamond",
	MASTER: "master",
	GRAND_MASTER: "grandmaster",
	TOP_500: "top"
};

class CompetitiveRole
{
	static get ROLES()
	{
		return {
			TANK: "tank",
			DAMAGE: "damage",
			SUPPORT: "support"
		};
	}

	static get ROLE_EMOJIS()
	{
		return {
			"tank": "<:tank:816735313921310721>",
			"damage": "<:dps:816735334243106856>",
			"support": "<:support:816735352453726250>"
		};
	}

	get emoji()
	{
		return CompetitiveRole.ROLE_EMOJIS[this.name];
	}

	constructor(name, rank)
	{
		this.name = name;
		this.rank = rank;
	}
}

class CompetitiveRank
{
	static get RANK_TIERS()
	{
		return {
			0: CompetitiveTiers.BRONZE,
			1500: CompetitiveTiers.SILVER,
			2000: CompetitiveTiers.GOLD,
			2500: CompetitiveTiers.PLATINUM,
			3000: CompetitiveTiers.DIAMOND,
			3500: CompetitiveTiers.MASTER,
			4000: CompetitiveTiers.GRAND_MASTER,
			4500: CompetitiveTiers.TOP_500 // TODO: figure out how to detect someone is "top 500"
		};
	}

	static get RANK_EMOJIS()
	{
		return {
			"bronze": "<:rankbronze:816735979062558783>",
			"silver": "<:ranksilver:816735989586198579>",
			"gold": "<:rankgold:816736010703732846>",
			"platinum": "<:rankplatinum:816736034171256894>",
			"diamond": "<:rankdiamond:816736047991226398>",
			"master": "<:rankmaster:816736096734019654>",
			"grandmaster": "<:rankgrandmaster:816736118237954068>",
			"top": "<:ranktop:816736143864627241>"
		};
	}

	get tier()
	{
		for (const level of Object.keys(CompetitiveRank.RANK_TIERS).reverse())
		{
			if (this.level >= level)
				return CompetitiveRank.RANK_TIERS[level];
		}

		return 0;
	}

	get emoji()
	{
		return CompetitiveRank.RANK_EMOJIS[this.tier];
	}

	constructor(level)
	{
		this.level = level;
	}
}

class PartialProfile
{
	get battletag()
	{
		return `${this.username}#${this.tag}`;
	}

	get url()
	{
		return `https://playoverwatch.com/career/${this.platform}/${this.battletag.replace("#", "-")}`;
	}

	get stars()
	{
		// 100 levels = 1 star, every 600 levels = remove 1 star
		return Math.floor(this.level.level / 100) - Math.floor(this.level.level / 600);
	}

	constructor(data)
	{
		const [ match, username, tag ] = data.battletag.match(/^(\w+?)#(\d+)$/);
		this.username = username;
		this.tag = tag;

		this.level = data.level;
		this.endorsementLevel = data.endorsementLevel;
		this.public = data.public;
		this.platform = data.platform;
		this.portrait = data.portrait;
	}
}

class Profile extends PartialProfile
{
	constructor(data)
	{
		super(data);

		this.mainHero = data.mainHero;
		this.stats = data.stats;
	}
}

class OverwatchProfile extends Command
{
	constructor(client)
	{
		super(client, InteractionResponseType.ACKNOWLEDGE_WITH_SOURCE, {
			name: "overwatch-profile",
			description: "Display an Overwatch Profile. Profile must be set to public.",
			permission: 100
		});

		this.cache = new Cache({
			stdTTL: 60 /* secs */ * 60 /* mins*/,
			useClones: false
		});

		this.request = request.defaults({
			baseUrl: "https://playoverwatch.com",
			json: true,
			headers: {
				"User-Agent": "krook-bot (https://github.com/medallyon/krook-bot)"
			}
		});
	}

	fetchProfile(battletag, platform = Platform.PC)
	{
		if (this.cache.has(battletag.toLowerCase()))
			return Promise.resolve(this.cache.get(battletag.toLowerCase()));

		return new Promise((resolve, reject) =>
		{
			const data = {};
			// 2 requests are required because the profile html doesn't expose the full player profile
			this.request(`/search/account-by-name/${battletag}`, (err, res, profiles) =>
			{
				if (err)
					return reject(err);

				const profile = profiles.find(x => x.name.split("#")[1] === battletag.split("#")[1]);
				if (!profile)
					return reject(new Error(`No accounts matching '${battletag}'`));

				data.id = profile.id;
				data.battletag = profile.name;
				data.public = profile.isPublic;
				data.platform = profile.platform;
				data.portrait = {
					id: profile.portrait,
					url: null
				};
				data.level = {
					level: profile.level,
					borderImageURL: null,
					starsImageURL: null
				};

				this.request(`/career/${platform}/${battletag.replace("#", "-")}`, (err, res, body) =>
				{
					if (err)
						return reject(err);

					const $ = cheerio.load(body)
						, grabBackgroundImageURL = (prop) =>
						{
							return prop.match(/^(?:url\s*\(\s*"?)?(.+?)(?:\s*"?\s*\))?$/)[1];
						};

					data.portrait.url = $(".masthead-player > .player-portrait").attr("src");
					data.level.borderImageURL = grabBackgroundImageURL($(".player-level").css("background-image"));
					data.level.starsImageURL = grabBackgroundImageURL($(".player-level > .player-rank").css("background-image"));
					data.endorsementLevel = parseInt($(".EndorsementIcon-tooltip > .u-center").first().text().trim());

					if (!data.public)
					{
						this.cache.set(battletag.toLowerCase(), new PartialProfile(data));
						return resolve(this.cache.get(battletag.toLowerCase()));
					}

					data.mainHero = {
						name: $(".masthead-hero-image").attr("data-hero-quickplay"),
						imageURL: grabBackgroundImageURL($(".masthead-hero-image").css("background-image").match(/^(?:url\s*\(\s*"?)?(.+?)(?:\s*"?\s*\))?$/)[1])
					};

					data.stats = {};
					if ($(".competitive-rank").length)
					{
						data.stats.competitive = {};

						const $roles = $(".competitive-rank-role");
						// roles are double because of mobile layout, so only get one set
						for (const r of $roles.slice(0, $roles.length / 2))
						{
							const $role = $(r)
								, $nameSection = $role.find(".competitive-rank-tier")
								, roleName = $nameSection.prop("data-ow-tooltip-text").toLowerCase().split(" ")[0]
								, roleLevel = parseInt($role.find(".competitive-rank-level").text().trim())
								, role = new CompetitiveRole(roleName, new CompetitiveRank(roleLevel));
							data.stats.competitive[roleName] = role;
						}
					}

					this.cache.set(battletag.toLowerCase(), new Profile(data));
					resolve(this.cache.get(battletag.toLowerCase()));
				});
			});
		});
	}

	buildEmbed(profile, extended = false)
	{
		const embed = new DefaultEmbed()
			.setAuthor(profile.battletag, profile.portrait.url, profile.url)
			.setThumbnail(profile.level.starsImageURL)
			.setImage(profile.mainHero.imageURL);

		embed.addField("Player Level", profile.level.level, true);
		embed.addField("Endorsement Level", profile.endorsementLevel, true);
		embed.addField("Total Stars", profile.stars, true);

		if (extended)
		{
			if (profile.stats)
			{
				const roles = Object.values(profile.stats.competitive);
				embed.addField("**Competitive**", roles.map(x => `${x.emoji} [${x.rank.emoji}] ${x.rank.level}`).join("\n"));
			}
		}

		return embed;
	}

	run(interaction)
	{
		const args = interaction.arguments;
		if (!/\w{4,32}#\d{4,5}/.test(args.battletag.value))
			return Promise.reject(new Error("'battletag' must be valid."));

		if (!args.platform)
			args.platform = { value: "pc" };

		if (!args.extended)
			args.extended = { value: false };

		return new Promise((resolve, reject) =>
		{
			this.fetchProfile(args.battletag.value, args.platform.value)
				.then(profile =>
				{
					resolve(new CommandResponse(this.buildEmbed(profile, args.extended.value)));
				}).catch(reject);
		});
	}
}

module.exports = OverwatchProfile;