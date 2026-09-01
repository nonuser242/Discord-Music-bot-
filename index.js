const {
  Client,
  GatewayIntentBits,
  Events
} = require("discord.js");

const {
  joinVoiceChannel,
  entersState,
  VoiceConnectionStatus,
  getVoiceConnection
} = require("@discordjs/voice");

// TOKEN-ka geli Environment Variables
const TOKEN = process.env.TOKEN;

if (!TOKEN) {
  console.error("❌ TOKEN lama helin! Ku dar Environment Variable: TOKEN");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ]
});

client.once(Events.ClientReady, readyClient => {
  console.log(`✅ Bot Online: ${readyClient.user.tag}`);
  console.log("🎤 Command: !connection");
});

client.on(Events.MessageCreate, async message => {
  // Ignore bots
  if (message.author.bot) return;

  // Command
  if (message.content.toLowerCase() !== "!connection") return;

  // Server only
  if (!message.guild) {
    return message.reply("❌ Command-kan Server-ka gudihiisa ku isticmaal.");
  }

  // Check user's voice channel
  const voiceChannel = message.member?.voice?.channel;

  if (!voiceChannel) {
    return message.reply(
      "❌ Marka hore gal Voice Channel, kadib qor `!connection`."
    );
  }

  try {
    // Check existing connection
    let connection = getVoiceConnection(message.guild.id);

    // Haddii bot hore ugu jiro call kale
    if (connection) {
      if (connection.joinConfig.channelId === voiceChannel.id) {
        return message.reply(
          `🎤 Hore ayaan ugu jiraa **${voiceChannel.name}**.`
        );
      }

      // Move bot to the user's current channel
      connection.destroy();
    }

    // Join Voice Channel
    connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: message.guild.id,
      adapterCreator: message.guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false
    });

    // Wait until connection is ready
    await entersState(
      connection,
      VoiceConnectionStatus.Ready,
      30_000
    );

    await message.reply(
      `✅ Waxaan galay Voice Channel-ka **${voiceChannel.name}** 🎤\n` +
      `Bot-ku iskii ugama baxayo call-ka inta uu online yahay.`
    );

    console.log(
      `🎤 Connected to ${voiceChannel.name} in ${message.guild.name}`
    );

    // Haddii connection-ku disconnect noqdo, isku day reconnect
    connection.on(
      VoiceConnectionStatus.Disconnected,
      async () => {
        try {
          console.log("⚠️ Connection disconnected. Reconnecting...");

          await Promise.race([
            entersState(
              connection,
              VoiceConnectionStatus.Signalling,
              5_000
            ),

            entersState(
              connection,
              VoiceConnectionStatus.Connecting,
              5_000
            )
          ]);
        } catch (error) {
          console.log("❌ Connection destroyed.");

          try {
            connection.destroy();
          } catch {}
        }
      }
    );

  } catch (error) {
    console.error("VOICE ERROR:", error);

    return message.reply(
      "❌ Waxaan ku guuldareystay inaan galo Voice Channel-ka."
    );
  }
});

// Error handlers
process.on("unhandledRejection", error => {
  console.error("Unhandled Promise Rejection:", error);
});

process.on("uncaughtException", error => {
  console.error("Uncaught Exception:", error);
});

client.login(TOKEN);
