const DI = require("better-discord-interactions");

class WebInteraction
{
	constructor(payload)
	{
		/**
		 * @type {Snowflake}
		 */
		this.id = payload.id;
		/**
		 * @type {String}
		 */
		this.token = payload.token;
		/**
		 * @type {Number}
		 */
		this.type = payload.type;
		/**
		 * @type {Object}
		 */
		this.command = payload.data;
		/**
		 * @type {Snowflake}
		 */
		this.guildID = payload.guild_id;
		/**
		 * @type {Snowflake}
		 */
		this.channelID = payload.channel_id;
		/**
		 * @type {Object}
		 */
		this.member = payload.member;
		/**
		 * @type {Number}
		 */
		this.version = payload.version;

		function generateOptionsObject(options = [])
		{
			if (!Array.isArray(options))
				return {};

			const out = {};
			for (const opt of options)
			{
				if (opt.type === DI.ApplicationCommandOptionType.SUB_COMMAND && Array.isArray(opt.options))
					out[opt.name] = generateOptionsObject(opt.options);
				else
					out[opt.name] = opt;
			}

			return out;
		}

		/**
		 * Any arguments, mapped as { name: { value }, ... }. Can be nested.
		 * @type {Object}
		 */
		this.arguments = generateOptionsObject(this.command.options);
	}
}

class WebInteractionResponse
{
	constructor(type, cmdResponse)
	{
		/**
		 * The Response type
		 * @type {Number}
		 */
		this.type = type;
		/**
		 * The Response, generally generated by a Command
		 * @type {CommandResponse}
		 */
		this.data = cmdResponse;
	}
}

const request = require("request")
	, { CommandResponse } = require(join(__libdir, "classes", "Command.js"))
	, { DefaultEmbed } = require(join(__libdir, "utils"));

// transforms raw properties into discord.js-compatible objects
class ClientInteraction extends WebInteraction
{
	_generateErrorEmbed(err)
	{
		return new DefaultEmbed()
			.setColor("#f04747")
			.setAuthor("Something unexpected happened.")
			.setDescription(`While trying to process the \`${this.command.name}\` command, an error ocurred:\n\`\`\`js\n${err.message}\`\`\`\nIf this keeps happening, please contact a developer.`);
	}

	async init() /* eslint-disable brace-style, no-empty */
	{
		if (this._init)
			return Promise.resolve(this);

		try
		{
			if (this.channelID != null)
			{
				this.channel = await this.client.channels.fetch(this.channelID);
				delete this.channelID;
			}
		} catch (err) {}

		try
		{
			if (this.guildID != null)
			{
				this.guild = await this.client.guilds.fetch(this.guildID);
				delete this.guildID;
			}
		} catch (err) {}

		try
		{
			if (this.member != null)
			{
				const user = await this.client.users.fetch(this.member.user.id);
				if (this.guild)
					this.member = this.guild.member(user);
				else
				{
					this.user = user;
					delete this.member;
				}
			}
		} catch (err) {}

		try
		{
			if (Object.keys(this.arguments).length)
			{
				const mentions = Object.values(this.arguments).filter(x => x.type === 6);
				for (let i = 0; i < mentions.length; i++)
				{
					const user = await this.client.users.fetch(mentions[i].value);
					this.mentions.push(user);

					if (this.guild && this.guild.members.cache.has(user.id))
						this.mentions[i] = this.guild.member(user);
				}
			}
		} catch (err) {}

		this._init = true;
		Promise.resolve(this);
	} /* eslint-enable brace-style, no-empty */

	constructor(client, data)
	{
		super(data);
		this.client = client;
		this._init = false;
		this._responded = false;

		this.mentions = [];

		const req = request.defaults({
			baseUrl: `https://discord.com/api/v8/webhooks/${this.client.user.id}/${this.token}/messages`,
			json: true,
			headers: {
				"Content-Type": "application/json",
				"User-Agent": "krook-bot (https://github.com/medallyon/krook-bot, 1.0.0)"
			}
		});
		this.update = req.defaults({ method: "PATCH" });
		this.delete = req.defaults({ method: "DELETE" });
	}

	_followup(cmdRes)
	{
		let body = cmdRes || new CommandResponse();
		if (cmdRes instanceof Error)
			body = new CommandResponse(this._generateErrorEmbed(cmdRes));

		if (body.empty)
			body = new CommandResponse("​"); // Content is a ZERO-WIDTH-SPACE!!!

		this.update("/@original", { body }, (err, r, body) =>
		{
			if (err || (body && body.errors))
				console.error(err || (body && body.errors));
		});
	}

	respond(res)
	{
		return this._followup(res);
	}
}

module.exports = {
	WebInteraction,
	WebInteractionResponse,
	ClientInteraction
};
