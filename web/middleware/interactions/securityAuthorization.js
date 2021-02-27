const nacl = require("tweetnacl");

module.exports = function(req, res, next)
{
	if (process.env.NODE_ENV !== "production")
		return next();

	const signature = {
		id: req.get("X-Signature-Ed25519"),
		timestamp: req.get("X-Signature-Timestamp")
	};

	const isVerified = nacl.sign.detached.verify(
		Buffer.from(signature.timestamp + req.rawBody),
		Buffer.from(signature.id, "hex"),
		Buffer.from(process.env.DISCORD_PUBLIC_KEY, "hex")
	);

	if (!isVerified)
		return res.status(401).end("invalid request signature");

	next();
};
